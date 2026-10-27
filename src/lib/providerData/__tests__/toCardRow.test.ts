import { describe, it, expect } from 'vitest'
import { adaptSnapshotToLegacyCardRow, adaptProviderHistoryForChart } from '../toCardRow'
import type { ProviderSnapshot } from '../snapshot'
import type { ProviderHistorySeries } from '../history'

const LEGACY = {
  card_slug: '886351',
  card_name: 'Dark Raticate',
  set_name: 'Team Rocket Returns',
  card_number: '17',
  card_url_slug: 'dark-raticate-17',
  image_url: 'https://legacy.example/img.jpg',
  language: 'en',
}

function snapshot(opts: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    pp_card_slug: '886351',
    tcg_card_id: 'pkm_ex7_17',
    tcg_printing_key: 'normal',
    tcg_set_code: 'ex7',
    tcg_language: 'en',
    tcg_name: 'Dark Raticate',
    pricing_eligibility: 'bulk_safe',
    image_normal: 'https://cards.tcggraph.io/ex7/pkm_ex7_17/normal.webp',
    image_large: null,
    image_source: 'own',
    market_prices: [],
    graded_prices: [],
    tcgplayer_product_id: null,
    ...opts,
  }
}

describe('adaptSnapshotToLegacyCardRow — PSA 9 safety invariant', () => {
  it('NEVER sets psa9_usd, even when pooled grade-9 is in the snapshot', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      graded_prices: [
        { grader: 'any', grade: '9', currency: 'USD', price: 42.00, sales_volume: 10, source_updated_at: null },
      ],
    }))
    expect(r?.card.psa9_usd).toBeNull()
  })

  it('also leaves psa9_usd null when a per-grader PSA 9 is accidentally included', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      graded_prices: [
        // Note: TCGGraph only pairs 'psa' with grade '10'; this input is
        // deliberately malformed to test defence in depth.
        { grader: 'psa' as any, grade: '9' as any, currency: 'USD', price: 123, sales_volume: 1, source_updated_at: null },
      ],
    }))
    expect(r?.card.psa9_usd).toBeNull()
  })

  it('exposes psa9_available: false in the attribution block', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot())
    expect(r?.providerAttribution.psa9_available).toBe(false)
  })
})

describe('adaptSnapshotToLegacyCardRow — ACE 10', () => {
  it('always leaves ace10_usd null (TCGGraph does not publish it)', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      graded_prices: [{ grader: 'psa', grade: '10', currency: 'USD', price: 500, sales_volume: 20, source_updated_at: null }],
    }))
    // CardRow[key: string]: unknown allows this access
    expect((r?.card as any).ace10_usd).toBeNull()
    expect(r?.providerAttribution.ace10_available).toBe(false)
  })
})

describe('adaptSnapshotToLegacyCardRow — happy paths + cents conversion', () => {
  it('converts dollars → cents correctly for raw + PSA 10', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      graded_prices: [
        { grader: 'raw', grade: 'ungraded', currency: 'USD', price: 1.39, sales_volume: 175, source_updated_at: null },
        { grader: 'psa', grade: '10', currency: 'USD', price: 103.05, sales_volume: 23, source_updated_at: null },
      ],
    }))
    expect(r?.card.raw_usd).toBe(139)         // $1.39 → 139 cents
    expect(r?.card.psa10_usd).toBe(10305)     // $103.05 → 10305 cents
  })

  it('populates BGS 10 / CGC 10 / SGC 10 when present (additive, not substitutes for PSA)', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      graded_prices: [
        { grader: 'bgs', grade: '10', currency: 'USD', price: 500, sales_volume: 5, source_updated_at: null },
        { grader: 'cgc', grade: '10', currency: 'USD', price: 450, sales_volume: 3, source_updated_at: null },
        { grader: 'sgc', grade: '10', currency: 'USD', price: 400, sales_volume: 2, source_updated_at: null },
      ],
    }))
    expect((r?.card as any).bgs10_usd).toBe(50000)
    expect((r?.card as any).cgc10_usd).toBe(45000)
    expect((r?.card as any).sgc10_usd).toBe(40000)
    expect(r?.providerAttribution.bgs10_available).toBe(true)
    expect(r?.providerAttribution.cgc10_available).toBe(true)
    expect(r?.providerAttribution.sgc10_available).toBe(true)
  })

  it('uses provider image when present, falls back to legacy image_url', () => {
    const withImg = adaptSnapshotToLegacyCardRow(LEGACY, snapshot())
    expect(withImg?.card.image_url).toBe('https://cards.tcggraph.io/ex7/pkm_ex7_17/normal.webp')

    const noImg = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({ image_normal: null }))
    expect(noImg?.card.image_url).toBe('https://legacy.example/img.jpg')
  })

  it('passes through legacy metadata fields unchanged', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot())
    expect(r?.card.card_slug).toBe('886351')
    expect(r?.card.card_name).toBe('Dark Raticate')
    expect(r?.card.card_url_slug).toBe('dark-raticate-17')
    expect(r?.card.set_name).toBe('Team Rocket Returns')
    expect(r?.card.language).toBe('en')
  })

  it('returns null when snapshot is null', () => {
    const r = adaptSnapshotToLegacyCardRow(LEGACY, null)
    expect(r).toBeNull()
  })
})

