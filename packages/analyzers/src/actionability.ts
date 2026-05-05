import type { Finding } from '@areyouagentic/shared';
import type { Analyzer, AnalyzerResult } from './types.js';
import { clampScore, loadHtml, snippet } from './utils/dom.js';

export const AC_FINDINGS = {
  INPUTS_MISSING_LABEL: 'AC_INPUTS_MISSING_LABEL',
  INPUTS_MISSING_NAME: 'AC_INPUTS_MISSING_NAME',
  INPUTS_NO_AUTOCOMPLETE: 'AC_INPUTS_NO_AUTOCOMPLETE',
  WEAK_SUBMIT_TEXT: 'AC_WEAK_SUBMIT_TEXT',
  CLICKABLE_DIV_INSTEAD_OF_BUTTON: 'AC_CLICKABLE_DIV_INSTEAD_OF_BUTTON',
  WEAK_LINK_TEXT: 'AC_WEAK_LINK_TEXT',
  UNSTABLE_SELECTORS: 'AC_UNSTABLE_SELECTORS',
  IMAGES_MISSING_ALT: 'AC_IMAGES_MISSING_ALT',
  NO_SKIP_LINK: 'AC_NO_SKIP_LINK',
  NON_READABLE_URL: 'AC_NON_READABLE_URL',
} as const;

const WEAK_TEXTS = new Set([
  'click here',
  'read more',
  'learn more',
  'more',
  'here',
  'link',
  'this',
  'submit',
  'go',
  'ok',
]);

const HASH_CLASS_RE = /^[a-z0-9_-]*[A-Za-z]+_[A-Za-z0-9]{4,}$|^css-[a-z0-9]{5,}$|^[a-z]{2,4}-[a-z0-9]{6,}$/;

function looksLikeHashedClass(cls: string): boolean {
  // Heuristic: hashed class names tend to be short, contain digits + letters,
  // and have characteristic patterns (e.g. "css-1abc23d", "Button_root__a8B2c").
  return HASH_CLASS_RE.test(cls);
}

/**
 * Score (0-100) is the sum of:
 *  - Forms: input labels                   20
 *  - Forms: name + id present              10
 *  - Forms: autocomplete configured         5
 *  - Submit buttons have descriptive text  10
 *  - Real <button>/<a> not <div onclick>   15
 *  - Link/button text quality              10
 *  - Stable selectors (id / data-*)        10
 *  - Image alt text coverage               10
 *  - Skip-link present                      5
 *  - Readable URL structure                 5
 */
