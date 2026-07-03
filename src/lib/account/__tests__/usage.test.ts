// Block 5A-W-42A-FIX2 — invariants for the shared portfolio-id
// resolver used by every dashboard-adjacent caller (hub, onboarding
// checklist, entitlement guards).
//
// Behavioural coverage with a lightweight stub client + source-read
// pins for the two-tier is_default → any-portfolio fallback.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadUserPortfolioIds } from '../usage'

const SRC = readFileSync(join(__dirname, '..', 'usage.ts'), 'utf8')

// ── Chain stub ─────────────────────────────────────────────────────
// PostgREST builders in supabase-js are thenable. The chain returned
// by .eq() can either be further .eq()'d OR awaited directly.

type StubResult = { data: Array<{ id: string }> | null; error: unknown }

function makeStub(defaultResult: StubResult, anyResult: StubResult) {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          // First .eq('user_id', ...). The returned chain must be BOTH
          //   * further chainable via .eq('is_default', true) → default
          //   * awaitable → any-portfolios fallback
          return {
            eq(_col: string, _val: unknown) {
              return {
                eq(col2: string, val2: unknown) {
                  if (col2 === 'is_default' && val2 === true) {
                    return Promise.resolve(defaultResult)
                  }
                  return Promise.resolve({ data: null, error: null })
                },
                then(resolve: (r: StubResult) => unknown, reject?: (e: unknown) => unknown) {
                  return Promise.resolve(anyResult).then(resolve, reject)
                },
              }
            },
          }
        },
      }
    },
  } as any
}

describe('loadUserPortfolioIds — behavioural', () => {
  it('returns [] when the userId is empty', async () => {
    const client = makeStub({ data: [], error: null }, { data: [], error: null })
    expect(await loadUserPortfolioIds(client, '')).toEqual([])
  })

  it('prefers is_default = true portfolios and short-circuits the fallback', async () => {
    const client = makeStub(
      { data: [{ id: 'p-default' }], error: null },
      { data: [{ id: 'p-legacy-1' }, { id: 'p-legacy-2' }], error: null },
    )
    const ids = await loadUserPortfolioIds(client, 'user-1')
    expect(ids).toEqual(['p-default'])
  })

  it('falls back to any-portfolio when no is_default row exists (legacy users)', async () => {
    const client = makeStub(
      { data: [], error: null },
      { data: [{ id: 'p-legacy-1' }, { id: 'p-legacy-2' }], error: null },
    )
    const ids = await loadUserPortfolioIds(client, 'user-1')
    expect(ids).toEqual(['p-legacy-1', 'p-legacy-2'])
  })

  it('returns [] when neither tier finds a portfolio row', async () => {
    const client = makeStub({ data: [], error: null }, { data: [], error: null })
    expect(await loadUserPortfolioIds(client, 'user-1')).toEqual([])
  })

  it('filters out falsy ids from either tier', async () => {
    const client = makeStub(
      { data: [{ id: 'p-default' }, { id: '' }] as any, error: null },
      { data: [], error: null },
    )
    expect(await loadUserPortfolioIds(client, 'user-1')).toEqual(['p-default'])
  })
})

describe('loadUserPortfolioIds — source invariants', () => {
  it('is exported so the hub, checklist, and entitlement guards share one loader', () => {
    expect(SRC).toContain('export async function loadUserPortfolioIds')
  })

  it('queries is_default=true FIRST and falls back to any-portfolio SECOND', () => {
    // Pin the two-tier order — regressing to a single query would
    // recreate either the dashboard/portfolio-page mismatch OR the
    // legacy-user fallback loss depending on which branch was kept.
    const isDefaultIdx = SRC.indexOf(".eq('is_default', true)")
    const bareLegacy   = SRC.indexOf('// Legacy fallback: any portfolios this user owns')
    expect(isDefaultIdx).toBeGreaterThan(-1)
    expect(bareLegacy).toBeGreaterThan(-1)
    expect(isDefaultIdx).toBeLessThan(bareLegacy)
  })

  it('loadPortfolioItemCount delegates to loadUserPortfolioIds so the fallback stays consistent', () => {
    expect(SRC).toContain('const ids = await loadUserPortfolioIds(supa, userId)')
  })
})
