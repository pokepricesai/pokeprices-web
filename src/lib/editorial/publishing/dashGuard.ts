// src/lib/editorial/publishing/dashGuard.ts
//
// Deterministic dash cleanup for editorial prose.
//
// AI models sometimes emit em dashes (U+2014, "—") and en dashes
// (U+2013, "–") despite explicit prompt rules against them. This
// module is the last-line safety net that runs on the finalised
// insight payload immediately before it is written to the database,
// so no article can reach the site with stray dashes.
//
// Ordinary hyphens ("-") in compound words like "30-year",
// "high-value", "first-edition" are LEFT ALONE. URL characters
// inside href attributes are LEFT ALONE. The guard only touches
// human-visible text.
//
// Replacement heuristic:
//   ` — ` / ` –  ` (dashes with surrounding whitespace)   → `, `
//   `—` / `–`     (bare dashes not surrounded by whitespace) → `, `
//   After substitution, collapse duplicated commas and any double
//   spaces the replacement may leave behind.
//
// This produces grammatically-safe prose in almost all cases. Awkward
// phrasing is rare and always preferable to shipping the character
// the writer was told to avoid. The primary defence is the prompt;
// this is belt-and-braces.

const EM_DASH = '—'
const EN_DASH = '–'
const DASH_REGEX = /\s*[—–]\s*/g

// A numeric-ish token: optional $, digits with commas/decimals, optional
// unit suffix (%, k/K/M/m/B/b). Matches "1996", "$50", "1.5", "12%",
// "1,000", "$5k", "10M". Not exhaustive but covers the ranges the
// writers actually produce.
const NUMERIC_TOKEN = String.raw`\$?\d[\d,.]*[%kKmMbB]?`
const NUMERIC_RANGE_EN_DASH = new RegExp(`(${NUMERIC_TOKEN})\\s*–\\s*(${NUMERIC_TOKEN})`, 'g')

/** Strip em / en dashes from a single string. Returns the original
 *  string unchanged when it contains neither.
 *
 *  Numeric-range en dashes ("1996–2026", "$50–$100", "5–10 cards")
 *  become " to " so ranges stay readable. All other em / en dashes
 *  become ", " (with duplicate-comma + double-space collapse). Em
 *  dashes are prose punctuation; they never mean "range". */
export function stripDashesFromText(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input
  if (input.indexOf(EM_DASH) < 0 && input.indexOf(EN_DASH) < 0) return input
  // Ranges first, so the second pass doesn't turn them into commas.
  const withRanges = input.replace(NUMERIC_RANGE_EN_DASH, '$1 to $2')
  const withCommas = withRanges.replace(DASH_REGEX, ', ')
  return normaliseCommasAndSpaces(withCommas)
}

/** Collapse double commas + double spaces that dash → comma
 *  substitution can produce ("word , next" → "word, next"). */
function normaliseCommasAndSpaces(s: string): string {
  return s
    .replace(/ +,/g, ',')        // strip whitespace directly before a comma
    .replace(/,\s*,/g, ',')       // collapse comma repeats
    .replace(/  +/g, ' ')          // collapse multi-space
    .replace(/,\s*\./g, '.')       // collapse ", ." → "."
    .replace(/,\s*$/,  '')         // trim trailing comma at end of string
    .replace(/^\s*,\s*/, '')       // trim leading comma at start of string
}

// ─────────────────────────────────────────────────────────────────
// InsightBlock walker
// ─────────────────────────────────────────────────────────────────
//
// Traverses the CMS body_json shape produced by
// studioDocumentToInsightBody and replaces dashes only in
// text-carrying fields. Link href attributes are left alone. The
// walker is defensive against unknown block shapes — anything it
// does not recognise passes through untouched.

type InsightBlock = any

export function stripDashesFromInsightBody(body: { blocks: InsightBlock[] } | null | undefined): { blocks: InsightBlock[] } | null | undefined {
  if (!body || !Array.isArray(body.blocks)) return body
  return { blocks: body.blocks.map(cleanBlock) }
}

function cleanBlock(block: InsightBlock): InsightBlock {
  if (!block || typeof block !== 'object') return block
  const out: any = { ...block }
  if (typeof block.text === 'string') out.text = stripDashesFromText(block.text)
  if (Array.isArray(block.content)) out.content = block.content.map(cleanSpan)
  if (Array.isArray(block.items))   out.items   = block.items.map((item: any) => Array.isArray(item) ? item.map(cleanSpan) : cleanSpan(item))
  // dataBlock: payload is opaque market data (numeric + slugs) — do
  // NOT touch it. Ordinary hyphens in url slugs and Pokémon names
  // are legitimate.
  return out
}

function cleanSpan(span: any): any {
  if (!span || typeof span !== 'object') return span
  if (typeof span.text !== 'string') return span
  // Never touch link marks — but the visible anchor text (`text`) is
  // fair game. Marks carry href/mark type/etc.
  return { ...span, text: stripDashesFromText(span.text) }
}

// ─────────────────────────────────────────────────────────────────
// Markdown pass-through
// ─────────────────────────────────────────────────────────────────
//
// Runs the same replacement over Markdown text, but skips URLs
// inside `[anchor](https://...)` link forms so an unusual link
// containing an em dash cannot be corrupted.

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\((\S+?)\)/g

export function stripDashesFromMarkdown(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input
  if (input.indexOf(EM_DASH) < 0 && input.indexOf(EN_DASH) < 0) return input
  // Extract every Markdown link, protect the URL, clean anchor + prose,
  // then reassemble.
  const parts: string[] = []
  let cursor = 0
  let m: RegExpExecArray | null
  const rx = new RegExp(MARKDOWN_LINK_RE.source, 'g')
  while ((m = rx.exec(input)) !== null) {
    if (m.index > cursor) parts.push(stripDashesFromText(input.slice(cursor, m.index)))
    parts.push(`[${stripDashesFromText(m[1])}](${m[2]})`)
    cursor = m.index + m[0].length
  }
  if (cursor < input.length) parts.push(stripDashesFromText(input.slice(cursor)))
  return parts.join('')
}

// ─────────────────────────────────────────────────────────────────
// Detection helper (used by tests + preflight warnings)
// ─────────────────────────────────────────────────────────────────

/** True when the input contains ANY em or en dash. Cheap; used to
 *  short-circuit expensive walks and to power test assertions. */
export function containsAnyDash(input: string): boolean {
  return typeof input === 'string' && (input.indexOf(EM_DASH) >= 0 || input.indexOf(EN_DASH) >= 0)
}

/** Deep containment check for the CMS body shape. Returns the first
 *  dash-carrying text fragment (up to 60 chars) it finds, or null. */
export function findDashInBody(body: { blocks: InsightBlock[] } | null | undefined): string | null {
  if (!body || !Array.isArray(body.blocks)) return null
  for (const b of body.blocks) {
    if (typeof b?.text === 'string' && containsAnyDash(b.text)) return b.text.slice(0, 60)
    if (Array.isArray(b?.content)) for (const c of b.content) if (typeof c?.text === 'string' && containsAnyDash(c.text)) return c.text.slice(0, 60)
    if (Array.isArray(b?.items)) {
      for (const item of b.items) {
        if (Array.isArray(item)) {
          for (const c of item) if (typeof c?.text === 'string' && containsAnyDash(c.text)) return c.text.slice(0, 60)
        } else {
          const t = (item as any)?.text
          if (typeof t === 'string' && containsAnyDash(t)) return t.slice(0, 60)
        }
      }
    }
  }
  return null
}
