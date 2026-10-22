// PP-TCG-500-PREP correction §B — actual-output tests for the
// title/description picker. Mirrors the branches the generateMetadata
// function depends on. These tests pin the EXACT strings so that if
// a future change silently alters SEO claims, CI catches it before
// anything reaches Googlebot.

import { describe, it, expect } from 'vitest'
import { pickCardTitleDescription } from '../pickCardTitleDescription'

const BASE = {
  name: 'Jacinthe', num: ' 122/88', jpMarker: '', year: 2026,
  setLabel: 'Perfect Order', descSetPhrase: 'Perfect Order',
} as const

describe('pickCardTitleDescription', () => {
  // ───────── provider-active path (TCGGraph cents) ─────────

  it('useGradingVariant: psa10 >= 3× raw → "Worth Grading?" title', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: 2000,   // $20
      psa9UsdCents: null,  // adapter nulls PSA 9 in provider mode
      psa10UsdCents: 10000, // $100 → 5× → useGradingVariant
    })
    expect(r.title).toBe('Jacinthe 122/88 Price: $100 PSA 10 vs $20 Raw. Worth Grading? (2026)')
    expect(r.description).toBe('Is Jacinthe 122/88 worth grading? PSA 10 $100 is 5.0× the raw price of $20. Perfect Order price guide: gem rate, grading spread, PSA population and verified recent sales.')
    expect(r.description).not.toMatch(/PSA 9/)
  })

  it('non-grading variant: psa10 < 3× raw → "Price & Value" title; description omits PSA 9 when null', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: 2087,
      psa9UsdCents: null,
      psa10UsdCents: 5251, // 2.5× → non-grading variant
    })
    expect(r.title).toBe('Jacinthe 122/88 Price & Value: $21 Raw, $53 PSA 10 (2026) | Perfect Order')
    expect(r.description).toBe('How much is Jacinthe 122/88 worth? Perfect Order price guide: $21 raw, $53 PSA 10. Price trend, grading spread, PSA population and verified recent sales.')
    expect(r.description).not.toMatch(/PSA 9/)
  })

  it('non-grading variant with legacy PSA 9: description includes PSA 9 clause', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: 2087,
      psa9UsdCents: 2511,  // legacy card has PSA 9
      psa10UsdCents: 5251,
    })
    expect(r.description).toMatch(/\$25 PSA 9/)
  })

  // ───────── fail-closed path (all three null) ─────────

  it('fail-closed (all nulls): generic no-price title + description, no numerical claims', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: null, psa9UsdCents: null, psa10UsdCents: null,
    })
    expect(r.title).toBe('Jacinthe 122/88 Pokémon Card Price Guide (2026) | Perfect Order')
    expect(r.description).toBe('Track Jacinthe 122/88 from Perfect Order: raw, PSA 9 and PSA 10 prices, grading spreads, PSA population and verified recent sales. Price guide updated nightly.')
    // No $ amounts
    expect(r.title).not.toMatch(/\$\d/)
    expect(r.description).not.toMatch(/\$\d/)
  })

  it('partial: psa10 only (no raw) → "PSA 10 Price & Value" title', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: null, psa9UsdCents: null, psa10UsdCents: 5251,
    })
    expect(r.title).toBe('Jacinthe 122/88 PSA 10 Price & Value: $53 (2026) | Perfect Order')
    expect(r.description).toBe('Jacinthe 122/88 PSA 10 value: $53. Perfect Order price guide: price trend, PSA population, gem rate and verified recent sales. Updated nightly.')
  })

  it('partial: raw only (no psa10) → "Price: X Raw" title', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      rawUsdCents: 2087, psa9UsdCents: null, psa10UsdCents: null,
    })
    expect(r.title).toBe('Jacinthe 122/88 Price: $21 Raw (2026) | Perfect Order')
    expect(r.description).toMatch(/\$21 raw/)
    expect(r.description).not.toMatch(/PSA 10/)
  })

  // ───────── Japanese marker ─────────

  it('Japanese marker injected after name', () => {
    const r = pickCardTitleDescription({
      ...BASE,
      name: 'Falinks V', num: ' 319/190', jpMarker: ' Japanese',
      setLabel: 'Shiny Star V', descSetPhrase: 'Shiny Star V (Japanese)',
      rawUsdCents: 264, psa9UsdCents: null, psa10UsdCents: 2475,
    })
    expect(r.title).toContain('Falinks V 319/190 Japanese')
  })

  // ───────── never contradictory ─────────

  it('provider-active sample (Groudon EX): title uses TCGGraph $6.3k PSA 10', () => {
    const r = pickCardTitleDescription({
      name: 'Groudon EX', num: ' 93/100', jpMarker: '', year: 2026,
      setLabel: 'Crystal Guardians', descSetPhrase: 'Crystal Guardians',
      rawUsdCents: 8500,         // $85
      psa9UsdCents: null,         // adapter nulls PSA 9
      psa10UsdCents: 634000,      // $6340 → formatted $6.3k
    })
    expect(r.title).toBe('Groudon EX 93/100 Price: $6.3k PSA 10 vs $85 Raw. Worth Grading? (2026)')
    expect(r.description).not.toMatch(/PSA 9/)
  })
})
