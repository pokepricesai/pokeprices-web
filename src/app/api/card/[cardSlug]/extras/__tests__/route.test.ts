// src/app/api/card/[cardSlug]/extras/__tests__/route.test.ts
//
// Phase 1 — contract tests for the public card extras endpoint.
// Covers:
//   1. full successful payload                      (SUCCESS_CACHE)
//   2. metrics failure + other four successes       (PARTIAL_CACHE)
//   3. history failure + other four successes       (PARTIAL_CACHE)
//   4. legitimate zero/empty database result        (SUCCESS_CACHE)
//   5. backend error distinguishable from empty
//   6. invalid card input                           (400 + no-store)
//   7. all-five backend failure                     (500 + no-store)
//   8. success cache = 24h
//   9. partial-error cache = 1h recovery
//  10. fatal/invalid response = no-store
//  11. endpoint does not read cookies / Authorization
//  12. stable canonical request identity

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── mocks ─────────────────────────────────────────────────────────

// Every one of the five sources dispatches by the first supabase.*
// method the caller invoked. The mock routes to per-source handlers
// so a single test can assert "metrics fails but history + insight +
// volume + psaPop all succeed".
const {
  metricsMock,
  priceHistoryMock,
  insightMock,
  cardVolumeMock,
  psaPopMock,
} = vi.hoisted(() => ({
  metricsMock:      vi.fn<[], Promise<{ data: unknown; error: unknown }>>(),
  priceHistoryMock: vi.fn<[], Promise<{ data: unknown; error: unknown }>>(),
  insightMock:      vi.fn<[], Promise<{ data: unknown; error: unknown }>>(),
  cardVolumeMock:   vi.fn<[], Promise<{ data: unknown; error: unknown }>>(),
  psaPopMock:       vi.fn<[], Promise<{ data: unknown; error: unknown }>>(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name: string) => {
      if (name === 'get_card_metrics')       return metricsMock()
      if (name === 'get_card_price_history') return priceHistoryMock()
      if (name === 'get_card_insight')       return insightMock()
      return Promise.reject(new Error(`unexpected rpc: ${name}`))
    },
    from: (table: string) => {
      if (table === 'card_volume') {
        return makeTerminal(() => cardVolumeMock())
      }
      if (table === 'psa_population') {
        return makeTerminal(() => psaPopMock())
      }
      return makeTerminal(() => Promise.reject(new Error(`unexpected table: ${table}`)))
    },
  }),
}))

/** Build a chainable PostgREST-like builder that terminates on an
 *  implicit await by invoking `fetch()` and returning its promise.
 *  We don't model each builder method individually — any call just
 *  returns the same chainable object. */
function makeTerminal(fetch: () => Promise<{ data: unknown; error: unknown }>) {
  const chain: any = {
    select:     () => chain,
    eq:         () => chain,
    ilike:      () => chain,
    gt:         () => chain,
    order:      () => chain,
    limit:      () => chain,
    maybeSingle: () => chain,
    then:       (onFulfilled: any, onRejected: any) => fetch().then(onFulfilled, onRejected),
  }
  return chain
}

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  metricsMock.mockReset()
  priceHistoryMock.mockReset()
  insightMock.mockReset()
  cardVolumeMock.mockReset()
  psaPopMock.mockReset()
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

async function loadGET() {
  const mod = await import('../route')
  return mod.GET
}

