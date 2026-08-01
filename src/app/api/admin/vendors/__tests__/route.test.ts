// Block 5A-W-50A — vendor moderation API route tests.
//
// Verifies that PATCH:
//   * requires a valid admin bearer token,
//   * validates the vendor id,
//   * accepts active|verified booleans and rejects everything else,
//   * updates only the requested columns via the service-role client.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// `server-only` throws when imported outside a server component. In the
// test harness we don't care — bypass it before importing the route.
vi.mock('server-only', () => ({}))

// Fake the requireAdmin gate — accept when Authorization is 'Bearer good'.
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: async (req: Request) => {
    const h = req.headers.get('authorization') ?? ''
    return h === 'Bearer good'
      ? { ok: true, userId: 'u1', email: 'admin@x', status: 200, error: '' }
      : { ok: false, userId: '', email: '', status: 401, error: 'Unauthorised' }
  },
}))

// Track calls into the service client
const svcCalls: any[] = []
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from: (table: string) => ({
      update: (patch: any) => ({
        eq: (col: string, val: string) => ({
          select: (cols: string) => {
            svcCalls.push({ op: 'update', table, patch, col, val, cols })
            return Promise.resolve({
              data: [{ id: val, name: 'X', slug: 'x', active: !!patch.active, verified: !!patch.verified, updated_at: '2026-08-02T00:00:00Z' }],
              error: null,
            })
          },
        }),
      }),
      select: (cols: string) => ({
        order: (col: string, opts: any) => {
          svcCalls.push({ op: 'select', table, cols, col, opts })
          return Promise.resolve({ data: [{ id: 'a', name: 'A' }], error: null })
        },
      }),
    }),
  }),
}))

// Import AFTER the mocks
import { GET, PATCH } from '../route'

beforeEach(() => { svcCalls.length = 0 })

function req(url: string, init: RequestInit = {}) {
  return new Request(url, init)
}
const UUID = '12345678-1234-1234-1234-1234567890ab'

describe('/api/admin/vendors', () => {
  describe('auth', () => {
    it('rejects GET without a valid bearer', async () => {
      const res = await GET(req('http://x/api/admin/vendors'))
      expect(res.status).toBe(401)
    })
    it('rejects PATCH without a valid bearer', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH', body: JSON.stringify({ id: UUID, active: true }),
      }))
      expect(res.status).toBe(401)
    })
  })

  describe('GET', () => {
    it('returns the vendor list ordered by created_at desc', async () => {
      const res = await GET(req('http://x/api/admin/vendors', {
        headers: { Authorization: 'Bearer good' },
      }))
      expect(res.status).toBe(200)
      const j = await res.json()
      expect(j.vendors).toEqual([{ id: 'a', name: 'A' }])
      const call = svcCalls.find(c => c.op === 'select')
      expect(call.table).toBe('vendors')
      expect(call.col).toBe('created_at')
      expect(call.opts).toEqual({ ascending: false })
    })
  })

  describe('PATCH', () => {
    it('updates active only', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: UUID, active: true }),
      }))
      expect(res.status).toBe(200)
      const call = svcCalls.find(c => c.op === 'update')
      expect(call.patch).toEqual({ active: true })
      expect(call.col).toBe('id')
      expect(call.val).toBe(UUID)
    })

    it('updates verified only', async () => {
      await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: UUID, verified: true }),
      }))
      const call = svcCalls.find(c => c.op === 'update')
      expect(call.patch).toEqual({ verified: true })
    })

    it('updates both when supplied together', async () => {
      await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: UUID, active: false, verified: false }),
      }))
      const call = svcCalls.find(c => c.op === 'update')
      expect(call.patch).toEqual({ active: false, verified: false })
    })

    it('rejects unknown fields (does not accept slug/name/vendor_type)', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: UUID, name: 'evil', slug: 'evil' }),
      }))
      expect(res.status).toBe(400)
      const j = await res.json()
      expect(j.error).toMatch(/active|verified/i)
    })

    it('rejects invalid id', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'not-a-uuid', active: true }),
      }))
      expect(res.status).toBe(400)
    })

    it('rejects malformed JSON body', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: 'not json',
      }))
      expect(res.status).toBe(400)
    })

    it('rejects non-boolean active/verified', async () => {
      const res = await PATCH(req('http://x/api/admin/vendors', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer good', 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: UUID, active: 'yes' }),
      }))
      expect(res.status).toBe(400)
    })
  })
})
