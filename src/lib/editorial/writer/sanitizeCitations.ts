// src/lib/editorial/writer/sanitizeCitations.ts
//
// Deterministic sanitizer for web-search citation markup. Anthropic's
// server-side web_search tool sometimes emits inline citation tags
// alongside plain prose (usually `<cite index="21-14">...</cite>` or
// its parenthesis-form / Markdown-escaped variants) and those tags
// were leaking through the two-stage external Writer path into
// Studio and the published article.
//
// Small, focused module: strip opening + closing citation tags,
// preserve inner text, do NOT touch normal Markdown links.

/** Remove citation markup while preserving inner text.
 *
 *  Handles:
 *    * `<cite index="21-14">text</cite>`                — standard
 *    * `<cite index="21-14,21-15">text</cite>`          — multi-index
 *    * `(cite index="29-7">text</cite>`                 — paren-opening
 *    * `\<cite index="21-14"\>text\</cite\>`            — Markdown-escaped
 *    * `\(cite index="29-7"\>text\)/cite\)`             — belt + braces
 *
 *  Does NOT touch:
 *    * `[anchor](https://...)` Markdown links
 *    * plain prose containing the word "cite" outside a tag
 *    * heading / list / paragraph structure
 *
 *  Empty / falsy input is returned as-is.
 */
export function stripCitationMarkup(input: string): string {
  if (!input || typeof input !== 'string') return input

  let out = input

  // Opening tags: <cite ...>, (cite ...>, escaped variants. `[^>)]*`
  // captures the attribute run (index="..." plus anything before the
  // closing bracket). `\b` after `cite` prevents matching words like
  // `<citefoo>`.
  out = out.replace(/\\?[<(]\s*cite\b[^>)]*\\?[>)]/gi, '')

  // Closing tags: </cite>, )/cite), escaped variants.
  out = out.replace(/\\?[<(]\s*\/\s*cite\s*\\?[>)]/gi, '')

  return out
}

/** Apply stripCitationMarkup to every string field of an article-
 *  shaped object. Non-string fields untouched. Returns a new
 *  object; input is not mutated. */
export function stripCitationMarkupFromArticle<T extends Record<string, unknown>>(article: T): T {
  const out: Record<string, unknown> = { ...article }
  for (const key of Object.keys(out)) {
    const value = out[key]
    if (typeof value === 'string') out[key] = stripCitationMarkup(value)
  }
  return out as T
}
