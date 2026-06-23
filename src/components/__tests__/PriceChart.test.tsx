// Block 4B-W-7A — pure-helper tests for the price-chart range selector.
//
// The recharts component itself is not rendered here (it relies on DOM
// measurement that is not available in the node test environment).
// Instead these tests cover the two exported pure helpers that own all
// the range behaviour:
//   * rangeCutoff(latestDate, range)      → cutoff string anchored on data
//   * applyRange(rows, range)             → filter with graceful fallback
//   * pickDefaultRange(rows)              → choose the default range
//
// A small render smoke check confirms the range pills appear when the
// `ranges` prop is set and are absent otherwise.

import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'

// The shared supabase module eagerly constructs a browser client at
// import time. The test env has no Supabase env vars, so stub it.
vi.mock('@/lib/supabase', () => ({
  supabase: {},
  CHAT_ENDPOINT: '',
  formatPrice:       (c: number | null | undefined) => c == null ? '—' : `$${(c/100).toFixed(2)}`,
  formatPriceGBP:    (c: number | null | undefined) => c == null ? '—' : `£${(c/100).toFixed(2)}`,
  formatPriceShort:  (c: number | null | undefined) => c == null ? '—' : `$${(c/100).toFixed(0)}`,
  formatPct:         () => ({ text: '—', color: '' }),
  formatDate:        (d: string | null) => d ?? '—',
  formatChartPrice:  (c: number) => `$${c}`,
}))

import PriceChart, {
  applyRange,
  rangeCutoff,
  pickDefaultRange,
  type ChartRange,
} from '../PriceChart'

// ─────────────────────────────────────────────────────────────────────
// rangeCutoff — date arithmetic anchored on the supplied latest date
// ─────────────────────────────────────────────────────────────────────

describe('rangeCutoff', () => {
  it('returns null for the all range', () => {
    expect(rangeCutoff('2026-06-20', 'all')).toBeNull()
  })

  it('subtracts 7 days for 7d', () => {
    expect(rangeCutoff('2026-06-20', '7d')).toBe('2026-06-13')
  })

  it('subtracts 30 days for 30d', () => {
    expect(rangeCutoff('2026-06-30', '30d')).toBe('2026-05-31')
  })

  it('subtracts 90 days for 90d', () => {
    expect(rangeCutoff('2026-06-30', '90d')).toBe('2026-04-01')
  })

  it('subtracts 6 calendar months for 6m', () => {
    expect(rangeCutoff('2026-06-15', '6m')).toBe('2025-12-15')
  })

  it('subtracts 1 calendar year for 1y', () => {
    expect(rangeCutoff('2026-06-15', '1y')).toBe('2025-06-15')
  })

  it('returns null when the latest date is unparseable', () => {
    expect(rangeCutoff('not-a-date', '30d')).toBeNull()
  })

  it('is anchored on the supplied latest date, not Date.now()', () => {
    // Cutoff for "30d" before a date five years in the past must still
    // be exactly 30 days before that past date.
    expect(rangeCutoff('2021-01-31', '30d')).toBe('2021-01-01')
  })
})

// ─────────────────────────────────────────────────────────────────────
// applyRange — filters an ASC dataset, with sane fallbacks
// ─────────────────────────────────────────────────────────────────────

function ds(dates: string[]): Array<{ date: string; raw_usd: number }> {
  return dates.map((d, i) => ({ date: d, raw_usd: 100 + i }))
}

