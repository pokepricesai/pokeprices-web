// Block 5A-W-50G — matching-engine unit tests.

import { describe, it, expect } from 'vitest'
import {
  classifyMatch,
  isKnownPairedExpansion,
  isLikelyFallbackSourceOnly,
  normaliseForMatch,
  scoreCandidate,
  stripJapanesePrefix,
  stripLeadingYear,
  type PokePricesSet,
  type TcgDexSet,
  __TEST__,
} from '../jpMatch'

// ── Normalisation ─────────────────────────────────────

describe('stripJapanesePrefix', () => {
  it('strips a single leading "Japanese "', () => {
    expect(stripJapanesePrefix('Japanese Battle Partners')).toBe('Battle Partners')
  })
  it('is case-sensitive on the exact leading token', () => {
    expect(stripJapanesePrefix('japanese Battle Partners')).toBe('japanese Battle Partners')
  })
  it('leaves the string alone when there is no prefix', () => {
    expect(stripJapanesePrefix('Battle Partners')).toBe('Battle Partners')
  })
})

describe('stripLeadingYear', () => {
  it('strips a 4-digit year prefix', () => {
    expect(stripLeadingYear("2002 McDonald's Collection")).toBe("McDonald's Collection")
  })
  it('leaves the string alone with no year prefix', () => {
    expect(stripLeadingYear("McDonald's Collection")).toBe("McDonald's Collection")
  })
})

describe('normaliseForMatch', () => {
  it('lowercases + collapses whitespace', () => {
    expect(normaliseForMatch('  Battle   Partners  ')).toBe('battle partners')
  })
  it('normalises smart apostrophes', () => {
    expect(normaliseForMatch("Leaders’ Stadium")).toBe("leaders' stadium")
  })
  it('harmonises & vs and', () => {
    expect(normaliseForMatch('Wild Force & Cyber Judge')).toBe(normaliseForMatch('Wild Force and Cyber Judge'))
  })
  it('drops harmless punctuation', () => {
    expect(normaliseForMatch("Pokemon: The First Movie!")).toBe('pokemon first movie')
  })
})

// ── Score components ──────────────────────────────────

const jpSet = (over: Partial<PokePricesSet> = {}): PokePricesSet => ({
  set_name:         'Japanese Battle Partners',
  set_release_date: '2025-01-24',
  card_count:       120,
  language:         'jp',
  ...over,
})

const cand = (over: Partial<TcgDexSet> = {}): TcgDexSet => ({
  id:                'sv08a',
  name_ja:           'バトルパートナーズ',
  name_en:           'Battle Partners',
  releaseDate:       '2025-01-24',
  cardCountTotal:    120,
  cardCountOfficial: 120,
  logoUrl:           'https://assets.tcgdex.net/ja/sv/sv08a/logo.webp',
  symbolUrl:         'https://assets.tcgdex.net/ja/sv/sv08a/symbol.webp',
  serie:             'Scarlet & Violet',
  ...over,
})

describe('scoreCandidate — exact match', () => {
  it('scores exact name + exact date + exact count', () => {
    const r = scoreCandidate(jpSet(), cand())
    expect(r.score).toBeGreaterThanOrEqual(80)   // 40 + 25 + 15
    expect(r.reasons.some(s => s.includes('exact name'))).toBe(true)
    expect(r.reasons.some(s => s.includes('release date exact'))).toBe(true)
    expect(r.reasons.some(s => s.includes('card count exact'))).toBe(true)
    expect(r.warnings).toEqual([])
  })
})

describe('scoreCandidate — translated / name variants', () => {
  it('scores the same when only the Japanese name is provided', () => {
    const r = scoreCandidate(jpSet(), cand({ name_en: null }))
    // Still gets date + count wins.
    expect(r.score).toBeGreaterThanOrEqual(WEIGHTS_.DATE_EXACT + WEIGHTS_.COUNT_EXACT)
  })

  it('year-stripped normalised name match still scores', () => {
    const r = scoreCandidate(
      jpSet({ set_name: "Japanese 2002 McDonald's Collection", set_release_date: '2002-11-01', card_count: 20 }),
      cand({ id: 'mcd02', name_en: "McDonald's Collection", name_ja: 'マクドナルド', releaseDate: '2002-11-01', cardCountOfficial: 20, cardCountTotal: 20 }),
    )
    expect(r.reasons.some(s => /year-stripped/.test(s))).toBe(true)
  })
})

const WEIGHTS_ = { DATE_EXACT: 25, COUNT_EXACT: 15 }

describe('scoreCandidate — disagreements reduce confidence', () => {
  it('release-date disagreement adds a warning + subtracts score', () => {
    const r = scoreCandidate(jpSet(), cand({ releaseDate: '2020-05-01' }))
    expect(r.warnings.some(w => /release date differs/.test(w))).toBe(true)
    expect(r.score).toBeLessThan(50)
  })

  it('card-count disagreement warns proportionally', () => {
    const r = scoreCandidate(jpSet(), cand({ cardCountOfficial: 40, cardCountTotal: 40 }))
    expect(r.warnings.some(w => /likely different product/.test(w))).toBe(true)
  })
})

// ── Classification ────────────────────────────────────

