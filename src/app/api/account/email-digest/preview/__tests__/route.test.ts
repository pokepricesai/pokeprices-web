// Block 5A-W-45A — GET /api/account/email-digest/preview tests.
// Covers: bearer-required, token verification, response shape,
// preference-driven status pass-through, no PII in the response,
// no email send, no writes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// ── Auth stub — token → user id ────────────────────────────────────
let getUserMock: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (token: string) => getUserMock(token) },
  }),
}))

// ── Digest builder + renderer stubs ────────────────────────────────
// The route's real value is the auth + response-shape contract; the
// builder and renderer have their own extensive tests
// (weeklyDigest.test.ts, weeklyDigestEmail.test.ts). Stubbing them
// here keeps the route test focused and deterministic.

let builderCalls: string[]
let buildWeeklyDigestForUserMock: (userId: string) => Promise<any>
vi.mock('@/lib/alerts/weeklyDigest', () => ({
  buildWeeklyDigestForUser: (_supa: unknown, userId: string) => {
    builderCalls.push(userId)
    return buildWeeklyDigestForUserMock(userId)
  },
}))

let buildWeeklyDigestEmailMock: (data: any) => {
  subject: string; previewText: string; html: string; text: string
}
vi.mock('@/lib/alerts/weeklyDigestEmail', () => ({
  buildWeeklyDigestEmail: (data: any) => buildWeeklyDigestEmailMock(data),
}))

import { GET } from '../route'

const OK_DIGEST = {
  status:       'ok',
  asOf:         '2026-07-21T00:00:00Z',
  lookbackDays: 7,
  currency:     'GBP',
  portfolio: {
    itemCount:          3,
    currentTotalCents:  123_45,
    previousTotalCents: null,
    absChangeCents:     null,
    pctChange:          null,
    topItems:           [],
  },
  watchlist: {
    itemCount: 2,
    topItems:  [],
  },
  alertSummary: { totalEvents: 0, cardBlocks: [] },
  diagnostics: {
    portfolioCardsConsidered:    3,
    watchlistCardsConsidered:    2,
    cardsWithNoSlugResolution:   0,
    cardsWithNoPriceData:        0,
    cardsWithNoRecentSales:      0,
    portfolioPriceBasisCounts:   { raw_usd: 3, psa9_usd: 0, psa10_usd: 0, unknown_fallback: 0 },
    displayCurrency:             'GBP',
    portfolioValueSource:        'shared_valuation_helper',
    portfolioMovementSource:     'dashboard_30d',
    portfolioItemMovementWindowDays:   30,
    portfolioHeadlineChangeSuppressed: true,
    portfolioHeadlineSuppressedReason: 'test',
    portfolioValueSourceCounts:  { card_trends: 3, daily_prices: 0, manual: 0, missing: 0 },
    portfolioPortfoliosLoaded:        1,
    portfolioItemsLoaded:             3,
    portfolioItemsMissingCardName:    0,
    portfolioItemsValuedAsMissing:    0,
    portfolioHoldingsPricedCount:        3,
    portfolioHoldingsMissingPriceCount:  0,
    portfolioScope:                'selected_dashboard_portfolio',
    portfolioNamesIncluded:        ['My Collection'],
    portfolioItemsIncludedInTotal: 3,
    portfolioReconciliation:       [],
    alertCardsResolvedBySlug:      0,
    alertCardsResolvedByNameSet:   0,
    alertCardsWithNoUrl:           0,
    sectionsOmittedByPreferences:  [],
    generatedAt:                   '2026-07-21T00:00:00Z',
  },
}

const KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  getUserMock                = async () => ({ data: { user: null }, error: { message: 'no user' } })
  buildWeeklyDigestForUserMock = async () => OK_DIGEST
  buildWeeklyDigestEmailMock   = () => ({
    subject:     'Your weekly PokePrices update',
    previewText: 'Weekly overview',
    html:        '<p>Weekly digest for signed-in user</p>',
    text:        'Weekly digest for signed-in user',
  })
  builderCalls = []
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(opts: { bearer?: string } = {}): Request {
  const headers: Record<string, string> = {}
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return new Request('http://localhost/api/account/email-digest/preview', {
    method: 'GET', headers,
  })
}

// ── Auth gate ─────────────────────────────────────────────────────

