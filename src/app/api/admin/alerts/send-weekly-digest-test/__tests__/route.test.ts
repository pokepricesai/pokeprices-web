// Block 5A-W-16 — POST /api/admin/alerts/send-weekly-digest-test tests.
// Covers: dual-flag gate, admin gate, locked recipient (env vs admin
// fallback vs hard fail), [TEST] subject, [TEST] [SAMPLE] sample
// subject, arbitrary recipient in body is IGNORED, no DB writes, no
// alert_events.delivered_at mutations, sendEmail call shape.

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

// sendEmail is mocked at the module boundary so the route never
// reaches Resend or the email_delivery_log table. Every call is
// captured so we can assert on the recipient, category, subject etc.
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
import { preferencesToRow, ALERT_PREFERENCE_DEFAULTS } from '@/lib/alerts/preferences'

const KEYS = [
  'ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED',
  'ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED',
  'ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO',
] as const
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
  return new Request('http://localhost/api/admin/alerts/send-weekly-digest-test', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

function seedDigestableAdmin() {
  fakeDB.seed('user_alert_preferences', [
    { user_id: 'admin-uid', ...preferencesToRow(ALERT_PREFERENCE_DEFAULTS) },
  ])
  fakeDB.seed('cards', [
    { card_url_slug: 'charizard-base-4', card_slug: '1450205', card_name: 'Charizard', set_name: 'Base Set' },
  ])
  fakeDB.seed('watchlist', [
    { user_id: 'admin-uid', card_slug: 'charizard-base-4', card_name: null, set_name: null },
  ])
  fakeDB.seed('daily_prices', [
    { card_slug: 'pc-1450205', date: '2026-06-18', raw_usd: 10, psa9_usd: null, psa10_usd: null },
    { card_slug: 'pc-1450205', date: '2026-06-25', raw_usd: 14, psa9_usd: null, psa10_usd: null },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-test — gates', () => {
  it('503 when neither flag is set', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
    expect(sendCalls).toHaveLength(0)
  })

  it('200 when ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED=true and the other is unset', async () => {
    process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(sendCalls).toHaveLength(1)
  })

  it('200 when ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED=true and the test flag is unset', async () => {
    process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(sendCalls).toHaveLength(1)
  })

  it('rejects flag values other than the literal "true"', async () => {
    for (const v of ['1', 'yes', 'TRUE', 'enabled']) {
      process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
    expect(sendCalls).toHaveLength(0)
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(sendCalls).toHaveLength(0)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
    expect(sendCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Recipient locking — env override + admin fallback + hard fail
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-test — recipient locking', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true' })

  it('uses ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO when set', async () => {
    process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO = 'tests@pokeprices.io'
    const r = await POST(req())
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.recipient).toBe('tests@pokeprices.io')
    expect(j.recipientSource).toBe('env')
    expect(sendCalls[0].toEmail).toBe('tests@pokeprices.io')
  })

  it('falls back to the authenticated admin email when env is unset', async () => {
    const r = await POST(req())
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.recipient).toBe('admin@example.com')
    expect(j.recipientSource).toBe('admin')
    expect(sendCalls[0].toEmail).toBe('admin@example.com')
  })

  it('400 when env is malformed AND no admin fallback applies', async () => {
    process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO = 'not-an-email'
    const r = await POST(req())
    expect(r.status).toBe(400)
    expect(sendCalls).toHaveLength(0)
  })

  it('400 when env is unset AND admin has no email', async () => {
    mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: '', status: 200, error: '' })
    const r = await POST(req())
    expect(r.status).toBe(400)
    expect(sendCalls).toHaveLength(0)
  })

  it('IGNORES an arbitrary recipient sent in the request body', async () => {
    // Attacker / mistaken admin tries to redirect the send. The route
    // never reads a recipient from the body — only env or admin.
    const r = await POST(req({ to: 'attacker@example.com', toEmail: 'attacker@example.com', recipient: 'attacker@example.com' }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.recipient).toBe('admin@example.com')   // admin fallback, NOT body
    expect(sendCalls[0].toEmail).toBe('admin@example.com')
    expect(sendCalls).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Subject + mode handling
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-test — subject + modes', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true' })

  it('defaults to auto-mode → sample on an empty system; subject is [TEST] [SAMPLE] …', async () => {
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.subject).toMatch(/^\[TEST\] \[SAMPLE\] Your weekly PokePrices update/)
    expect(sendCalls[0].subject).toBe(j.subject)
  })

  it('auto-mode → real subject (just [TEST]) when the admin has actual content', async () => {
    seedDigestableAdmin()
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.subject).toBe('[TEST] Your weekly PokePrices update')
    expect(j.subject).not.toMatch(/\[SAMPLE\]/)
  })

  it('mode=sample always stacks [TEST] [SAMPLE] even when real data exists', async () => {
    seedDigestableAdmin()
    const r = await POST(req({ mode: 'sample' }))
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.subject).toMatch(/^\[TEST\] \[SAMPLE\] /)
  })

  it('mode=real keeps [TEST] without stacking [SAMPLE], even on a quiet/empty system', async () => {
    const r = await POST(req({ mode: 'real' }))
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.subject).toBe('[TEST] Your weekly PokePrices update')
    expect(j.subject).not.toMatch(/\[SAMPLE\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// sendEmail call shape
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-test — sendEmail call shape', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true' })

  it('uses the weekly_report category and an admin-bypass with recipientLocked=true', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(sendCalls).toHaveLength(1)
    const c = sendCalls[0] as Record<string, unknown> & { adminBypass?: { recipientLocked?: boolean } }
    expect(c.category).toBe('weekly_report')
    expect(c.templateKey).toBe('weekly-digest-test')
    expect(c.adminBypass?.recipientLocked).toBe(true)
  })

  it('passes the renderer subject / html / text through verbatim', async () => {
    const r = await POST(req())
    const j = await r.json()
    const c = sendCalls[0] as { subject: string; html: string; text: string }
    expect(c.subject).toBe(j.subject)
    expect(typeof c.html).toBe('string')
    expect(c.html.length).toBeGreaterThan(100)
    expect(typeof c.text).toBe('string')
    expect(c.text.length).toBeGreaterThan(50)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Safety — no DB mutations
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/send-weekly-digest-test — safety', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED = 'true' })

  it('does NOT mark any alert_events delivered (delivered_at stays null)', async () => {
    seedDigestableAdmin()
    fakeDB.seed('alert_events', [
      { id: 'e1', user_id: 'admin-uid', card_slug: '1450205',
        card_name: 'Charizard', set_name: 'Base Set',
        rule: 'raw_change', severity: 'normal', payload_json: {},
        detected_at: '2026-06-24T10:00:00Z', delivered_at: null },
    ])
    await POST(req())
    const rows = fakeDB.rows('alert_events') as Array<{ delivered_at: string | null }>
    expect(rows.every(r => r.delivered_at == null)).toBe(true)
  })

  it('does NOT mutate the seeded portfolio / watchlist / cards / daily_prices tables', async () => {
    seedDigestableAdmin()
    const snapshot = {
      prefs:   JSON.stringify(fakeDB.rows('user_alert_preferences')),
      cards:   JSON.stringify(fakeDB.rows('cards')),
      watch:   JSON.stringify(fakeDB.rows('watchlist')),
      prices:  JSON.stringify(fakeDB.rows('daily_prices')),
      sales:   JSON.stringify(fakeDB.rows('recent_sales')),
    }
    await POST(req())
    expect(JSON.stringify(fakeDB.rows('user_alert_preferences'))).toBe(snapshot.prefs)
    expect(JSON.stringify(fakeDB.rows('cards'))).toBe(snapshot.cards)
    expect(JSON.stringify(fakeDB.rows('watchlist'))).toBe(snapshot.watch)
    expect(JSON.stringify(fakeDB.rows('daily_prices'))).toBe(snapshot.prices)
    expect(JSON.stringify(fakeDB.rows('recent_sales'))).toBe(snapshot.sales)
  })

  it('response never echoes user_id or auth tokens', async () => {
    seedDigestableAdmin()
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/admin-uid/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
  })

  it('reports send outcome verbatim — e.g. suppressed bounces back', async () => {
    sendMock = async () => ({ outcome: 'suppressed', reason: 'hard_bounce' })
    const r = await POST(req())
    const j = await r.json()
    expect(j.ok).toBe(false)
    expect(j.outcome).toBe('suppressed')
    expect(j.reason).toBe('hard_bounce')
  })
})
