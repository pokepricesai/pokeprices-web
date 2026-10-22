// Pin the DB query shape for the efficient candidate selector. The
// canary path depends on all filters being pushed into SQL so the view
// is never fully scanned. If this test breaks, inspect the filter
// chain before shipping — a dropped filter could cause the enrol to
// time out again or (worse) select ineligible cards.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { listStrictCandidatesEfficient } from '../strict'

type Call = { op: string; args: unknown[] }

function makeStubSupabase(rows: unknown[] = []) {
  const calls: Call[] = []
  const builder: Record<string, unknown> = {}
  const chainable = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args })
    return builder
  }
  builder.select = chainable('select')
  builder.eq     = chainable('eq')
  builder.in     = chainable('in')
  builder.or     = chainable('or')
  builder.order  = chainable('order')
  builder.limit  = chainable('limit')
  builder.then   = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null })
  const sb = {
    from: (table: string) => { calls.push({ op: 'from', args: [table] }); return builder },
    _calls: () => calls,
  }
  return sb
}

describe('listStrictCandidatesEfficient', () => {
  it('selects from the reconciliation view', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    expect(sb._calls().find(c => c.op === 'from')?.args).toEqual(['v_pp_tcg_card_reconciliation'])
  })

  it('applies every strict filter — outcome, risk, confidence, review, printing, image, market, eligibility set', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    const eqs = sb._calls().filter(c => c.op === 'eq').map(c => c.args)
    expect(eqs).toContainEqual(['outcome', 'approved_active'])
    expect(eqs).toContainEqual(['risk_class', 'catalogue_corroborated'])
    expect(eqs).toContainEqual(['confidence', 'verified'])
    expect(eqs).toContainEqual(['review_status', 'approved'])
    expect(eqs).toContainEqual(['printing_active_status', 'active'])
    expect(eqs).toContainEqual(['has_image', true])
    expect(eqs).toContainEqual(['has_market_prices', true])
    const ins = sb._calls().filter(c => c.op === 'in').map(c => c.args)
    expect(ins).toContainEqual(['effective_eligibility', ['bulk_safe', 'market_only']])
  })

  it('applies the asymmetric graded gate via SQL OR (market_only free; bulk_safe needs has_graded_prices=true)', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    const ors = sb._calls().filter(c => c.op === 'or').map(c => c.args[0])
    expect(ors).toContain('effective_eligibility.eq.market_only,has_graded_prices.eq.true')
  })

  it('orders by gsc_rank asc nulls last, then pp_card_slug asc (deterministic tie-break)', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    const orders = sb._calls().filter(c => c.op === 'order').map(c => c.args)
    expect(orders[0]).toEqual(['gsc_rank', { ascending: true, nullsFirst: false }])
    expect(orders[1]).toEqual(['pp_card_slug', { ascending: true }])
  })

  it('enforces LIMIT in SQL — fetches limit + headroom rows (default headroom 100)', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    const limits = sb._calls().filter(c => c.op === 'limit').map(c => c.args[0])
    expect(limits).toContain(105)
  })

  it('honours a custom headroom', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 10, headroom: 25 })
    const limits = sb._calls().filter(c => c.op === 'limit').map(c => c.args[0])
    expect(limits).toContain(35)
  })

  it('scopes language when language is not "any"', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5, language: 'en' })
    const eqs = sb._calls().filter(c => c.op === 'eq').map(c => c.args)
    expect(eqs).toContainEqual(['pp_language', 'en'])
  })

  it('does NOT add a language filter when language="any"', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5, language: 'any' })
    const eqs = sb._calls().filter(c => c.op === 'eq').map(c => c.args)
    expect(eqs.find(([k]) => k === 'pp_language')).toBeUndefined()
  })

  it('never paginates — exactly one .limit(), zero .range()', async () => {
    const sb = makeStubSupabase()
    await listStrictCandidatesEfficient(sb as unknown as never, { limit: 5 })
    const limits = sb._calls().filter(c => c.op === 'limit')
    const ranges = sb._calls().filter(c => c.op === 'range')
    expect(limits.length).toBe(1)
    expect(ranges.length).toBe(0)
  })
})
