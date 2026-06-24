// Block 5A-W-5 — POST /api/admin/alerts/send-test-email tests.
// Covers: dual-flag gate, admin gate, recipient resolution (env vs
// admin fallback vs hard fail), [TEST] subject, sample fallback, no
// DB writes to alert_events, no delivered_at update, sendEmail call
// shape, no recipient leakage to non-allowed addresses.

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

// sendEmail is mocked at the module boundary so the route test never
// touches Resend or email_delivery_log. The mock records every call
// so we can assert on the args (recipient, subject, category, etc.).
type SendInput = Record<string, unknown>
const sendCalls: SendInput[] = []
let sendMock: (input: SendInput) => Promise<{ outcome: string; emailId?: string; deliveryLogId?: string; reason?: string }> =
  async () => ({ outcome: 'sent', emailId: 'fake-email-id', deliveryLogId: 'fake-log-id' })
vi.mock('@/lib/email/send', () => ({
  sendEmail: (input: SendInput) => {
    sendCalls.push(input)
    return sendMock(input)
  },
}))

import { POST } from '../route'

const KEYS = ['ALERT_TEST_EMAIL_ENABLED', 'ALERT_EMAIL_PREVIEW_ENABLED', 'ALERT_TEST_EMAIL_TO'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  sendCalls.length = 0
  mockAdmin = async () => ({
    ok: true, userId: 'admin-uid', email: 'admin@example.com',
    status: 200, error: '',
  })
  sendMock = async () => ({ outcome: 'sent', emailId: 'fake-email-id', deliveryLogId: 'fake-log-id' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/send-test-email', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

function seedRealEvents(userId: string) {
  fakeDB.seed('alert_events', [
    { user_id: userId, card_slug: '1450205', card_name: "Lt. Surge's Raichu", set_name: 'Gym Challenge',
      rule: 'raw_change', severity: 'high', payload_json: { old: 12500, new: 16875, pct: 35 },
      detected_at: '2026-06-24T10:00:00Z', delivered_at: null },
    { user_id: userId, card_slug: '9536051', card_name: 'Haunter', set_name: 'Fossil',
      rule: 'recent_sales', severity: 'normal', payload_json: { recent_active_count: 3, window_days: 7 },
      detected_at: '2026-06-24T09:00:00Z', delivered_at: null },
  ])
  fakeDB.seed('cards', [
    { card_slug: '1450205', set_name: 'Gym Challenge', card_url_slug: 'lt-surges-raichu-1st-edition-11' },
    { card_slug: '9536051', set_name: 'Fossil',         card_url_slug: 'haunter-incomplete-holo-error-6'   },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-test-email — gates', () => {
  it('503 when neither flag is set', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
    expect(sendCalls).toHaveLength(0)
  })

  it('200 when ALERT_TEST_EMAIL_ENABLED=true and ALERT_EMAIL_PREVIEW_ENABLED unset', async () => {
    process.env.ALERT_TEST_EMAIL_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(sendCalls).toHaveLength(1)
  })

  it('200 when ALERT_EMAIL_PREVIEW_ENABLED=true alone (back-compat)', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('503 when either flag is a near-miss', async () => {
    for (const v of ['1','yes','TRUE','True']) {
      process.env.ALERT_TEST_EMAIL_ENABLED    = v
      process.env.ALERT_EMAIL_PREVIEW_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERT_TEST_EMAIL_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(sendCalls).toHaveLength(0)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERT_TEST_EMAIL_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
    expect(sendCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Recipient resolution
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-test-email — recipient', () => {
  beforeEach(() => { process.env.ALERT_TEST_EMAIL_ENABLED = 'true' })

  it('falls back to the authenticated admin email when ALERT_TEST_EMAIL_TO is unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.recipient).toBe('admin@example.com')
    expect(j.recipientSource).toBe('admin')
    expect(sendCalls[0].toEmail).toBe('admin@example.com')
  })

  it('uses ALERT_TEST_EMAIL_TO when set, even if the admin has a different email', async () => {
    process.env.ALERT_TEST_EMAIL_TO = 'lukejosephpierce@gmail.com'
    const r = await POST(req())
    const j = await r.json()
    expect(j.recipient).toBe('lukejosephpierce@gmail.com')
    expect(j.recipientSource).toBe('env')
    expect(sendCalls[0].toEmail).toBe('lukejosephpierce@gmail.com')
  })

  it('400 hard-fail when no recipient can be resolved', async () => {
    mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: '', status: 200, error: '' })
    const r = await POST(req())
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/no recipient/i)
    expect(sendCalls).toHaveLength(0)
  })

  it('400 when ALERT_TEST_EMAIL_TO is set to a non-email string', async () => {
    process.env.ALERT_TEST_EMAIL_TO = 'not-an-email'
    const r = await POST(req())
    expect(r.status).toBe(400)
    expect(sendCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Subject + mode
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-test-email — subject and mode', () => {
  beforeEach(() => { process.env.ALERT_TEST_EMAIL_ENABLED = 'true' })

  it('falls back to sample mode + stacks [TEST] [SAMPLE] in the subject when no real events exist', async () => {
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.subject.startsWith('[TEST] [SAMPLE] ')).toBe(true)
    expect(sendCalls[0].subject).toBe(j.subject)
  })

  it('uses real mode and a [TEST]-only subject when admin has undelivered events', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.eventCount).toBe(2)
    expect(j.subject.startsWith('[TEST] ')).toBe(true)
    expect(j.subject).not.toContain('[SAMPLE]')
  })

  it('passes category=transactional + templateKey=alert-digest-test + adminBypass to sendEmail', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    const call = sendCalls[0]
    expect(call.category).toBe('transactional')
    expect(call.templateKey).toBe('alert-digest-test')
    expect((call.adminBypass as Record<string, unknown>).recipientLocked).toBe(true)
  })

  it('passes a unique idempotency key per click', async () => {
    await POST(req())
    await new Promise(res => setTimeout(res, 2))
    await POST(req())
    expect(sendCalls).toHaveLength(2)
    expect(sendCalls[0].idempotencyKey).not.toBe(sendCalls[1].idempotencyKey)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Safety — no writes / no delivered_at update
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-test-email — safety', () => {
  beforeEach(() => { process.env.ALERT_TEST_EMAIL_ENABLED = 'true' })

  it('does not insert, update or delete alert_events', async () => {
    seedRealEvents('admin-uid')
    const before = fakeDB.rows('alert_events').map(r => ({ ...r }))
    await POST(req())
    await POST(req())
    const after = fakeDB.rows('alert_events').map(r => ({ ...r }))
    expect(after).toEqual(before)
  })

  it('does not update delivered_at on any seeded event', async () => {
    seedRealEvents('admin-uid')
    await POST(req())
    for (const r of fakeDB.rows('alert_events')) {
      expect(r.delivered_at).toBeNull()
    }
  })

  it('surfaces the sendEmail outcome verbatim (e.g. suppressed)', async () => {
    sendMock = async () => ({ outcome: 'suppressed', deliveryLogId: 'log-suppressed', reason: 'hard_bounce' })
    const r = await POST(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.outcome).toBe('suppressed')
    expect(j.ok).toBe(false)
    expect(j.reason).toBe('hard_bounce')
  })

  it('returns 500 when sendEmail throws', async () => {
    sendMock = async () => { throw new Error('boom') }
    const r = await POST(req())
    expect(r.status).toBe(500)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Response shape — no PII / user_id leakage
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-test-email — response shape', () => {
  beforeEach(() => { process.env.ALERT_TEST_EMAIL_ENABLED = 'true' })

  it('response carries no user_id key and no admin-uid string', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/admin-uid/)
  })
})
