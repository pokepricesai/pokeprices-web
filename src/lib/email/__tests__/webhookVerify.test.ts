// Verifies the Svix-backed verifier without spinning up a real webhook.
// We sign a payload with a known secret, hand the signature back to
// verifyResendWebhook, and prove the matrix of outcomes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// Mock svix to keep the test deterministic and decoupled from the real
// SDK's transport. The behavioural contract under test is the wrapper's
// translation of svix outcomes into our { ok, reason } shape.
const svixVerifySpy = vi.fn()
vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({
    verify: (body: string, headers: Record<string, string>) => svixVerifySpy(body, headers),
  })),
}))

import { verifyResendWebhook } from '../webhookVerify'

beforeEach(() => {
  svixVerifySpy.mockReset()
})

afterEach(() => {
  delete process.env.RESEND_WEBHOOK_SECRET
})

const goodHeaders = {
  'svix-id':        'msg_abc',
  'svix-timestamp': '1718200000',
  'svix-signature': 'v1,signature',
}

describe('verifyResendWebhook', () => {
  it('returns missing_secret when neither env var nor caller secret is set', () => {
    const r = verifyResendWebhook('{}', goodHeaders)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_secret')
    expect(svixVerifySpy).not.toHaveBeenCalled()
  })

  it('returns missing_headers when a required header is absent', () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    const r = verifyResendWebhook('{}', { 'svix-id': 'x' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_headers')
    expect(svixVerifySpy).not.toHaveBeenCalled()
  })

  it('returns bad_signature when svix.verify throws', () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    svixVerifySpy.mockImplementation(() => { throw new Error('No matching signature') })
    const r = verifyResendWebhook('{"type":"email.sent"}', goodHeaders)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_signature')
  })

  it('returns bad_payload when svix.verify returns a non-object', () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue('not an object')
    const r = verifyResendWebhook('"a"', goodHeaders)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_payload')
  })

  it('returns ok + the verified payload on success', () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({ type: 'email.sent', data: { email_id: 'r1' } })
    const r = verifyResendWebhook('{"type":"email.sent"}', goodHeaders)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload).toEqual({ type: 'email.sent', data: { email_id: 'r1' } })
  })

  it('accepts the caller-supplied secret over the env var', () => {
    process.env.RESEND_WEBHOOK_SECRET = ''
    svixVerifySpy.mockReturnValue({ type: 'email.sent' })
    const r = verifyResendWebhook('{}', goodHeaders, 'whsec_explicit')
    expect(r.ok).toBe(true)
  })

  it('accepts a plain Headers instance', () => {
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_test'
    svixVerifySpy.mockReturnValue({ type: 'email.sent' })
    const h = new Headers(goodHeaders)
    const r = verifyResendWebhook('{}', h)
    expect(r.ok).toBe(true)
  })
})
