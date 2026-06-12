/**
 * Serialize a JSON-LD object for safe inlining inside a
 * `<script type="application/ld+json">` block.
 *
 * `JSON.stringify` alone is unsafe here: a `<` / `>` / `&` in any string value
 * could close the script element or start a comment, and the JS line
 * separators U+2028/U+2029 are invalid in a script context. We escape all of
 * them to their `\uXXXX` forms. The result is still valid JSON-LD (the escapes
 * are equivalent), but can never break out of the script element.
 *
 * Today the structured-data blocks are built from static site config, so this
 * is defense-in-depth — but it means the helper stays safe if a value ever
 * becomes dynamic.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
