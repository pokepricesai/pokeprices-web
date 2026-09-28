// Stage 6A — IndexNow queue unit tests.
//
// We inject a fake Supabase client via the optional `client` argument on
// every queue helper. No real DB, no `import 'server-only'` surprises, no
// vi.mock needed.
//
// The fake client models only the query-builder methods our code touches
// against seo_indexnow_queue and seo_indexnow_submissions. It stores rows
// in-memory and enforces the unique constraint on `url`.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub `server-only` — matches the pattern used by src/lib/insights/
// __tests__/adminApi.test.ts. Without this, `import 'server-only'` in
// queue.ts throws at collection time.
vi.mock('server-only', () => ({}))

import { enqueueUrl, claimBatch, completeBatch, failBatch } from '../queue'

type Row = Record<string, unknown> & { id: number }

// ── Tiny in-memory fake ─────────────────────────────────────────────────
function makeFakeSupabase() {
  const queueRows: Row[] = []
  const submissionRows: Row[] = []
  let nextId = 1

  function tableChain(table: string) {
    const rows = table === 'seo_indexnow_queue' ? queueRows : submissionRows

    // Query state that build up through .select().eq().in().order().limit()
    // then get evaluated at the terminal call.
    let selectCols: string | null = null
    const filters: Array<{ op: 'eq' | 'in' | 'lte' | 'gte' | 'not' | 'is'; col: string; val: unknown }> = []
    const orderBy: Array<{ col: string; asc: boolean }> = []
    let limitN: number | null = null
    let insertPayload: Row | Row[] | null = null
    let updatePayload: Partial<Row> | null = null
    let returnSingle = false
    let returnMaybe = false

    function applyFilters(): Row[] {
      let out = rows.slice()
      for (const f of filters) {
        if (f.op === 'eq') out = out.filter(r => (r as Record<string, unknown>)[f.col] === f.val)
        else if (f.op === 'in') out = out.filter(r => (f.val as unknown[]).includes((r as Record<string, unknown>)[f.col]))
        else if (f.op === 'lte') out = out.filter(r => Number((r as Record<string, unknown>)[f.col]) <= Number(f.val) || String((r as Record<string, unknown>)[f.col]) <= String(f.val))
        else if (f.op === 'gte') out = out.filter(r => Number((r as Record<string, unknown>)[f.col]) >= Number(f.val) || String((r as Record<string, unknown>)[f.col]) >= String(f.val))
      }
      if (orderBy.length > 0) {
        out.sort((a, b) => {
          for (const o of orderBy) {
            const av = (a as Record<string, unknown>)[o.col] as string | number
            const bv = (b as Record<string, unknown>)[o.col] as string | number
            if (av === bv) continue
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1)
          }
          return 0
        })
      }
      if (limitN != null) out = out.slice(0, limitN)
      return out
    }

    async function evaluateTerminal(): Promise<{ data: unknown; error: null | { message: string } }> {
      if (insertPayload) {
        const payloadArr = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
        const inserted: Row[] = []
        for (const p of payloadArr) {
          if (table === 'seo_indexnow_queue') {
            const url = (p as Record<string, unknown>).url as string
            if (rows.some(r => (r as Record<string, unknown>).url === url)) {
              return { data: null, error: { message: `duplicate key value violates unique constraint (url=${url})` } }
            }
          }
          const row: Row = { id: nextId++, ...p }
          rows.push(row)
          inserted.push(row)
        }
        if (selectCols) {
          if (returnSingle) return { data: inserted[0] ?? null, error: null }
          if (returnMaybe)  return { data: inserted[0] ?? null, error: null }
          return { data: inserted, error: null }
        }
        return { data: null, error: null }
      }
      if (updatePayload) {
        const targets = applyFilters()
        for (const t of targets) Object.assign(t, updatePayload)
        if (selectCols) return { data: targets, error: null }
        return { data: null, error: null }
      }
      // read-only path
      const out = applyFilters()
      if (returnMaybe)  return { data: out[0] ?? null, error: null }
      if (returnSingle) return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }

    const proxy: Record<string, unknown> = {}
    proxy.select = (cols?: string) => { selectCols = cols ?? '*'; return chain }
    proxy.insert = (payload: Row | Row[]) => { insertPayload = payload; return chain }
    proxy.update = (patch: Partial<Row>) => { updatePayload = patch; return chain }
    proxy.eq  = (col: string, val: unknown) => { filters.push({ op: 'eq',  col, val }); return chain }
    proxy.in  = (col: string, val: unknown[]) => { filters.push({ op: 'in',  col, val }); return chain }
    proxy.lte = (col: string, val: unknown) => { filters.push({ op: 'lte', col, val }); return chain }
    proxy.gte = (col: string, val: unknown) => { filters.push({ op: 'gte', col, val }); return chain }
    proxy.order = (col: string, opts?: { ascending?: boolean }) => { orderBy.push({ col, asc: opts?.ascending !== false }); return chain }
    proxy.limit = (n: number) => { limitN = n; return chain }
    proxy.maybeSingle = () => { returnMaybe = true; return evaluateTerminal() }
    proxy.single      = () => { returnSingle = true; return evaluateTerminal() }
    // Make the chain thenable so `await supa.from('t').update(...).eq(...)` works.
    proxy.then = (resolve: (r: { data: unknown; error: null | { message: string } }) => unknown, reject?: (e: unknown) => unknown) => {
      return evaluateTerminal().then(resolve, reject)
    }
    const chain = proxy
    return chain
  }

  return {
    _queue: queueRows,
    _submissions: submissionRows,
    from: (table: string) => tableChain(table),
  }
}

