// src/lib/set-assets/jpBulbagardenMatch.ts
//
// Block 5A-W-50G-B — matching engine for Bulbagarden Archives + Bulbapedia
// candidate assets against the PokePrices Japanese set catalogue.
//
// Distinct from src/lib/set-assets/jpMatch.ts (TCGdex matcher) because
// Bulbagarden candidates are files (not sets), so the scoring is done
// per-file against a target set. Also handles logo/symbol separately
// and gives explicit NO_OFFICIAL_LOGO and WRONG_ASSET_TYPE outputs
// that the TCGdex engine does not produce.

import { normaliseForMatch, stripJapanesePrefix, stripLeadingYear } from './jpMatch'

export interface BulbagardenFile {
  archive_title:            string
  source_url:               string
  thumb_url:                string | null
  mime:                     string | null
  width:                    number | null
  height:                   number | null
  description_page_url:     string | null
  categories:               string[]
  linked_pages:             string[]
  asset_type:               'logo' | 'symbol' | 'pack' | 'card' | 'banner' | 'unknown'
  is_english_market_likely: boolean
  retrieved_at:             string
}

export interface PokePricesSetLite {
  set_name:         string
  set_release_date: string | null
  language:         'jp'
}

export type BulbagardenClassification =
  | 'CONFIRMED_AUTOMATIC'
  | 'PROBABLE_REVIEW'
  | 'AMBIGUOUS'
  | 'NO_MATCH'
  | 'NO_OFFICIAL_LOGO'
  | 'WRONG_ASSET_TYPE'

export interface BulbagardenCandidateScore {
  file:      BulbagardenFile
  score:     number
  reasons:   string[]
  warnings:  string[]
}

export interface BulbagardenMatch {
  logoClassification:   BulbagardenClassification
  logoBest:             BulbagardenCandidateScore | null
  logoAlternates:       BulbagardenCandidateScore[]
  symbolClassification: BulbagardenClassification
  symbolBest:           BulbagardenCandidateScore | null
  symbolAlternates:     BulbagardenCandidateScore[]
}

// ── Scoring weights ────────────────────────────────────

export const BG_WEIGHTS = {
  LINKED_PAGE_EXACT:       40,   // page name == "<visible set> (TCG)"
  LINKED_PAGE_NORMALISED:  30,
  LINKED_PAGE_YEARLESS:    20,
  ARCHIVE_TITLE_MATCH:     22,   // filename literally contains the set name
  CATEGORY_JP_MATCH:       12,   // "Category:Japanese TCG set logos/symbols"
  CATEGORY_SET_NAME:       8,    // any category referencing the set
  ASSET_TYPE_CORRECT:      10,   // logo when looking for logo, symbol for symbol
  ASSET_TYPE_WRONG:       -30,   // pack/card/banner
  ENGLISH_MARKET_LIKELY:  -40,   // Neo_Genesis_Logo_EN.png etc.
  DIMENSION_TINY:          -8,   // <80×80 — probably a symbol tile in a logo slot
} as const

const CONFIRMED_MIN = 60
const PROBABLE_MIN  = 30
const AMBIGUITY_GAP = 12

// ── Public API ─────────────────────────────────────────

export function matchBulbagardenFor(
  pp: PokePricesSetLite,
  allFiles: BulbagardenFile[],
): BulbagardenMatch {
  // Include pack/card/banner in the logo pool so WRONG_ASSET_TYPE can
  // fire when the only page-linked file is a pack shot. The negative
  // ASSET_TYPE_WRONG weight ensures a genuine logo always outscores
  // a pack when both exist for the same set.
  const logoCandidates   = allFiles.filter(f => f.asset_type !== 'symbol')
  const symbolCandidates = allFiles.filter(f => f.asset_type === 'symbol')

  const logo   = pickBestOfClass(pp, logoCandidates,   'logo')
  const symbol = pickBestOfClass(pp, symbolCandidates, 'symbol')

  return {
    logoClassification:   logo.classification,
    logoBest:             logo.best,
    logoAlternates:       logo.alternates,
    symbolClassification: symbol.classification,
    symbolBest:           symbol.best,
    symbolAlternates:     symbol.alternates,
  }
}

// ── Per-class matching ─────────────────────────────────

interface ClassMatch {
  classification: BulbagardenClassification
  best:           BulbagardenCandidateScore | null
  alternates:     BulbagardenCandidateScore[]
}

