// Block 5A-W-58D.1 — unit tests for the primary set-cards retry helper.
//
// These pin the six required scenarios plus the source-level wiring
// into SetPageClient so a regression that removes the `live` guard or
// the retry surfaces immediately.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  fetchPrimarySetCardsWithRetry,
  PRIMARY_RETRY_DELAY_MS,
  type CardRpcFetcher,
  type PrimaryCardsOutcome,
} from '../loadSetCards'

// ---------------------------------------------------------------------
// fake fetcher helpers
// ---------------------------------------------------------------------

function ok(data: unknown[]): { data: unknown[] | null; error: unknown | null } {
  return { data, error: null }
}
function fail(): { data: unknown[] | null; error: unknown | null } {
  return { data: null, error: { message: 'boom' } }
}

/** A fetcher that returns a scripted sequence of results. */
function scripted(results: Array<{ data: unknown[] | null; error: unknown | null }>): {
  fetcher: CardRpcFetcher
  calls: () => number
} {
  let i = 0
  const fetcher: CardRpcFetcher = async () => {
    const r = results[i] ?? results[results.length - 1]
    i++
    return r
  }
  return { fetcher, calls: () => i }
}

/** A sleep stub that resolves immediately — the tests don't need real time. */
const instantSleep = async () => {}

// ---------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------

describe('fetchPrimarySetCardsWithRetry', () => {
  it('scenario 1 — succeeds on first attempt, no retry', async () => {
    const { fetcher, calls } = scripted([ok([{ card_slug: 'a' }])])
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => true,
      { sleep: instantSleep },
    )
    expect(out.status).toBe('success')
    expect((out as Extract<PrimaryCardsOutcome, { status: 'success' }>).data).toEqual([
      { card_slug: 'a' },
    ])
    expect(calls()).toBe(1)
  })

  it('scenario 2 — fails once, succeeds on retry', async () => {
    const { fetcher, calls } = scripted([fail(), ok([{ card_slug: 'b' }])])
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => true,
      { sleep: instantSleep },
    )
    expect(out.status).toBe('success')
    expect((out as Extract<PrimaryCardsOutcome, { status: 'success' }>).data).toEqual([
      { card_slug: 'b' },
    ])
    expect(calls()).toBe(2)
  })

  it('scenario 3 — fails twice, returns failed (no third attempt)', async () => {
    const { fetcher, calls } = scripted([fail(), fail()])
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => true,
      { sleep: instantSleep },
    )
    expect(out.status).toBe('failed')
    expect(calls()).toBe(2)
  })

  it('scenario 4 — stale first load fails after newer load succeeds; failure ignored (isLive drops mid-flight)', async () => {
    // Simulate the "stale request completes after fresh effect started"
    // race: the fetcher returns a failure but by then isLive() has
    // been flipped to false by the caller (effect cleanup). The helper
    // must return `aborted`, not `failed`, so the caller does NOT call
    // setError(true) and clobber a fresh success.
    let live = true
    const fetcher: CardRpcFetcher = async () => {
      live = false // caller superseded us before this promise resolved
      return fail()
    }
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => live,
      { sleep: instantSleep },
    )
    expect(out.status).toBe('aborted')
  })

  it('scenario 5 — stale first load succeeds after newer load succeeds; result ignored', async () => {
    // Same shape as scenario 4, but the stale fetch actually returns
    // data. We still want `aborted` — the caller cannot pass this data
    // to setCards or it would overwrite the fresh effect's cards.
    let live = true
    const fetcher: CardRpcFetcher = async () => {
      live = false
      return ok([{ card_slug: 'stale' }])
    }
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => live,
      { sleep: instantSleep },
    )
    expect(out.status).toBe('aborted')
  })

  it('scenario 6 — effect cleanup during retry delay; no second attempt, no state write', async () => {
    let live = true
    const { fetcher, calls } = scripted([fail(), ok([{ card_slug: 'never-used' }])])
    const sleep = vi.fn(async () => {
      // Caller's cleanup fires during the retry delay.
      live = false
    })
    const out = await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => live,
      { sleep },
    )
    expect(out.status).toBe('aborted')
    // Only the first attempt happened; retry was suppressed.
    expect(calls()).toBe(1)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('uses PRIMARY_RETRY_DELAY_MS by default', async () => {
    const { fetcher } = scripted([fail(), ok([])])
    const sleep = vi.fn(async () => {})
    await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => true,
      { sleep },
    )
    expect(sleep).toHaveBeenCalledWith(PRIMARY_RETRY_DELAY_MS)
  })

  it('does not sleep or retry on first-attempt success', async () => {
    const { fetcher, calls } = scripted([ok([{ card_slug: 'a' }])])
    const sleep = vi.fn(async () => {})
    await fetchPrimarySetCardsWithRetry(
      fetcher,
      'Base Set',
      'release_desc',
      () => true,
      { sleep },
    )
    expect(calls()).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------
// source-level pin — mirrors the codebase's existing test style
// (see src/app/browse/__tests__/browseCompletion.test.ts). Guarantees
// the helper is wired into the effect and the `live` guard cannot be
// silently deleted.
// ---------------------------------------------------------------------

const SET_CLIENT_SRC = readFileSync(
  join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'),
  'utf8',
)

describe('SetPageClient — Block 5A-W-58D.1 wiring', () => {
  it('imports the retry helper', () => {
    expect(SET_CLIENT_SRC).toContain("from './loadSetCards'")
    expect(SET_CLIENT_SRC).toContain('fetchPrimarySetCardsWithRetry')
  })

  it('declares a `live` flag and returns a cleanup that flips it', () => {
    expect(SET_CLIENT_SRC).toMatch(/let live = true/)
    expect(SET_CLIENT_SRC).toMatch(/return \(\) => \{ live = false \}/)
  })

  it('guards state writes after awaits with `if (!live) return`', () => {
    // Block 5A-W-58D.2 folded the previously-serial secondary chain
    // into a single Promise.allSettled group. That group is protected
    // by ONE guard immediately after the settle. Combined with the
    // guards around the primary RPC and the movers enrichment, every
    // `await` in the loader is still gated. The count is therefore
    // >= 4 rather than >= 6 (which was the pre-58D.2 shape).
    //
    // If any guard drops out of the loader — primary, primary post-
    // normalise, post-allSettled, post-movers-enrichment — this test
    // will fail with a lower count and the parallel-loader test file
    // will fail on its explicit position assertions.
    const matches = SET_CLIENT_SRC.match(/if \(!live\) return/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('handles the failed / aborted outcomes from the retry helper', () => {
    expect(SET_CLIENT_SRC).toContain("primary.status === 'aborted'")
    expect(SET_CLIENT_SRC).toContain("primary.status === 'failed'")
  })
})
