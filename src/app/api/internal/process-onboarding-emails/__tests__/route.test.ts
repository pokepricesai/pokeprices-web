// Block 3D — processor route auth + GET/POST + dual-secret + safe disabled.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const runMock = vi.fn()
vi.mock('@/lib/email/onboardingProcessor', () => ({
  runProcessor: (input: unknown) => runMock(input),
}))

// Use the real cronAuth implementation under test — it reads
// process.env directly, which we control per test.
import { GET, POST } from '../route'

const KEYS = [
  'CRON_SECRET',
  'ONBOARDING_CRON_SECRET',
  'EMAIL_ONBOARDING_ENABLED',
] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  runMock.mockReset()
  runMock.mockResolvedValue({
    status: 'success', runId: 'run-1',
    processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
  })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(method: 'GET' | 'POST', auth?: string, body?: unknown, qs?: string): Request {
  const url = 'http://localhost/api/internal/process-onboarding-emails' + (qs ? `?${qs}` : '')
  const init: RequestInit = {
    method,
    headers: { ...(auth ? { authorization: auth } : {}) },
  }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    ;(init.headers as Record<string,string>)['Content-Type'] = 'application/json'
  }
  return new Request(url, init)
}

describe('processor route — auth', () => {
  it('GET without auth header → 401', async () => {
    process.env.CRON_SECRET = 'right'
    const r = await GET(req('GET'))
    expect(r.status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('POST without auth header → 401', async () => {
    process.env.CRON_SECRET = 'right'
    const r = await POST(req('POST'))
    expect(r.status).toBe(401)
  })

  it('503 when both env vars are missing (operator misconfig)', async () => {
    const r = await GET(req('GET', 'Bearer anything'))
    expect(r.status).toBe(503)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('GET with valid CRON_SECRET → 200 + summary', async () => {
    process.env.CRON_SECRET             = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await GET(req('GET', 'Bearer right'))
    expect(r.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: undefined })
  })

  it('POST with valid CRON_SECRET → 200 + summary', async () => {
    process.env.CRON_SECRET             = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req('POST', 'Bearer right'))
    expect(r.status).toBe(200)
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: undefined })
  })

  it('legacy ONBOARDING_CRON_SECRET still works during migration window', async () => {
    process.env.ONBOARDING_CRON_SECRET  = 'legacy'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    const r = await POST(req('POST', 'Bearer legacy'))
    expect(r.status).toBe(200)
    expect(runMock).toHaveBeenCalledTimes(1)
  })

  it('rejects the legacy secret when only CRON_SECRET is set', async () => {
    process.env.CRON_SECRET = 'new'
    const r = await POST(req('POST', 'Bearer legacy'))
    expect(r.status).toBe(401)
    expect(runMock).not.toHaveBeenCalled()
  })

  it('invalid secret → 401', async () => {
    process.env.CRON_SECRET = 'right'
    const r = await POST(req('POST', 'Bearer wrong'))
    expect(r.status).toBe(401)
  })
})

describe('processor route — limit plumbing', () => {
  beforeEach(() => {
    process.env.CRON_SECRET             = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
  })

  it('GET reads ?limit from the query string', async () => {
    await GET(req('GET', 'Bearer right', undefined, 'limit=10'))
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: 10 })
  })

  it('GET ignores a non-numeric ?limit', async () => {
    await GET(req('GET', 'Bearer right', undefined, 'limit=abc'))
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: undefined })
  })

  it('POST reads numeric limit from JSON body', async () => {
    await POST(req('POST', 'Bearer right', { limit: 7 }))
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: 7 })
  })

  it('POST ignores a non-numeric limit in body', async () => {
    await POST(req('POST', 'Bearer right', { limit: 'all' }))
    expect(runMock).toHaveBeenCalledWith({ source: 'cron', limit: undefined })
  })
})

describe('processor route — feature-flag safety', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'right' })

  it('GET with flag off returns disabled summary (no surprise alerts)', async () => {
    runMock.mockResolvedValueOnce({
      status: 'disabled', runId: 'run-disabled',
      processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: true,
    })
    const r = await GET(req('GET', 'Bearer right'))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.disabled).toBe(true)
    expect(j.status).toBe('disabled')
  })

  it('response never contains the secret value or any email address', async () => {
    runMock.mockResolvedValueOnce({
      status: 'success', runId: 'run-1',
      processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
    })
    const r = await GET(req('GET', 'Bearer right'))
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/right/)
    expect(blob).not.toMatch(/@/)
  })
})

describe('processor route — concurrency', () => {
  it('two concurrent calls both go through and each gets its own response', async () => {
    process.env.CRON_SECRET             = 'right'
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    runMock
      .mockResolvedValueOnce({ status: 'success', runId: 'r1', processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false })
      .mockResolvedValueOnce({ status: 'success', runId: 'r2', processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false })
    const [a, b] = await Promise.all([
      GET(req('GET', 'Bearer right')),
      GET(req('GET', 'Bearer right')),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    // Each runProcessor invocation goes through; per-row atomic claim
    // inside processOnboardingBatch (mocked here) is what guarantees
    // no double-send. The route itself does not gate concurrency.
    expect(runMock).toHaveBeenCalledTimes(2)
  })
})