describe('GET /api/account/email-digest/preview — auth', () => {
  it('missing bearer → 401 (does not call the digest builder)', async () => {
    const r = await GET(req())
    expect(r.status).toBe(401)
    const j = await r.json()
    expect(j.error).toBe('unauthenticated')
    // Guard: MUST NOT call the digest builder for an anonymous request.
    expect(builderCalls).toEqual([])
  })

  it('invalid bearer → 401 (does not call the digest builder)', async () => {
    getUserMock = async () => ({ data: { user: null }, error: { message: 'invalid' } })
    const r = await GET(req({ bearer: 'bogus' }))
    expect(r.status).toBe(401)
    expect(builderCalls).toEqual([])
  })

  it('valid bearer → 200 with the rendered email payload', async () => {
    getUserMock = async () => ({ data: { user: { id: 'user-42' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.status).toBe('ok')
    expect(j.subject).toBe('Your weekly PokePrices update')
    expect(j.previewText).toBe('Weekly overview')
    expect(j.html).toContain('Weekly digest for signed-in user')
    expect(j.text).toContain('Weekly digest for signed-in user')
    expect(j.diagnostics).toBeDefined()
    expect(j.mode).toBe('real')
    expect(j.sample).toBe(false)
  })
})

// ── Response privacy ──────────────────────────────────────────────

describe('GET /api/account/email-digest/preview — no PII in response', () => {
  it('response body never echoes user_id or email fields', async () => {
    getUserMock = async () => ({
      data: { user: { id: 'secret-user-uuid-1234', email: 'secret@example.com' } as any },
      error: null,
    })
    const r = await GET(req({ bearer: 'good' }))
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toContain('secret-user-uuid-1234')
    expect(blob).not.toContain('secret@example.com')
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"email"/i)
  })
})

// ── Preferences pass-through ──────────────────────────────────────

describe('GET /api/account/email-digest/preview — respects user preferences', () => {
  it('passes disabled_master status through when the builder reports it', async () => {
    getUserMock = async () => ({ data: { user: { id: 'user-42' } }, error: null })
    buildWeeklyDigestForUserMock = async () => ({
      ...OK_DIGEST,
      status: 'disabled_master',
      portfolio: undefined,
      watchlist: undefined,
    })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.status).toBe('disabled_master')
  })

  it('passes disabled_weekly status through when the user has turned off the weekly digest', async () => {
    getUserMock = async () => ({ data: { user: { id: 'user-42' } }, error: null })
    buildWeeklyDigestForUserMock = async () => ({
      ...OK_DIGEST,
      status: 'disabled_weekly',
      portfolio: undefined,
      watchlist: undefined,
    })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    expect((await r.json()).status).toBe('disabled_weekly')
  })
})

// ── Failure modes ─────────────────────────────────────────────────

describe('GET /api/account/email-digest/preview — misconfig + errors', () => {
  it('missing SUPABASE_URL → 503 (fail closed, no leak of which env is missing)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(503)
    expect((await r.json()).error).toBe('misconfigured')
  })

  it('builder throws → 500 with a generic error message', async () => {
    getUserMock = async () => ({ data: { user: { id: 'user-42' } }, error: null })
    buildWeeklyDigestForUserMock = async () => { throw new Error('boom') }
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(500)
    const j = await r.json()
    expect(j.error).toBe('preview failed')
    // Detail is echoed but must not include a stack trace or sensitive
    // env; we only check that the shape is preserved.
    expect(typeof j.detail).toBe('string')
  })
})

// ── No side effects ───────────────────────────────────────────────

describe('GET /api/account/email-digest/preview — read-only', () => {
  it('the route only calls the pure builder + pure renderer; no send / no write mocks are needed', async () => {
    // If the route ever grows a sendEmail path or a table write, this
    // test file will need a corresponding mock. The absence of any
    // send/write mock here is the test.
    getUserMock = async () => ({ data: { user: { id: 'user-42' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
  })

  it('the route implementation does NOT import a send helper or write path', () => {
    // Source-level regression guard against a future edit accidentally
    // importing a delivery / send / insert helper.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'route.ts'),
      'utf8',
    )
    expect(src).not.toContain("from '@/lib/alerts/weeklyDigestDelivery'")
    expect(src).not.toContain("from '@/lib/alerts/delivery'")
    expect(src).not.toContain('sendEmail')
    expect(src).not.toContain('resend')
    expect(src).not.toMatch(/\.from\([^)]+\)\.insert\(/)
    expect(src).not.toMatch(/\.from\([^)]+\)\.update\(/)
    expect(src).not.toMatch(/\.from\([^)]+\)\.delete\(/)
    // Positive check: the route MUST use the auth-scoped client
    // (Bearer forwarded on `global.headers.authorization`) so RLS
    // enforces the user boundary.
    expect(src).toContain('global: { headers: { authorization: `Bearer ${token}` } }')
  })
})
