import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

// In-memory Supabase fake.
const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

// Verifier mock so we can control valid/invalid/missing-secret outcomes
// per test without exercising svix's crypto path.
const verifyMock = vi.fn()
vi.mock('@/lib/email/webhookVerify', () => ({
  verifyResendWebhook: (body: string, headers: Headers, secret?: string) =>
    verifyMock(body, headers, secret),
}))

import { POST } from '../route'

const ENV_KEYS = ['RESEND_WEBHOOK_SECRET'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of ENV_KEYS) snap[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  fakeDB.reset()
  verifyMock.mockReset()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function postReq(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: { 'svix-id': 'evt_1', ...headers },
  })
}

describe('POST /api/webhooks/resend', () => {
  it('returns 503 when the signing secret is missing', async () => {
    verifyMock.mockReturnValue({ ok: false, reason: 'missing_secret' })
    const r = await POST(postReq('{}'))
    expect(r.status).toBe(503)
    expect(fakeDB.rows('email_webhook_events')).toHaveLength(0)
  })

  it('returns 400 on an invalid signature', async () => {
    verifyMock.mockReturnValue({ ok: false, reason: 'bad_signature' })
    const r = await POST(postReq('{}'))
    expect(r.status).toBe(400)
    expect(fakeDB.rows('email_webhook_events')).toHaveLength(0)
  })

  it('stores the event and reconciles delivery log on email.sent', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.sent', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-1' },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-1', status: 'pending',
      template_key: 'x', category: 'transactional',
      idempotency_key: 'idem', created_at: '2026-06-15T09:00:00Z',
    }])
    const r = await POST(postReq('{}'))
    expect(r.status).toBe(200)
    const evt = fakeDB.rows('email_webhook_events')[0]
    expect(evt.event_type).toBe('email.sent')
    expect(evt.resend_email_id).toBe('r-1')
    expect(evt.processed_at).toBeTruthy()
    const log = fakeDB.rows('email_delivery_log')[0]
    expect(log.status).toBe('sent')
    expect(log.sent_at).toBe('2026-06-15T10:00:00Z')
  })

  it('acknowledges a duplicate event (UNIQUE provider_event_id) with 200', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.sent', created_at: '2026-06-15T10:00:00Z', data: { email_id: 'r-2' },
    }})
    fakeDB.forceInsertError('email_webhook_events', { code: '23505', message: 'unique' })
    const r = await POST(postReq('{}'))
    expect(r.status).toBe(200)
    const json = await r.json()
    expect(json).toEqual({ ok: true, duplicate: true })
  })

  it('soft delay does NOT suppress', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.delivery_delayed', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-3' },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-3', status: 'sent', template_key: 'x',
      category: 'service_product', idempotency_key: 'idem3',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
    expect(fakeDB.rows('email_delivery_log')[0].status).toBe('delivery_delayed')
  })

  it('hard bounce applies a global suppression', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.bounced', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-4', bounce: { type: 'hard', subType: 'NoEmail' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-4', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem4',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    const supp = fakeDB.rows('email_suppressions')
    expect(supp).toHaveLength(1)
    expect(supp[0].reason).toBe('hard_bounce')
    expect(supp[0].category).toBeNull()
  })

  it('soft bounce does NOT suppress', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.bounced', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-5', bounce: { type: 'soft' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-5', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem5',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
  })

  it('complaint applies a global suppression', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.complained', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-6' },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-6', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem6',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    const supp = fakeDB.rows('email_suppressions')
    expect(supp[0].reason).toBe('complaint')
  })

  // ── Block 3A correction: classified failures ──

  it('email.failed with a PERMANENT recipient reason applies provider_rejection suppression', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.failed', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-perm', failed: { reason: 'Mailbox does not exist' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-perm', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem-perm',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    const supp = fakeDB.rows('email_suppressions')
    expect(supp).toHaveLength(1)
    expect(supp[0].reason).toBe('provider_rejection')
    // …delivery log status still flips to failed:
    expect(fakeDB.rows('email_delivery_log')[0].status).toBe('failed')
  })

  it('email.failed with a TEMPORARY reason does NOT suppress (log status only)', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.failed', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-tmp', failed: { reason: 'Connection timed out' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-tmp', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem-tmp',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
    expect(fakeDB.rows('email_delivery_log')[0].status).toBe('failed')
  })

  it('email.failed with an UNKNOWN reason does NOT suppress', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.failed', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-unk', failed: { reason: 'wat' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-unk', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem-unk',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
  })

  it('email.bounced with type=unknown does NOT suppress', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.bounced', created_at: '2026-06-15T10:00:00Z',
      data: { email_id: 'r-unkb', bounce: { type: 'foobar' } },
    }})
    fakeDB.seed('email_delivery_log', [{
      id: 'l1', resend_email_id: 'r-unkb', status: 'sent', template_key: 'x',
      category: 'marketing_newsletter', idempotency_key: 'idem-unkb',
      created_at: '2026-06-15T09:00:00Z', contact_id: 'c1',
    }])
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'foo@example.com', user_id: null, email_verified: false,
    }])
    await POST(postReq('{}'))
    expect(fakeDB.rows('email_suppressions')).toHaveLength(0)
  })

  // ── Block 3A correction: payload normalisation ──

  it('payload_normalized never contains body fields (html / text / headers / full recipient list)', async () => {
    verifyMock.mockReturnValue({ ok: true, payload: {
      type: 'email.sent', created_at: '2026-06-15T10:00:00Z',
      data: {
        email_id: 'r-store', to: ['foo@example.com', 'second@example.com'],
        // Hostile / oversized fields that MUST NOT land in the store.
        html:    '<p>secret body</p>',
        text:    'secret body',
        subject: 'super secret subject',
        headers: { 'X-Internal-Token': 'shh' },
      } as unknown as Record<string, unknown>,
    }})
    await POST(postReq('{}'))
    const evt = fakeDB.rows('email_webhook_events')[0]
    const blob = JSON.stringify(evt.payload_normalized)
    expect(blob).not.toMatch(/secret body/)
    expect(blob).not.toMatch(/super secret/)
    expect(blob).not.toMatch(/X-Internal-Token/)
    // And the only recipient-shaped field we ever store on a webhook
    // event is the (hashed-by-delivery-log) email — never the raw list.
    expect(blob).not.toMatch(/second@example.com/)
  })
})