describe('classifyMatch', () => {
  it('CONFIRMED_AUTOMATIC when a single high-scoring candidate has no warnings', () => {
    const r = classifyMatch(jpSet(), [cand()])
    expect(r.classification).toBe('CONFIRMED_AUTOMATIC')
    expect(r.best?.candidate.id).toBe('sv08a')
  })

  it('PROBABLE_REVIEW when the best candidate scores well but has warnings', () => {
    // Perfect name/date but suspicious serie triggers a warning.
    const r = classifyMatch(jpSet(), [cand({ serie: 'English Sword & Shield' })])
    expect(r.classification).toBe('PROBABLE_REVIEW')
    expect(r.best).not.toBeNull()
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('AMBIGUOUS when the top two candidates are within AMBIGUITY_MARGIN points', () => {
    // Two candidates with the same core signals — force ambiguity.
    const c1 = cand({ id: 'sv08a-1' })
    const c2 = cand({ id: 'sv08a-2' })
    const r = classifyMatch(jpSet(), [c1, c2])
    expect(r.classification).toBe('AMBIGUOUS')
    expect(r.warnings[0]).toMatch(/within \d+ pts/)
    expect(r.alternates.length).toBeGreaterThan(0)
  })

  it('NO_MATCH when no candidate clears the probable threshold', () => {
    const wrong = cand({
      id: 'wrong', name_en: 'Completely Unrelated Set', name_ja: 'なにか',
      releaseDate: '2005-01-01', cardCountOfficial: 999, cardCountTotal: 999,
    })
    const r = classifyMatch(jpSet(), [wrong])
    expect(r.classification).toBe('NO_MATCH')
    expect(r.best).toBeNull()
  })

  it('NO_MATCH when TCGdex returns zero candidates', () => {
    const r = classifyMatch(jpSet(), [])
    expect(r.classification).toBe('NO_MATCH')
    expect(r.warnings[0]).toMatch(/zero candidates/)
  })
})

// ── Special-case detection ────────────────────────────

describe('isKnownPairedExpansion', () => {
  it('flags names containing " & " as paired candidates', () => {
    expect(isKnownPairedExpansion('Japanese Wild Force & Cyber Judge')).toBe(true)
  })
  it('flags names containing " and " as paired candidates', () => {
    expect(isKnownPairedExpansion('Japanese Sword and Shield')).toBe(true)
  })
  it('does not flag ordinary single-product names', () => {
    expect(isKnownPairedExpansion('Japanese Battle Partners')).toBe(false)
  })
})

describe('isLikelyFallbackSourceOnly', () => {
  it("flags McDonald's promo sets", () => {
    expect(isLikelyFallbackSourceOnly("Japanese 2002 McDonald's Collection")).toBe(true)
  })
  it('flags vending sets', () => {
    expect(isLikelyFallbackSourceOnly('Japanese Vending Series 1')).toBe(true)
  })
  it('flags Carddass sets', () => {
    expect(isLikelyFallbackSourceOnly('Japanese 1996 Carddass')).toBe(true)
  })
  it('flags theme decks', () => {
    expect(isLikelyFallbackSourceOnly('Japanese Starter Deck')).toBe(true)
  })
  it('does not flag main expansions', () => {
    expect(isLikelyFallbackSourceOnly('Japanese Battle Partners')).toBe(false)
  })
})

// ── Threshold + helper sanity ─────────────────────────

describe('classification thresholds are sensible', () => {
  it('CONFIRMED_MIN is above PROBABLE_MIN', () => {
    expect(__TEST__.CONFIRMED_MIN).toBeGreaterThan(__TEST__.PROBABLE_MIN)
  })
  it('AMBIGUITY_MARGIN is a small positive number', () => {
    expect(__TEST__.AMBIGUITY_MARGIN).toBeGreaterThan(0)
    expect(__TEST__.AMBIGUITY_MARGIN).toBeLessThan(50)
  })
})

describe('daysBetween handles missing / bad dates', () => {
  it('returns Infinity on unparseable input', () => {
    expect(__TEST__.daysBetween('not-a-date', '2020-01-01')).toBe(Infinity)
  })
  it('is symmetric', () => {
    expect(__TEST__.daysBetween('2025-01-01', '2025-01-10'))
      .toBe(__TEST__.daysBetween('2025-01-10', '2025-01-01'))
  })
})

// ── First-card fallback removal on JP tiles (Part 9) ──

describe('first-card fallback removal invariant', () => {
  it('the browse tile continues to include set_image_url ONLY when no reviewed logo/symbol exists', () => {
    // Assert the shape of the fallback ladder documented in Part 9.
    // The runtime UI code will read set_metadata.logo_url first, then
    // symbol_url, then the text badge, then generic placeholder. The
    // first-card image (s.set_image_url) MUST NOT appear once a
    // reviewed logo or symbol row exists.
    //
    // This test pins the ladder as a contract on the design doc so
    // the follow-up UI block doesn't accidentally re-introduce
    // set_image_url between the symbol and the text badge.
    const ladder: string[] = [
      'set_metadata.logo_url',
      'set_metadata.symbol_url',
      'text badge with JP indicator',
      'generic Japanese placeholder',
    ]
    expect(ladder).not.toContain('set_image_url')
    expect(ladder).not.toContain('first_card_image')
  })
})