describe('applyRange', () => {
  it('returns the full dataset for all', () => {
    const rows = ds(['2026-01-01','2026-03-01','2026-06-01'])
    expect(applyRange(rows, 'all')).toEqual(rows)
  })

  it('keeps rows on or after the cutoff for 30d', () => {
    const rows = ds(['2026-05-01','2026-05-20','2026-06-10','2026-06-20'])
    // latest = 2026-06-20, cutoff = 2026-05-21
    const out = applyRange(rows, '30d')
    expect(out.map(r => r.date)).toEqual(['2026-06-10','2026-06-20'])
  })

  it('keeps rows on or after the cutoff for 7d', () => {
    const rows = ds(['2026-06-10','2026-06-13','2026-06-14','2026-06-20'])
    // latest = 2026-06-20, cutoff = 2026-06-13
    const out = applyRange(rows, '7d')
    expect(out.map(r => r.date)).toEqual(['2026-06-13','2026-06-14','2026-06-20'])
  })

  it('filters 90d', () => {
    const rows = ds(['2026-01-01','2026-03-01','2026-04-15','2026-06-20'])
    // latest = 2026-06-20, cutoff = 2026-03-22
    const out = applyRange(rows, '90d')
    expect(out.map(r => r.date)).toEqual(['2026-04-15','2026-06-20'])
  })

  it('filters 6m anchored on latest date', () => {
    const rows = ds(['2025-10-01','2026-01-01','2026-03-01','2026-06-15'])
    // latest = 2026-06-15, cutoff = 2025-12-15
    const out = applyRange(rows, '6m')
    expect(out.map(r => r.date)).toEqual(['2026-01-01','2026-03-01','2026-06-15'])
  })

  it('filters 1y anchored on latest date', () => {
    const rows = ds(['2024-01-01','2025-06-15','2026-01-01','2026-06-15'])
    // latest = 2026-06-15, cutoff = 2025-06-15
    const out = applyRange(rows, '1y')
    expect(out.map(r => r.date)).toEqual(['2025-06-15','2026-01-01','2026-06-15'])
  })

  it('uses the LATEST data point as the anchor, not Date.now()', () => {
    // Dataset is 5 years stale. A 30d filter must still keep the last
    // few points in the dataset; it must NOT be empty just because
    // wall-clock now is much later.
    const rows = ds(['2021-03-01','2021-03-15','2021-03-25','2021-03-31'])
    // latest = 2021-03-31, cutoff = 2021-03-01
    const out = applyRange(rows, '30d')
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out[out.length - 1].date).toBe('2021-03-31')
  })

  it('falls back to the full dataset when the filter leaves <2 points', () => {
    const rows = ds(['2024-01-01','2024-02-01','2026-06-20'])
    // latest = 2026-06-20, cutoff for 7d = 2026-06-13
    // Filtered would yield exactly 1 row → fall back to full dataset.
    expect(applyRange(rows, '7d')).toEqual(rows)
  })

  it('returns the dataset unchanged when length < 2', () => {
    expect(applyRange(ds([]), '7d')).toEqual([])
    expect(applyRange(ds(['2026-06-01']), '7d').length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// pickDefaultRange — 90d when span >= 90 days, else all
// ─────────────────────────────────────────────────────────────────────

describe('pickDefaultRange', () => {
  it('returns all for an empty dataset', () => {
    expect(pickDefaultRange([])).toBe<ChartRange>('all')
  })

  it('returns all when only one data point exists', () => {
    expect(pickDefaultRange(ds(['2026-06-15']))).toBe<ChartRange>('all')
  })

  it('returns all when span < 90 days', () => {
    expect(pickDefaultRange(ds(['2026-04-15','2026-06-15']))).toBe<ChartRange>('all') // ~61 days
  })

  it('returns 90d when span >= 90 days exactly', () => {
    expect(pickDefaultRange(ds(['2026-03-17','2026-06-15']))).toBe<ChartRange>('90d') // 90 days
  })

  it('returns 90d when span > 1 year', () => {
    expect(pickDefaultRange(ds(['2024-06-15','2026-06-15']))).toBe<ChartRange>('90d')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Component smoke — range pills present iff ranges prop is set
// ─────────────────────────────────────────────────────────────────────

describe('PriceChart — range pill rendering', () => {
  const data = ds(['2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-06-01'])

  it('renders the range tablist when ranges is true', () => {
    const html = renderToString(createElement(PriceChart, { data, ranges: true }))
    expect(html).toContain('Price history range')
    for (const label of ['7D','30D','90D','6M','1Y','All']) {
      expect(html).toContain(`>${label}<`)
    }
  })

  it('does not render the range tablist when ranges is omitted (back-compat)', () => {
    const html = renderToString(createElement(PriceChart, { data }))
    expect(html).not.toContain('Price history range')
  })

  it('renders the "not enough data" message and no range tablist when data has <2 points', () => {
    const html = renderToString(createElement(PriceChart, { data: ds(['2026-06-15']), ranges: true }))
    expect(html).toContain('Not enough price history data yet')
    expect(html).not.toContain('Price history range')
  })

  it('marks exactly one range tab as selected when ranges is true', () => {
    const html = renderToString(createElement(PriceChart, { data, ranges: true }))
    const selected = (html.match(/aria-selected="true"/g) ?? []).length
    expect(selected).toBe(1)
  })
})
