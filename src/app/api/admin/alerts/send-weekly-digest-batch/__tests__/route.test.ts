// Block 5A-W-17 — POST /api/admin/alerts/send-weekly-digest-batch tests.
// Covers: flag gate, admin gate, dryRun default, response shape, no
// arbitrary recipient, no user_id / email exposure, engine call shape.

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

// The admin route delegates to the engine. We mock the engine boundary
// so this test focuses on the route's gate behaviour and call shape;
// the engine itself is covered by weeklyDigestDelivery.test.ts.
type DelivOpts = Record<string, unknown>
const deliveryCalls: DelivOpts[] = []
let deliveryMock: (opts: DelivOpts) => Promise<Record<string, unknown>> = async () => ({
  dryRun: true, source: 'admin', asOf: 'now',
  asOfDayOfWeek: 1, usersConsidered: 0, usersEmailed: 0,
  usersInCooldown: 0, usersWrongDay: 0, usersSkipped: 0,
  usersFailed: 0, cooldownDays: 7, perUser: [],
})
vi.mock('@/lib/alerts/weeklyDigestDelivery', () => ({
  deliverWeeklyDigests: (_supa: unknown, opts: DelivOpts) => {
    deliveryCalls.push(opts)
    return deliveryMock(opts)
  },
}))

// Stub makeAuthEmailLookup so the route can wire it without importing
// auth machinery.
vi.mock('@/lib/alerts/delivery', () => ({
  makeAuthEmailLookup: () => async (_uid: string) => null,
}))

import { POST } from '../route'

const KEY = 'ALERT_WEEKLY_DIGEST_BATCH_ENABLED' as const
let snap: string | undefined

beforeEach(() => {
  snap = process.env[KEY]
  delete process.env[KEY]
  fakeDB.reset()
  deliveryCalls.length = 0
  mockAdmin = async () => ({
    ok: true, userId: 'admin-uid', email: 'admin@example.com',
    status: 200, error: '',
  })
  deliveryMock = async () => ({
    dryRun: true, source: 'admin', asOf: 'now',
    asOfDayOfWeek: 1, usersConsidered: 0, usersEmailed: 0,
    usersInCooldown: 0, usersWrongDay: 0, usersSkipped: 0,
    usersFailed: 0, cooldownDays: 7, perUser: [],
  })
})
afterEach(() => {
  if (snap === undefined) delete process.env[KEY]
  else process.env[KEY] = snap
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/send-weekly-digest-batch', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-batch — gates', () => {
  it('503 when flag is unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('503 when flag is set to a non-"true" value (e.g. "1")', async () => {
    process.env[KEY] = '1'
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('rejects non-admins with the requireAdmin status code', async () => {
    process.env[KEY] = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'unauthorised' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(deliveryCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// dryRun default
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-batch — dryRun default', () => {
  beforeEach(() => { process.env[KEY] = 'true' })

  it('defaults dryRun=true when omitted', async () => {
    await POST(req())
    expect(deliveryCalls[0].dryRun).toBe(true)
  })

  it('non-boolean false (e.g. "false" string) stays as dryRun=true', async () => {
    await POST(req({ dryRun: 'false' }))
    expect(deliveryCalls[0].dryRun).toBe(true)
  })

  it('only literal boolean false flips dryRun off', async () => {
    await POST(req({ dryRun: false }))
    expect(deliveryCalls[0].dryRun).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Forwarded options
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-batch — option forwarding', () => {
  beforeEach(() => { process.env[KEY] = 'true' })

  it('forwards maxUsers / cooldownDays / asOf to the engine; source=admin always', async () => {
    await POST(req({ maxUsers: 10, cooldownDays: 5, asOf: '2026-06-22T09:00:00Z' }))
    const opts = deliveryCalls[0]
    expect(opts.maxUsers).toBe(10)
    expect(opts.cooldownDays).toBe(5)
    expect((opts.asOf as Date).toISOString()).toBe('2026-06-22T09:00:00.000Z')
    expect(opts.source).toBe('admin')
  })

  it('ignores invalid asOf, maxUsers, cooldownDays', async () => {
    await POST(req({ asOf: 'not-a-date', maxUsers: -3, cooldownDays: 0 }))
    const opts = deliveryCalls[0]
    expect(opts.asOf).toBeUndefined()
    expect(opts.maxUsers).toBeUndefined()
    expect(opts.cooldownDays).toBeUndefined()
  })

  it('never accepts a recipient / userId field — request body ignored', async () => {
    await POST(req({ toEmail: 'attacker@evil.com', userId: 'someone-else' } as Record<string, unknown>))
    const opts = deliveryCalls[0]
    expect('toEmail' in opts).toBe(false)
    expect('userId' in opts).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Response shape — no user_id / token leakage
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-batch — response', () => {
  beforeEach(() => { process.env[KEY] = 'true' })

  it('response body never echoes user_id / email / tokens', async () => {
    deliveryMock = async () => ({
      dryRun: false, source: 'admin', asOf: '2026-06-22T09:00:00Z',
      asOfDayOfWeek: 1, usersConsidered: 2, usersEmailed: 1,
      usersInCooldown: 0, usersWrongDay: 0, usersSkipped: 1, usersFailed: 0,
      cooldownDays: 7,
      perUser: [
        { recipientMasked: 'lu***@gmail.com', outcome: 'sent', weeklyDayOfWeek: 1,
          portfolioItemCount: 3, watchlistItemCount: 0, alertHighlightCount: 0 },
        { recipientMasked: '***',             outcome: 'no_content', weeklyDayOfWeek: 4,
          portfolioItemCount: 0, watchlistItemCount: 0, alertHighlightCount: 0 },
      ],
    })
    const r = await POST(req({ dryRun: false }))
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/admin-uid/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
    expect(blob).not.toMatch(/lukejosephpierce@gmail\.com/i)
  })
})
