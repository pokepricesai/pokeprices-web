// src/lib/indexnow/worker.ts
// ============================================================================
// IndexNow queue drain worker.
//
// Called by `/api/cron/indexnow-worker` on a Vercel schedule (see vercel.json).
// One invocation:
//   1. Loads settings (kill switch, caps).
//   2. Claims up to per_invocation_url_cap URLs from seo_indexnow_queue.
//   3. Batches them by MAX_BATCH_SIZE (1000) and POSTs each batch to
//      api.indexnow.org/indexnow via the pure submitter.
//   4. Records one seo_indexnow_submissions row per batch, and marks the
//      corresponding queue rows as submitted / retry / failed.
//   5. Stops when the time budget is exhausted or the daily cap is hit.
//
// Failure handling
//   200/202 → completeBatch (submitted, attempts reset).
//   400/403/422 → failBatch(permanent=true) — a malformed URL will never
//                 recover on its own; we mark it failed and stop retrying.
//   429 / 5xx / network → failBatch(permanent=false) — exponential backoff
//                          via seo_indexnow_queue.next_attempt_at.
//
// Concurrency
//   claimBatch marks rows as `processing` in a filter-gated UPDATE that only
//   affects rows still `pending`/`retry`. A second concurrent invocation
//   claiming the same window will simply see zero rows updated for that id
//   and move on.
//
// First-run safety
//   The worker only submits URLs that are already queued. It does NOT scan
//   the sitemap and enqueue everything. `bulk_submission_enabled` is a
//   separate flag reserved for a hypothetical historical backfill script;
//   the worker itself never turns it on.
// ============================================================================

import 'server-only'
import { randomUUID } from 'node:crypto'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as submitter from './submitter.mjs'
import {
  claimBatch, completeBatch, failBatch, recordSubmission,
  loadSettings, submittedInLast24h,
  type IndexnowSettings, type ClaimedRow,
} from './queue'

const {
  CANONICAL_HOST,
  MAX_BATCH_SIZE,
  buildPayload,
  classifyStatus,
  safeLogBody,
} = submitter as {
  CANONICAL_HOST: string
  MAX_BATCH_SIZE: number
  buildPayload: (urls: readonly string[], opts: { key: string; keyLocation: string }) => object
  classifyStatus: (status: number) => string
  safeLogBody: (text: string, key: string) => string
}

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const INDEXNOW_KEY      = process.env.INDEXNOW_KEY || 'a8f92c1d7e4b49d2b7c5e913f4aa8179'
const KEY_LOCATION      = `https://${CANONICAL_HOST}/${INDEXNOW_KEY}.txt`

export type WorkerRunResult = {
  run_id:              string
  started_at:          string
  finished_at:         string
  duration_ms:         number
  status:              'ok' | 'skipped' | 'partial' | 'error'
  reason:              string
  claimed:             number
  batches_attempted:   number
  batches_succeeded:   number
  batches_failed:      number
  urls_submitted:      number
  urls_retry:          number
  urls_failed:         number
  urls_skipped_cap:    number
  daily_cap_before:    number
  daily_cap_used:      number
  settings:            IndexnowSettings
  error?:              string
}

export type WorkerTrigger = 'cron' | 'admin_manual' | 'test'

export type RunWorkerOptions = {
  trigger:        WorkerTrigger
  /** Override the default fetch — used by tests to mock IndexNow responses. */
  fetchImpl?:     typeof fetch
  /** Override the default settings load — used by tests. */
  settings?:      IndexnowSettings
}

