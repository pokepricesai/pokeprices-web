// Block 3B — processor route auth + flag tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const batchMock = vi.fn()
vi.mock('@/lib/email/onboarding', () => ({
  processOnboardingBatch: (input: unknown) => batchMock(input),
  isOnboardingEnabled:    () => (process.env.EMAIL_ONBOARDING_ENABLED ?? '').toLowerCase() === 'true',
}))

import { POST } from '../route'

const KEYS = ['ONBOARDING_CRON_SECRET', 'EMAIL_ONBOARDING_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  batchMock.mockReset()
  batchMock.mockResolvedValue({ processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false })
})

afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(headers: Record<string, string> = {}, body?: unknown): Request {
  const init: RequestInit = { method: 'POST', headers }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string,string>)['Content-Type'] = 'application/json'
  }
  return new Request('http://localhost/api/internal/process-onboarding-emails', init)
}

describe('POST /api/internal/process-onboarding-emails', () => {
  it('401 when no secret is configured', async () => {
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req({ Authorization: 'Bearer anything' }))
    expect(r.status).toBe(401)
    expect(batchMock).not.toHaveBeenCalled()
  })

  it('401 when the bearer secret is wrong', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req({ Authorization: 'Bearer wrong' }))
    expect(r.status).toBe(401)
    expect(batchMock).not.toHaveBeenCalled()
  })

  it('returns disabled: true without running the batch when feature flag is off', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'right'
    const r = await POST(req({ Authorization: 'Bearer right' }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.disabled).toBe(true)
    expect(j.processed).toBe(0)
    expect(batchMock).not.toHaveBeenCalled()
  })

  it('runs the batch and returns the summary when authorised and enabled', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req({ Authorization: 'Bearer right' }, { limit: 10 }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.sent).toBe(1)
    expect(batchMock).toHaveBeenCalledWith({ limit: 10 })
  })

  it('summary response carries no email or user id', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req({ Authorization: 'Bearer right' }))
    const j = await r.json()
    const blob = JSON.stringify(j)
    expect(blob).not.toMatch(/@/)
    expect(blob).not.toMatch(/user_id/i)
  })
})
