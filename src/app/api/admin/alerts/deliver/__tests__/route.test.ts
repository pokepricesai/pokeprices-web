// Block 5A-W-6 — POST /api/admin/alerts/deliver tests.
// Focuses on the route's responsibilities: gating, body parsing, and
// invocation of deliverAlerts with the right options. The orchestrator
// itself is covered in src/lib/alerts/__tests__/delivery.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// Mock the delivery module so the route test asserts wiring without
// re-exercising the orchestrator. Also captures the options object so
// we can assert what the route passed in.
type DelivOpts = Record<string, unknown>
const deliveryCalls: DelivOpts[] = []
let deliveryResult: Record<string, unknown> = {
  dryRun: true, asOf: 't', usersConsidered: 0, usersEmailed: 0,
  eventsDelivered: 0, suppressedOrSkipped: 0, failed: 0, perUser: [],
}
vi.mock('@/lib/alerts/delivery', () => ({
  deliverAlerts: vi.fn(async (_supa: unknown, opts: DelivOpts) => {
    deliveryCalls.push(opts)
    return { ...deliveryResult, dryRun: opts.dryRun !== false }
  }),
  makeAuthEmailLookup: () => async (_id: string) => null,
}))

import { POST } from '../route'

const KEYS = ['ALERT_DELIVERY_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  deliveryCalls.length = 0
  mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: 'a@x', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/deliver', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/deliver — gates', () => {
  it('503 when ALERT_DELIVERY_ENABLED is unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('503 when ALERT_DELIVERY_ENABLED is anything other than the literal "true"', async () => {
    for (const v of ['1','yes','TRUE','True','enabled','false']) {
      process.env.ALERT_DELIVERY_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
  })

  it('does NOT accept the preview / test-send flags as substitutes', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    process.env.ALERT_TEST_EMAIL_ENABLED    = 'true'
    const r = await POST(req())
    expect(r.status).toBe(503)
    delete process.env.ALERT_EMAIL_PREVIEW_ENABLED
    delete process.env.ALERT_TEST_EMAIL_ENABLED
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERT_DELIVERY_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERT_DELIVERY_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
    expect(deliveryCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// dryRun default + body parsing
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/deliver — dryRun', () => {
  beforeEach(() => { process.env.ALERT_DELIVERY_ENABLED = 'true' })

  it('defaults dryRun=true with an empty body', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(deliveryCalls).toHaveLength(1)
    expect(deliveryCalls[0].dryRun).toBe(true)
  })

  it('keeps dryRun=true when body explicitly passes { dryRun: true }', async () => {
    const r = await POST(req({ dryRun: true }))
    expect(r.status).toBe(200)
    expect(deliveryCalls[0].dryRun).toBe(true)
  })

  it('keeps dryRun=true when body passes the STRING "false" (only literal boolean sends)', async () => {
    const r = await POST(req({ dryRun: 'false' as unknown as boolean }))
    expect(r.status).toBe(200)
    expect(deliveryCalls[0].dryRun).toBe(true)
  })

  it('flips to dryRun=false only when body has the literal boolean false', async () => {
    const r = await POST(req({ dryRun: false }))
    expect(r.status).toBe(200)
    expect(deliveryCalls[0].dryRun).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Limit forwarding
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/deliver — limit forwarding', () => {
  beforeEach(() => { process.env.ALERT_DELIVERY_ENABLED = 'true' })

  it('forwards maxUsers, maxEventsPerUser and maxCardsPerEmail when supplied as positive integers', async () => {
    await POST(req({ maxUsers: 3, maxEventsPerUser: 10, maxCardsPerEmail: 6 }))
    expect(deliveryCalls[0].maxUsers).toBe(3)
    expect(deliveryCalls[0].maxEventsPerUser).toBe(10)
    expect(deliveryCalls[0].maxCardsPerEmail).toBe(6)
  })

  it('drops non-numeric or non-positive limits (orchestrator applies its defaults)', async () => {
    await POST(req({ maxUsers: 'lots' as unknown as number, maxEventsPerUser: -5, maxCardsPerEmail: 0 }))
    expect(deliveryCalls[0].maxUsers).toBeUndefined()
    expect(deliveryCalls[0].maxEventsPerUser).toBeUndefined()
    expect(deliveryCalls[0].maxCardsPerEmail).toBeUndefined()
  })

  it('forwards cooldownHours when supplied as a positive number (Block 5A-W-12)', async () => {
    await POST(req({ cooldownHours: 12 }))
    expect(deliveryCalls[0].cooldownHours).toBe(12)
  })

  it('accepts fractional cooldownHours (e.g. 0.5h for short stress runs)', async () => {
    await POST(req({ cooldownHours: 0.5 }))
    expect(deliveryCalls[0].cooldownHours).toBe(0.5)
  })

  it('drops non-positive or non-numeric cooldownHours (orchestrator falls back to env default)', async () => {
    await POST(req({ cooldownHours: -1 }))
    expect(deliveryCalls[0].cooldownHours).toBeUndefined()
    await POST(req({ cooldownHours: 'soon' as unknown as number }))
    expect(deliveryCalls[1].cooldownHours).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Response shape passthrough
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/deliver — response', () => {
  beforeEach(() => { process.env.ALERT_DELIVERY_ENABLED = 'true' })

  it('passes the orchestrator result through as JSON', async () => {
    deliveryResult = {
      dryRun: false, asOf: '2026-06-24T12:00:00Z',
      usersConsidered: 5, usersEmailed: 3, eventsDelivered: 12,
      suppressedOrSkipped: 1, failed: 1,
      perUser: [
        { recipientMasked: 'lu***@gmail.com', eventCount: 4, outcome: 'sent', emailId: 'r-1' },
      ],
    }
    const r = await POST(req({ dryRun: false }))
    const j = await r.json()
    expect(j.dryRun).toBe(false)
    expect(j.usersEmailed).toBe(3)
    expect(j.perUser[0].recipientMasked).toBe('lu***@gmail.com')
  })

  it('returns 500 when the orchestrator throws', async () => {
    // Re-mock to throw for this single test.
    const mod = await import('@/lib/alerts/delivery')
    vi.mocked(mod.deliverAlerts).mockRejectedValueOnce(new Error('kaboom'))
    const r = await POST(req())
    expect(r.status).toBe(500)
  })
})