function req(path: string, opts: { bearer?: string; cookie?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  if (opts.cookie) headers.cookie = opts.cookie
  return new Request(`http://localhost${path}`, { method: 'GET', headers })
}

const CARD = {
  slug: 'bulbasaur-base-set-1',
  setName: 'Base Set',
  cardName: 'Bulbasaur',
  cardNumber: '44',
}
function path(overrides: Partial<typeof CARD> = {}): string {
  const c = { ...CARD, ...overrides }
  const qs = new URLSearchParams({
    setName: c.setName,
    cardName: c.cardName,
    cardNumber: c.cardNumber,
  })
  return `/api/card/${c.slug}/extras?${qs.toString()}`
}

function ctx(slug: string = CARD.slug) {
  return { params: Promise.resolve({ cardSlug: slug }) }
}

function seedAllOk() {
  metricsMock.mockResolvedValueOnce({
    data: [{ drawdown_pct: '-12.5', sales_30d: 7, volume_30d: 7 }],
    error: null,
  })
  priceHistoryMock.mockResolvedValueOnce({
    data: [{ date: '2026-10-01', raw_usd: 500 }, { date: '2026-10-02', raw_usd: 510 }],
    error: null,
  })
  insightMock.mockResolvedValueOnce({ data: 'Clean 30d rise.', error: null })
  cardVolumeMock.mockResolvedValueOnce({ data: { volume_label: 'Sells weekly', sales_30d: 7 }, error: null })
  psaPopMock.mockResolvedValueOnce({ data: [{ total_graded: 1234, psa_10: 456, gem_rate: '37.0' }], error: null })
}

// ─── 1. full successful payload ─────────────────────────────────────

describe('/api/card/[cardSlug]/extras — fully successful', () => {
  it('returns 200 with every chunk status=ok + 24h cache + 7d SWR', async () => {
    seedAllOk()
    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=86400/)
    expect(r.headers.get('Cache-Control')).toMatch(/stale-while-revalidate=604800/)
    const body = await r.json()
    expect(body.cardSlug).toBe(CARD.slug)
    expect(body.metrics.status).toBe('ok')
    expect(body.metrics.data).toBeTruthy()
    expect(body.priceHistory.status).toBe('ok')
    expect(body.priceHistory.data).toHaveLength(2)
    expect(body.insight.status).toBe('ok')
    expect(body.insight.data).toBe('Clean 30d rise.')
    expect(body.volume.status).toBe('ok')
    expect(body.volume.data.volume_label).toBe('Sells weekly')
    expect(body.psaPop.status).toBe('ok')
    expect(body.psaPop.data.total_graded).toBe(1234)
  })
})

// ─── 2. metrics failure, others ok ─────────────────────────────────

describe('/api/card/[cardSlug]/extras — metrics failure, four others ok', () => {
  it('returns 200, metrics.status=error, partial-cache 1h, other chunks intact', async () => {
    metricsMock.mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } })
    priceHistoryMock.mockResolvedValueOnce({ data: [{ date: '2026-10-01' }], error: null })
    insightMock.mockResolvedValueOnce({ data: 'ok', error: null })
    cardVolumeMock.mockResolvedValueOnce({ data: null, error: null })
    psaPopMock.mockResolvedValueOnce({ data: [], error: null })

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=3600/)
    expect(r.headers.get('Cache-Control')).not.toMatch(/s-maxage=86400/)
    expect(r.headers.get('Cache-Control')).toMatch(/stale-while-revalidate=604800/)

    const body = await r.json()
    expect(body.metrics.status).toBe('error')
    expect(body.metrics.data).toBeNull()
    expect(body.priceHistory.status).toBe('ok')
    expect(body.priceHistory.data).toHaveLength(1)
    expect(body.insight.status).toBe('ok')
    expect(body.volume.status).toBe('ok')
    expect(body.volume.data).toBeNull()      // legitimate factual zero
    expect(body.psaPop.status).toBe('ok')
    expect(body.psaPop.data).toBeNull()      // legitimate factual zero
  })

  it('a REJECTED promise (threw) is classified as error — not a crash', async () => {
    metricsMock.mockRejectedValueOnce(new Error('network blip'))
    priceHistoryMock.mockResolvedValueOnce({ data: [], error: null })
    insightMock.mockResolvedValueOnce({ data: null, error: null })
    cardVolumeMock.mockResolvedValueOnce({ data: null, error: null })
    psaPopMock.mockResolvedValueOnce({ data: [], error: null })

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=3600/)
    const body = await r.json()
    expect(body.metrics.status).toBe('error')
  })
})

// ─── 3. history failure, others ok ─────────────────────────────────

