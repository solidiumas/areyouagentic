'use client';

import * as React from 'react';
import Script from 'next/script';

/** Public site key. When unset (the default), the widget is fully inert. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

/** Imperative surface for parents that need to reset the widget (see below). */
export type TurnstileWidgetHandle = {
  /** Discard the current token and re-run the challenge to mint a fresh one. */
  reset: () => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile widget. Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * is configured; otherwise it renders nothing and reports a `null` token, so
 * the captcha is opt-in and the default build pulls in no third-party script.
 *
 * Tokens are single-use: once submitted to the server they are spent whether
 * the request succeeded or not, so forms must call `ref.reset()` after every
 * submit attempt to mint a fresh token for the next try.
 */
export function TurnstileWidget({
  onToken,
  ref,
}: {
  onToken: (token: string | null) => void;
  ref?: React.Ref<TurnstileWidgetHandle>;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const [scriptReady, setScriptReady] = React.useState(false);

  React.useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        // Clear the parent's stored token first so a resubmit racing the new
        // challenge can't replay the spent one. Guard the widget call: with no
        // site key (or before the script loads) there is nothing to reset.
        onToken(null);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }),
    [onToken],
  );

  React.useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !scriptReady || !containerRef.current || !window.turnstile) return;
    const api = window.turnstile;
    const el = containerRef.current;
    widgetIdRef.current = api.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => onToken(token),
      'error-callback': () => onToken(null),
      'expired-callback': () => onToken(null),
    });
    return () => {
      if (widgetIdRef.current) api.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [scriptReady, onToken]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div ref={containerRef} className="mt-3" />
    </>
  );
}
