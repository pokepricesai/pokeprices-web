// Block 5A-W-29 — GET /api/admin/account/pro-early-access-requests
// tests. Covers admin gate, masking, limit, empty table, no public
// exposure of raw email / full user_id / message body.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

let mockAdmin: () => Promise<{ ok: boolean; userId: string; email: string; status: number; error: string }>
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: (_req: Request) => mockAdmin(),
}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { GET } from '../route'

function req(): Request {
  return new Request('http://localhost/api/admin/account/pro-early-access-requests', {
    method: 'GET',
  })
}

beforeEach(() => {
  fakeDB.reset()
  mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: 'admin@example.com', status: 200, error: '' })
})

describe('pro-early-access admin route — admin gate', () => {
  it('rejects non-admins with the admin auth status code', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'unauthorised' })
    const r = await GET(req())
    expect(r.status).toBe(401)
    const body = await r.json()
    expect(body.error).toBe('unauthorised')
  })

  it('rejects forbidden (non-allowlisted) admins with 403', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'Not authorised' })
    const r = await GET(req())
    expect(r.status).toBe(403)
  })
})

describe('pro-early-access admin route — projection', () => {
  it('returns latest requests with masked email + masked user_id + message snippet', async () => {
    fakeDB.seed('pro_early_access_requests', [
      {
        id: 'r-1',
        created_at: '2026-06-28T10:00:00Z',
        user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'luke@example.com',
        source: 'watchlist_alerts',
        plan_interest: 'pro',
        message: 'Would love instant alerts on Charizard.',
      },
    ])
    const r = await GET(req())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(Array.isArray(body.rows)).toBe(true)
    expect(body.rows).toHaveLength(1)
    const row = body.rows[0]
    expect(row.user_id_masked).toBe('aaaaaaaa***')
    expect(row.email_masked).toBe('lu***@example.com')
    expect(row.source).toBe('watchlist_alerts')
    expect(row.plan_interest).toBe('pro')
    expect(row.message_snippet).toBe('Would love instant alerts on Charizard.')
    expect(row.created_at).toBe('2026-06-28T10:00:00Z')
    expect(body.limit).toBe(50)
    expect(body.total).toBe(1)
  })

  it('orders by created_at descending', async () => {
    fakeDB.seed('pro_early_access_requests', [
      { id: 'old',    created_at: '2026-06-20T00:00:00Z', user_id: 'u1', email: 'a@x.com', source: 'dashboard',         plan_interest: 'pro', message: null },
      { id: 'newest', created_at: '2026-06-29T00:00:00Z', user_id: 'u2', email: 'b@x.com', source: 'settings',          plan_interest: 'pro', message: null },
      { id: 'mid',    created_at: '2026-06-25T00:00:00Z', user_id: 'u3', email: 'c@x.com', source: 'watchlist_alerts',  plan_interest: 'pro', message: null },
    ])
    const r = await GET(req())
    const body = await r.json()
    expect(body.rows.map((x: { id: string }) => x.id)).toEqual(['newest', 'mid', 'old'])
  })

  it('caps the response at 50 rows even when more exist', async () => {
    const rows = Array.from({ length: 75 }, (_, i) => ({
      id: `r-${i}`,
      created_at: new Date(2026, 5, 1 + (i % 28), i % 24, 0, 0).toISOString(),
      user_id: `user-${i}-aaaa-bbbb-cccc-dddddddddddd`,
      email: `seed${i}@example.com`,
      source: 'dashboard',
      plan_interest: 'pro',
      message: null,
    }))
    fakeDB.seed('pro_early_access_requests', rows)
    const r = await GET(req())
    const body = await r.json()
    expect(body.rows).toHaveLength(50)
    expect(body.limit).toBe(50)
    expect(body.total).toBe(50)
  })

  it('handles an empty table without erroring', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.rows).toEqual([])
    expect(body.total).toBe(0)
    expect(body.limit).toBe(50)
  })

  it('does not leak raw email or full user_id anywhere in the response payload', async () => {
    fakeDB.seed('pro_early_access_requests', [
      {
        id: 'r-1',
        created_at: '2026-06-28T10:00:00Z',
        user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'luke.j.pierce.collector@example.com',
        source: 'settings',
        plan_interest: 'pro',
        message: 'Hello',
      },
    ])
    const r = await GET(req())
    const blob = JSON.stringify(await r.json())
    // Full UUID must never appear.
    expect(blob).not.toMatch(/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/)
    // Full local-part of the email must never appear.
    expect(blob).not.toMatch(/luke\.j\.pierce\.collector/)
    // The fully formed raw address must never appear verbatim.
    expect(blob).not.toContain('luke.j.pierce.collector@example.com')
  })

  it('trims message bodies longer than the snippet cap and appends an ellipsis', async () => {
    const longMessage = 'x'.repeat(500)
    fakeDB.seed('pro_early_access_requests', [
      {
        id: 'r-long',
        created_at: '2026-06-28T10:00:00Z',
        user_id: 'long-user',
        email: 'long@example.com',
        source: 'dashboard',
        plan_interest: 'pro',
        message: longMessage,
      },
    ])
    const r = await GET(req())
    const body = await r.json()
    expect(body.rows[0].message_snippet).toBe('x'.repeat(200) + '…')
    expect(body.rows[0].message_snippet.length).toBeLessThanOrEqual(201)
  })

  it('returns null message_snippet when message is empty or whitespace-only', async () => {
    fakeDB.seed('pro_early_access_requests', [
      { id: 'r-empty',  created_at: '2026-06-28T10:00:00Z', user_id: 'ue', email: 'e@x.com', source: 'dashboard', plan_interest: 'pro', message: '' },
      { id: 'r-spaces', created_at: '2026-06-28T11:00:00Z', user_id: 'us', email: 'f@x.com', source: 'dashboard', plan_interest: 'pro', message: '   ' },
      { id: 'r-null',   created_at: '2026-06-28T12:00:00Z', user_id: 'un', email: 'g@x.com', source: 'dashboard', plan_interest: 'pro', message: null },
    ])
    const r = await GET(req())
    const body = await r.json()
    for (const row of body.rows) {
      expect(row.message_snippet).toBeNull()
    }
  })

  it('masks email when present and returns null when missing', async () => {
    fakeDB.seed('pro_early_access_requests', [
      { id: 'r-with', created_at: '2026-06-28T10:00:00Z', user_id: 'u1', email: 'collector@pokeprices.io', source: 'dashboard', plan_interest: 'pro', message: null },
      { id: 'r-no',   created_at: '2026-06-28T11:00:00Z', user_id: 'u2', email: null,                       source: 'dashboard', plan_interest: 'pro', message: null },
    ])
    const r = await GET(req())
    const body = await r.json()
    const withEmail = body.rows.find((x: { id: string }) => x.id === 'r-with')
    const noEmail   = body.rows.find((x: { id: string }) => x.id === 'r-no')
    expect(withEmail.email_masked).toBe('co***@pokeprices.io')
    expect(noEmail.email_masked).toBeNull()
  })

  it('masks user_id to first 8 chars and returns null when missing', async () => {
    fakeDB.seed('pro_early_access_requests', [
      { id: 'r-1', created_at: '2026-06-28T10:00:00Z', user_id: '11111111-2222-3333-4444-555555555555', email: 'a@x.com', source: 'dashboard', plan_interest: 'pro', message: null },
      { id: 'r-2', created_at: '2026-06-28T11:00:00Z', user_id: null, email: 'b@x.com', source: 'dashboard', plan_interest: 'pro', message: null },
    ])
    const r = await GET(req())
    const body = await r.json()
    const row1 = body.rows.find((x: { id: string }) => x.id === 'r-1')
    const row2 = body.rows.find((x: { id: string }) => x.id === 'r-2')
    expect(row1.user_id_masked).toBe('11111111***')
    expect(row2.user_id_masked).toBeNull()
  })
})
