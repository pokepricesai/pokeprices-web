// src/lib/editorial/research/__tests__/qualityChecks.test.ts
//
// Block 6 — unit tests for the deterministic quality checks used by
// every recipe. These are the guardrails that ensure Charmeleon #31
// is correctly split into four distinct cards, and that reverse-foil
// / error / promo rows are excluded (not silently kept).

import { describe, it, expect } from 'vitest'
import {
  isEditoriallyMeaningfulPopRow, popDedupKey,
  checkPopulationRow, checkPriceRow, freshnessWarning, daysBetween,
  type PopRowLike,
} from '../qualityChecks'

function pop(overrides: Partial<PopRowLike> = {}): PopRowLike {
  return {
    set_name: 'Pokemon Base Set',
    card_number: '4',
    card_name: 'Charizard-Holo',
    variant: '',
    psa_9: 100,
    psa_10: 10,
    total_graded: 200,
    gem_rate: 5,
    scraped_date: '2026-05-13',
    psa_spec_id: 'spec-123',
    ...overrides,
  }
}

describe('isEditoriallyMeaningfulPopRow', () => {
  it('keeps a clean standard printing', () => {
    expect(isEditoriallyMeaningfulPopRow(pop()).keep).toBe(true)
  })
  it('drops reverse foil variants', () => {
    const r = isEditoriallyMeaningfulPopRow(pop({ card_name: 'Charmeleon-Reverse Foil' }))
    expect(r.keep).toBe(false)
    expect(r.excludedReason).toMatch(/reverse-foil/)
  })
  it('drops error variants named in card_name or variant', () => {
    expect(isEditoriallyMeaningfulPopRow(pop({ card_name: 'Ninetales-Holo', variant: 'Shadowless-Missing Attack' })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ card_name: 'Charizard-Holo', variant: 'Black Dot Error' })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ card_name: 'Haunter-Holo',   variant: 'Stain Error' })).keep).toBe(false)
  })
  it('drops promo / oddball printings', () => {
    expect(isEditoriallyMeaningfulPopRow(pop({ variant: 'Prerelease' })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ variant: 'Rainbow Foil' })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ variant: 'Burger King Collection 2009' })).keep).toBe(false)
  })
  it('drops legacy Japanese / Topps sets', () => {
    expect(isEditoriallyMeaningfulPopRow(pop({ set_name: 'Pokemon Topps Pokemon the Movie Edt' })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ set_name: 'Pokemon 1999 Topps Movie'          })).keep).toBe(false)
    expect(isEditoriallyMeaningfulPopRow(pop({ set_name: 'Pokemon Japanese 1998 Carddass'    })).keep).toBe(false)
  })
})

describe('popDedupKey (Charmeleon #31 regression)', () => {
  // Live-verified case: four legitimate distinct rows with unique
  // psa_spec_id. The dedup key must separate them, not collapse.
  const rows = [
    { set_name: 'Pokemon Fire Red & Leaf Green', card_number: '31', card_name: 'Charmeleon',              variant: '',            psa_spec_id: '2380994', psa_9: 43,  psa_10: 38,  total_graded: 125,  gem_rate: 30.4, scraped_date: '2026-05-13' },
    { set_name: 'Pokemon Fire Red & Leaf Green', card_number: '31', card_name: 'Charmeleon-Reverse Foil', variant: '',            psa_spec_id: '2273277', psa_9: 118, psa_10: 39,  total_graded: 330,  gem_rate: 11.8, scraped_date: '2026-05-13' },
    { set_name: 'Pokemon Gym Challenge',         card_number: '31', card_name: "Blaine's Charmeleon",     variant: '',            psa_spec_id: '2169714', psa_9: 169, psa_10: 65,  total_graded: 487,  gem_rate: 13.35, scraped_date: '2026-05-13' },
    { set_name: 'Pokemon Gym Challenge',         card_number: '31', card_name: "Blaine's Charmeleon",     variant: '1st Edition', psa_spec_id: '1724740', psa_9: 503, psa_10: 184, total_graded: 1011, gem_rate: 18.2, scraped_date: '2026-05-13' },
  ] as PopRowLike[]

  it('produces four distinct keys for the four legitimate Charmeleon #31 printings', () => {
    const keys = rows.map(popDedupKey)
    expect(new Set(keys).size).toBe(4)
  })

  it('falls back to composite key when psa_spec_id is missing', () => {
    const noSpec = { ...rows[0], psa_spec_id: null }
    expect(popDedupKey(noSpec)).toMatch(/^nokey:/)
  })

  it('treats two identical no-spec rows as the same key', () => {
    const a = { ...rows[0], psa_spec_id: null }
    const b = { ...rows[0], psa_spec_id: '' }
    expect(popDedupKey(a)).toBe(popDedupKey(b))
  })
})

describe('checkPopulationRow', () => {
  const affects = 'test-row'
  it('is silent on a clean row', () => {
    expect(checkPopulationRow(pop(), { affects })).toEqual([])
  })
  it('flags psa_10 > total_graded as critical', () => {
    const ws = checkPopulationRow(pop({ psa_10: 500, total_graded: 200 }), { affects })
    expect(ws.some(w => w.severity === 'critical' && /exceeds total graded/.test(w.message))).toBe(true)
  })
  it('flags null psa_10 as major', () => {
    const ws = checkPopulationRow(pop({ psa_10: null }), { affects })
    expect(ws.some(w => w.severity === 'major' && /psa_10 count is null/.test(w.message))).toBe(true)
  })
  it('flags impossible gem rate', () => {
    const ws = checkPopulationRow(pop({ gem_rate: 150 }), { affects })
    expect(ws.some(w => w.severity === 'critical' && /impossible/i.test(w.message))).toBe(true)
  })
  it('flags missing psa_spec_id as minor', () => {
    const ws = checkPopulationRow(pop({ psa_spec_id: null }), { affects })
    expect(ws.some(w => w.severity === 'minor' && /psa_spec_id is missing/.test(w.message))).toBe(true)
  })
})

describe('checkPriceRow', () => {
  const affects = 't'
  it('flags zero raw as major', () => {
    expect(checkPriceRow({ raw_usd: 0 }, { affects }).some(w => w.severity === 'major' && /raw_usd is 0/.test(w.message))).toBe(true)
  })
  it('flags PSA 10 below raw as major inversion', () => {
    expect(checkPriceRow({ raw_usd: 1000, psa10_usd: 500 }, { affects }).some(w => /PSA 10 price.*lower than raw/.test(w.message))).toBe(true)
  })
  it('flags implausibly tiny raw price', () => {
    expect(checkPriceRow({ raw_usd: 50 }, { affects }).some(w => /listing floor/.test(w.message))).toBe(true)
  })
})

describe('freshnessWarning + daysBetween', () => {
  it('does not warn when within window', () => {
    expect(freshnessWarning('2026-08-15', '2026-09-06', 60, 'test', 't')).toBeNull()
  })
  it('warns as minor near the bar and as major past 2x', () => {
    const minor = freshnessWarning('2026-07-01', '2026-09-06', 60, 'test', 't')  // 67 days old
    expect(minor?.severity).toBe('minor')
    const major = freshnessWarning('2026-04-01', '2026-09-06', 60, 'test', 't')  // 158 days old
    expect(major?.severity).toBe('major')
  })
  it('daysBetween is symmetric', () => {
    expect(daysBetween('2026-01-01', '2026-01-05')).toBe(4)
    expect(daysBetween('2026-01-05', '2026-01-01')).toBe(4)
  })
})
