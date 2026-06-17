// Block 3D — runProcessor lifecycle + run-log writes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from './_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

// Mock the underlying batch so we control the summary and any throws.
const batchMock = vi.fn()
vi.mock('../onboarding', () => ({
  processOnboardingBatch: (input: unknown) => batchMock(input),
  isOnboardingEnabled:    () => (process.env.EMAIL_ONBOARDING_ENABLED ?? '').toLowerCase() === 'true',
}))

import { runProcessor } from '../onboardingProcessor'

const KEYS = ['EMAIL_ONBOARDING_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  batchMock.mockReset()
  batchMock.mockResolvedValue({
    processed: 1, sent: 1, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
  })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

describe('runProcessor — disabled short-circuit', () => {
  it('writes a disabled run row + returns disabled summary, never calls the batch', async () => {
    const r = await runProcessor({ source: 'cron' })
    expect(r.status).toBe('disabled')
    expect(r.disabled).toBe(true)
    expect(r.runId).toBeTruthy()
    expect(batchMock).not.toHaveBeenCalled()

    const rows = fakeDB.rows('email_onboarding_runs')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('disabled')
    expect(rows[0].source).toBe('cron')
    expect(rows[0].sent_count).toBe(0)
  })
})

describe('runProcessor — status resolution', () => {
  beforeEach(() => { process.env.EMAIL_ONBOARDING_ENABLED = 'true' })

  it('success when failed_count = 0 AND retried_count = 0', async () => {
    batchMock.mockResolvedValueOnce({
      processed: 2, sent: 2, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false,
    })
    const r = await runProcessor({ source: 'cron' })
    expect(r.status).toBe('success')
    const row = fakeDB.rows('email_onboarding_runs').find(x => x.id === r.runId)!
    expect(row.status).toBe('success')
    expect(row.sent_count).toBe(2)
    expect(row.completed_at).toBeTruthy()
    expect(row.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('partial when failed_count > 0', async () => {
    batchMock.mockResolvedValueOnce({
      processed: 3, sent: 2, skipped: 0, retried: 0, cancelled: 0, failed: 1, disabled: false,
    })
    const r = await runProcessor({ source: 'cron' })
    expect(r.status).toBe('partial')
  })

  it('partial when retried_count > 0 even if failed = 0', async () => {
    batchMock.mockResolvedValueOnce({
      processed: 3, sent: 2, skipped: 0, retried: 1, cancelled: 0, failed: 0, disabled: false,
    })
    const r = await runProcessor({ source: 'cron' })
    expect(r.status).toBe('partial')
  })

  it('failed when the batch throws', async () => {
    batchMock.mockImplementationOnce(() => { throw new Error('boom') })
    const r = await runProcessor({ source: 'cron' })
    expect(r.status).toBe('failed')
    const row = fakeDB.rows('email_onboarding_runs').find(x => x.id === r.runId)!
    expect(row.status).toBe('failed')
    expect(row.error_code).toBeTruthy()
  })
})

describe('runProcessor — source recording', () => {
  beforeEach(() => { process.env.EMAIL_ONBOARDING_ENABLED = 'true' })

  it("records source='cron' for cron-driven runs", async () => {
    const r = await runProcessor({ source: 'cron' })
    const row = fakeDB.rows('email_onboarding_runs').find(x => x.id === r.runId)!
    expect(row.source).toBe('cron')
  })

  it("records source='manual' for admin-driven runs", async () => {
    const r = await runProcessor({ source: 'manual' })
    const row = fakeDB.rows('email_onboarding_runs').find(x => x.id === r.runId)!
    expect(row.source).toBe('manual')
  })
})

describe('runProcessor — limit clamping', () => {
  beforeEach(() => { process.env.EMAIL_ONBOARDING_ENABLED = 'true' })

  it('caps the limit at the hard processor batch cap', async () => {
    await runProcessor({ source: 'cron', limit: 9999 })
    const call = batchMock.mock.calls[0][0] as { limit: number }
    expect(call.limit).toBeLessThanOrEqual(25)
  })

  it('drops a non-finite or negative limit', async () => {
    await runProcessor({ source: 'cron', limit: -5 })
    const call = batchMock.mock.calls[0][0] as { limit?: number }
    expect(call.limit).toBeUndefined()
  })
})

describe('runProcessor — no PII or secret in response', () => {
  beforeEach(() => { process.env.EMAIL_ONBOARDING_ENABLED = 'true' })

  it('never returns email, user_id or any secret in the summary', async () => {
    process.env.CRON_SECRET = 'secret-do-not-leak'
    const r = await runProcessor({ source: 'cron' })
    const blob = JSON.stringify(r)
    expect(blob).not.toMatch(/@/)
    expect(blob).not.toMatch(/secret-do-not-leak/)
    delete process.env.CRON_SECRET
  })
})
