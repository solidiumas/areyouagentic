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
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const widgetIdRef = React.useRef<string | null>(null);
  const [scriptReady, setScriptReady] = React.useState(false);

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
