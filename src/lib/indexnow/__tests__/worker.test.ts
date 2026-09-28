// Stage 6A — worker unit tests. Mocks the queue module and fetch so no
// real DB or network I/O.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub `server-only` so `import 'server-only'` in worker.ts does not throw.
vi.mock('server-only', () => ({}))

const {
  claimBatchMock, completeBatchMock, failBatchMock, recordSubmissionMock,
  loadSettingsMock, submittedInLast24hMock,
} = vi.hoisted(() => ({
  claimBatchMock:        vi.fn(),
  completeBatchMock:     vi.fn(async () => ({ updated: 0, stale: 0 })),
  failBatchMock:         vi.fn(async () => ({ updated: 0, stale: 0 })),
  recordSubmissionMock:  vi.fn(async () => undefined),
  loadSettingsMock:      vi.fn(),
  submittedInLast24hMock: vi.fn(async () => 0),
}))

vi.mock('../queue', () => ({
  claimBatch:          claimBatchMock,
  completeBatch:       completeBatchMock,
  failBatch:           failBatchMock,
  recordSubmission:    recordSubmissionMock,
  loadSettings:        loadSettingsMock,
  submittedInLast24h:  submittedInLast24hMock,
}))

import { runIndexnowWorker } from '../worker'

const DEFAULT_SETTINGS = {
  worker_enabled:                true,
  bulk_submission_enabled:       false,
  daily_submission_cap:          5000,
  per_invocation_url_cap:        500,
  per_invocation_time_budget_ms: 55_000,
}

beforeEach(() => {
  vi.clearAllMocks()
  loadSettingsMock.mockResolvedValue(DEFAULT_SETTINGS)
  submittedInLast24hMock.mockResolvedValue(0)
})

function makeClaimedRow(i: number) {
  return {
    id: i, url: `https://www.pokeprices.io/insights/x-${i}`,
    content_hash: `h${i}`, page_family: 'insight',
    priority: 0, reason: 'created', attempts: 0,
  }
}

describe('runIndexnowWorker — control flow', () => {
  it('skips when worker_enabled=false', async () => {
    loadSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, worker_enabled: false })
    const r = await runIndexnowWorker({ trigger: 'test' })
    expect(r.status).toBe('skipped')
    expect(r.reason).toBe('worker_disabled')
    expect(claimBatchMock).not.toHaveBeenCalled()
  })

  it('skips when daily cap already reached', async () => {
    submittedInLast24hMock.mockResolvedValue(5000)
    const r = await runIndexnowWorker({ trigger: 'test' })
    expect(r.status).toBe('skipped')
    expect(r.reason).toBe('daily_cap_reached')
  })

  it('returns ok/queue_empty when the queue has nothing eligible', async () => {
    claimBatchMock.mockResolvedValue([])
    const r = await runIndexnowWorker({ trigger: 'test' })
    expect(r.status).toBe('ok')
    expect(r.reason).toBe('queue_empty')
    expect(r.claimed).toBe(0)
  })
})

describe('runIndexnowWorker — successful submission', () => {
  it('POSTs to api.indexnow.org, records a submission row, and marks rows submitted on 200', async () => {
    const rows = [makeClaimedRow(1), makeClaimedRow(2)]
    claimBatchMock.mockResolvedValue(rows)
    const fetchImpl = vi.fn(async () => ({
      status: 200, text: async () => 'OK',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any))
    const r = await runIndexnowWorker({ trigger: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('ok')
    expect(r.urls_submitted).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (fetchImpl.mock.calls as any[])[0] as any[]
    expect(call[0]).toBe('https://api.indexnow.org/indexnow')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = JSON.parse((call[1] as any).body)
    expect(body.host).toBe('www.pokeprices.io')
    expect(body.urlList).toHaveLength(2)
    expect(completeBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      rows: [{ id: 1, content_hash: 'h1' }, { id: 2, content_hash: 'h2' }],
    }))
    expect(recordSubmissionMock).toHaveBeenCalledWith(expect.objectContaining({
      batchSize: 2, statusClass: 'ok',
    }) as never)
  })

  it('marks rows as retry on a 500 response and records the submission with error class', async () => {
    claimBatchMock.mockResolvedValue([makeClaimedRow(1)])
    failBatchMock.mockResolvedValue({ updated: 1, stale: 0 })
    const fetchImpl = vi.fn(async () => ({
      status: 500, text: async () => 'boom',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any))
    const r = await runIndexnowWorker({ trigger: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('error')
    expect(r.urls_retry).toBe(1)
    expect(failBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      permanent: false, statusClass: 'server-error',
    }) as never)
  })

  it('marks rows as failed (not retry) on a 400 response', async () => {
    claimBatchMock.mockResolvedValue([makeClaimedRow(1)])
    failBatchMock.mockResolvedValue({ updated: 1, stale: 0 })
    const fetchImpl = vi.fn(async () => ({
      status: 400, text: async () => 'bad',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any))
    const r = await runIndexnowWorker({ trigger: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.urls_failed).toBe(1)
    expect(failBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      permanent: true, statusClass: 'bad-request',
    }) as never)
  })

  it('marks rows as retry on network error and never lets the error escape', async () => {
    claimBatchMock.mockResolvedValue([makeClaimedRow(1)])
    failBatchMock.mockResolvedValue({ updated: 1, stale: 0 })
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET') })
    const r = await runIndexnowWorker({ trigger: 'test', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.status).toBe('error')
    expect(r.urls_retry).toBe(1)
    expect(failBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      permanent: false, statusClass: 'network-error', error: expect.stringMatching(/ECONNRESET/),
    }) as never)
  })
})

describe('runIndexnowWorker — cap enforcement', () => {
  it('caps per_invocation_url_cap against remaining daily cap', async () => {
    loadSettingsMock.mockResolvedValue({ ...DEFAULT_SETTINGS, daily_submission_cap: 100, per_invocation_url_cap: 500 })
    submittedInLast24hMock.mockResolvedValue(80)
    claimBatchMock.mockResolvedValue([])
    await runIndexnowWorker({ trigger: 'test' })
    // Worker should ask for min(cap-used, per_invocation_url_cap) = 20.
    expect(claimBatchMock).toHaveBeenCalledWith(expect.any(String), 20)
  })
})
