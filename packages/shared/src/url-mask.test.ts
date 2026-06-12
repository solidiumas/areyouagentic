import { describe, it, expect } from 'vitest';
import { maskSensitiveUrl, REDACTED } from './url-mask.js';

describe('maskSensitiveUrl', () => {
  it('redacts a token query param but keeps the param name', () => {
    const out = maskSensitiveUrl('https://example.com/reset?token=supersecret&page=2');
    expect(out).toContain(`token=${encodeURIComponent(REDACTED)}`);
    expect(out).not.toContain('supersecret');
    expect(out).toContain('page=2');
  });

  it('redacts a range of secret-bearing params', () => {
    const params = [
      'access_token',
      'refresh_token',
      'api_key',
      'apikey',
      'client_secret',
      'password',
      'pwd',
      'sig',
      'signature',
      'sessionid',
      'auth',
      'otp',
      'code',
    ];
    for (const p of params) {
      const out = maskSensitiveUrl(`https://example.com/x?${p}=LEAK`);
      expect(out, `${p} should be redacted`).not.toContain('LEAK');
    }
  });

  it('leaves ordinary params untouched', () => {
    const out = maskSensitiveUrl('https://example.com/search?q=cats&lang=en&zipcode=90210');
    expect(out).toContain('q=cats');
    expect(out).toContain('lang=en');
    expect(out).toContain('zipcode=90210');
  });

  it('does not over-redact lookalike names (keyword, encode)', () => {
    const out = maskSensitiveUrl('https://example.com/?keyword=hello&encode=1');
    expect(out).toContain('keyword=hello');
    expect(out).toContain('encode=1');
  });

  it('strips embedded credentials', () => {
    const out = maskSensitiveUrl('https://user:pass@example.com/path');
    expect(out).not.toContain('user:pass');
    expect(out).toContain('example.com/path');
  });

  it('redacts case-insensitively', () => {
    const out = maskSensitiveUrl('https://example.com/?ACCESS_TOKEN=LEAK');
    expect(out).not.toContain('LEAK');
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(maskSensitiveUrl('not a url')).toBe('not a url');
  });

  it('accepts a URL instance', () => {
    const out = maskSensitiveUrl(new URL('https://example.com/?secret=x'));
    expect(out).not.toContain('=x');
  });
});
