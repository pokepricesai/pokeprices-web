// Block 5A-W-23 — summary stats helper tests.
// Pure unit tests for the bucket math driving the top-of-page panel.

import { describe, it, expect } from 'vitest'
import {
  summariseWatchlistAlerts,
  type WatchlistOverrideRowLite,
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
