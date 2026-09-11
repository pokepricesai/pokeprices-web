// Block 5A-W-58D.2 — pin the parallelised set-page loader wiring.
//
// This is a source-level pin (same style as the other set-page wiring
// tests). It guarantees that:
//   * The secondary RPCs run in a single Promise.allSettled group so a
//     slow query cannot block the others and a single failure cannot
//     hide unrelated UI sections.
//   * The `live` guard is re-checked after the group settles AND
//     before the movers enrichment writes state.
//   * The retry helper + 58D.1 abort semantics remain wired.
//   * Every state write path (insight, priceHistory, popStats, movers)
//     is gated behind its own settled-result check so partial failures
//     are absorbed gracefully.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'),
  'utf8',
)

describe('SetPageClient — Block 5A-W-58D.2 parallel secondary loader', () => {
  it('runs the secondary queries in a single Promise.allSettled group', () => {
    expect(SRC).toContain('Promise.allSettled([')
    // The array must include all six independent probes.
    const groupMatch = SRC.match(/Promise\.allSettled\(\[[\s\S]*?\]\)/)
    expect(groupMatch).toBeTruthy()
    const group = groupMatch![0]
    expect(group).toMatch(/set_metadata/)
    expect(group).toMatch(/get_set_insight/)
    expect(group).toMatch(/get_set_price_history/)
    expect(group).toMatch(/psa_set_totals/)
    expect(group).toMatch(/card_trends/)
    // Release-date fallback lives in the group too.
    expect(group).toMatch(/set_release_date/)
  })

  it('re-checks the `live` guard immediately after the allSettled group', () => {
    // The `if (!live) return` line immediately following the group is
    // the critical 58D.1 guard for the parallel group's state writes.
    // If a superseded effect completes the whole group, this line
    // prevents every downstream setState from firing.
    const idx = SRC.indexOf('Promise.allSettled([')
    expect(idx).toBeGreaterThan(0)
    const after = SRC.slice(idx, idx + 3000)
    // Find the closing `])` then within a short window look for the
    // live guard.
    const closeIdx = after.indexOf('])')
    expect(closeIdx).toBeGreaterThan(0)
    const window = after.slice(closeIdx, closeIdx + 200)
    expect(window).toContain('if (!live) return')
  })

  it('gates every settled-result state write behind its own status check', () => {
    // Six settled probes, each writing state only when fulfilled. The
    // literal counts here ensure that a `.status === 'fulfilled'` check
    // exists for each of the six secondary results.
    const matches = SRC.match(/\.status === 'fulfilled'/g) ?? []
    // 6 secondaries. Allow >= 6 in case future edits add extra
    // fulfilled checks; anything below 6 means at least one result is
    // being consumed without a status guard.
    expect(matches.length).toBeGreaterThanOrEqual(6)
  })

  it('still uses the 58D.1 retry helper for the primary RPC', () => {
    expect(SRC).toContain('fetchPrimarySetCardsWithRetry')
    expect(SRC).toContain("primary.status === 'aborted'")
    expect(SRC).toContain("primary.status === 'failed'")
  })

  it('keeps the `live` guard inside the movers enrichment sub-chain', () => {
    // The two enrichment queries (cards.in + card_volume.in) run in
    // Promise.all AFTER the primary allSettled group returns. We must
    // still re-check `live` before writing movers state so a
    // superseded effect cannot overwrite a fresh one.
    const enrichIdx = SRC.indexOf('card_volume')
    expect(enrichIdx).toBeGreaterThan(0)
    const window = SRC.slice(enrichIdx, enrichIdx + 2000)
    expect(window).toMatch(/if \(!live\) return/)
  })

  it('does not resurrect the previous serial-chain pattern', () => {
    // Guards against a regression that reintroduces a per-secondary
    // `await supabase.rpc('get_set_insight'` at the top level (i.e.
    // outside the allSettled group).
    //
    // The current file has exactly ONE reference to each secondary
    // (inside the allSettled array). If a serial refactor adds a
    // second reference, this assertion will fail.
    const rpcInsightCount = (SRC.match(/rpc\('get_set_insight'/g) ?? []).length
    const rpcHistoryCount = (SRC.match(/rpc\('get_set_price_history'/g) ?? []).length
    expect(rpcInsightCount).toBe(1)
    expect(rpcHistoryCount).toBe(1)
  })
})
