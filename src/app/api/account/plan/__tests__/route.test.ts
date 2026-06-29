// Block 5A-W-25 — GET /api/account/plan tests.
// Covers: anonymous fallback, bearer verification, env-allowlist
// resolution, response shape contains only the boolean plan and
// never leaks the full allowlist or user_id.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Stub Supabase client constructor — verify token → user_id.
let getUserMock: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }>
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: (token: string) => getUserMock(token),
    },
  }),
}))

import { GET } from '../route'

const KEYS = [
  'ACCOUNT_PRO_USER_IDS',
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
  getUserMock = async () => ({ data: { user: null }, error: { message: 'no user' } })
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
  return new Request('http://localhost/api/account/plan', { method: 'GET', headers })
}

describe('GET /api/account/plan — anonymous', () => {
  it('no bearer → 200 free (paints clean for anonymous dashboard mounts)', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ plan: 'free' })
  })
})

describe('GET /api/account/plan — bearer verification', () => {
  it('invalid token → 401 free', async () => {
    getUserMock = async () => ({ data: { user: null }, error: { message: 'invalid' } })
    const r = await GET(req({ bearer: 'bogus' }))
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ plan: 'free' })
  })
})

describe('GET /api/account/plan — allowlist resolution', () => {
  it('valid token + user_id NOT in allowlist → free', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = 'someone-else'
    getUserMock = async () => ({ data: { user: { id: 'uuid-not-listed' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ plan: 'free' })
  })

  it('valid token + user_id IN allowlist → pro', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = '745453cb-db78-4b29-96ed-8aad8f060c55,other-uuid'
    getUserMock = async () => ({
      data:  { user: { id: '745453cb-db78-4b29-96ed-8aad8f060c55' } },
      error: null,
    })
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ plan: 'pro' })
  })

  it('whitespace-laden env still resolves the listed id', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = ' uuid-A , uuid-B '
    getUserMock = async () => ({ data: { user: { id: 'uuid-B' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    expect(await r.json()).toEqual({ plan: 'pro' })
  })

  it('env unset → free even for valid sessions', async () => {
    getUserMock = async () => ({ data: { user: { id: 'uuid-1' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    expect(await r.json()).toEqual({ plan: 'free' })
  })
})

describe('GET /api/account/plan — response privacy', () => {
  it('response body NEVER includes the user_id or the full allowlist', async () => {
    process.env.ACCOUNT_PRO_USER_IDS = 'secret-uuid-A,secret-uuid-B,secret-uuid-C'
    getUserMock = async () => ({ data: { user: { id: 'secret-uuid-A' } }, error: null })
    const r = await GET(req({ bearer: 'good' }))
    const blob = JSON.stringify(await r.json())
    // Only the resolved plan boolean is exposed.
    expect(blob).not.toMatch(/secret-uuid-A/)
    expect(blob).not.toMatch(/secret-uuid-B/)
    expect(blob).not.toMatch(/secret-uuid-C/)
    expect(blob).not.toMatch(/"user_id"/i)
  })
})

describe('GET /api/account/plan — misconfig', () => {
  it('missing SUPABASE_URL → 503 free (fail closed without leaking why)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const r = await GET(req({ bearer: 'good' }))
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ plan: 'free' })
  })
})
