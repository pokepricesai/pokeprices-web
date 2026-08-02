// Block 5A-W-50C — completion loader tests.

import { describe, it, expect } from 'vitest'
import {
  computePercentage,
  aggregateOwned,
  buildCompletionMap,
  loadPortfolioOwnedBySet,
} from '../setCompletion'

describe('computePercentage', () => {
  it('returns 0 when total is zero or negative', () => {
    expect(computePercentage(5, 0)).toBe(0)
    expect(computePercentage(5, -1)).toBe(0)
  })
  it('returns 0 when owned is zero or negative', () => {
    expect(computePercentage(0, 100)).toBe(0)
    expect(computePercentage(-1, 100)).toBe(0)
  })
  it('rounds to the nearest integer', () => {
    expect(computePercentage(1, 3)).toBe(33)
    expect(computePercentage(2, 3)).toBe(67)
    expect(computePercentage(1, 8)).toBe(13)   // 12.5 → 13
  })
  it('clamps at 100 when owned exceeds total', () => {
    expect(computePercentage(150, 100)).toBe(100)
  })
  it('returns 100 for exact completion', () => {
    expect(computePercentage(50, 50)).toBe(100)
  })
  it('handles infinity / NaN gracefully', () => {
    expect(computePercentage(Number.POSITIVE_INFINITY, 100)).toBe(0)
    expect(computePercentage(50, Number.NaN)).toBe(0)
  })
})

describe('aggregateOwned', () => {
  it('groups distinct card_slug per set_name_snapshot', () => {
    const out = aggregateOwned([
      { card_slug: 'a', set_name_snapshot: 'Base Set' },
      { card_slug: 'b', set_name_snapshot: 'Base Set' },
      { card_slug: 'a', set_name_snapshot: 'Base Set' },   // duplicate row (multiple holdings)
      { card_slug: 'c', set_name_snapshot: 'Jungle' },
    ])
    expect(out['Base Set'].size).toBe(2)   // 'a' counted once
    expect(out['Jungle'].size).toBe(1)
  })

  it('multiple holding_types of the same card count once', () => {
    // Same card_slug + set_name via raw + graded holdings — should
    // still resolve to a single distinct card.
    const out = aggregateOwned([
      { card_slug: '111', set_name_snapshot: 'Base Set' },   // raw
      { card_slug: '111', set_name_snapshot: 'Base Set' },   // PSA 10
      { card_slug: '111', set_name_snapshot: 'Base Set' },   // BGS 9.5
    ])
    expect(out['Base Set'].size).toBe(1)
  })

  it('English and Japanese sets stay separate', () => {
    const out = aggregateOwned([
      { card_slug: '999', set_name_snapshot: 'Base Set' },
      { card_slug: '999', set_name_snapshot: 'Japanese Base Set' },
    ])
    expect(out['Base Set'].size).toBe(1)
    expect(out['Japanese Base Set'].size).toBe(1)
  })

  it('same card_slug in different sets counts in each', () => {
    // Different sets — different denominator each — so we track
    // per-set even when the underlying slug looks the same.
    const out = aggregateOwned([
      { card_slug: '111', set_name_snapshot: 'Base Set' },
      { card_slug: '111', set_name_snapshot: 'Jungle' },
    ])
    expect(out['Base Set'].size).toBe(1)
    expect(out['Jungle'].size).toBe(1)
  })

  it('skips rows with null card_slug or null set_name_snapshot', () => {
    const out = aggregateOwned([
      { card_slug: null, set_name_snapshot: 'Base Set' },
      { card_slug: 'a',  set_name_snapshot: null },
      { card_slug: 'b',  set_name_snapshot: 'Jungle' },
    ])
    expect(Object.keys(out).sort()).toEqual(['Jungle'])
  })
})

