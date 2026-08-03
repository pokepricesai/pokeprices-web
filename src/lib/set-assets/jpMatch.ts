// src/lib/set-assets/jpMatch.ts
//
// Block 5A-W-50G — pure matching engine that scores TCGdex Japanese
// set candidates against the PokePrices JP set catalogue.
//
// Deliberately pure: no I/O, no dates other than the ones passed in,
// no external API knowledge. The fetch script (jp-tcgdex-fetch.mjs)
// shapes network data into the `TcgDexSet` interface; the report
// generator (jp-review-report.mjs) applies this engine and writes
// HTML. Tests exercise only these functions.

// ── Inputs ──────────────────────────────────────────────

export interface PokePricesSet {
  /** Internal set_name — retains the leading "Japanese " prefix. */
  set_name:          string
  /** ISO date (YYYY-MM-DD) or null when unknown. */
  set_release_date:  string | null
  /** Card count from get_set_list_v2 (non-sealed). */
  card_count:        number
  language:          'jp'
}

export interface TcgDexSet {
  /** TCGdex stable set ID (e.g. "sv07"). */
  id:                    string
  /** Japanese-localised name from /v2/ja/sets. */
  name_ja:               string
  /** English-localised name from /v2/en/sets/{id} (may be null when
   *  TCGdex has no English entry for a JP-only set). */
  name_en:               string | null
  /** ISO release date (YYYY-MM-DD). */
  releaseDate:           string | null
  /** Total printed cards including alt arts. */
  cardCountTotal:        number | null
  /** "Official" set-list card count. */
  cardCountOfficial:     number | null
  logoUrl:               string | null
  symbolUrl:             string | null
  serie:                 string | null
}

// ── Outputs ─────────────────────────────────────────────

export type Classification =
  | 'CONFIRMED_AUTOMATIC'
  | 'PROBABLE_REVIEW'
  | 'AMBIGUOUS'
  | 'NO_MATCH'

export interface ScoredCandidate {
  candidate: TcgDexSet
  score:     number
  reasons:   string[]
  warnings:  string[]
}

export interface MatchResult {
  pokePricesSet:   PokePricesSet
  classification:  Classification
  best:            ScoredCandidate | null
  alternates:      ScoredCandidate[]
  warnings:        string[]
}

// ── Normalisation ───────────────────────────────────────

const JAPANESE_PREFIX = /^Japanese\s+/

/**
 * Strips the "Japanese " prefix that PokePrices uses on every JP set
 * name. Case-sensitive prefix (only real leading token counts).
 */
export function stripJapanesePrefix(name: string): string {
  return name.replace(JAPANESE_PREFIX, '')
}

/**
 * Normalises a set name for comparison. Only for scoring — never
 * written back to the DB. Applies:
 *   * lowercase
 *   * apostrophe normalisation ('  and `  and ’  → straight ')
 *   * ampersand ↔ "and" harmonisation
 *   * remove harmless punctuation (commas, colons, periods)
 *   * collapse whitespace
 *   * remove year prefixes/suffixes ("2002 McDonald's" ↔ "McDonald's")
 */