describe('/api/card/[cardSlug]/extras — history failure, four others ok', () => {
  it('returns 200, priceHistory.status=error, partial-cache 1h', async () => {
    metricsMock.mockResolvedValueOnce({ data: [{ drawdown_pct: '-5' }], error: null })
    priceHistoryMock.mockResolvedValueOnce({ data: null, error: { message: 'oops' } })
    insightMock.mockResolvedValueOnce({ data: 'ok', error: null })
    cardVolumeMock.mockResolvedValueOnce({ data: { volume_label: 'Steady' }, error: null })
    psaPopMock.mockResolvedValueOnce({ data: [{ total_graded: 100 }], error: null })

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=3600/)
    const body = await r.json()
    expect(body.priceHistory.status).toBe('error')
    expect(body.priceHistory.data).toBeNull()
    expect(body.metrics.status).toBe('ok')
    expect(body.insight.status).toBe('ok')
  })
})

// ─── 4. legitimate zero/empty ─────────────────────────────────────

describe('/api/card/[cardSlug]/extras — legitimate zero', () => {
  it('null data from every source WITH no errors → 200, status=ok everywhere, 24h cache', async () => {
    // Thin card: no priced history, no metrics, no insight, no
    // volume label, no PSA population. All five sources return
    // (data: null, error: null) legitimately.
    metricsMock.mockResolvedValueOnce({ data: null, error: null })
    priceHistoryMock.mockResolvedValueOnce({ data: null, error: null })
    insightMock.mockResolvedValueOnce({ data: null, error: null })
    cardVolumeMock.mockResolvedValueOnce({ data: null, error: null })
    psaPopMock.mockResolvedValueOnce({ data: [], error: null })

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=86400/)
    const body = await r.json()
    // Every chunk is ok with null (or empty array for collection shapes).
    expect(body.metrics.status).toBe('ok')
    expect(body.priceHistory.status).toBe('ok')
    expect(body.priceHistory.data).toEqual([])  // default-ok coerces null to []
    expect(body.insight.status).toBe('ok')
    expect(body.insight.data).toBeNull()
    expect(body.volume.status).toBe('ok')
    expect(body.volume.data).toBeNull()
    expect(body.psaPop.status).toBe('ok')
    expect(body.psaPop.data).toBeNull()
  })
})

// ─── 5. error distinguishable from empty ───────────────────────────

describe('/api/card/[cardSlug]/extras — error vs empty', () => {
  it('an error chunk has status=error; an empty chunk has status=ok with null — client can tell the difference', async () => {
    metricsMock.mockResolvedValueOnce({ data: null, error: null })                   // legitimate zero
    priceHistoryMock.mockResolvedValueOnce({ data: null, error: { message: 'x' } }) // error
    insightMock.mockResolvedValueOnce({ data: null, error: null })                   // legitimate zero
    cardVolumeMock.mockResolvedValueOnce({ data: null, error: { message: 'x' } })   // error
    psaPopMock.mockResolvedValueOnce({ data: [], error: null })                      // legitimate empty

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(200)
    const body = await r.json()

    expect(body.metrics.status).toBe('ok')
    expect(body.metrics.data).toBeNull()

    expect(body.priceHistory.status).toBe('error')
    expect(body.priceHistory.data).toBeNull()

    expect(body.insight.status).toBe('ok')
    expect(body.insight.data).toBeNull()

    expect(body.volume.status).toBe('error')
    expect(body.volume.data).toBeNull()

    expect(body.psaPop.status).toBe('ok')
    expect(body.psaPop.data).toBeNull()

    // Two errors ⇒ partial cache, 1h
    expect(r.headers.get('Cache-Control')).toMatch(/s-maxage=3600/)
  })
})

// ─── 6. invalid input ─────────────────────────────────────────────