function pickBestOfClass(
  pp: PokePricesSetLite,
  candidates: BulbagardenFile[],
  want: 'logo' | 'symbol',
): ClassMatch {
  if (candidates.length === 0) {
    return { classification: 'NO_MATCH', best: null, alternates: [] }
  }

  const scored = candidates
    .map(f => scoreFile(pp, f, want))
    .filter(s => s.score > -100) // sanity floor
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0 || scored[0].score < PROBABLE_MIN) {
    return { classification: 'NO_MATCH', best: null, alternates: [] }
  }

  const [best, second] = scored
  const alternates = scored.slice(1, 4)

  // Wrong-asset-type detection: if the top candidate is a pack/card/banner
  // despite the negative weight, all other candidates are worse, mark
  // WRONG_ASSET_TYPE so the reviewer knows to skip rather than approve.
  if (best.file.asset_type === 'pack' || best.file.asset_type === 'card' || best.file.asset_type === 'banner') {
    return { classification: 'WRONG_ASSET_TYPE', best, alternates }
  }

  // English-market rejection: hard bounce.
  if (best.file.is_english_market_likely) {
    return { classification: 'NO_MATCH', best, alternates }
  }

  if (second && best.score - second.score < AMBIGUITY_GAP) {
    return { classification: 'AMBIGUOUS', best, alternates }
  }

  if (best.score >= CONFIRMED_MIN && best.warnings.length === 0) {
    return { classification: 'CONFIRMED_AUTOMATIC', best, alternates }
  }

  return { classification: 'PROBABLE_REVIEW', best, alternates }
}

// ── Scoring a single file ──────────────────────────────

export function scoreFile(
  pp: PokePricesSetLite,
  f: BulbagardenFile,
  want: 'logo' | 'symbol',
): BulbagardenCandidateScore {
  const reasons: string[] = []
  const warnings: string[] = []
  let score = 0

  const visible          = stripJapanesePrefix(pp.set_name)
  const visibleNorm      = normaliseForMatch(visible)
  const visibleYearless  = normaliseForMatch(stripLeadingYear(visible))
  const expectedPageName = `${visible} (TCG)`

  // Linked-page match (strongest signal — a file is on the expansion page).
  for (const page of f.linked_pages) {
    const pageNorm = normaliseForMatch(stripSuffixParens(page))
    if (page === expectedPageName) {
      score += BG_WEIGHTS.LINKED_PAGE_EXACT
      reasons.push(`linked from page "${page}"`)
      break
    }
    if (pageNorm === visibleNorm) {
      score += BG_WEIGHTS.LINKED_PAGE_NORMALISED
      reasons.push(`linked from page "${page}" (normalised name match)`)
      break
    }
    if (pageNorm === visibleYearless) {
      score += BG_WEIGHTS.LINKED_PAGE_YEARLESS
      reasons.push(`linked from page "${page}" (year-stripped match)`)
      break
    }
  }

  // Archive-title match. Bulbapedia file names use underscores + CamelCase
  // (e.g. SV9_Battle_Partners_pack, SetLogoBattlePartners) so normalise
  // both separators to whitespace before comparing.
  const rawTitle = f.archive_title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')
  const titleFlat = rawTitle
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // Split camelCase / PascalCase
  const titleNorm = normaliseForMatch(titleFlat)
  if (visibleNorm.length > 3 && (titleNorm.includes(visibleNorm) || visibleNorm.includes(titleNorm))) {
    score += BG_WEIGHTS.ARCHIVE_TITLE_MATCH
    reasons.push(`archive title matches set name`)
  }

  // Category signals.
  const catsLower = f.categories.map(c => c.toLowerCase())
  const jpCat = catsLower.some(c => c.includes('japanese') && (c.includes('logo') || c.includes('symbol')))
  if (jpCat) {
    score += BG_WEIGHTS.CATEGORY_JP_MATCH
    reasons.push(`category signals Japanese ${want}`)
  }
  const setNamedCat = catsLower.some(c => c.includes(visibleNorm) && visibleNorm.length > 3)
  if (setNamedCat) {
    score += BG_WEIGHTS.CATEGORY_SET_NAME
    reasons.push(`category names the set`)
  }

  // Asset-type correctness.
  if (f.asset_type === want) {
    score += BG_WEIGHTS.ASSET_TYPE_CORRECT
    reasons.push(`asset_type=${want}`)
  }
  if (f.asset_type === 'pack' || f.asset_type === 'card' || f.asset_type === 'banner') {
    score += BG_WEIGHTS.ASSET_TYPE_WRONG
    warnings.push(`asset_type=${f.asset_type} — likely wrong asset for a set identity`)
  }

  // English-market rejection.
  if (f.is_english_market_likely) {
    score += BG_WEIGHTS.ENGLISH_MARKET_LIKELY
    warnings.push('English-market asset (filename or category suggests EN)')
  }

  // Tiny dimension guard when asking for a logo.
  if (want === 'logo' && f.width != null && f.height != null && f.width < 80 && f.height < 80) {
    score += BG_WEIGHTS.DIMENSION_TINY
    warnings.push(`tiny image (${f.width}×${f.height}) — likely a symbol misfiled as logo`)
  }

  return { file: f, score, reasons, warnings }
}

function stripSuffixParens(page: string): string {
  return page.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export const __TEST__ = { CONFIRMED_MIN, PROBABLE_MIN, AMBIGUITY_GAP }
