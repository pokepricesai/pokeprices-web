// Exercises the central send service end-to-end against an in-memory
// fake Supabase + a mocked Resend SDK.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

const resendSendMock = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: (args: unknown) => resendSendMock(args) },
  })),
}))

import { sendEmail } from '../send'
import { __resetResendClientForTests } from '../resend'
import { EMAIL_CATEGORIES } from '../categories'

const ENV_KEYS = [
  'RESEND_API_KEY', 'VERCEL_ENV', 'EMAIL_TEST_RECIPIENT', 'EMAIL_ALLOW_PREVIEW_SEND',
] as const
let envSnap: Record<string, string | undefined>

beforeEach(() => {
  envSnap = {}
  for (const k of ENV_KEYS) envSnap[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  fakeDB.reset()
  resendSendMock.mockReset()
  resendSendMock.mockResolvedValue({ data: { id: 'resend-id-1' }, error: null })
  __resetResendClientForTests()

  // Pretend we are in production unless a test says otherwise.
  process.env.VERCEL_ENV       = 'production'
  process.env.RESEND_API_KEY   = 'rk-test'
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envSnap[k] === undefined) delete process.env[k]
    else process.env[k] = envSnap[k]
  }
})

function baseInput(overrides: Partial<Parameters<typeof sendEmail>[0]> = {}) {
  return {
    toEmail:        'collector@example.com',
    category:       EMAIL_CATEGORIES.SERVICE_PRODUCT,
    templateKey:    'transactional_test',
    subject:        'hi',
    html:           '<p>hi</p>',
    text:           'hi',
    idempotencyKey: 'idem-1',
    ...overrides,
  }
}

describe('sendEmail — happy path', () => {
  it('sends, logs the resend email id, returns outcome=sent', async () => {
    const r = await sendEmail(baseInput())
    expect(r.outcome).toBe('sent')
    expect(r.emailId).toBe('resend-id-1')

    expect(resendSendMock).toHaveBeenCalledTimes(1)
    const sentArgs = resendSendMock.mock.calls[0][0] as { to: string; subject: string }
    expect(sentArgs.to).toBe('collector@example.com')
    expect(sentArgs.subject).toBe('hi')

    const log = fakeDB.rows('email_delivery_log')[0]
    expect(log.status).toBe('sent')
    expect(log.resend_email_id).toBe('resend-id-1')
    expect(log.recipient_email_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('marketing sends carry List-Unsubscribe headers; transactional do not', async () => {
    await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      templateKey: 'marketing_preview',
      idempotencyKey: 'idem-mkt',
      adminBypass: { reason: 'test', recipientLocked: true },
    }))
    const callArgs = resendSendMock.mock.calls[0][0] as { headers?: Record<string, string> }
    expect(callArgs.headers?.['List-Unsubscribe']).toMatch(/^<https?:\/\//)
    expect(callArgs.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')

    resendSendMock.mockClear()
    await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-txn',
    }))
    const txnArgs = resendSendMock.mock.calls[0][0] as { headers?: Record<string, string> }
    expect(txnArgs.headers?.['List-Unsubscribe']).toBeUndefined()
  })
})

