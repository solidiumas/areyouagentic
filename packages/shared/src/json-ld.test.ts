import { describe, it, expect } from 'vitest';
import { serializeJsonLd } from './json-ld.js';

describe('serializeJsonLd', () => {
  it('escapes characters that could break out of a <script> block', () => {
    const out = serializeJsonLd({ name: '</script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('\\u003c');
    expect(out).toContain('\\u003e');
  });

  it('escapes ampersands', () => {
    const out = serializeJsonLd({ q: 'a & b' });
    expect(out).toContain('\\u0026');
    expect(out).not.toMatch(/[^\\]&/);
  });

  it('escapes the U+2028 / U+2029 line separators', () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const out = serializeJsonLd({ text: `a${LS}b${PS}c` });
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
  });

  it('still round-trips to the original data', () => {
    const data = { '@type': 'FAQPage', name: 'Tom & Jerry <3' };
    // The browser's JSON parser reads the \uXXXX escapes back to the originals.
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});
