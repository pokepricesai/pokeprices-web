// Block 5A-W-1 — tests for the admin engagement snapshot helper.
// Covers: empty database → zeros; seeded data → counts + top-card sort;
// privacy → no user_id or email in the response.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import { getEngagementSnapshot } from '../engagementQueries'

const fakeDB = new FakeDB()
beforeEach(() => { fakeDB.reset() })

describe('getEngagementSnapshot — empty database', () => {
  it('returns zeroed counts and an empty topCards array', async () => {
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.watchlist).toEqual({ rows: 0, distinctUsers: 0, topCards: [] })
    expect(snap.portfolio).toEqual({ distinctUsers: 0, items: 0 })
    expect(snap.alerts).toEqual({
      legacyUserAlertsActive: 0,
      alertPreferenceRows:    0,
      alertEventsAllTime:     0,
      alertEvents7d:          0,
    })
  })
})

describe('getEngagementSnapshot — watchlist counts', () => {
  it('counts distinct users + total rows', async () => {
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'a', card_name: 'Charizard',  set_name: 'Base Set' },
      { user_id: 'u1', card_slug: 'b', card_name: 'Blastoise',  set_name: 'Base Set' },
      { user_id: 'u2', card_slug: 'a', card_name: 'Charizard',  set_name: 'Base Set' },
      { user_id: 'u3', card_slug: 'a', card_name: 'Charizard',  set_name: 'Base Set' },
    ])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.watchlist.rows).toBe(4)
    expect(snap.watchlist.distinctUsers).toBe(3)
  })

  it('builds a top-cards list sorted by watcher count desc', async () => {
    fakeDB.seed('watchlist', [
      { user_id: 'u1', card_slug: 'a', card_name: 'Charizard', set_name: 'Base' },
      { user_id: 'u2', card_slug: 'a', card_name: 'Charizard', set_name: 'Base' },
      { user_id: 'u3', card_slug: 'a', card_name: 'Charizard', set_name: 'Base' },
      { user_id: 'u1', card_slug: 'b', card_name: 'Blastoise', set_name: 'Base' },
      { user_id: 'u2', card_slug: 'b', card_name: 'Blastoise', set_name: 'Base' },
      { user_id: 'u1', card_slug: 'c', card_name: 'Pikachu',   set_name: 'Promo' },
    ])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.watchlist.topCards.map(c => c.cardSlug)).toEqual(['a','b','c'])
    expect(snap.watchlist.topCards[0]).toMatchObject({
      cardSlug: 'a', cardName: 'Charizard', setName: 'Base', watchers: 3,
    })
  })

  it('caps top cards at 20 entries', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      user_id: `u${i}`, card_slug: `slug-${i}`, card_name: `Card ${i}`, set_name: 'Set',
    }))
    fakeDB.seed('watchlist', rows)
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.watchlist.topCards).toHaveLength(20)
  })
})

describe('getEngagementSnapshot — portfolio counts', () => {
  it('counts distinct portfolio owners and item rows', async () => {
    fakeDB.seed('portfolios',       [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u2' }])
    fakeDB.seed('portfolio_items',  [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }, { id: 'i4' }])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.portfolio.distinctUsers).toBe(2)
    expect(snap.portfolio.items).toBe(4)
  })
})

describe('getEngagementSnapshot — alert counts', () => {
  it('counts active legacy user_alerts only (skips is_active=false)', async () => {
    fakeDB.seed('user_alerts', [
      { id: 'a1', user_id: 'u1', is_active: true  },
      { id: 'a2', user_id: 'u1', is_active: true  },
      { id: 'a3', user_id: 'u2', is_active: false },
    ])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.alerts.legacyUserAlertsActive).toBe(2)
  })

  it('counts user_alert_preferences rows', async () => {
    fakeDB.seed('user_alert_preferences', [
      { user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' },
    ])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.alerts.alertPreferenceRows).toBe(3)
  })

  it('counts alert_events all-time and within the 7-day window', async () => {
    const now = Date.now()
    fakeDB.seed('alert_events', [
      { id: 'e1', user_id: 'u1', detected_at: new Date(now - 1 * 86_400_000).toISOString() }, // 1d → in 7d
      { id: 'e2', user_id: 'u1', detected_at: new Date(now - 5 * 86_400_000).toISOString() }, // 5d → in 7d
      { id: 'e3', user_id: 'u2', detected_at: new Date(now - 9 * 86_400_000).toISOString() }, // 9d → not in 7d
    ])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    expect(snap.alerts.alertEventsAllTime).toBe(3)
    expect(snap.alerts.alertEvents7d).toBe(2)
  })
})

describe('getEngagementSnapshot — privacy', () => {
  it('does not expose user_id or email anywhere in the response', async () => {
    fakeDB.seed('watchlist', [
      { user_id: 'should-not-leak', card_slug: 'a', card_name: 'X', set_name: 'Y' },
    ])
    fakeDB.seed('portfolios',      [{ user_id: 'should-not-leak' }])
    fakeDB.seed('portfolio_items', [{ id: 'i1' }])
    fakeDB.seed('alert_events',    [{ id: 'e1', user_id: 'should-not-leak', detected_at: new Date().toISOString() }])
    const snap = await getEngagementSnapshot(asSupa(fakeDB))
    const blob = JSON.stringify(snap)
    expect(blob).not.toMatch(/should-not-leak/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"email"/i)
  })
})