describe('adaptSnapshotToLegacyCardRow — variant printing restriction', () => {
  it('market_only snapshot (where resolver already stripped graded) produces null graded values', () => {
    // The upstream snapshot resolver zeroes graded_prices for
    // market_only rows. The adapter should not try to compensate.
    const r = adaptSnapshotToLegacyCardRow(LEGACY, snapshot({
      pricing_eligibility: 'market_only',
      graded_prices: [],
      market_prices: [
        { source: 'tcgplayer', finish: '1st-edition', list_type: 'retail', currency: 'USD', market: 24.48, low: 13.49, trend: null, source_updated_at: null },
      ],
    }))
    expect(r?.card.psa10_usd).toBeNull()
    expect(r?.card.raw_usd).toBeNull()
    expect((r?.card as any).bgs10_usd).toBeNull()
  })
})

describe('adaptProviderHistoryForChart', () => {
  it('maps raw-ungraded series → raw_usd (cents)', () => {
    const s: ProviderHistorySeries[] = [{
      kind: 'graded', grader: 'raw', grade: 'ungraded', currency: 'USD',
      points: [{ day: '2026-10-01', market: 2.50, low: 2.00 }, { day: '2026-10-02', market: 2.60, low: 2.10 }],
    }]
    const out = adaptProviderHistoryForChart(s)
    expect(out).toHaveLength(2)
    expect(out[0].raw_usd).toBe(250)   // $2.50 → 250 cents
    expect(out[1].raw_usd).toBe(260)
  })

  it('maps PSA 10 series → psa10_usd (cents)', () => {
    const s: ProviderHistorySeries[] = [{
      kind: 'graded', grader: 'psa', grade: '10', currency: 'USD',
      points: [{ day: '2026-10-01', market: 103.05, low: 90.00 }],
    }]
    const out = adaptProviderHistoryForChart(s)
    expect(out[0].psa10_usd).toBe(10305)
  })

  it('NEVER maps pooled grade-9 to psa9_usd', () => {
    const s: ProviderHistorySeries[] = [{
      kind: 'graded', grader: 'any', grade: '9', currency: 'USD',
      points: [{ day: '2026-10-01', market: 42.00, low: 38.00 }],
    }]
    const out = adaptProviderHistoryForChart(s)
    // The point for that day should exist (if any series yielded a
    // point there) but with no psa9_usd key. In this test the pooled
    // series produced the only input and we skip it entirely → no points.
    expect(out).toHaveLength(0)
  })

  it('maps market tcgplayer-normal-USD → tcgplayer_normal_usd (cents)', () => {
    const s: ProviderHistorySeries[] = [{
      kind: 'market', source: 'tcgplayer', finish: 'normal', currency: 'USD',
      points: [{ day: '2026-10-01', market: 1.26, low: 0.29 }],
    }]
    const out = adaptProviderHistoryForChart(s)
    expect(out[0].tcgplayer_normal_usd).toBe(126)
  })

  it('merges multiple series on the same day', () => {
    const s: ProviderHistorySeries[] = [
      { kind: 'graded', grader: 'raw', grade: 'ungraded', currency: 'USD', points: [{ day: '2026-10-01', market: 1.39, low: null }] },
      { kind: 'graded', grader: 'psa', grade: '10', currency: 'USD', points: [{ day: '2026-10-01', market: 103.05, low: null }] },
      { kind: 'market', source: 'tcgplayer', finish: 'normal', currency: 'USD', points: [{ day: '2026-10-01', market: 1.26, low: null }] },
    ]
    const out = adaptProviderHistoryForChart(s)
    expect(out).toHaveLength(1)
    expect(out[0].raw_usd).toBe(139)
    expect(out[0].psa10_usd).toBe(10305)
    expect(out[0].tcgplayer_normal_usd).toBe(126)
  })

  it('sorts by day ascending', () => {
    const s: ProviderHistorySeries[] = [{
      kind: 'graded', grader: 'raw', grade: 'ungraded', currency: 'USD',
      points: [
        { day: '2026-10-03', market: 3, low: null },
        { day: '2026-10-01', market: 1, low: null },
        { day: '2026-10-02', market: 2, low: null },
      ],
    }]
    const out = adaptProviderHistoryForChart(s)
    expect(out.map(p => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })
})
