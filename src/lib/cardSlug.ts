// src/lib/cardSlug.ts
// Block 4B-W-1 — pure helpers for the PriceCharting slug split.
//
// PokePrices stores card identifiers in two shapes today:
//
//   * cards.card_slug         — bare numeric  (e.g. "959616")
//   * daily_prices.card_slug  — pc- prefixed  (e.g. "pc-959616")
//
// The conversion is currently reinvented across 14 files and 28 call
// sites (see docs/recent-sales-architecture.md → "pc-prefix call
// sites for the deferred refactor"). This module centralises the
// conversion so new recent-sales code can use a single typed helper.
//
// Scope of this block: helpers are USED ONLY by newly added recent-
// sales / provider-identity code. Existing call sites remain
// untouched until a dedicated refactor block.
//
// Design rules:
//   * Pure: no I/O, no Supabase calls, safe to import anywhere.
//   * Idempotent: prefixing twice does NOT produce "pc-pc-959616".
//   * Type-narrowing: TypeScript distinguishes BareCardSlug and
//     PriceCardSlug at compile time.
//   * Strict: rejects empty / non-numeric / whitespace / control
//     characters. Returns null on bad input rather than throwing.

const PC_PREFIX = 'pc-'
const NUMERIC_RE = /^\d+$/

// Branded string types so callers can require one form without
// accidentally passing the other.
declare const __bareCardSlug__:  unique symbol
declare const __priceCardSlug__: unique symbol
export type BareCardSlug  = string & { readonly [__bareCardSlug__]:  'bare'  }
export type PriceCardSlug = string & { readonly [__priceCardSlug__]: 'price' }

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

function stripControl(s: string): string {
  // Drop NULs, tabs, newlines and other ASCII control chars before
  // any validation.
  return s.replace(/[\x00-\x1F\x7F]/g, '').trim()
}

function isNumericString(s: string): boolean {
  return NUMERIC_RE.test(s) && s.length > 0 && s.length <= 32
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns true when the input looks like a pc-prefixed slug.
 * "pc-959616"  → true
 * "959616"     → false
 * "pc-"        → false  (empty body)
 * null / "" / non-string → false
 *
 * Does NOT accept "pc-pc-959616" — the body must itself be a valid
 * bare slug.
 */
export function isPriceCardSlug(value: unknown): value is PriceCardSlug {
  if (typeof value !== 'string') return false
  const s = stripControl(value)
  if (!s.startsWith(PC_PREFIX)) return false
  const body = s.slice(PC_PREFIX.length)
  return isNumericString(body)
}

/**
 * Normalises any accepted form to the bare numeric slug. Returns null
 * when the input is malformed.
 *
 *   "959616"           → "959616"
 *   "pc-959616"        → "959616"
 *   "  pc-959616  "    → "959616"
 *   "PC-959616"        → null         (case-sensitive: PC ≠ pc)
 *   "pc-pc-959616"     → null         (double-prefix rejected at validation)
 *   "959616x"          → null         (non-numeric)
 *   ""  / null / 42    → null
 */
export function toBareCardSlug(value: unknown): BareCardSlug | null {
  if (typeof value !== 'string') return null
  const s = stripControl(value)
  if (!s) return null
  if (s.startsWith(PC_PREFIX)) {
    const body = s.slice(PC_PREFIX.length)
    return isNumericString(body) ? (body as BareCardSlug) : null
  }
  return isNumericString(s) ? (s as BareCardSlug) : null
}

/**
 * Normalises any accepted form to the pc-prefixed slug. Idempotent:
 * already-prefixed input round-trips unchanged.
 *
 *   "959616"           → "pc-959616"
 *   "pc-959616"        → "pc-959616"
 *   "pc-pc-959616"     → null
 *   ""  / null / 42    → null
 */
export function toPriceCardSlug(value: unknown): PriceCardSlug | null {
  const bare = toBareCardSlug(value)
  if (!bare) return null
  return (PC_PREFIX + bare) as PriceCardSlug
}

/**
 * Best-effort extractor: pulls the numeric PriceCharting product id
 * out of either a slug, a pc-prefixed slug, or a PriceCharting URL
 * (e.g. "https://www.pricecharting.com/game/pokemon-base-set/959616").
 *
 * Returns null when no product id can be located.
 *
 *   "959616"
 *   "pc-959616"
 *   "https://www.pricecharting.com/.../959616"
 *   "https://www.pricecharting.com/.../959616?q=1"
 *   "/some/path/959616/"
 *     → all return "959616" as BareCardSlug
 *
 *   "https://example.com/no-id-here"            → null
 *   "https://www.pricecharting.com/.../abcdef"  → null
 */
export function extractPriceChartingProductId(value: unknown): BareCardSlug | null {
  if (typeof value !== 'string') return null
  const s = stripControl(value)
  if (!s) return null

  // Direct slug / pc-prefixed slug path.
  const direct = toBareCardSlug(s)
  if (direct) return direct

  // URL path: find the last numeric segment.
  // Accepts protocols + query strings + trailing slashes.
  const matches = s.match(/(?:^|[\/?#=])(\d{3,12})(?=$|[\/?#&])/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  // Strip the leading separator captured by (?:^|[\/?#=]).
  const cleaned = last.replace(/^[\/?#=]/, '')
  return isNumericString(cleaned) ? (cleaned as BareCardSlug) : null
}