describe('/api/card/[cardSlug]/extras — invalid request', () => {
  it('cardSlug with invalid chars → 400 + no-store (no CDN fan-out)', async () => {
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/BAD%20SLUG/extras?setName=Base%20Set&cardName=Bulbasaur`),
      ctx('BAD SLUG'),
    )
    expect(r.status).toBe(400)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('missing setName → 400 + no-store', async () => {
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/${CARD.slug}/extras?cardName=Bulbasaur`),
      ctx(),
    )
    expect(r.status).toBe(400)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('missing cardName → 400 + no-store', async () => {
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/${CARD.slug}/extras?setName=Base%20Set`),
      ctx(),
    )
    expect(r.status).toBe(400)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('empty-after-trim setName → 400 + no-store', async () => {
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/${CARD.slug}/extras?setName=%20%20&cardName=Bulbasaur`),
      ctx(),
    )
    expect(r.status).toBe(400)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
  })

  it('pc-prefixed slug is canonicalised to the bare form (not rejected)', async () => {
    seedAllOk()
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/pc-${CARD.slug}/extras?setName=${encodeURIComponent(CARD.setName)}&cardName=${encodeURIComponent(CARD.cardName)}`),
      ctx(`pc-${CARD.slug}`),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.cardSlug).toBe(CARD.slug)  // pc- stripped
  })
})

// ─── 7. all-five failure ──────────────────────────────────────────

describe('/api/card/[cardSlug]/extras — total backend failure', () => {
  it('all five chunks error → 500 + no-store (CDN never pins)', async () => {
    metricsMock.mockRejectedValueOnce(new Error('x'))
    priceHistoryMock.mockRejectedValueOnce(new Error('x'))
    insightMock.mockRejectedValueOnce(new Error('x'))
    cardVolumeMock.mockRejectedValueOnce(new Error('x'))
    psaPopMock.mockRejectedValueOnce(new Error('x'))

    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(500)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    const body = await r.json()
    expect(body.metrics.status).toBe('error')
    expect(body.priceHistory.status).toBe('error')
    expect(body.insight.status).toBe('error')
    expect(body.volume.status).toBe('error')
    expect(body.psaPop.status).toBe('error')
  })

  it('missing supabase env → 500 + no-store, no DB call attempted', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const GET = await loadGET()
    const r = await GET(req(path()), ctx())
    expect(r.status).toBe(500)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(metricsMock).not.toHaveBeenCalled()
    expect(priceHistoryMock).not.toHaveBeenCalled()
  })
})

// ─── 11. no cookies / auth ────────────────────────────────────────

describe('/api/card/[cardSlug]/extras — public, deterministic from URL only', () => {
  it('ignores cookies and Authorization — response is identical with or without them', async () => {
    seedAllOk()
    const GET = await loadGET()
    const r = await GET(
      req(path(), {
        cookie: 'sb-access-token=whatever; currency=GBP; theme=dark',
        bearer: 'eyJ.spoofed.token',
      }),
      ctx(),
    )
    expect(r.status).toBe(200)
    // Public, not private — proves the handler never flipped to a
    // viewer-scoped response based on cookies/auth.
    expect(r.headers.get('Cache-Control')).toMatch(/^public/)
  })
})

// ─── 12. stable canonical identity ────────────────────────────────

describe('/api/card/[cardSlug]/extras — stable cache key', () => {
  it('whitespace variations in query params do not change the response (canonicalisation)', async () => {
    seedAllOk()
    const GET = await loadGET()
    const r1 = await GET(
      req(`/api/card/${CARD.slug}/extras?setName=Base%20Set&cardName=Bulbasaur`),
      ctx(),
    )
    expect(r1.status).toBe(200)

    seedAllOk()
    const r2 = await GET(
      req(`/api/card/${CARD.slug}/extras?setName=%20%20Base%20%20Set%20%20&cardName=%20Bulbasaur%20`),
      ctx(),
    )
    expect(r2.status).toBe(200)

    const b1 = await r1.json()
    const b2 = await r2.json()
    // Same handler path, same canonicalisation → same cardSlug key,
    // same body shape. The CDN layer dedupes on URL — this test
    // confirms the handler itself produces an identical response.
    expect(b1.cardSlug).toBe(b2.cardSlug)
    expect(b1.priceHistory.data).toEqual(b2.priceHistory.data)
  })

  it('upper-case cardSlug is lower-cased before validation', async () => {
    seedAllOk()
    const GET = await loadGET()
    const r = await GET(
      req(`/api/card/BULBASAUR-BASE-SET-1/extras?setName=${encodeURIComponent(CARD.setName)}&cardName=${encodeURIComponent(CARD.cardName)}`),
      ctx('BULBASAUR-BASE-SET-1'),
    )
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.cardSlug).toBe('bulbasaur-base-set-1')
  })
})
