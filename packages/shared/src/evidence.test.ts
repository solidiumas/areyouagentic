import { describe, expect, it } from 'vitest';
import { extractScreenshotKeys } from './evidence.js';

const capturedAt = '2026-07-07T00:00:00.000Z';

function screenshotItem(url: string) {
  return {
    id: 'e1',
    type: 'screenshot' as const,
    url,
    contentType: 'image/png',
    capturedAt,
  };
}

describe('extractScreenshotKeys', () => {
  it('extracts the object key from a screenshot evidence URL', () => {
    const evidence = [
      screenshotItem('https://pub-abc.r2.dev/screenshots/cm4xyz123.png'),
      { id: 'e2', type: 'robots-txt' as const, inline: 'User-agent: *', capturedAt },
    ];
    expect(extractScreenshotKeys(evidence)).toEqual(['screenshots/cm4xyz123.png']);
  });

  it('handles UUID-style keys (hyphens)', () => {
    const evidence = [
      screenshotItem('https://pub-abc.r2.dev/screenshots/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.png'),
    ];
    expect(extractScreenshotKeys(evidence)).toEqual([
      'screenshots/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d.png',
    ]);
  });

  it('ignores screenshot items without a url (inline-only)', () => {
    const evidence = [{ id: 'e1', type: 'screenshot' as const, capturedAt }];
    expect(extractScreenshotKeys(evidence)).toEqual([]);
  });

  it('ignores URLs whose path is not a screenshots/ key', () => {
    const evidence = [screenshotItem('https://example.com/other/path.png')];
    expect(extractScreenshotKeys(evidence)).toEqual([]);
  });

  it('returns [] for malformed evidence instead of throwing', () => {
    expect(extractScreenshotKeys(null)).toEqual([]);
    expect(extractScreenshotKeys('not-an-array')).toEqual([]);
    expect(extractScreenshotKeys([{ bogus: true }])).toEqual([]);
  });
});