let supa: ReturnType<typeof makeFakeSupabase>

beforeEach(() => { supa = makeFakeSupabase() })

// ── Enqueue behaviour ───────────────────────────────────────────────────

describe('enqueueUrl', () => {
  it('accepts a canonical www URL and inserts a pending row', async () => {
    const r = await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/hello-world',
      contentHash: 'h1', pageFamily: 'insight', entityId: 'hello-world',
      priority: 0, reason: 'created',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, supa as any)
    expect(r.ok).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (r.ok) expect((r as any).action).toBe('inserted')
    expect(supa._queue).toHaveLength(1)
    expect(supa._queue[0].status).toBe('pending')
    expect(supa._queue[0].priority).toBe(0)
  })

  it('rejects a non-canonical URL', async () => {
    const r = await enqueueUrl({
      url: 'https://pokeprices.io/insights/hi',   // bare host
      contentHash: 'h', pageFamily: 'insight', priority: 0, reason: 'created',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, supa as any)
    expect(r.ok).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(r as any).ok) expect((r as any).reason).toBe('invalid_url')
    expect(supa._queue).toHaveLength(0)
  })

  it('rejects a disallowed path', async () => {
    const r = await enqueueUrl({
      url: 'https://www.pokeprices.io/admin/analytics',
      contentHash: 'h', pageFamily: 'other', priority: 2, reason: 'manual',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, supa as any)
    expect(r.ok).toBe(false)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(r as any).ok) expect((r as any).reason).toBe('disallowed_path')
  })

  it('re-enqueuing the same URL+hash is a no-op (unchanged)', async () => {
    const args = {
      url: 'https://www.pokeprices.io/insights/x',
      contentHash: 'h1', pageFamily: 'insight' as const, entityId: 'x',
      priority: 0 as const, reason: 'created' as const,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await enqueueUrl(args, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await enqueueUrl(args, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(r1.ok && (r1 as any).action).toBe('inserted')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(r2.ok && (r2 as any).action).toBe('unchanged')
    expect(supa._queue).toHaveLength(1)
  })

  it('re-enqueuing with a NEW hash resets the row to pending + zero attempts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/y', contentHash: 'h1',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // Simulate the row already having been submitted + failed once.
    Object.assign(supa._queue[0], {
      status: 'failed', submission_attempts: 6, last_error: 'earlier',
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/y', contentHash: 'h2',
      pageFamily: 'insight', priority: 1, reason: 'updated',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(r.ok && (r as any).action).toBe('updated')
    expect(supa._queue[0].status).toBe('pending')
    expect(supa._queue[0].submission_attempts).toBe(0)
    expect(supa._queue[0].content_hash).toBe('h2')
    expect(supa._queue[0].last_error).toBeNull()
  })
})

// ── claim / complete / fail ─────────────────────────────────────────────

describe('claimBatch → completeBatch', () => {
  it('claims pending rows in priority order and completeBatch marks them submitted', async () => {
    // Seed 3 rows with different priorities. Insert in reverse so we can
    // verify ordering picks the P0 first.
    for (const [url, prio] of [
      ['https://www.pokeprices.io/insights/low',  2],
      ['https://www.pokeprices.io/insights/mid',  1],
      ['https://www.pokeprices.io/insights/top',  0],
    ] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await enqueueUrl({
        url, contentHash: url, pageFamily: 'insight', entityId: url,
        priority: prio as 0 | 1 | 2, reason: 'created',
      }, supa as any)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('worker-a', 10, supa as any)
    expect(claimed).toHaveLength(3)
    expect(claimed[0].url).toContain('/top')
    expect(claimed[1].url).toContain('/mid')
    expect(claimed[2].url).toContain('/low')
    for (const row of supa._queue) expect(row.status).toBe('processing')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await completeBatch({
      rows: claimed.map(c => ({ id: c.id, content_hash: c.content_hash })), httpStatus: 200, statusClass: 'ok',
    }, supa as any)
    expect(r.updated).toBe(3)
    for (const row of supa._queue) expect(row.status).toBe('submitted')
  })

  it('does not double-claim already-processing rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/z', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await claimBatch('w-a', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = await claimBatch('w-b', 10, supa as any)
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(0)
  })
})

// ── Race-condition tests ────────────────────────────────────────────────
//
// Scenario: URL is claimed with hash A, an enqueue with hash B lands while
// the worker is mid-flight, then the worker's completeBatch (still holding
// hash A) fires. The row MUST end up pending with hash B — Bing was told
// about A, not B, so B still needs to go out.

describe('race conditions — hash-CAS on completeBatch / failBatch', () => {
  it('completeBatch does NOT mark submitted when the row moved to a newer hash', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-c', contentHash: 'hA',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w-a', 10, supa as any)
    expect(claimed).toHaveLength(1)
    expect(claimed[0].content_hash).toBe('hA')

    // A new enqueue lands with hash B while the worker is still in-flight.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bump = await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-c', contentHash: 'hB',
      pageFamily: 'insight', priority: 0, reason: 'updated',
    }, supa as any)
    expect(bump.ok).toBe(true)
    expect(supa._queue[0].content_hash).toBe('hB')
    expect(supa._queue[0].status).toBe('pending')

    // Worker completes with the stale hash A.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await completeBatch({
      rows: [{ id: claimed[0].id, content_hash: 'hA' }],
      httpStatus: 200, statusClass: 'ok',
    }, supa as any)

    // The row must NOT be marked submitted — hash A was old.
    expect(r.updated).toBe(0)
    expect(r.stale).toBe(1)
    expect(supa._queue[0].status).toBe('pending')
    expect(supa._queue[0].content_hash).toBe('hB')
  })

  it('failBatch does NOT bump attempts when the row moved to a newer hash', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-f', contentHash: 'hA',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-f', contentHash: 'hB',
      pageFamily: 'insight', priority: 0, reason: 'updated',
    }, supa as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await failBatch({
      rows: [{ id: claimed[0].id, content_hash: 'hA' }],
      httpStatus: 500, statusClass: 'server-error',
      error: 'transient', permanent: false,
    }, supa as any)

    expect(r.updated).toBe(0)
    expect(r.stale).toBe(1)
    expect(supa._queue[0].status).toBe('pending')          // still eligible for next claim
    expect(supa._queue[0].submission_attempts).toBe(0)     // NOT bumped
    expect(supa._queue[0].content_hash).toBe('hB')
  })

  it('completeBatch DOES mark submitted when the hash still matches', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-ok', contentHash: 'hA',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await completeBatch({
      rows: [{ id: claimed[0].id, content_hash: 'hA' }],
      httpStatus: 200, statusClass: 'ok',
    }, supa as any)
    expect(r.updated).toBe(1)
    expect(r.stale).toBe(0)
    expect(supa._queue[0].status).toBe('submitted')
  })

  it('two workers claiming the same window: second gets zero rows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-twin', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [a, b] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claimBatch('w-a', 10, supa as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claimBatch('w-b', 10, supa as any),
    ])
    // The fake supabase serialises the two claim chains. Whichever ran
    // first wins the row; the other sees an already-`processing` row and
    // gets nothing.
    expect(a.length + b.length).toBe(1)
    expect(Math.min(a.length, b.length)).toBe(0)
  })

  it('worker time-out returns claimed rows to retry so a later claim can pick them up', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/race-timeout', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w-1', 10, supa as any)
    expect(claimed).toHaveLength(1)

    // Simulate worker time-out: mark as retry with a permanent=false failBatch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await failBatch({
      rows: [{ id: claimed[0].id, content_hash: 'h' }],
      httpStatus: null, statusClass: 'skipped',
      error: 'time_budget_exhausted_before_send', permanent: false,
    }, supa as any)

    expect(supa._queue[0].status).toBe('retry')
    // A later claim after next_attempt_at MUST be able to pick it up. The
    // fake sets next_attempt_at to now + 60s; simulate the passage of time.
    supa._queue[0].next_attempt_at = new Date(Date.now() - 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const later = await claimBatch('w-2', 10, supa as any)
    expect(later).toHaveLength(1)
    expect(later[0].id).toBe(claimed[0].id)
  })
})

