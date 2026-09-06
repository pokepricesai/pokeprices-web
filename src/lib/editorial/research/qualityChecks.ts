// src/lib/editorial/research/qualityChecks.ts
//
// EIC Block 6 — deterministic data-quality validators used by every
// research recipe. These are not a generic anomaly-detection
// platform; each check exists because a specific plausible failure
// mode has bitten us (or would visibly discredit an article).
//
// Consumers should append these warnings to EvidencePack.warnings and
// downgrade quality accordingly. Rows are never silently dropped
// unless the check explicitly returns dropRow = true.

import type { Warning } from './types'

let warnCounter = 0
function nextWarnId(prefix = 'warn'): string {
  warnCounter += 1
  return `${prefix}-${warnCounter}`
}

// ─────────────────────────────────────────────────────────────────
// PSA population row shape (subset of psa_population)
// ─────────────────────────────────────────────────────────────────

export type PopRowLike = {
  set_name:     string
  card_number:  string
  card_name:    string | null
  variant:      string | null
  psa_9:        number | null
  psa_10:       number | null
  total_graded: number | null
  gem_rate:     number | null
  scraped_date: string | null
  psa_spec_id:  string | null
}

export type PriceRowLike = {
  raw_usd?:    number | null
  psa9_usd?:   number | null
  psa10_usd?:  number | null
}

// ─────────────────────────────────────────────────────────────────
// Population checks
// ─────────────────────────────────────────────────────────────────

export function checkPopulationRow(row: PopRowLike, ctx: { affects: string }): Warning[] {
  const out: Warning[] = []
  const totalGraded = num(row.total_graded)
  const psa10       = num(row.psa_10)

  // Impossible: psa_10 alone > total graded.
  if (totalGraded != null && psa10 != null && psa10 > totalGraded) {
    out.push({
      id: nextWarnId('pop-invalid-total'),
      severity: 'critical',
      message: `PSA 10 count (${psa10}) exceeds total graded (${totalGraded}) — refusing to trust this row.`,
      affects: ctx.affects,
    })
  }

  // Missing psa_10 count entirely.
  if (psa10 == null) {
    out.push({
      id: nextWarnId('pop-missing-psa10'),
      severity: 'major',
      message: 'psa_10 count is null — row unusable for scarcity claims.',
      affects: ctx.affects,
    })
  }

  // Gem rate impossibly high (defensive — should already be blocked
  // by the total-graded check).
  if (row.gem_rate != null && Number(row.gem_rate) > 100) {
    out.push({
      id: nextWarnId('pop-gemrate-impossible'),
      severity: 'critical',
      message: `Gem rate ${row.gem_rate}% is impossible.`,
      affects: ctx.affects,
    })
  }

  // Missing psa_spec_id (our chosen dedup key). Not critical, but
  // means we cannot dedupe reliably.
  if (!row.psa_spec_id || !String(row.psa_spec_id).trim()) {
    out.push({
      id: nextWarnId('pop-missing-specid'),
      severity: 'minor',
      message: 'psa_spec_id is missing — dedup falls back to (set_name, card_number, card_name, variant).',
      affects: ctx.affects,
    })
  }

  return out
}

/**
 * Editorial-usability filter for PSA population rows.
 *
 * The user's target article is "cards with high prices and very low
 * PSA 10 populations". Rows that make the mechanical filter but
 * would embarrass the article (error variants, promo reverse-foils,
 * "Rainbow Foil #E5", "Black Dot Error" printing oddities) are
 * removed here and reported as excludedGroups in the pack methodology,
 * not silently dropped without trace.
 */
export function isEditoriallyMeaningfulPopRow(row: PopRowLike): { keep: boolean; excludedReason?: string } {
  const name    = String(row.card_name ?? '')
  const variant = String(row.variant   ?? '')
  const setName = String(row.set_name  ?? '')

  const nameLower    = name.toLowerCase()
  const variantLower = variant.toLowerCase()
  const setLower     = setName.toLowerCase()

  // Reverse Foil ("-Reverse Foil" printings): technically legitimate
  // but the reader intent for a "cards with low PSA 10 populations"
  // headline is standard prints, not reverse-holo error tails.
  if (nameLower.includes('-reverse foil') || nameLower.includes('reverse foil') || variantLower.includes('reverse foil')) {
    return { keep: false, excludedReason: 'reverse-foil variants (editorial focus is standard prints)' }
  }

  // Error printings — not usable as "you should be watching this card" stories.
  const errorTokens = [
    'error', 'missing attack', 'black dot', 'stain', 'double holo', 'inverted back',
    'crimped', 'miscut', 'no rarity', 'no card number',
  ]
  const combined = `${nameLower} ${variantLower}`
  if (errorTokens.some(t => combined.includes(t))) {
    return { keep: false, excludedReason: 'known printing-error variants' }
  }

  // Promo/oddball prints that dominate the "PSA 10 = 0" tail.
  const promoTokens = ['prerelease', 'rainbow foil', 'burger king', 'cracked ice', 'cosmos-toys r us', 'toys r us', 'topps', 'comic con', 'inverted back']
  if (promoTokens.some(t => combined.includes(t))) {
    return { keep: false, excludedReason: 'promo/oddball printings' }
  }

  // Japanese Carddass and similar niche sets — not the target audience for this article type.
  const japaneseHints = ['carddass', 'topps pokemon the movie', '1999 topps movie']
  if (japaneseHints.some(t => setLower.includes(t))) {
    return { keep: false, excludedReason: 'niche/legacy sets outside the primary editorial audience' }
  }

  return { keep: true }
}

