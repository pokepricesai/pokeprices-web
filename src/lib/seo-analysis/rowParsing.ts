// src/lib/seo-analysis/rowParsing.ts
// Block 5A-W-33B — robust parsing helpers for GSC / Bing ranking-row
// exports.
//
// Two bugs caught in the W33 re-run:
//
//   1. GSC sometimes ships an unreliable CTR column. For example, a
//      row with 4 clicks / 1,580 impressions has an actual CTR of
//      0.25% but the CSV's `CTR` field reads "25.00%" — a 100× error
//      that silently broke every opportunity filter (everything looked
//      well above the 1% threshold). Solution: ALWAYS compute CTR
//      from clicks/impressions when both are present. Fall back to
//      the CTR column only when clicks or impressions are missing.
//
//   2. Bing's column is `Avg. Position` (with a period). The previous
//      regex matched `Position` or `Average position` exactly, so
//      every Bing row got position = 0 and dropped out of the
//      opportunity filter band. Solution: widen the accepted column
//      list to every variant we've seen in real exports.

/**
 * Column-name candidates the runner should pickFirst() across when
 * looking for an average-position field. Order doesn't matter —
 * pickFirst returns the first non-empty value across the row.
 */
export const POSITION_COLUMN_CANDIDATES: readonly string[] = [
  'Position',
  'Average position',
  'Average Position',
  'Avg. Position',
  'Avg. position',
  'Avg Position',
  'Avg position',
  'Avg. pos',
  'Avg pos',
]

/**
 * Parse a CTR string ("0.72%", "0.72 %", "0.0072", "") into a decimal
 * in the 0..1 range. Tolerant of:
 *   * trailing % (with or without space)
 *   * locale comma decimals ("0,72%")
 *   * a raw decimal like "0.0072"
 *   * a percent-as-integer ("72%")
 *
 * Returns null when the input is empty or unparseable, so the caller
 * can decide whether to use a computed value instead.
 */
export function parseCtrString(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim().replace(/\s+/g, '')
  if (s === '') return null
  const hadPercent = s.endsWith('%')
  // Allow either "." or "," decimal separator. Strip the "%".
  const cleaned = (hadPercent ? s.slice(0, -1) : s).replace(',', '.')
  const n = Number.parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  if (n < 0) return null
  if (hadPercent) {
    // Explicit percent. Treat as N/100.
    return n / 100
  }
  // No percent sign: assume already a decimal (0..1). Anything > 1 is
  // almost certainly a raw percentage that someone forgot to suffix —
  // treat as percent for safety.
  return n > 1 ? n / 100 : n
}

/**
 * Preferred CTR resolution. ALWAYS prefer computed value when both
 * clicks and impressions are sensible numbers; otherwise fall back
 * to whatever the CSV's CTR column carries.
 *
 * Returns 0 when impressions is 0 / NaN / negative — never NaN /
 * Infinity. The opportunity filter ignores zero-impression rows
 * before this is consulted anyway.
 */
export function computeCtr(
  clicks:      number | null | undefined,
  impressions: number | null | undefined,
  fallback:    unknown,
): number {
  const i = toFiniteNumber(impressions)
  // Zero impressions = 0 CTR. Don't trust the CSV column to invent
  // a value out of nothing — that's the bug class the helper exists
  // to defend against.
  if (i !== null && i <= 0) return 0

  const c = toFiniteNumber(clicks)
  if (i !== null && i > 0 && c !== null) {
    const ratio = c / i
    if (Number.isFinite(ratio) && ratio >= 0) return ratio
    return 0
  }
  // Fallback to the CSV's CTR column when clicks / impressions
  // are missing entirely.
  const parsed = parseCtrString(fallback)
  return parsed ?? 0
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim().replace(',', '.')
  if (s === '') return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}