describe('failBatch backoff', () => {
  it('non-permanent failure moves row to retry and bumps attempts', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/f', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await failBatch({
      rows: claimed.map(c => ({ id: c.id, content_hash: c.content_hash })), httpStatus: 500, statusClass: 'server-error',
      error: 'oops', permanent: false,
    }, supa as any)
    expect(supa._queue[0].status).toBe('retry')
    expect(supa._queue[0].submission_attempts).toBe(1)
    expect(supa._queue[0].last_error).toBe('oops')
  })

  it('permanent failure moves row to failed immediately', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/g', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await failBatch({
      rows: claimed.map(c => ({ id: c.id, content_hash: c.content_hash })), httpStatus: 400, statusClass: 'bad-request',
      error: 'malformed', permanent: true,
    }, supa as any)
    expect(supa._queue[0].status).toBe('failed')
  })

  it('marks row failed after 6 attempts even for retryable errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enqueueUrl({
      url: 'https://www.pokeprices.io/insights/h', contentHash: 'h',
      pageFamily: 'insight', priority: 0, reason: 'created',
    }, supa as any)
    supa._queue[0].submission_attempts = 5   // 5 attempts already; next = 6 which triggers fail
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimBatch('w', 10, supa as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await failBatch({
      rows: claimed.map(c => ({ id: c.id, content_hash: c.content_hash })), httpStatus: 500, statusClass: 'server-error',
      error: 'still bad', permanent: false,
    }, supa as any)
    expect(supa._queue[0].status).toBe('failed')
    expect(supa._queue[0].submission_attempts).toBe(6)
  })
})