// ─────────────────────────────────────────────────────────────────
// Price checks
// ─────────────────────────────────────────────────────────────────

export const CENTS_PER_USD = 100

export function checkPriceRow(row: PriceRowLike, ctx: { affects: string }): Warning[] {
  const out: Warning[] = []
  const raw   = num(row.raw_usd)
  const psa9  = num(row.psa9_usd)
  const psa10 = num(row.psa10_usd)

  // Zero-cent prices are almost always missing data, not free cards.
  if (raw != null && raw === 0) {
    out.push({ id: nextWarnId('price-zero-raw'),   severity: 'major', message: 'raw_usd is 0 — treat as missing.', affects: ctx.affects })
  }
  if (psa10 != null && psa10 === 0) {
    out.push({ id: nextWarnId('price-zero-psa10'), severity: 'major', message: 'psa10_usd is 0 — treat as missing.', affects: ctx.affects })
  }

  // Implausibly tiny listing floors ($0.01–$0.99) — mostly bots.
  if (raw != null && raw > 0 && raw < 100) {
    out.push({ id: nextWarnId('price-tiny-raw'), severity: 'minor', message: `raw_usd is $${(raw / CENTS_PER_USD).toFixed(2)} — likely a listing floor, not a real market.`, affects: ctx.affects })
  }

  // PSA 10 cheaper than raw is unusual and often means data misalignment.
  if (raw != null && psa10 != null && raw > 0 && psa10 > 0 && psa10 < raw) {
    out.push({
      id: nextWarnId('price-inverted'),
      severity: 'major',
      message: `PSA 10 price ($${cents(psa10)}) is lower than raw ($${cents(raw)}) — unusual, check for data misalignment.`,
      affects: ctx.affects,
    })
  }

  // PSA 9 cheaper than raw (less unusual but still worth flagging).
  if (raw != null && psa9 != null && raw > 0 && psa9 > 0 && psa9 < raw) {
    out.push({
      id: nextWarnId('price-psa9-below-raw'),
      severity: 'minor',
      message: `PSA 9 price ($${cents(psa9)}) is lower than raw ($${cents(raw)}) — often true for common cards, verify before publishing.`,
      affects: ctx.affects,
    })
  }

  return out
}

// ─────────────────────────────────────────────────────────────────
// Freshness helpers
// ─────────────────────────────────────────────────────────────────

export function daysBetween(a: string, b: string): number {
  const t1 = new Date(a + 'T00:00:00Z').getTime()
  const t2 = new Date(b + 'T00:00:00Z').getTime()
  return Math.floor(Math.abs(t2 - t1) / 86400000)
}

export function freshnessWarning(asOf: string, today: string, staleAfterDays: number, subject: string, affects: string): Warning | null {
  const d = daysBetween(asOf, today)
  if (d <= staleAfterDays) return null
  return {
    id: nextWarnId('stale'),
    severity: d > staleAfterDays * 2 ? 'major' : 'minor',
    message: `${subject} data snapshot is ${d} days old (as of ${asOf}). Above the ${staleAfterDays}-day freshness bar for this article type.`,
    affects,
  }
}

// ─────────────────────────────────────────────────────────────────
// Dedup helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Preferred dedup key for PSA population rows.
 *
 * PSA emits a unique psa_spec_id per (set, card, variant, print run).
 * When present, that is authoritative. When missing we fall back to
 * a normalised (set_name, card_number, card_name, variant) tuple.
 *
 * The prior Strategist run flagged what looked like a duplicate
 * "Charmeleon #31" — investigation showed four legitimate distinct
 * rows: Fire Red & Leaf Green regular + reverse foil, Gym Challenge
 * Blaine's Charmeleon regular + 1st Edition. All four have unique
 * psa_spec_id. The dedup key correctly separates them.
 */
export function popDedupKey(r: PopRowLike): string {
  if (r.psa_spec_id && String(r.psa_spec_id).trim()) return `spec:${String(r.psa_spec_id).trim()}`
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  return `nokey:${norm(r.set_name)}|${norm(r.card_number)}|${norm(r.card_name)}|${norm(r.variant)}`
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function cents(cents: number): string { return (cents / CENTS_PER_USD).toFixed(2) }
