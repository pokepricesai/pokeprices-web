// Tests for /api/admin/test-resend after Block 3A refactor.
//
// The route is now a thin shim over the central send service. The
// safety contract is preserved end-to-end:
//   * anonymous + non-admin rejected
//   * recipient locked to EMAIL_TEST_RECIPIENT, never read from body
//   * generic 503 when RESEND_API_KEY or EMAIL_TEST_RECIPIENT missing
//   * generic 502 on provider error / SDK throw
//   * API key never echoed back to the caller

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let mockAdmin: () => Promise<{ ok: boolean; userId: string; email: string; status: number; error: string }>
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: (_req: Request) => mockAdmin(),
}))

const sendEmailMock = vi.fn()
vi.mock('@/lib/email/send', () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
}))

// Stub the template renderer — these tests verify the route shim only.
vi.mock('@/emails/render', () => ({
  DELIVERY_TEST_KEY: 'delivery_test',
  renderTemplate: async () => ({
    subject:  'PokePrices Vercel email test',
    html:     '<p>hi</p>',
    text:     'hi',
    category: 'transactional',
  }),
}))

import { POST } from '../route'

function adminOk()                       { return { ok: true,  userId: 'u1', email: 'a@x', status: 200, error: '' } }
function adminReject(s: number, e: string) { return { ok: false, userId: '',   email: '',    status: s,   error: e  } }

function postReq(headers: Record<string, string> = {}, body?: unknown): Request {
  const init: RequestInit = {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request('http://localhost/api/admin/test-resend', init)
}

const ENV_VARS = ['RESEND_API_KEY', 'EMAIL_TEST_RECIPIENT', 'VERCEL_ENV'] as const
let originalEnv: Record<string, string | undefined>

beforeEach(() => {
  originalEnv = {}
  for (const name of ENV_VARS) originalEnv[name] = process.env[name]
  for (const name of ENV_VARS) delete process.env[name]
  mockAdmin = async () => adminOk()
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue({ outcome: 'sent', emailId: 'mock-id-123' })
})

afterEach(() => {
  for (const name of ENV_VARS) {
    if (originalEnv[name] === undefined) delete process.env[name]
    else process.env[name] = originalEnv[name]
  }
})

describe('POST /api/admin/test-resend (Block 3A)', () => {
  it('rejects anonymous requests with the auth helper status', async () => {
    mockAdmin = async () => adminReject(401, 'Missing bearer token')
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const res = await POST(postReq())
    expect(res.status).toBe(401)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('rejects authenticated but non-admin callers', async () => {
    mockAdmin = async () => adminReject(403, 'Not authorised')
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const res = await POST(postReq({ Authorization: 'Bearer not-an-admin' }))
    expect(res.status).toBe(403)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('returns 503 + generic message when EMAIL_TEST_RECIPIENT is missing', async () => {
    process.env.RESEND_API_KEY = 'rk-test'
    const res = await POST(postReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ success: false, error: 'Email service not configured' })
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('returns 503 generic when the send service reports configuration_error (e.g. missing RESEND_API_KEY)', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    sendEmailMock.mockResolvedValueOnce({ outcome: 'configuration_error', reason: 'missing_api_key' })
    const res = await POST(postReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ success: false, error: 'Email service not configured' })
  })

  it('returns success + emailId on a clean send', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.VERCEL_ENV           = 'production'
    const res = await POST(postReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, emailId: 'mock-id-123' })
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const call = sendEmailMock.mock.calls[0][0] as { toEmail: string; templateKey: string; adminBypass: unknown }
    expect(call.toEmail).toBe('safe@example.com')
    expect(call.templateKey).toBe('delivery_test')
    expect(call.adminBypass).toBeDefined()
  })

  it('ignores any "to" / recipient supplied in the request body — only EMAIL_TEST_RECIPIENT is used', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    process.env.RESEND_API_KEY       = 'rk-test'
    const res = await POST(postReq({}, {
      to:        'attacker@evil.example',
      recipient: 'attacker@evil.example',
      email:     'attacker@evil.example',
    }))
    expect(res.status).toBe(200)
    const call = sendEmailMock.mock.calls[0][0] as { toEmail: string }
    expect(call.toEmail).toBe('safe@example.com')
    expect(call.toEmail).not.toContain('attacker')
  })

  it('returns 502 generic when the send service reports provider_error', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    process.env.RESEND_API_KEY       = 'rk-test'
    sendEmailMock.mockResolvedValueOnce({ outcome: 'provider_error', reason: 'oops' })
    const res = await POST(postReq())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ success: false, error: 'Send failed' })
  })

  it('never echoes the API key in any response', async () => {
    process.env.RESEND_API_KEY       = 'rk-secret-do-not-leak-XYZ'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const res = await POST(postReq())
    const json = await res.json()
    const headerPairs: string[] = []
    res.headers.forEach((value, key) => { headerPairs.push(key + '=' + value) })
    const serialised = JSON.stringify(json) + ' ' + headerPairs.join(';')
    expect(serialised).not.toMatch(/rk-secret-do-not-leak/)
  })
})
