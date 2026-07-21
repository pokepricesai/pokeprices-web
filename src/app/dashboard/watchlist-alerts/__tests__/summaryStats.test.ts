// Block 5A-W-23 — summary stats helper tests.
// Pure unit tests for the bucket math driving the top-of-page panel.

import { describe, it, expect } from 'vitest'
import {
  summariseWatchlistAlerts,
  pickBiggestMover,
  type WatchlistOverrideRowLite,
  type WatchlistPricedRowLite,
} from '../summaryStats'

function over(over: Partial<WatchlistOverrideRowLite>): WatchlistOverrideRowLite {
  return { card_slug: 'x', enabled: true, use_global_defaults: true, ...over }
}

describe('summariseWatchlistAlerts', () => {
  it('empty watchlist → all counts zero, masterEnabled echoed', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: [], overrides: [], recentEvents7d: [], masterEnabled: true,
    })
    expect(s).toEqual({
      watchedCount: 0, globalDefault: 0, customThreshold: 0,
      alertsOff: 0, recent7dCount: 0, masterEnabled: true,
    })
  })

  it('cards with no override row land in globalDefault', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a', 'b', 'c'], overrides: [],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.globalDefault).toBe(3)
    expect(s.customThreshold).toBe(0)
    expect(s.alertsOff).toBe(0)
  })

  it('override with use_global_defaults=true behaves like no override (still globalDefault)', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a', 'b'],
      overrides:      [over({ card_slug: 'a', use_global_defaults: true })],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.globalDefault).toBe(2)
    expect(s.customThreshold).toBe(0)
  })

  it('override with use_global_defaults=false lands in customThreshold', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a', 'b'],
      overrides:      [over({ card_slug: 'a', use_global_defaults: false })],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.customThreshold).toBe(1)
    expect(s.globalDefault).toBe(1)
  })

  it('override with enabled=false lands in alertsOff (regardless of use_global_defaults)', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a', 'b', 'c'],
      overrides: [
        over({ card_slug: 'a', enabled: false, use_global_defaults: true }),
        over({ card_slug: 'b', enabled: false, use_global_defaults: false }),
      ],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.alertsOff).toBe(2)
    expect(s.globalDefault).toBe(1)
    expect(s.customThreshold).toBe(0)
  })

  it('buckets are mutually exclusive — they sum to watchedCount', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a', 'b', 'c', 'd'],
      overrides: [
        over({ card_slug: 'b', use_global_defaults: false }),
        over({ card_slug: 'c', enabled: false }),
      ],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.globalDefault + s.customThreshold + s.alertsOff).toBe(s.watchedCount)
  })

  it('overrides for un-watched cards are ignored (stale rows from removed cards)', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a'],
      overrides: [
        over({ card_slug: 'ghost', enabled: false }),
        over({ card_slug: 'phantom', use_global_defaults: false }),
      ],
      recentEvents7d: [], masterEnabled: true,
    })
    expect(s.alertsOff).toBe(0)
    expect(s.customThreshold).toBe(0)
    expect(s.globalDefault).toBe(1)
  })

  it('recent7dCount is the length of the supplied recentEvents7d array', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a'],
      overrides: [],
      recentEvents7d: [
        { detected_at: '2026-06-28T10:00:00Z' },
        { detected_at: '2026-06-27T10:00:00Z' },
      ],
      masterEnabled: true,
    })
    expect(s.recent7dCount).toBe(2)
  })

  it('masterEnabled=false is faithfully echoed (drives the "Alerts off" empty state)', () => {
    const s = summariseWatchlistAlerts({
      watchlistSlugs: ['a'], overrides: [], recentEvents7d: [],
      masterEnabled: false,
    })
    expect(s.masterEnabled).toBe(false)
  })
})

// ── Block 5A-W-44B — biggest-mover picker ────────────────────────

function row(over: Partial<WatchlistPricedRowLite>): WatchlistPricedRowLite {
  return {
    card_slug:     'slug',
    card_name:     'Card',
    set_name:      'Set',
    card_url_slug: null,
    pct_7d:        null,
    pct_30d:       null,
    ...over,
  }
}

describe('pickBiggestMover — pure (W44B)', () => {
  it('returns null for empty / null / undefined input', () => {
    expect(pickBiggestMover([])).toBeNull()
    expect(pickBiggestMover(null)).toBeNull()
    expect(pickBiggestMover(undefined)).toBeNull()
  })

  it('returns null when no row has a usable pct_7d or pct_30d', () => {
    expect(pickBiggestMover([
      row({ card_slug: 'a', pct_7d: null, pct_30d: null }),
      row({ card_slug: 'b', pct_7d: null, pct_30d: null }),
    ])).toBeNull()
  })

  it('prefers pct_30d over pct_7d row-by-row', () => {
    const out = pickBiggestMover([
      row({ card_slug: 'a', pct_7d: 40, pct_30d: 5 }),  // pct=5 (30d wins)
      row({ card_slug: 'b', pct_7d: null, pct_30d: 3 }),
    ])
    expect(out?.card_slug).toBe('a')
    expect(out?.pct).toBe(5)
    expect(out?.window).toBe('30d')
  })

  it('falls back to pct_7d when pct_30d is null', () => {
    const out = pickBiggestMover([
      row({ card_slug: 'a', pct_7d: 15, pct_30d: null }),
      row({ card_slug: 'b', pct_7d: 2,  pct_30d: null }),
    ])
    expect(out?.card_slug).toBe('a')
    expect(out?.pct).toBe(15)
    expect(out?.window).toBe('7d')
  })

  it('picks by ABSOLUTE value (a big drop beats a smaller rise)', () => {
    const out = pickBiggestMover([
      row({ card_slug: 'a', pct_30d:  10 }),
      row({ card_slug: 'b', pct_30d: -25 }),
    ])
    expect(out?.card_slug).toBe('b')
    expect(out?.pct).toBe(-25)
  })

  it('preserves the sign of the winning pct so the caller can render colour + arrow', () => {
    const up   = pickBiggestMover([row({ card_slug: 'a', pct_30d:  17.4 })])
    const down = pickBiggestMover([row({ card_slug: 'a', pct_30d: -17.4 })])
    expect(up?.pct).toBeGreaterThan(0)
    expect(down?.pct).toBeLessThan(0)
  })

  it('carries card_name / set_name / card_url_slug through so the callable link matches the watchlist row', () => {
    const out = pickBiggestMover([
      row({
        card_slug:     'charizard-base',
        card_name:     'Charizard',
        set_name:      'Base Set',
        card_url_slug: 'charizard-base-set',
        pct_30d:       22.2,
      }),
    ])
    expect(out).toEqual({
      card_name:     'Charizard',
      set_name:      'Base Set',
      card_slug:     'charizard-base',
      card_url_slug: 'charizard-base-set',
      pct:           22.2,
      window:        '30d',
    })
  })

  it('ties resolve to the first row (deterministic)', () => {
    const out = pickBiggestMover([
      row({ card_slug: 'a', pct_30d: 20 }),
      row({ card_slug: 'b', pct_30d: 20 }),
    ])
    expect(out?.card_slug).toBe('a')
  })

  it('skips rows with NaN pct without throwing', () => {
    const out = pickBiggestMover([
      row({ card_slug: 'a', pct_30d: Number.NaN, pct_7d: null }),
      row({ card_slug: 'b', pct_30d: 8 }),
    ])
    expect(out?.card_slug).toBe('b')
  })
})