describe('sendEmail — validation', () => {
  it('rejects an invalid recipient', async () => {
    const r = await sendEmail(baseInput({ toEmail: 'not-an-email' }))
    expect(r.outcome).toBe('invalid_recipient')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('configuration_error when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    __resetResendClientForTests()
    const r = await sendEmail(baseInput())
    expect(r.outcome).toBe('configuration_error')
    expect(r.reason).toBe('missing_api_key')
  })
})

describe('sendEmail — Preview safety', () => {
  it('blocks Preview send to a non-locked recipient', async () => {
    process.env.VERCEL_ENV           = 'preview'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const r = await sendEmail(baseInput({ toEmail: 'random@example.com' }))
    expect(r.outcome).toBe('configuration_error')
    expect(r.reason).toBe('preview_recipient_not_allowed')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('allows Preview send to the locked recipient', async () => {
    process.env.VERCEL_ENV           = 'preview'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const r = await sendEmail(baseInput({ toEmail: 'safe@example.com' }))
    expect(r.outcome).toBe('sent')
  })

  it('allows Preview send to any recipient when EMAIL_ALLOW_PREVIEW_SEND=true', async () => {
    process.env.VERCEL_ENV                = 'preview'
    process.env.EMAIL_TEST_RECIPIENT      = 'safe@example.com'
    process.env.EMAIL_ALLOW_PREVIEW_SEND  = 'true'
    const r = await sendEmail(baseInput({ toEmail: 'open@example.com' }))
    expect(r.outcome).toBe('sent')
  })

  it('blocks Preview send when no locked recipient is configured', async () => {
    process.env.VERCEL_ENV = 'preview'
    const r = await sendEmail(baseInput())
    expect(r.outcome).toBe('configuration_error')
    expect(r.reason).toBe('preview_lock_no_recipient')
  })
})

describe('sendEmail — preferences', () => {
  it('returns preference_disabled when marketing is not granted', async () => {
    // Seed an existing contact so preferences are evaluated for it.
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null,
      email_verified: false,
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      templateKey: 'marketing_preview',
      idempotencyKey: 'idem-mkt-skip',
    }))
    expect(r.outcome).toBe('preference_disabled')
    expect(r.reason).toBe('marketing_default')
    expect(resendSendMock).not.toHaveBeenCalled()
    const log = fakeDB.rows('email_delivery_log')[0]
    expect(log.status).toBe('preference_disabled')
  })

  it('sends when an explicit consent is granted', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null,
      email_verified: false,
    }])
    fakeDB.seed('email_consents', [{
      contact_id: 'c1', category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      state: 'granted', source: 'test', consent_version: 'v1',
      created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      templateKey: 'marketing_preview',
      idempotencyKey: 'idem-mkt-go',
    }))
    expect(r.outcome).toBe('sent')
  })
})

describe('sendEmail — suppressions', () => {
  it('returns suppressed for a hard-bounce contact (non-transactional)', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput())
    expect(r.outcome).toBe('suppressed')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('returns unsubscribed when the suppression is a manual unsubscribe', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'manual_unsubscribe',
      category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      source: 'unsubscribe_link', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    fakeDB.seed('email_consents', [{
      contact_id: 'c1', category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      state: 'granted', source: 'test', consent_version: 'v1',
      created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      templateKey: 'marketing_preview',
      idempotencyKey: 'idem-unsub',
    }))
    expect(r.outcome).toBe('unsubscribed')
  })

  // ── Block 3A correction: terminal reasons now block transactional ──

  it('global HARD_BOUNCE blocks transactional', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-txn-hb',
    }))
    expect(r.outcome).toBe('suppressed')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('global COMPLAINT blocks transactional', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'complaint', category: null,
      source: 'webhook_complaint', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-txn-cmp',
    }))
    expect(r.outcome).toBe('suppressed')
  })

  it('global INVALID_ADDRESS blocks transactional', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'invalid_address', category: null,
      source: 'send_service', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-txn-inv',
    }))
    expect(r.outcome).toBe('suppressed')
  })

  it('global ADMIN_SUPPRESSION blocks transactional', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'admin_suppression', category: null,
      source: 'admin_action', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-txn-adm',
    }))
    expect(r.outcome).toBe('suppressed')
  })

  it('marketing manual_unsubscribe does NOT block a transactional/service send', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'manual_unsubscribe',
      category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      source: 'unsubscribe_link', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.SERVICE_PRODUCT,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-svc-ok',
    }))
    expect(r.outcome).toBe('sent')
  })

  // ── adminBypass scope ──

  it('adminBypass does NOT override a terminal hard_bounce — operator must notice', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'hard_bounce', category: null,
      source: 'webhook_bounce', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.TRANSACTIONAL,
      templateKey: 'delivery_test',
      idempotencyKey: 'idem-bypass-hb',
      adminBypass: { reason: 'admin_test_resend', recipientLocked: true },
    }))
    expect(r.outcome).toBe('suppressed')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('adminBypass does NOT override a terminal complaint', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'complaint', category: null,
      source: 'webhook_complaint', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.SERVICE_PRODUCT,
      templateKey: 'transactional_test',
      idempotencyKey: 'idem-bypass-cmp',
      adminBypass: { reason: 'admin_email_send_test', recipientLocked: true },
    }))
    expect(r.outcome).toBe('suppressed')
  })

  it('adminBypass DOES allow a marketing send to a contact with a marketing manual_unsubscribe (intended bypass scope)', async () => {
    fakeDB.seed('email_contacts', [{
      id: 'c1', email_normalized: 'collector@example.com', user_id: null, email_verified: false,
    }])
    fakeDB.seed('email_suppressions', [{
      id: 's1', contact_id: 'c1', reason: 'manual_unsubscribe',
      category: EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      source: 'unsubscribe_link', lifted_at: null, created_at: '2026-06-15T00:00:00Z',
    }])
    const r = await sendEmail(baseInput({
      category:    EMAIL_CATEGORIES.MARKETING_NEWSLETTER,
      templateKey: 'marketing_preview',
      idempotencyKey: 'idem-bypass-unsub',
      adminBypass: { reason: 'admin_test', recipientLocked: true },
    }))
    expect(r.outcome).toBe('sent')
  })

  it('adminBypass still rejects an invalid recipient string', async () => {
    const r = await sendEmail(baseInput({
      toEmail: 'not-an-email',
      adminBypass: { reason: 'admin', recipientLocked: true },
    }))
    expect(r.outcome).toBe('invalid_recipient')
  })
})

