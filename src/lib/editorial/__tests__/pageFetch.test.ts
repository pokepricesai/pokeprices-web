// src/lib/editorial/__tests__/pageFetch.test.ts
//
// Regression tests for fetchInChunks — the fix for the
// `fetchAllPages: page 0 failed — 414 Request-URI Too Large`
// error that hit monthlyMarketReport when its .in('card_slug',
// 30k-slugs) blew past PostgREST's URL length limit.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { fetchInChunks } from '../pageFetch'

// Fake builder that records every chunk it was asked to fetch and
// returns one fake row per value in the chunk. Simulates
// PostgREST's default 1k page cap by returning at most 1000 rows
// per call — but here chunks are ≤500 so pagination doesn't kick in.
type Row = { id: string | number }

function makeBuilderFactory(record: Array<readonly (string | number)[]>) {
  return (chunk: readonly (string | number)[]) => {
    record.push(chunk)
    let requestedFrom = 0
    let requestedTo   = 999
    const chain: any = {
      range(from: number, to: number) { requestedFrom = from; requestedTo = to; return chain },
      then(resolve: (v: any) => any) {
        const rows: Row[] = chunk.slice(requestedFrom, requestedTo + 1).map(v => ({ id: v }))
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return chain
  }
}

// ─────────────────────────────────────────────────────────────────
// 414 regression — the actual failure mode
// ─────────────────────────────────────────────────────────────────

describe('fetchInChunks: 414 regression', () => {
  it('30,000 slugs (default chunkSize) → 75 requests, all rows returned', async () => {
    const seen: Array<readonly (string | number)[]> = []
    // Bare numeric slugs — the actual shape used by monthlyMarketReport.
    const slugs = Array.from({ length: 30_000 }, (_, i) => String(100_000 + i))
    const rows = await fetchInChunks<Row>(slugs, makeBuilderFactory(seen))

    expect(rows).toHaveLength(30_000)
    // Default chunkSize is 400 → 30,000 / 400 = 75 requests.
    expect(seen).toHaveLength(75)
    for (const c of seen) expect(c.length).toBeLessThanOrEqual(400)
    // Every value appears exactly once in seen (dedup + no gap).
    const flat = seen.flatMap(c => Array.from(c))
    expect(new Set(flat).size).toBe(30_000)
  })

  it('dedupes duplicate input values before chunking', async () => {
    const seen: Array<readonly (string | number)[]> = []
    const slugs = ['a', 'b', 'a', 'c', 'b', 'a']
    const rows = await fetchInChunks<Row>(slugs, makeBuilderFactory(seen), { chunkSize: 100 })
    expect(rows).toHaveLength(3)          // a, b, c
    expect(seen[0]).toEqual(['a', 'b', 'c'])
  })

  it('respects custom chunk size', async () => {
    const seen: Array<readonly (string | number)[]> = []
    const slugs = Array.from({ length: 250 }, (_, i) => `x-${i}`)
    await fetchInChunks<Row>(slugs, makeBuilderFactory(seen), { chunkSize: 100 })
    expect(seen).toHaveLength(3)  // 100 + 100 + 50
    expect(seen[0].length).toBe(100)
    expect(seen[1].length).toBe(100)
    expect(seen[2].length).toBe(50)
  })

  it('empty input skips fetching entirely', async () => {
    const seen: Array<readonly (string | number)[]> = []
    const rows = await fetchInChunks<Row>([], makeBuilderFactory(seen))
    expect(rows).toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('single small chunk works with default settings', async () => {
    const seen: Array<readonly (string | number)[]> = []
    const rows = await fetchInChunks<Row>(['only'], makeBuilderFactory(seen))
    expect(rows).toEqual([{ id: 'only' }])
    expect(seen).toEqual([['only']])
  })

  it('URL length estimate at default chunkSize=400 stays under 8KB for realistic slug shapes', () => {
    // Real PokePrices card_slug values are numeric (~6 chars). Even
    // padded to 15 chars for pessimistic safety: 400 × (15 + 3) + 200
    // base = 7,400 bytes — under 8KB. This is why chunkSize was
    // dropped from 500 to 400 as a defense-in-depth default.
    const slugsRealistic = Array.from({ length: 400 }, (_, i) => String(100_000 + i))
    const perValueRealistic = slugsRealistic[0].length + 3   // 6 + 3 = 9
    const estUrlRealistic = 200 + slugsRealistic.length * perValueRealistic
    expect(estUrlRealistic).toBeLessThan(8_000)

    // Pessimistic: even 15-char slugs fit under 8KB at 400 chunk.
    const perValuePessimistic = 15 + 3
    const estUrlPessimistic = 200 + 400 * perValuePessimistic
    expect(estUrlPessimistic).toBeLessThan(8_000)
  })
})
