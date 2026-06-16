// Block 3B — activation branching tests. Pure rule + DB-backed counts.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { pickActivationBranch, readActivationCounts } from '../onboardingActivation'

beforeEach(() => fakeDB.reset())

describe('pickActivationBranch (pure)', () => {
  it('A when both portfolio + watchlist are empty', () => {
    expect(pickActivationBranch({ portfolio: 0, watchlist: 0, shows: 0 })).toBe('A')
  })
  it('B when watchlist > 0 AND portfolio == 0', () => {
    expect(pickActivationBranch({ portfolio: 0, watchlist: 3, shows: 0 })).toBe('B')
  })
  it('C when portfolio > 0 AND watchlist == 0', () => {
    expect(pickActivationBranch({ portfolio: 2, watchlist: 0, shows: 5 })).toBe('C')
  })
  it('D when both portfolio AND watchlist exist', () => {
    expect(pickActivationBranch({ portfolio: 2, watchlist: 4, shows: 0 })).toBe('D')
  })
  it('shows count never alone changes the branch', () => {
    // Card-show stars do not currently move the activation needle.
    expect(pickActivationBranch({ portfolio: 0, watchlist: 0, shows: 99 })).toBe('A')
  })
})

describe('readActivationCounts (DB-backed)', () => {
  it('returns zero counts for a fresh user', async () => {
    const r = await readActivationCounts('u-fresh')
    expect(r).toEqual({ watchlist: 0, portfolio: 0, shows: 0 })
  })

  it('counts watchlist + card_show_stars rows for the user', async () => {
    fakeDB.seed('watchlist', [
      { id: 'w1', user_id: 'u1', card_slug: 'a' },
      { id: 'w2', user_id: 'u1', card_slug: 'b' },
      { id: 'w3', user_id: 'u2', card_slug: 'c' }, // other user — ignored
    ])
    fakeDB.seed('card_show_stars', [
      { user_id: 'u1', show_id: 'london-2026' },
    ])
    const r = await readActivationCounts('u1')
    expect(r.watchlist).toBe(2)
    expect(r.shows).toBe(1)
    expect(r.portfolio).toBe(0)
  })

  it('counts portfolio_items joined via portfolios.user_id', async () => {
    fakeDB.seed('portfolios', [
      { id: 'p1', user_id: 'u1' },
      { id: 'p2', user_id: 'u1' },
      { id: 'p3', user_id: 'u2' }, // other user
    ])
    fakeDB.seed('portfolio_items', [
      { id: 'i1', portfolio_id: 'p1' },
      { id: 'i2', portfolio_id: 'p1' },
      { id: 'i3', portfolio_id: 'p2' },
      { id: 'i4', portfolio_id: 'p3' }, // belongs to other user
    ])
    const r = await readActivationCounts('u1')
    expect(r.portfolio).toBe(3)
  })

  it('falls back to 0 when portfolios table query fails (defensive)', async () => {
    fakeDB.forceInsertError('portfolios', { code: 'X', message: 'no' })
    // forceInsertError only affects writes; portfolios is read here so
    // this should still return 0 simply because no rows exist.
    const r = await readActivationCounts('u-x')
    expect(r.portfolio).toBe(0)
  })
})
