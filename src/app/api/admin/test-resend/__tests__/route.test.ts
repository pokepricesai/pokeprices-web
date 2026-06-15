// Tests for the temporary /api/admin/test-resend route.
//
// Coverage:
//   1. anonymous request rejected
//   2. non-admin authenticated request rejected
//   3. missing RESEND_API_KEY returns 503 + generic message
//   4. missing EMAIL_TEST_RECIPIENT returns 503 + generic message
//   5. successful send (Resend SDK mocked) returns success + emailId
//   6. recipient sent in the request body is ignored — only the
//      EMAIL_TEST_RECIPIENT env value is ever passed to Resend

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────────
// The route imports `server-only`, which throws by design outside a
// React Server Component context. Vitest's `node` environment is
// otherwise fine for testing route handlers, so we no-op the guard.
vi.mock('server-only', () => ({}))

// requireAdmin is mocked per-test by overwriting the exported binding via
// vi.mock + a controllable handle.

let mockAdmin: () => Promise<{ ok: boolean; userId: string; email: string; status: number; error: string }>
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: (req: Request) => mockAdmin(),
}))

// Resend SDK mock — the constructor returns an object with .emails.send.
// Tests set `resendSendImpl` to control the response.
let resendSendImpl: (args: any) => Promise<{ data: any; error: any }>
const resendSendSpy = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: (args: any) => {
        resendSendSpy(args)
        return resendSendImpl(args)
      },
    },
  })),
}))

// Import AFTER mocks are registered.
import { POST } from '../route'

// ── Helpers ────────────────────────────────────────────────────────────────

function adminOk() {
  return {
    ok: true, userId: 'u1', email: 'admin@example.com', status: 200, error: '',
  }
}

function adminReject(status: number, error: string) {
  return {
    ok: false, userId: '', email: '', status, error,
  }
}

function postReq(headers: Record<string, string> = {}, body?: unknown): Request {
  const init: RequestInit = {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request('http://localhost/api/admin/test-resend', init)
}

// ── Env hygiene ────────────────────────────────────────────────────────────

const ENV_VARS = ['RESEND_API_KEY', 'EMAIL_TEST_RECIPIENT', 'VERCEL_ENV'] as const
let originalEnv: Partial<Record<string, string | undefined>> = {}

beforeEach(() => {
  originalEnv = {}
  for (const name of ENV_VARS) originalEnv[name] = process.env[name]
  // Clean slate per test.
  for (const name of ENV_VARS) delete process.env[name]

  mockAdmin = async () => adminOk()
  resendSendImpl = async () => ({ data: { id: 'mock-id-123' }, error: null })
  resendSendSpy.mockClear()
})

afterEach(() => {
  for (const name of ENV_VARS) {
    if (originalEnv[name] === undefined) delete process.env[name]
    else process.env[name] = originalEnv[name]
  }
})

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/test-resend', () => {
  it('rejects anonymous requests (no session) with the auth helper status', async () => {
    mockAdmin = async () => adminReject(401, 'Missing bearer token')
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'

    const res = await POST(postReq())
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Missing bearer token' })
    expect(resendSendSpy).not.toHaveBeenCalled()
  })

  it('rejects authenticated but non-admin callers', async () => {
    mockAdmin = async () => adminReject(403, 'Not authorised')
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'

    const res = await POST(postReq({ Authorization: 'Bearer not-an-admin' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Not authorised' })
    expect(resendSendSpy).not.toHaveBeenCalled()
  })

  it('returns 503 + generic message when RESEND_API_KEY is missing', async () => {
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    // RESEND_API_KEY intentionally unset.

    const res = await POST(postReq())
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Email service not configured' })
    expect(resendSendSpy).not.toHaveBeenCalled()
  })

  it('returns 503 + generic message when EMAIL_TEST_RECIPIENT is missing', async () => {
    process.env.RESEND_API_KEY = 'rk-test'
    // EMAIL_TEST_RECIPIENT intentionally unset.

    const res = await POST(postReq())
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Email service not configured' })
    expect(resendSendSpy).not.toHaveBeenCalled()
  })

  it('returns success + emailId on a clean send', async () => {
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    process.env.VERCEL_ENV           = 'production'

    const res = await POST(postReq())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ success: true, emailId: 'mock-id-123' })

    expect(resendSendSpy).toHaveBeenCalledTimes(1)
    const callArgs = resendSendSpy.mock.calls[0][0]
    expect(callArgs.from).toBe('PokePrices <hello@pokeprices.io>')
    expect(callArgs.to).toBe('safe@example.com')
    expect(callArgs.subject).toBe('PokePrices Vercel email test')
    // Body mentions the Vercel environment and references Resend.
    expect(String(callArgs.text)).toMatch(/Resend API/i)
    expect(String(callArgs.text)).toMatch(/production/)
    // ISO timestamp present.
    expect(String(callArgs.text)).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('ignores any "to" / recipient supplied in the request body — only EMAIL_TEST_RECIPIENT is used', async () => {
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'

    // Attacker tries to redirect the email.
    const res = await POST(postReq({}, {
      to:        'attacker@evil.example',
      recipient: 'attacker@evil.example',
      email:     'attacker@evil.example',
    }))
    expect(res.status).toBe(200)

    expect(resendSendSpy).toHaveBeenCalledTimes(1)
    const callArgs = resendSendSpy.mock.calls[0][0]
    expect(callArgs.to).toBe('safe@example.com')
    expect(callArgs.to).not.toContain('attacker')
  })

  it('returns generic 502 when Resend reports an error', async () => {
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    resendSendImpl = async () => ({ data: null, error: { name: 'validation_error', message: 'oops' } })

    const res = await POST(postReq())
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Send failed' })
    // Generic message — must not leak the Resend error text.
    expect(JSON.stringify(json)).not.toMatch(/oops/)
  })

  it('returns generic 502 when the Resend SDK throws', async () => {
    process.env.RESEND_API_KEY       = 'rk-test'
    process.env.EMAIL_TEST_RECIPIENT = 'safe@example.com'
    resendSendImpl = async () => { throw new Error('network down — full URL secrets etc') }

    const res = await POST(postReq())
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json).toEqual({ success: false, error: 'Send failed' })
    expect(JSON.stringify(json)).not.toMatch(/secrets/)
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