export async function runIndexnowWorker(opts: RunWorkerOptions): Promise<WorkerRunResult> {
  const run_id     = randomUUID()
  const startedAt  = Date.now()
  const startedIso = new Date(startedAt).toISOString()

  const settings = opts.settings ?? await loadSettings()

  const baseResult: WorkerRunResult = {
    run_id, started_at: startedIso, finished_at: startedIso, duration_ms: 0,
    status: 'ok', reason: 'noop',
    claimed: 0, batches_attempted: 0, batches_succeeded: 0, batches_failed: 0,
    urls_submitted: 0, urls_retry: 0, urls_failed: 0, urls_skipped_cap: 0,
    daily_cap_before: 0, daily_cap_used: 0,
    settings,
  }

  if (!settings.worker_enabled) {
    return finalise(baseResult, { status: 'skipped', reason: 'worker_disabled', startedAt })
  }

  const alreadySubmittedToday = await submittedInLast24h()
  baseResult.daily_cap_before = alreadySubmittedToday
  const remainingToday = Math.max(0, settings.daily_submission_cap - alreadySubmittedToday)
  if (remainingToday === 0) {
    return finalise(baseResult, { status: 'skipped', reason: 'daily_cap_reached', startedAt })
  }

  const perInvocation = Math.min(settings.per_invocation_url_cap, remainingToday)
  if (perInvocation === 0) {
    return finalise(baseResult, { status: 'skipped', reason: 'per_invocation_cap_zero', startedAt })
  }

  // Claim rows.
  const claimed: ClaimedRow[] = await claimBatch(`worker:${run_id.slice(0, 8)}`, perInvocation)
  baseResult.claimed = claimed.length
  if (claimed.length === 0) {
    return finalise(baseResult, { status: 'ok', reason: 'queue_empty', startedAt })
  }

  const fetchFn = opts.fetchImpl ?? fetch
  const trigger = opts.trigger

  // Batch and submit.
  const chunks = chunk(claimed, MAX_BATCH_SIZE)
  let batchesAttempted = 0, batchesSucceeded = 0, batchesFailed = 0
  let urlsSubmitted = 0, urlsRetry = 0, urlsFailed = 0
  const errors: string[] = []

  for (const c of chunks) {
    const rowIdHashes = c.map(r => ({ id: r.id, content_hash: r.content_hash }))
    if (timeLeft(startedAt, settings.per_invocation_time_budget_ms) <= 500) {
      // Give the remaining claimed rows back so a later run picks them up.
      await failBatch({
        rows: rowIdHashes, httpStatus: null, statusClass: 'skipped',
        error: 'time_budget_exhausted_before_send', permanent: false,
      })
      urlsRetry += rowIdHashes.length
      break
    }

    batchesAttempted++
    const urls = c.map(r => r.url)
    const payload = buildPayload(urls, { key: INDEXNOW_KEY, keyLocation: KEY_LOCATION })
    const batchStart = Date.now()
    let httpStatus: number | null = null
    let bodyText = ''
    let networkErrorMsg: string | undefined
    try {
      const res = await fetchFn(INDEXNOW_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    JSON.stringify(payload),
      })
      httpStatus = res.status
      bodyText = await res.text().catch(() => '')
    } catch (e) {
      networkErrorMsg = e instanceof Error ? e.message : 'unknown network error'
    }
    const durationMs = Date.now() - batchStart
    const statusClass = classifyStatus(httpStatus ?? 0)
    const sample = urls.slice(0, 5)

    // Record the submission — success OR failure.
    await recordSubmission({
      runId:         run_id,
      batchSize:     urls.length,
      httpStatus,
      statusClass,
      attemptNumber: 1,
      durationMs,
      error:         networkErrorMsg ?? (statusClass === 'ok' || statusClass === 'accepted' ? undefined : safeLogBody(bodyText, INDEXNOW_KEY)),
      sampleUrls:    sample,
      trigger,
    })

    if (statusClass === 'ok' || statusClass === 'accepted') {
      batchesSucceeded++
      urlsSubmitted += urls.length
      await completeBatch({
        rows:        rowIdHashes,
        httpStatus,
        statusClass,
      })
    } else {
      batchesFailed++
      const permanent = statusClass === 'bad-request' || statusClass === 'forbidden' || statusClass === 'unprocessable'
      const failResult = await failBatch({
        rows:        rowIdHashes,
        httpStatus,
        statusClass,
        error:       networkErrorMsg ?? safeLogBody(bodyText, INDEXNOW_KEY),
        permanent,
      })
      if (permanent) urlsFailed  += failResult.updated
      else            urlsRetry   += failResult.updated
      if (errors.length < 3) {
        errors.push(`batch(${urls.length} urls) → ${statusClass} (HTTP ${httpStatus ?? 'n/a'})`)
      }
    }
  }

  const finalStatus: WorkerRunResult['status'] =
    batchesFailed === 0 ? 'ok' :
    batchesSucceeded > 0 ? 'partial' :
    'error'

  return finalise({
    ...baseResult,
    batches_attempted: batchesAttempted,
    batches_succeeded: batchesSucceeded,
    batches_failed:    batchesFailed,
    urls_submitted:    urlsSubmitted,
    urls_retry:        urlsRetry,
    urls_failed:       urlsFailed,
    daily_cap_used:    alreadySubmittedToday + urlsSubmitted,
    ...(errors.length ? { error: errors.join(' | ').slice(0, 500) } : {}),
  }, {
    status: finalStatus,
    reason: finalStatus === 'ok' ? 'drained' : 'partial_or_failure',
    startedAt,
  })
}

function finalise(r: WorkerRunResult, opts: { status: WorkerRunResult['status']; reason: string; startedAt: number }): WorkerRunResult {
  const finishedAt = Date.now()
  return {
    ...r,
    status:      opts.status,
    reason:      opts.reason,
    finished_at: new Date(finishedAt).toISOString(),
    duration_ms: finishedAt - opts.startedAt,
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function timeLeft(startedAt: number, budgetMs: number): number {
  return Math.max(0, budgetMs - (Date.now() - startedAt))
}