export const actionabilityAnalyzer: Analyzer = (input): AnalyzerResult => {
  const findings: Finding[] = [];
  const $ = loadHtml(input.renderedHtml);

  // ── Forms: inputs ────────────────────────────────────────────────
  const inputs = $('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select');
  const totalInputs = inputs.length;
  let labeled = 0;
  let withName = 0;
  let withAutocomplete = 0;

  inputs.each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id');
    const ariaLabel = $el.attr('aria-label');
    const ariaLabelledBy = $el.attr('aria-labelledby');
    let hasLabel = false;
    if (id && $(`label[for="${cssEscape(id)}"]`).length > 0) hasLabel = true;
    if (ariaLabel && ariaLabel.trim().length > 0) hasLabel = true;
    if (ariaLabelledBy && ariaLabelledBy.trim().length > 0) hasLabel = true;
    // Wrapped label
    if ($el.parents('label').length > 0) hasLabel = true;
    if (hasLabel) labeled++;
    if ($el.attr('name') && id) withName++;
    if ($el.attr('autocomplete')) withAutocomplete++;
  });

  let labelScore = 20;
  let nameScore = 10;
  let autocompleteScore = 5;
  if (totalInputs > 0) {
    const labelRatio = labeled / totalInputs;
    labelScore = Math.round(labelRatio * 20);
    if (labelRatio < 0.9) {
      findings.push({
        id: AC_FINDINGS.INPUTS_MISSING_LABEL,
        severity: labelRatio < 0.5 ? 'high' : 'medium',
        title: `${totalInputs - labeled}/${totalInputs} form inputs lack a label`,
        description: 'Inputs need a <label for>, wrapping <label>, aria-label, or aria-labelledby. Agents fill forms by matching field semantics, not coordinates.',
      });
    }

    const nameRatio = withName / totalInputs;
    nameScore = Math.round(nameRatio * 10);
    if (nameRatio < 0.9) {
      findings.push({
        id: AC_FINDINGS.INPUTS_MISSING_NAME,
        severity: 'medium',
        title: `${totalInputs - withName}/${totalInputs} inputs missing name or id`,
        description: 'Both name and id are needed: name for submission, id for label association and stable targeting.',
      });
    }

    const autocompleteRatio = withAutocomplete / totalInputs;
    autocompleteScore = Math.round(autocompleteRatio * 5);
    if (totalInputs >= 3 && autocompleteRatio < 0.3) {
      findings.push({
        id: AC_FINDINGS.INPUTS_NO_AUTOCOMPLETE,
        severity: 'low',
        title: 'Most inputs do not declare autocomplete',
        description: 'Standard autocomplete tokens (email, name, tel, address-line1, …) let browsers and agents auto-fill safely.',
      });
    }
  }

  // ── Submit buttons ───────────────────────────────────────────────
  const submitButtons = $('button[type=submit], input[type=submit], button:not([type])');
  let goodSubmitText = 0;
  let totalSubmits = submitButtons.length;
  submitButtons.each((_, el) => {
    const $el = $(el);
    const text = ($el.is('input') ? $el.attr('value') : $el.text()) ?? '';
    const trimmed = text.trim().toLowerCase();
    if (trimmed.length >= 4 && !WEAK_TEXTS.has(trimmed)) goodSubmitText++;
  });
  let submitScore = 10;
  if (totalSubmits > 0) {
    submitScore = Math.round((goodSubmitText / totalSubmits) * 10);
    if (goodSubmitText < totalSubmits) {
      findings.push({
        id: AC_FINDINGS.WEAK_SUBMIT_TEXT,
        severity: 'low',
        title: `${totalSubmits - goodSubmitText}/${totalSubmits} submit buttons have generic text`,
        description: 'Replace "Submit" / "Go" with a verb that describes the action ("Create account", "Send message").',
      });
    }
  }

  // ── Buttons vs clickable divs ────────────────────────────────────
  const realButtons = $('button, a[href], input[type=submit], input[type=button]').length;
  const clickableDivs = $('div[onclick], span[onclick], div[role=button], span[role=button]').length;
  let buttonScore: number;
  if (clickableDivs === 0) {
    buttonScore = 15;
  } else if (clickableDivs <= Math.max(1, realButtons / 5)) {
    buttonScore = 10;
  } else {
    buttonScore = 0;
    findings.push({
      id: AC_FINDINGS.CLICKABLE_DIV_INSTEAD_OF_BUTTON,
      severity: 'medium',
      title: `${clickableDivs} clickable <div>/<span> elements found`,
      description: 'Use real <button> or <a> for actions; otherwise keyboard users and agents can\'t reliably trigger them.',
    });
  }

  // ── Link/button text quality ─────────────────────────────────────
  const interactive = $('button, a[href]');
  let weakText = 0;
  let totalText = 0;
  interactive.each((_, el) => {
    const $el = $(el);
    const text = ($el.text() || $el.attr('aria-label') || '').trim().toLowerCase();
    if (text.length === 0) return;
    totalText++;
    if (WEAK_TEXTS.has(text) || text.length < 3) weakText++;
  });
  let textScore = 10;
  if (totalText > 0) {
    textScore = Math.round(((totalText - weakText) / totalText) * 10);
    if (weakText > 2) {
      findings.push({
        id: AC_FINDINGS.WEAK_LINK_TEXT,
        severity: 'low',
        title: `${weakText} interactive elements use generic text ("click here", "more")`,
        description: 'Descriptive text helps agents disambiguate destinations.',
      });
    }
  }

  // ── Stable selectors ─────────────────────────────────────────────
  const allInteractive = $('button, a[href], input, select, textarea, [role=button]');
  const sampleSize = Math.min(20, allInteractive.length);
  let stableCount = 0;
  if (sampleSize > 0) {
    const stride = allInteractive.length / sampleSize;
    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor(i * stride);
      const $el = allInteractive.eq(idx);
      const id = $el.attr('id');
      const attribs = ($el.get(0) as { attribs?: Record<string, string> } | undefined)?.attribs ?? {};
      const hasDataAttr = Object.keys(attribs).some((k) => k.startsWith('data-'));
      const cls = $el.attr('class') ?? '';
      const allClassesHashed = cls.length > 0 && cls.split(/\s+/).every(looksLikeHashedClass);

      if ((id && !looksLikeHashedClass(id)) || hasDataAttr) {
        stableCount++;
      } else if (cls.length > 0 && !allClassesHashed) {
        // Readable class names earn half-credit for stability.
        stableCount += 0.5;
      }
    }
  }
  const stabilityRatio = sampleSize === 0 ? 1 : stableCount / sampleSize;
  let stabilityScore = Math.round(stabilityRatio * 10);
  if (sampleSize >= 5 && stabilityRatio < 0.4) {
    findings.push({
      id: AC_FINDINGS.UNSTABLE_SELECTORS,
      severity: 'medium',
      title: 'Most interactive elements have only hashed class names',
      description: 'Add stable id or data-testid / data-* attributes so agents and tests can target elements without screen-coordinate guessing.',
    });
  }

  // ── Image alt text ───────────────────────────────────────────────
  const images = $('img');
  let withAlt = 0;
  images.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt !== undefined) withAlt++;
  });
  const altRatio = images.length === 0 ? 1 : withAlt / images.length;
  let altScore = Math.round(altRatio * 10);
  if (images.length > 0 && altRatio < 0.9) {
    findings.push({
      id: AC_FINDINGS.IMAGES_MISSING_ALT,
      severity: 'medium',
      title: `${images.length - withAlt}/${images.length} images missing alt attribute`,
      description: 'Use alt="" for decorative images and a description for informative ones. Required for screen readers and useful to agents.',
    });
  }

  // ── Skip link ────────────────────────────────────────────────────
  let skipLinkScore = 0;
  const skipCandidates = $('a[href^="#"]').filter((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    return /skip/.test(text) && /(content|main|nav)/.test(text);
  });
  if (skipCandidates.length > 0) {
    skipLinkScore = 5;
  } else {
    findings.push({
      id: AC_FINDINGS.NO_SKIP_LINK,
      severity: 'info',
      title: 'No "skip to content" link found',
      description: 'A skip link is a small accessibility win and gives agents a fast path to the main content.',
    });
  }

  // ── URL readability ──────────────────────────────────────────────
  let urlScore = 5;
  const urlBad = !isReadableUrl(input.finalUrl);
  if (urlBad) {
    urlScore = 0;
    findings.push({
      id: AC_FINDINGS.NON_READABLE_URL,
      severity: 'low',
      title: 'URL contains session IDs, uppercase, or random tokens',
      description: 'Readable, lowercase, hyphenated paths are easier for agents to reason about and quote in answers.',
      evidence: snippet(input.finalUrl, 120),
    });
  }

  const score = clampScore(
    labelScore +
      nameScore +
      autocompleteScore +
      submitScore +
      buttonScore +
      textScore +
      stabilityScore +
      altScore +
      skipLinkScore +
      urlScore,
  );

  return {
    score,
    findings,
    metrics: {
      totalInputs,
      labeled,
      withName,
      withAutocomplete,
      totalSubmits,
      goodSubmitText,
      realButtons,
      clickableDivs,
      weakText,
      totalText,
      stabilityRatio,
      images: images.length,
      withAlt,
      hasSkipLink: skipCandidates.length > 0,
      urlReadable: !urlBad,
      subScores: {
        labelScore,
        nameScore,
        autocompleteScore,
        submitScore,
        buttonScore,
        textScore,
        stabilityScore,
        altScore,
        skipLinkScore,
        urlScore,
      },
    },
  };
};

function cssEscape(value: string): string {
  return value.replace(/[\\"\]\[]/g, '\\$&');
}

function isReadableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const path = u.pathname;
  if (path.length <= 1) return true; // root path is fine
  if (/[A-Z]/.test(path)) return false;
  // Session-id-like params or path segments
  if (/[?&](?:sid|sessionid|jsessionid|phpsessid)=/i.test(u.search)) return false;
  for (const seg of path.split('/').filter(Boolean)) {
    if (seg.length > 40) return false;
    // 24+ hex/base64 chars that look like a token
    if (/^[a-f0-9]{16,}$/i.test(seg)) return false;
    if (/^[A-Za-z0-9+/=_-]{32,}$/.test(seg) && !/[a-z]-[a-z]/.test(seg)) return false;
  }
  return true;
}
