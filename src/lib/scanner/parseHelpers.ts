// src/lib/scanner/parseHelpers.ts
//
// Block 5A-W-51A — pure isomorphic parse helpers for the card
// scanner. Deliberately duplicated verbatim into
// supabase/functions/scan-card/index.ts (the Deno edge function can't
// import from src/), so the boundary test in
// __tests__/scanMatchMigration.test.ts checks that both copies stay
// in sync.
//
// All functions here are:
//   * pure (no I/O, no globals, no Deno APIs)
//   * safe to run from any environment (Node, Deno, browser)
//   * covered by focused unit tests in parseHelpers.test.ts
//
// The scanner problem 51A fixes is Japanese OCR + language routing.
// These helpers do not touch OCR — they handle post-OCR text.

// ── Promo prefix catalogue ──────────────────────────────
//
// Codes that appear in Pokemon collector numbers as a prefix rather
// than a numerator. Modern SV era + heritage promos. Extended in 51A
// with common Japanese subset codes (S, SM, SV variants have been
// verified against real Japanese card printings), but the actual
// Japanese Battle Partners cards use plain fraction numbers like
// "102/130" so this is defensive coverage, not the primary fix.
export const PROMO_PREFIXES = 'TG|GG|SV|SVP|SWSH|XY|SM|BW|DP|HGSS|POP|BS'

export const NUMBER_PATTERNS: { name: string; re: RegExp; reassemble?: (m: RegExpMatchArray) => string }[] = [
  { name: 'fraction-prefixed', re: new RegExp(`\\b((?:${PROMO_PREFIXES})[-_]?\\d{1,3}\\s*\\/\\s*(?:${PROMO_PREFIXES})[-_]?\\d{1,3})\\b`, 'i') },
  { name: 'fraction-numeric',  re: /\b(\d{1,3}\s*\/\s*\d{1,3})\b/ },
  { name: 'fraction-loose',    re: /\b(\d{1,3})\s*[\-_|]\s*(\d{1,3})\b/, reassemble: (m) => `${m[1]}/${m[2]}` },
  { name: 'fraction-space',    re: /\b(\d{1,3})\s+(\d{2,3})\b/, reassemble: (m) => parseInt(m[2], 10) >= 30 ? `${m[1]}/${m[2]}` : '' },
  { name: 'promo-prefixed',    re: new RegExp(`\\b((?:${PROMO_PREFIXES})[-_]?\\d{1,3})\\b`, 'i') },
]

export function extractCollectorNumber(text: string): { value: string | null; pattern: string | null } {
  const norm = text.replace(/\s*\/\s*/g, '/')
  for (const p of NUMBER_PATTERNS) {
    const m = norm.match(p.re)
    if (m) {
      const raw = p.reassemble ? p.reassemble(m) : m[1]
      if (!raw) continue
      return { value: raw.toUpperCase().replace(/\s+/g, ''), pattern: p.name }
    }
  }
  return { value: null, pattern: null }
}

// ── Language detection ─────────────────────────────────
//
// Positive Japanese signal: any character in the CJK Unified
// Ideographs range, or Hiragana, or Katakana. Latin-only text (English
// cards) never matches.
//
// This is intentionally coarse — the goal is a language-preference
// hint for the matcher, not a linguistic analysis. If OCR extracted
// even one Hiragana character, this scan almost certainly came from a
// Japanese-market card.
//
// Ranges covered:
//   * U+3040-U+309F  Hiragana
//   * U+30A0-U+30FF  Katakana
//   * U+4E00-U+9FFF  CJK Unified Ideographs (Kanji)
//   * U+FF66-U+FF9F  Halfwidth Katakana (some OCR outputs use these)
//
// Full-width Latin (U+FF01-U+FF5E) is NOT counted as Japanese —
// English cards printed in Asian markets can pick up wide-form ASCII.
const CJK_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/

export type DetectedLanguage = 'en' | 'jp' | null

/**
 * Returns 'jp' if the text contains any Hiragana / Katakana / Kanji,
 * 'en' if the text is non-empty Latin-only, null if the text is
 * empty. Callers should treat null as "no signal" and NOT filter
 * candidates — the null case is common when OCR returned nothing
 * (poor lighting, blurred image).
 */
export function detectCardLanguageFromText(text: string | null | undefined): DetectedLanguage {
  if (!text) return null
  if (CJK_RE.test(text)) return 'jp'
  // Require at least one Latin letter before claiming EN — a text
  // that's only digits/punctuation is ambiguous.
  if (/[A-Za-z]/.test(text)) return 'en'
  return null
}

// ── Promo flag ─────────────────────────────────────────
//
// Positive promo signal: a promo-prefixed collector number, the
// word "promo(tional)", or "black star". Kept intentionally narrow —
// downstream ranking already handles ambiguity.
export function extractIsPromo(text: string, collectorPattern: string | null): boolean {
  if (collectorPattern === 'promo-prefixed') return true
  return /\bpromo(?:tional)?\b/i.test(text) || /\bblack\s*star\b/i.test(text)
}
