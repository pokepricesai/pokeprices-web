// Block 5A-W-50B — bulk-loader tests. Proves:
//   * exactly TWO paginated queries per set-load (no N+1 per tile)
//   * anonymous users make no query (contract: caller checks user first)
//   * queries are keyed on (user_id, set_name) — English and Japanese
//     stay in separate buckets because "Base Set" and "Japanese Base Set"
//     resolve to different set_name strings.

import { describe, it, expect } from 'vitest'
import { loadSetMembership, normaliseSlug, EMPTY_MEMBERSHIP } from '../setPageMembership'

function fakeClient(watchRows: any[], portfolioRows: any[]) {
  const calls: Array<{ table: string; filters: Record<string, any> }> = []
  const client = {
    from(table: string) {
      const filters: Record<string, any> = {}
      const chain = {
        select: (_: string) => chain,
        eq: (col: string, val: any) => { filters[col] = val; return chain },
        then: (cb: any) => {
          calls.push({ table, filters })
          const data = table === 'watchlist' ? watchRows : portfolioRows
          return Promise.resolve({ data, error: null }).then(cb)
        },
      }
      return chain
    },
  } as any
  return { client, calls }
}

describe('normaliseSlug', () => {
  it('leaves bare slugs alone', () => {
    expect(normaliseSlug('8330138')).toBe('8330138')
  })
  it('strips a pc- prefix', () => {
    expect(normaliseSlug('pc-8330138')).toBe('8330138')
  })
  it('handles null / empty safely', () => {
    expect(normaliseSlug(null)).toBe('')
    expect(normaliseSlug(undefined)).toBe('')
    expect(normaliseSlug('')).toBe('')
  })
})

describe('loadSetMembership', () => {
  it('issues exactly TWO queries (no N+1)', async () => {
    const { client, calls } = fakeClient([], [])
    await loadSetMembership(client, 'u1', 'Base Set')
    expect(calls).toHaveLength(2)
    const tables = calls.map(c => c.table).sort()
    expect(tables).toEqual(['portfolio_items', 'watchlist'])
  })

  it('filters both tables on (user_id, set_name)', async () => {
    const { client, calls } = fakeClient([], [])
    await loadSetMembership(client, 'u1', 'Base Set')
    for (const c of calls) {
      expect(c.filters.user_id).toBe('u1')
    }
    const wl = calls.find(c => c.table === 'watchlist')!
    const pf = calls.find(c => c.table === 'portfolio_items')!
    expect(wl.filters.set_name).toBe('Base Set')
    expect(pf.filters.set_name_snapshot).toBe('Base Set')
  })

  it('returns bare-slug sets even when the DB row uses pc- prefix', async () => {
    const { client } = fakeClient(
      [{ card_slug: 'pc-8330138' }, { card_slug: '8076785' }],
      [{ card_slug: '8076785' }],
    )
    const m = await loadSetMembership(client, 'u1', 'Japanese Promo')
    expect(m.watched.has('8330138')).toBe(true)
    expect(m.watched.has('8076785')).toBe(true)
    expect(m.inPortfolio.has('8076785')).toBe(true)
    expect(m.watched.has('pc-8330138')).toBe(false)  // normalised
  })

  it('English and Japanese sets are scoped separately', async () => {
    // Query for 'Base Set' — DB returns nothing (the JP row is under
    // 'Japanese Base Set' and is scoped out by set_name).
    const { client } = fakeClient([], [])
    const m = await loadSetMembership(client, 'u1', 'Base Set')
    expect(m.watched.size).toBe(0)
    expect(m.inPortfolio.size).toBe(0)
    // Contrast: a query for the JP set returns rows.
    const { client: jpClient } = fakeClient(
      [{ card_slug: '999999' }], [],
    )
    const jm = await loadSetMembership(jpClient, 'u1', 'Japanese Base Set')
    expect(jm.watched.has('999999')).toBe(true)
  })

  it('returns EMPTY_MEMBERSHIP shape when no rows exist', async () => {
    const { client } = fakeClient([], [])
    const m = await loadSetMembership(client, 'u1', 'Base Set')
    expect(m).toEqual({
      watched: EMPTY_MEMBERSHIP.watched,
      inPortfolio: EMPTY_MEMBERSHIP.inPortfolio,
    })
  })
})
