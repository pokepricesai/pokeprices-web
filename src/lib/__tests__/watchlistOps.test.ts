// Block 5A-W-50B-FIX1 — shared performWatchlistAdd tests.

import { describe, it, expect } from 'vitest'
import { performWatchlistAdd } from '../watchlistOps'

function chain() {
  const state: any = { filters: {}, ops: [] }
  const c: any = {
    select: (cols: string) => { state.ops.push({ op: 'select', cols }); return c },
    eq:     (col: string, val: any) => { state.filters[col] = val; return c },
    maybeSingle: () => Promise.resolve({ data: state.__existing ?? null, error: null }),
    insert: (rows: any) => { state.ops.push({ op: 'insert', rows }); return c },
    single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }),
  }
  return { c, state }
}

function fakeClient(existing?: any) {
  const calls: any[] = []
  const client = {
    from: (table: string) => {
      const { c, state } = chain()
      state.__existing = existing
      calls.push({ table, state })
      return c
    },
  } as any
  return { client, calls }
}

const CARD = {
  card_slug: '8330138',
  card_name: "Aura's Lucario",
  set_name:  'Japanese Promo',
  image_url: null,
  card_number: '93',
  raw_usd: 5190,
  psa10_usd: null,
}

describe('performWatchlistAdd', () => {
  it('returns existing id without inserting when the row is already there', async () => {
    const { client, calls } = fakeClient({ id: 'existing-id' })
    const id = await performWatchlistAdd(client, 'u1', CARD)
    expect(id).toBe('existing-id')
    // Only the initial select-with-filters; no insert
    const insertCalls = calls.filter(c => c.state.ops.some((o: any) => o.op === 'insert'))
    expect(insertCalls).toHaveLength(0)
  })

  it('inserts a new row when none exists', async () => {
    const { client, calls } = fakeClient(null)
    const id = await performWatchlistAdd(client, 'u1', CARD)
    expect(id).toBe('new-id')
    const insertCalls = calls.filter(c => c.state.ops.some((o: any) => o.op === 'insert'))
    expect(insertCalls).toHaveLength(1)
    const inserted = insertCalls[0].state.ops.find((o: any) => o.op === 'insert').rows[0]
    expect(inserted.user_id).toBe('u1')
    expect(inserted.card_slug).toBe('8330138')
    expect(inserted.set_name).toBe('Japanese Promo')
  })

  it('dedup select filters on user_id AND card_slug AND set_name', async () => {
    const { client, calls } = fakeClient(null)
    await performWatchlistAdd(client, 'u1', CARD)
    // The first .from('watchlist') call is the dedup select.
    const first = calls[0]
    expect(first.state.filters.user_id).toBe('u1')
    expect(first.state.filters.card_slug).toBe('8330138')
    expect(first.state.filters.set_name).toBe('Japanese Promo')
  })
})