describe('buildCompletionMap', () => {
  it('excludes sets with zero owned (no placeholder)', () => {
    const owned  = aggregateOwned([
      { card_slug: 'a', set_name_snapshot: 'Base Set' },
    ])
    const totals = { 'Base Set': 100, 'Jungle': 64 }
    const m = buildCompletionMap(owned, totals)
    expect(m['Base Set']).toBeDefined()
    expect(m['Jungle']).toBeUndefined()   // no owned card → no entry
  })

  it('computes correct percentage using the passed totals', () => {
    const owned = aggregateOwned([
      { card_slug: 'a', set_name_snapshot: 'Base Set' },
      { card_slug: 'b', set_name_snapshot: 'Base Set' },
    ])
    const m = buildCompletionMap(owned, { 'Base Set': 8 })
    expect(m['Base Set']).toEqual({
      ownedDistinct: 2,
      totalEligible: 8,
      percentage:    25,
    })
  })

  it('percentage cannot exceed 100 even if the denominator is stale', () => {
    // Ownership > denominator (e.g. set metadata is out of date).
    const owned = aggregateOwned([
      { card_slug: 'a', set_name_snapshot: 'Base Set' },
      { card_slug: 'b', set_name_snapshot: 'Base Set' },
      { card_slug: 'c', set_name_snapshot: 'Base Set' },
    ])
    const m = buildCompletionMap(owned, { 'Base Set': 2 })
    expect(m['Base Set'].percentage).toBe(100)
  })

  it('missing denominator = 0 → percentage 0 (row still included with owned>0)', () => {
    const owned = aggregateOwned([
      { card_slug: 'a', set_name_snapshot: 'Base Set' },
    ])
    // No 'Base Set' in totals — the set is present in the map with 0
    // denominator. The React layer's <SetCompletionProgress> guard
    // then renders nothing.
    const m = buildCompletionMap(owned, {})
    expect(m['Base Set']).toEqual({
      ownedDistinct: 1,
      totalEligible: 0,
      percentage:    0,
    })
  })
})

describe('loadPortfolioOwnedBySet — pagination', () => {
  function fakeSupabase(pages: Array<Array<any>>) {
    // Return each page in order. Every .range() call pops the next page.
    let idx = 0
    const calls: Array<{ from: number; to: number; filters: any }> = []
    return {
      from: (_table: string) => {
        const filters: any = {}
        const chain: any = {
          select: (_cols: string) => chain,
          eq:     (col: string, val: any) => { filters[col] = val; return chain },
          range:  (from: number, to: number) => {
            const data = pages[idx] ?? []
            calls.push({ from, to, filters })
            idx++
            return Promise.resolve({ data, error: null })
          },
        }
        return chain
      },
      __calls: calls,
    } as any
  }

  it('paginates through multiple pages until a short page is seen', async () => {
    // Two full pages of 1000 then a final short page.
    const p1 = Array.from({ length: 1000 }, (_, i) => ({ card_slug: `s1-${i}`, set_name_snapshot: 'Base Set' }))
    const p2 = Array.from({ length: 1000 }, (_, i) => ({ card_slug: `s2-${i}`, set_name_snapshot: 'Base Set' }))
    const p3 = [{ card_slug: 'z', set_name_snapshot: 'Jungle' }]
    const client = fakeSupabase([p1, p2, p3])
    const map = await loadPortfolioOwnedBySet(client, 'u1', 1000)
    expect(map['Base Set'].size).toBe(2000)
    expect(map['Jungle'].size).toBe(1)
    expect(client.__calls.length).toBe(3)
    // Every call filters on user_id
    for (const c of client.__calls) expect(c.filters.user_id).toBe('u1')
  })

  it('stops after the first empty page (no infinite loop)', async () => {
    const client = fakeSupabase([[]])
    const map = await loadPortfolioOwnedBySet(client, 'u1', 1000)
    expect(map).toEqual({})
    expect(client.__calls.length).toBe(1)
  })

  it('respects the page size on the range boundaries', async () => {
    const client = fakeSupabase([[]])
    await loadPortfolioOwnedBySet(client, 'u1', 500)
    expect(client.__calls[0]).toEqual({ from: 0, to: 499, filters: { user_id: 'u1' } })
  })
})