export function normaliseForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’‘`ʼ]/g, "'")
    .replace(/\s*&\s*/g, ' and ')
    .replace(/[,.:;!]/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Some PokePrices JP names contain a leading four-digit year that
 * TCGdex often omits ("Japanese 2002 McDonald's" vs "McDonald's
 * Collection 2002"). Returns the name without the year for a second
 * pass at comparison.
 */
export function stripLeadingYear(name: string): string {
  return name.replace(/^\s*(19|20)\d{2}\s+/, '')
}

// ── Date + count helpers ────────────────────────────────

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z')
  const tb = Date.parse(b + 'T00:00:00Z')
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY
  return Math.abs(ta - tb) / (1000 * 60 * 60 * 24)
}

// ── Scoring one candidate ───────────────────────────────

/** Score weights are documented in docs/sql-reference/jp-set-assets/README.md. */
export const WEIGHTS = {
  EXACT_NAME:       40,
  NORMALISED_NAME:  30,
  NORMALISED_YEARLESS: 22,
  NAME_SUBSTRING:   10,
  DATE_EXACT:       25,
  DATE_30_DAYS:     20,
  DATE_90_DAYS:     10,
  DATE_MISMATCH:   -15,
  COUNT_EXACT:      15,
  COUNT_WITHIN_2:    8,
  COUNT_WITHIN_5:    4,
  COUNT_MAJOR_MISMATCH: -20,
} as const

const CONFIRMED_MIN     = 70
const PROBABLE_MIN      = 40
const AMBIGUITY_MARGIN  = 15

export function scoreCandidate(pp: PokePricesSet, cand: TcgDexSet): ScoredCandidate {
  const reasons: string[] = []
  const warnings: string[] = []
  let score = 0

  const ppStripped   = stripJapanesePrefix(pp.set_name)
  const ppNorm       = normaliseForMatch(ppStripped)
  const ppNormYearless = normaliseForMatch(stripLeadingYear(ppStripped))

  // ── Name scoring ──
  const candNames: string[] = [cand.name_en, cand.name_ja].filter(Boolean) as string[]

  let nameHit = false
  for (const cn of candNames) {
    const cNorm = normaliseForMatch(cn)
    if (cn === ppStripped) {
      score += WEIGHTS.EXACT_NAME
      reasons.push(`exact name match: "${cn}"`)
      nameHit = true
      break
    }
    if (cNorm === ppNorm) {
      score += WEIGHTS.NORMALISED_NAME
      reasons.push(`normalised name match: "${cn}" ~ "${ppStripped}"`)
      nameHit = true
      break
    }
    if (cNorm === ppNormYearless) {
      score += WEIGHTS.NORMALISED_YEARLESS
      reasons.push(`year-stripped name match: "${cn}" ~ "${ppStripped}"`)
      nameHit = true
      break
    }
  }
  if (!nameHit) {
    // Partial substring hit (useful for "Battle Partners" ⊂ "SV Battle Partners")
    for (const cn of candNames) {
      const cNorm = normaliseForMatch(cn)
      if (cNorm && (cNorm.includes(ppNorm) || ppNorm.includes(cNorm))) {
        score += WEIGHTS.NAME_SUBSTRING
        reasons.push(`substring name overlap: "${cn}" ~ "${ppStripped}"`)
        break
      }
    }
  }

  // ── Date scoring ──
  if (pp.set_release_date && cand.releaseDate) {
    const d = daysBetween(pp.set_release_date, cand.releaseDate)
    if (d === 0) { score += WEIGHTS.DATE_EXACT; reasons.push(`release date exact (${cand.releaseDate})`) }
    else if (d <= 30) { score += WEIGHTS.DATE_30_DAYS; reasons.push(`release date within 30 days (Δ=${d.toFixed(0)}d)`) }
    else if (d <= 90) { score += WEIGHTS.DATE_90_DAYS; reasons.push(`release date within 90 days (Δ=${d.toFixed(0)}d)`) }
    else {
      score += WEIGHTS.DATE_MISMATCH
      warnings.push(`release date differs by ${d.toFixed(0)} days (pp=${pp.set_release_date}, tcgdex=${cand.releaseDate})`)
    }
  } else if (pp.set_release_date || cand.releaseDate) {
    warnings.push('release date available on only one side')
  }

  // ── Card-count scoring ──
  const candCount = cand.cardCountOfficial ?? cand.cardCountTotal
  if (typeof pp.card_count === 'number' && pp.card_count > 0 && typeof candCount === 'number' && candCount > 0) {
    const delta = Math.abs(pp.card_count - candCount)
    if (delta === 0)  { score += WEIGHTS.COUNT_EXACT;   reasons.push(`card count exact (${pp.card_count})`) }
    else if (delta <= 2)   { score += WEIGHTS.COUNT_WITHIN_2; reasons.push(`card count Δ=${delta}`) }
    else if (delta <= 5)   { score += WEIGHTS.COUNT_WITHIN_5; reasons.push(`card count Δ=${delta}`) }
    else if (delta > pp.card_count * 0.5) {
      score += WEIGHTS.COUNT_MAJOR_MISMATCH
      warnings.push(`card count Δ=${delta} (pp=${pp.card_count}, tcgdex=${candCount}) — likely different product`)
    } else {
      warnings.push(`card count Δ=${delta} (pp=${pp.card_count}, tcgdex=${candCount})`)
    }
  } else {
    warnings.push('card count missing on one side')
  }

  // ── Blocked-substitution warnings ──
  // The English-equivalent set logo is never a valid substitute for
  // the Japanese logo. Detect the obvious case: the TCGdex serie
  // suggests English mainline (e.g. "Sword & Shield") but the set
  // has no explicit JP marker AND no JP-only card count evidence.
  if (cand.serie && /(^|\s)(en|english|international)\b/i.test(cand.serie)) {
    warnings.push(`TCGdex serie "${cand.serie}" looks English-market — verify this is genuinely the Japanese product`)
  }

  return { candidate: cand, score, reasons, warnings }
}

// ── Classification ──────────────────────────────────────

export function classifyMatch(
  pp: PokePricesSet,
  candidates: TcgDexSet[],
): MatchResult {
  const scored = candidates
    .map(c => scoreCandidate(pp, c))
    .sort((a, b) => b.score - a.score)

  const warnings: string[] = []

  if (scored.length === 0 || scored[0].score < PROBABLE_MIN) {
    return {
      pokePricesSet: pp,
      classification: 'NO_MATCH',
      best: null,
      alternates: [],
      warnings: scored.length === 0
        ? ['TCGdex returned zero candidates']
        : [`best score ${scored[0].score} below probable threshold ${PROBABLE_MIN}`],
    }
  }

  const [best, second] = scored
  const bestAlternates = scored.slice(1, 4)

  // Paired-expansion / ambiguous detection: if the second candidate
  // is within AMBIGUITY_MARGIN points of the best, we cannot force a
  // pick. Human review required.
  if (second && best.score - second.score < AMBIGUITY_MARGIN) {
    return {
      pokePricesSet: pp,
      classification: 'AMBIGUOUS',
      best,
      alternates: bestAlternates,
      warnings: [
        `top two candidates within ${AMBIGUITY_MARGIN} pts (${best.score} vs ${second.score}) — pick manually`,
        ...best.warnings,
      ],
    }
  }

  if (best.score >= CONFIRMED_MIN && best.warnings.length === 0) {
    return {
      pokePricesSet: pp,
      classification: 'CONFIRMED_AUTOMATIC',
      best,
      alternates: bestAlternates,
      warnings,
    }
  }

  return {
    pokePricesSet: pp,
    classification: 'PROBABLE_REVIEW',
    best,
    alternates: bestAlternates,
    warnings: best.warnings,
  }
}

// ── Special-case detection ──────────────────────────────

/**
 * Detects PokePrices catalogue names that we know combine two source
 * products (e.g. paired expansions released together in Japan but
 * merged into one PriceCharting set). Callers should demote these
 * to PROBABLE_REVIEW even when scoring passes.
 */
export function isKnownPairedExpansion(setName: string): boolean {
  // Extend as we identify more. Currently a hand-maintained list of
  // known Japanese paired expansions that ship as two 60-70 card
  // decks together (SV era predominantly).
  const stripped = stripJapanesePrefix(setName)
  return PAIRED_EXPANSION_MARKERS.some(marker => stripped.includes(marker))
}

const PAIRED_EXPANSION_MARKERS = [
  '&',   // "X & Y" pattern often signals a pair (Wild Force & Cyber Judge etc.)
  ' and ',
]

/**
 * Detects catalogue names that TCGdex is unlikely to carry as a
 * dedicated set (McDonald's, Carddass, vending, decks, etc.). These
 * belong in the fallback-source workflow (Bulbapedia / pokemon-card.com)
 * documented in docs/sql-reference/jp-set-assets/README.md.
 */
export function isLikelyFallbackSourceOnly(setName: string): boolean {
  const stripped = stripJapanesePrefix(setName).toLowerCase()
  return FALLBACK_ONLY_MARKERS.some(m => stripped.includes(m))
}

const FALLBACK_ONLY_MARKERS = [
  "mcdonald",
  'carddass',
  'vending',
  'gym challenge',
  'deck',
  'starter',
  'quick construction',
  'battle theme',
  'trainer kit',
]

export const __TEST__ = {
  CONFIRMED_MIN, PROBABLE_MIN, AMBIGUITY_MARGIN,
  daysBetween,
}
