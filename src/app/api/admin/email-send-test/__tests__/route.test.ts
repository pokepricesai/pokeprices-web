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

// Stub the renderer so the route tests do not exercise React Email.
vi.mock('@/emails/render', () => ({
  TEMPLATE_KEYS: ['delivery_test', 'transactional_test', 'marketing_preview'],
  isApprovedTemplateKey: (k: unknown) =>
    typeof k === 'string' && ['delivery_test','transactional_test','marketing_preview'].includes(k),
  renderTemplate: async () => ({
    subject:  'X', html: '<p>x</p>', text: 'x',
    category: 'transactional',
  }),
}))

import { POST, GET } from '../route'

const ENV_KEYS = ['EMAIL_TEST_RECIPIENT'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of ENV_KEYS) snap[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  mockAdmin = async () => ({ ok: true, userId: 'u', email: 'a@x', status: 200, error: '' })
  sendEmailMock.mockReset()
  sendEmailMock.mockResolvedValue({ outcome: 'sent', emailId: 'rid-1' })
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function postReq(body: unknown = {}): Request {
  return new Request('http://localhost/api/admin/email-send-test', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/admin/email-send-test', () => {
  it('GET returns the approved template list', async () => {
    const r = await GET()
    const j = await r.json()
    expect(Array.isArray(j.templates)).toBe(true)
    expect(j.templates).toContain('delivery_test')
  })

  it('rejects an unknown template key', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const r = await POST(postReq({ template: 'whatever' }))
    expect(r.status).toBe(400)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('rejects when admin auth fails', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(401)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('returns 503 when EMAIL_TEST_RECIPIENT is missing', async () => {
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(503)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('locks the recipient to EMAIL_TEST_RECIPIENT — body cannot override', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    await POST(postReq({
      template: 'delivery_test',
      to:       'attacker@example.com',
      recipient:'attacker@example.com',
    }))
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendEmailMock.mock.calls[0][0] as { toEmail: string; adminBypass: object }
    expect(sent.toEmail).toBe('safe@example.com')
    expect(sent.adminBypass).toBeDefined()
  })

  it('returns success + emailId on a clean send', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toEqual({ success: true, emailId: 'rid-1', template: 'delivery_test' })
  })

  it('returns 502 generic on provider_error', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    sendEmailMock.mockResolvedValueOnce({ outcome: 'provider_error', reason: 'oops' })
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(502)
    const j = await r.json()
    expect(j).toEqual({ success: false, error: 'Send failed' })
  })

  it('returns 409 on duplicate idempotency', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    sendEmailMock.mockResolvedValueOnce({ outcome: 'duplicate' })
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(409)
  })

  it('returns 503 on configuration_error', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    sendEmailMock.mockResolvedValueOnce({ outcome: 'configuration_error', reason: 'x' })
    const r = await POST(postReq({ template: 'delivery_test' }))
    expect(r.status).toBe(503)
  })
})
