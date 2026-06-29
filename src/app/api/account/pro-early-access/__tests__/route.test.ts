// Block 5A-W-28 — POST /api/account/pro-early-access tests.
//
// Covers: auth gate, body trust boundary (no spoofing user_id),
// source whitelist, message length cap, 24h dedupe, response shape,
// privacy (response never includes the auth user_id), missing config
// → 503.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

// Mocked Supabase admin client used purely to verify the JWT.
let getUserMock: (token: string) => Promise<{ data: { user: { id: string; email?: string } | null }; error: unknown }>
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: (token: string) => getUserMock(token),
    },
  }),
}))

import { POST } from '../route'

const KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  fakeDB.reset()
  getUserMock = async () => ({
    data: { user: { id: 'auth-user-uuid', email: 'real@example.com' } },
    error: null,
  })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(opts: { bearer?: string; body?: Record<string, unknown> } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return new Request('http://localhost/api/account/pro-early-access', {
    method:  'POST',
    headers,
    body:    opts.body ? JSON.stringify(opts.body) : '',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — auth gate', () => {
  it('401 when bearer is missing', async () => {
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(fakeDB.rows('pro_early_access_requests')).toEqual([])
  })

  it('401 when bearer is invalid (JWT verify fails)', async () => {
    getUserMock = async () => ({ data: { user: null }, error: { message: 'bad jwt' } })
    const r = await POST(req({ bearer: 'bogus' }))
    expect(r.status).toBe(401)
    expect(fakeDB.rows('pro_early_access_requests')).toEqual([])
  })

  it('503 when SUPABASE_URL is missing (server misconfigured)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const r = await POST(req({ bearer: 'good' }))
    expect(r.status).toBe(503)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Trust boundary — client cannot spoof user_id / email
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — trust boundary', () => {
  it('uses the auth user_id from the JWT, NOT the body user_id', async () => {
    const r = await POST(req({
      bearer: 'good',
      body:   { user_id: 'attacker-spoof-uuid', email: 'attacker@evil.com', source: 'dashboard' },
    }))
    expect(r.status).toBe(200)
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe('auth-user-uuid')        // from JWT
    expect(rows[0].email).toBe('real@example.com')        // from JWT
    expect(rows[0].user_id).not.toBe('attacker-spoof-uuid')
    expect(rows[0].email).not.toBe('attacker@evil.com')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Source whitelist
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — source whitelist', () => {
  it('accepts allowed sources verbatim', async () => {
    for (const source of ['dashboard', 'watchlist_alerts', 'portfolio', 'settings', 'limit_block', 'unknown']) {
      fakeDB.reset()
      await POST(req({ bearer: 'good', body: { source } }))
      const rows = fakeDB.rows('pro_early_access_requests')
      expect(rows).toHaveLength(1)
      expect(rows[0].source).toBe(source)
    }
  })

  it('rejects unknown sources by falling back to "unknown"', async () => {
    await POST(req({ bearer: 'good', body: { source: 'hacked_source' } }))
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(rows[0].source).toBe('unknown')
  })

  it('defaults to "unknown" when source is omitted', async () => {
    await POST(req({ bearer: 'good' }))
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(rows[0].source).toBe('unknown')
  })

  it('coerces non-string source values to "unknown"', async () => {
    await POST(req({ bearer: 'good', body: { source: 123 } }))
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(rows[0].source).toBe('unknown')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Message handling
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — message', () => {
  it('keeps short trimmed messages', async () => {
    await POST(req({ bearer: 'good', body: { message: '  Want unlimited alerts please  ' } }))
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(rows[0].message).toBe('Want unlimited alerts please')
  })

  it('truncates messages over 1000 chars', async () => {
    const long = 'a'.repeat(1200)
    await POST(req({ bearer: 'good', body: { message: long } }))
    const rows = fakeDB.rows('pro_early_access_requests')
    expect(typeof rows[0].message).toBe('string')
    expect((rows[0].message as string).length).toBe(1000)
  })

  it('persists null when message is empty / whitespace / non-string', async () => {
    await POST(req({ bearer: 'good', body: { message: '   ' } }))
    expect(fakeDB.rows('pro_early_access_requests')[0].message).toBeNull()
    fakeDB.reset()
    await POST(req({ bearer: 'good', body: { message: 42 } }))
    expect(fakeDB.rows('pro_early_access_requests')[0].message).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Dedupe within 24h
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — 24h dedupe', () => {
  it('first submission inserts a row, returns alreadyRegistered=false', async () => {
    const r = await POST(req({ bearer: 'good', body: { source: 'dashboard' } }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, alreadyRegistered: false })
    expect(fakeDB.rows('pro_early_access_requests')).toHaveLength(1)
  })

  it('second submission within 24h returns alreadyRegistered=true and inserts NOTHING', async () => {
    // Seed an existing row inside the window.
    fakeDB.seed('pro_early_access_requests', [{
      id: 'existing', user_id: 'auth-user-uuid',
      email: 'real@example.com', source: 'dashboard',
      plan_interest: 'pro', message: null, metadata_json: {},
      created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),  // 1h ago
    }])
    const r = await POST(req({ bearer: 'good', body: { source: 'settings' } }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, alreadyRegistered: true })
    expect(fakeDB.rows('pro_early_access_requests')).toHaveLength(1)
  })

  it('submission OUTSIDE the 24h window inserts a new row', async () => {
    fakeDB.seed('pro_early_access_requests', [{
      id: 'old', user_id: 'auth-user-uuid',
      email: 'real@example.com', source: 'dashboard',
      plan_interest: 'pro', message: null, metadata_json: {},
      created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),  // 48h ago
    }])
    const r = await POST(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, alreadyRegistered: false })
    expect(fakeDB.rows('pro_early_access_requests')).toHaveLength(2)
  })

  it('dedupe is scoped to user_id (other users do NOT block this user)', async () => {
    fakeDB.seed('pro_early_access_requests', [{
      id: 'other-user', user_id: 'someone-else',
      email: 'other@example.com', source: 'dashboard',
      plan_interest: 'pro', message: null, metadata_json: {},
      created_at: new Date().toISOString(),
    }])
    const r = await POST(req({ bearer: 'good' }))
    expect((await r.json()).alreadyRegistered).toBe(false)
    expect(fakeDB.rows('pro_early_access_requests')).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Response privacy
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/account/pro-early-access — response privacy', () => {
  it('response body never echoes user_id, email, or token', async () => {
    const r = await POST(req({ bearer: 'good', body: { source: 'dashboard' } }))
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/auth-user-uuid/)
    expect(blob).not.toMatch(/real@example\.com/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
  })

  it('never mentions Stripe / checkout / payment in the response shape', async () => {
    const r = await POST(req({ bearer: 'good' }))
    const blob = JSON.stringify(await r.json()).toLowerCase()
    expect(blob).not.toMatch(/stripe/)
    expect(blob).not.toMatch(/checkout/)
    expect(blob).not.toMatch(/payment/)
  })
})