describe('sendEmail — idempotency + provider behaviour', () => {
  it('returns duplicate on a UNIQUE constraint violation for the idempotency key', async () => {
    fakeDB.seed('email_delivery_log', [{
      id: 'existing', idempotency_key: 'idem-dup', status: 'sent',
      template_key: 'transactional_test', category: EMAIL_CATEGORIES.SERVICE_PRODUCT,
      created_at: '2026-06-15T00:00:00Z',
    }])
    fakeDB.forceInsertError('email_delivery_log', { code: '23505', message: 'unique' })
    const r = await sendEmail(baseInput({ idempotencyKey: 'idem-dup' }))
    expect(r.outcome).toBe('duplicate')
    expect(r.deliveryLogId).toBe('existing')
    expect(resendSendMock).not.toHaveBeenCalled()
  })

  it('returns provider_error when Resend reports an error', async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { name: 'validation_error', message: 'oops' } })
    const r = await sendEmail(baseInput({ idempotencyKey: 'idem-providerr' }))
    expect(r.outcome).toBe('provider_error')
    const log = fakeDB.rows('email_delivery_log').find(l => l.idempotency_key === 'idem-providerr')!
    expect(log.status).toBe('provider_error')
    expect(log.error_code).toBe('validation_error')
  })

  it('returns provider_error when the Resend SDK throws', async () => {
    resendSendMock.mockImplementationOnce(() => { throw new Error('boom') })
    const r = await sendEmail(baseInput({ idempotencyKey: 'idem-throw' }))
    expect(r.outcome).toBe('provider_error')
  })
})

describe('sendEmail — metadata sanitiser', () => {
  it('drops banned keys and oversize values before they reach the log', async () => {
    await sendEmail(baseInput({
      idempotencyKey: 'idem-meta',
      metadata: {
        ok_key:        'fine',
        token:         'should-be-dropped',
        password:      'never-stored',
        body:          'huge raw email body...',
        oversize_str:  'a'.repeat(500),
      },
    }))
    const log = fakeDB.rows('email_delivery_log').find(l => l.idempotency_key === 'idem-meta')!
    expect(log.metadata_json.ok_key).toBe('fine')
    expect('token' in log.metadata_json).toBe(false)
    expect('password' in log.metadata_json).toBe(false)
    expect('body' in log.metadata_json).toBe(false)
    expect(log.metadata_json.oversize_str.length).toBeLessThanOrEqual(200)
  })
})
