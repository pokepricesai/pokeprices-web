// src/lib/indexnow/queue.ts
// ============================================================================
// Persistent DB-backed IndexNow queue (Stage 6A).
//
// Callers use this module to enqueue URL change events. The scheduled worker
// (src/app/api/cron/indexnow-worker/route.ts) reads from the same tables and
// drains them via the existing pure submitter (src/lib/indexnow/submitter.mjs).
//
// Invariants
//   * Every URL that reaches this module MUST be a canonical www URL. The
//     enqueue helpers double-check with validateUrl() from the submitter and
//     silently drop non-canonical / disallowed paths.
//   * Same URL enqueued twice with the same content_hash is a no-op (the
//     upsert bumps last_queued_at but does not create a duplicate row).
//   * Same URL enqueued with a different content_hash resets the row so
//     submission_attempts starts fresh and status returns to 'pending'.
//   * Deletion / canonical-change events are marked with `reason='deleted'`
//     or `reason='canonical_change'` and priority 0.
//   * The worker — not this module — reads seo_indexnow_settings. Callers
//     always try to enqueue; worker decides whether to submit.
// ============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as submitter from './submitter.mjs'
import { urlHash } from './hash'

const { validateUrl } = submitter as {
  validateUrl: (u: string) => { ok: true; url: string } | { ok: false; reason: string; input: unknown }
}

export type PageFamily =
  | 'card' | 'set' | 'pokemon' | 'insight'
  | 'card_show' | 'creator' | 'vendor' | 'static' | 'other'

export type EnqueueReason =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'canonical_change'
  | 'price_change'
  | 'metadata_change'
  | 'manual'
  | 'backfill_historical'

export type Priority = 0 | 1 | 2

export type EnqueueInput = {
  url:           string
  contentHash:   string
  pageFamily:    PageFamily
  entityId?:     string | null
  priority:      Priority
  reason:        EnqueueReason
}

export type EnqueueResult =
  | { ok: true;  action: 'inserted' | 'updated' | 'unchanged'; queueId?: number }
  | { ok: false; reason: 'invalid_url' | 'disallowed_path' | 'db_error'; detail?: string }

/** Enqueue one URL. Idempotent on (url, content_hash) pairs. */
export async function enqueueUrl(input: EnqueueInput, client?: SupabaseClient): Promise<EnqueueResult> {
  const v = validateUrl(input.url)
  if (v.ok !== true) {
    const failure = v as { ok: false; reason: string; input: unknown }
    const reason = failure.reason === 'rejected-path' ? 'disallowed_path' as const : 'invalid_url' as const
    return { ok: false, reason, detail: failure.reason }
  }
  const canonical = (v as { ok: true; url: string }).url
  const supa = client ?? getSupabaseServiceClient()

  // Read whatever row currently exists so we can decide insert/update/no-op.
  const { data: existing, error: readErr } = await supa
    .from('seo_indexnow_queue')
    .select('id, content_hash, status')
    .eq('url', canonical)
    .maybeSingle()

  if (readErr) return { ok: false, reason: 'db_error', detail: readErr.message }

  const now = new Date().toISOString()

  if (!existing) {
    const { data, error } = await supa
      .from('seo_indexnow_queue')
      .insert({
        url:                 canonical,
        url_hash:            urlHash(canonical),
        content_hash:        input.contentHash,
        page_family:         input.pageFamily,
        entity_id:           input.entityId ?? null,
        priority:            input.priority,
        reason:              input.reason,
        status:              'pending',
        first_queued_at:     now,
        last_queued_at:      now,
        next_attempt_at:     now,
        submission_attempts: 0,
      })
      .select('id')
      .single()
    if (error) return { ok: false, reason: 'db_error', detail: error.message }
    return { ok: true, action: 'inserted', queueId: (data as { id: number } | null)?.id }
  }

  // Same hash → just bump last_queued_at so we can see it "was re-observed"
  // in the health view; do not reset attempts or status.
  if (existing.content_hash === input.contentHash) {
    const { error } = await supa
      .from('seo_indexnow_queue')
      .update({ last_queued_at: now, updated_at: now })
      .eq('id', existing.id)
    if (error) return { ok: false, reason: 'db_error', detail: error.message }
    return { ok: true, action: 'unchanged', queueId: existing.id }
  }

  // Different hash → real content change. Reset for a new submission cycle.
  const { error } = await supa
    .from('seo_indexnow_queue')
    .update({
      content_hash:        input.contentHash,
      page_family:         input.pageFamily,
      entity_id:           input.entityId ?? null,
      priority:            input.priority,
      reason:              input.reason,
      status:              'pending',
      last_queued_at:      now,
      submission_attempts: 0,
      next_attempt_at:     now,
      last_error:          null,
      claimed_at:          null,
      claimed_by:          null,
      updated_at:          now,
    })
    .eq('id', existing.id)
  if (error) return { ok: false, reason: 'db_error', detail: error.message }
  return { ok: true, action: 'updated', queueId: existing.id }
}

export type EnqueueBatchResult = {
  attempted:    number
  inserted:     number
  updated:      number
  unchanged:    number
  invalid:      number
  disallowed:   number
  db_errors:    number
  firstError?:  string
}

/** Enqueue many URLs sequentially. Callers are expected to be scripts /
 *  cron jobs — this is not for hot request paths. */
export async function enqueueBatch(inputs: EnqueueInput[], client?: SupabaseClient): Promise<EnqueueBatchResult> {
  const result: EnqueueBatchResult = {
    attempted: 0, inserted: 0, updated: 0, unchanged: 0,
    invalid: 0, disallowed: 0, db_errors: 0,
  }
  for (const input of inputs) {
    result.attempted++
    const r = await enqueueUrl(input, client)
    if (r.ok === true) {
      const success = r as Extract<EnqueueResult, { ok: true }>
      if (success.action === 'inserted')  result.inserted++
      if (success.action === 'updated')   result.updated++
      if (success.action === 'unchanged') result.unchanged++
    } else {
      const failure = r as Extract<EnqueueResult, { ok: false }>
      if (failure.reason === 'invalid_url')     result.invalid++
      if (failure.reason === 'disallowed_path') result.disallowed++
      if (failure.reason === 'db_error') {
        result.db_errors++
        if (!result.firstError) result.firstError = failure.detail
      }
    }
  }
  return result
}

// ── Worker-side helpers ────────────────────────────────────────────────────
//
// These live here so the queue's read/write semantics are all in one file.
// Worker composition (fetch → submit → record) lives in worker.ts.

export type ClaimedRow = {
  id:           number
  url:          string
  content_hash: string
  page_family:  string
  priority:     number
  reason:       string
  attempts:     number
}

/**
 * Atomically claim up to `limit` rows for a single worker invocation.
 *
 * Uses a Postgres UPDATE ... RETURNING against a scoped id-set so two
 * concurrent workers cannot claim the same row. `claimed_by` records the
 * caller id so operators can spot a hung claim.
 */
export async function claimBatch(
  workerId: string,
  limit: number,
  client?: SupabaseClient,
): Promise<ClaimedRow[]> {
  const supa = client ?? getSupabaseServiceClient()
  const nowIso = new Date().toISOString()

  // Two-step atomic claim: SELECT ... FOR UPDATE SKIP LOCKED semantics
  // aren't directly available via PostgREST, so we approximate with a
  // narrow SELECT followed by an UPDATE gated on (id, status) so only
  // one worker wins each row.
  const { data: candidates, error: selErr } = await supa
    .from('seo_indexnow_queue')
    .select('id')
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', nowIso)
    .order('priority', { ascending: true })
    .order('next_attempt_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)

  if (selErr || !candidates || candidates.length === 0) return []

  const ids = (candidates as Array<{ id: number }>).map(r => r.id)

  const { data: claimed, error: updErr } = await supa
    .from('seo_indexnow_queue')
    .update({
      status:     'processing',
      claimed_at: nowIso,
      claimed_by: workerId,
      updated_at: nowIso,
    })
    .in('id', ids)
    .in('status', ['pending', 'retry'])
    .lte('next_attempt_at', nowIso)
    .select('id, url, content_hash, page_family, priority, reason, submission_attempts')

  if (updErr || !claimed) return []

  // Postgres UPDATE ... RETURNING does not guarantee input order. We
  // re-sort by (priority, id) so the caller always sees the most-urgent
  // rows first, matching the SELECT ordering above.
  const rows = (claimed as Array<{
    id: number; url: string; content_hash: string; page_family: string;
    priority: number; reason: string; submission_attempts: number;
  }>).slice().sort((a, b) => a.priority - b.priority || a.id - b.id)

  return rows.map(r => ({
    id:           r.id,
    url:          r.url,
    content_hash: r.content_hash,
    page_family:  r.page_family,
    priority:     r.priority,
    reason:       r.reason,
    attempts:     r.submission_attempts,
  }))
}

export type CompleteInput = {
  /** Each item carries the id AND the content_hash that was submitted, so
   *  we can compare-and-swap: if the row's content_hash has changed since
   *  the claim, another enqueueUrl() bumped it in-flight and we must NOT
   *  mark it submitted — the newer hash still needs to go out on the next
   *  worker tick. */
  rows:        Array<{ id: number; content_hash: string }>
  httpStatus:  number | null
  statusClass: string
}

/** Mark URLs as submitted after a successful (200/202) IndexNow response.
 *  Skips any row whose content_hash was overwritten between claim and now. */
export async function completeBatch(input: CompleteInput, client?: SupabaseClient): Promise<{ updated: number; stale: number }> {
  const supa = client ?? getSupabaseServiceClient()
  const now = new Date().toISOString()
  let updated = 0
  let stale = 0
  for (const r of input.rows) {
    const { data, error } = await supa
      .from('seo_indexnow_queue')
      .update({
        status:              'submitted',
        last_submitted_at:   now,
        last_http_status:    input.httpStatus,
        last_error:          null,
        submission_attempts: 0,
        claimed_at:          null,
        claimed_by:          null,
        updated_at:          now,
      })
      .eq('id', r.id)
      .eq('content_hash', r.content_hash)
      .select('id')
    if (error) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = data as any[] | null
    if (rows && rows.length > 0) updated++
    else                          stale++
  }
  return { updated, stale }
}

export type FailInput = {
  /** Same CAS contract as completeBatch: only mutate the row if the
   *  content_hash still matches the one we just tried to submit. */
  rows:        Array<{ id: number; content_hash: string }>
  httpStatus:  number | null
  statusClass: string
  error?:      string
  permanent:   boolean
}

/** Mark URLs as retry or failed after a non-success IndexNow response.
 *  Skips any row whose content_hash was overwritten between claim and now. */
export async function failBatch(input: FailInput, client?: SupabaseClient): Promise<{ updated: number; stale: number }> {
  const supa = client ?? getSupabaseServiceClient()
  const now = new Date()
  let updated = 0
  let stale   = 0
  for (const r of input.rows) {
    // Read current attempts (still gated by hash CAS on the update below).
    const { data: existing } = await supa
      .from('seo_indexnow_queue')
      .select('submission_attempts, content_hash')
      .eq('id', r.id)
      .maybeSingle()
    if (!existing) { stale++; continue }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ex = existing as any
    if (ex.content_hash !== r.content_hash) { stale++; continue }

    const nextAttempts = (ex.submission_attempts ?? 0) + 1
    const shouldFail = input.permanent || nextAttempts >= 6
    const backoffMs = backoffFor(nextAttempts)
    const nextAt = new Date(now.getTime() + backoffMs).toISOString()
    const { data, error } = await supa
      .from('seo_indexnow_queue')
      .update({
        status:              shouldFail ? 'failed' : 'retry',
        submission_attempts: nextAttempts,
        next_attempt_at:     shouldFail ? now.toISOString() : nextAt,
        last_http_status:    input.httpStatus,
        last_error:          input.error?.slice(0, 500) ?? null,
        claimed_at:          null,
        claimed_by:          null,
        updated_at:          now.toISOString(),
      })
      .eq('id', r.id)
      .eq('content_hash', r.content_hash)
      .select('id')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = data as any[] | null
    if (!error && rows && rows.length > 0) updated++
    else                                   stale++
  }
  return { updated, stale }
}

function backoffFor(attempt: number): number {
  // Exponential: 1min, 5min, 15min, 1h, 3h, then cap.
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000]
  const idx = Math.max(0, Math.min(schedule.length - 1, attempt - 1))
  return schedule[idx]
}


// ── Submission audit ───────────────────────────────────────────────────────
export type RecordSubmissionInput = {
  runId:         string
  batchSize:     number
  httpStatus:    number | null
  statusClass:   string
  attemptNumber: number
  durationMs:    number | null
  error?:        string
  sampleUrls:    string[]
  trigger:       'cron' | 'admin_manual' | 'test'
}

export async function recordSubmission(input: RecordSubmissionInput, client?: SupabaseClient): Promise<void> {
  const supa = client ?? getSupabaseServiceClient()
  await supa.from('seo_indexnow_submissions').insert({
    run_id:         input.runId,
    submitted_at:   new Date().toISOString(),
    batch_size:     input.batchSize,
    http_status:    input.httpStatus,
    status_class:   input.statusClass,
    attempt_number: input.attemptNumber,
    duration_ms:    input.durationMs,
    error:          input.error?.slice(0, 500) ?? null,
    sample_urls:    input.sampleUrls.slice(0, 5),
    trigger:        input.trigger,
  })
}

// ── Settings ────────────────────────────────────────────────────────────────
export type IndexnowSettings = {
  worker_enabled:                boolean
  bulk_submission_enabled:       boolean
  daily_submission_cap:          number
  per_invocation_url_cap:        number
  per_invocation_time_budget_ms: number
  /** Harvester (queue producer) toggles — separate from the worker so we
   *  can build the queue even while the worker is paused. */
  harvester_enabled:             boolean
  harvester_events_per_run:      number
  harvester_enqueue_aggregates:  boolean
}

// First-deploy safe defaults. Migration 02 seeds the same values in the
// DB — this is what we fall back to if the settings row is missing.
const DEFAULTS: IndexnowSettings = {
  worker_enabled:                false,   // ← flipped after operator verifies queue producers
  bulk_submission_enabled:       false,
  daily_submission_cap:          15000,   // ~1.5× measured p95
  per_invocation_url_cap:        750,
  per_invocation_time_budget_ms: 55_000,
  harvester_enabled:             true,
  harvester_events_per_run:      2000,
  harvester_enqueue_aggregates:  true,
}

export async function loadSettings(client?: SupabaseClient): Promise<IndexnowSettings> {
  const supa = client ?? getSupabaseServiceClient()
  const { data, error } = await supa
    .from('seo_indexnow_settings')
    .select('key, value')
  if (error || !data) return { ...DEFAULTS }
  const out = { ...DEFAULTS }
  for (const row of data as Array<{ key: string; value: unknown }>) {
    switch (row.key) {
      case 'worker_enabled':                out.worker_enabled = Boolean(row.value); break
      case 'bulk_submission_enabled':       out.bulk_submission_enabled = Boolean(row.value); break
      case 'daily_submission_cap':          out.daily_submission_cap = Number(row.value); break
      case 'per_invocation_url_cap':        out.per_invocation_url_cap = Number(row.value); break
      case 'per_invocation_time_budget_ms': out.per_invocation_time_budget_ms = Number(row.value); break
      case 'harvester_enabled':             out.harvester_enabled = Boolean(row.value); break
      case 'harvester_events_per_run':      out.harvester_events_per_run = Number(row.value); break
      case 'harvester_enqueue_aggregates':  out.harvester_enqueue_aggregates = Boolean(row.value); break
    }
  }
  return out
}

/** How many URLs have been submitted (accepted/OK batches only) in the
 *  last 24 h. Used by the worker to enforce daily_submission_cap. */
export async function submittedInLast24h(client?: SupabaseClient): Promise<number> {
  const supa = client ?? getSupabaseServiceClient()
  const sinceIso = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { data, error } = await supa
    .from('seo_indexnow_submissions')
    .select('batch_size, status_class')
    .gte('submitted_at', sinceIso)
    .in('status_class', ['ok', 'accepted'])
  if (error || !data) return 0
  return (data as { batch_size: number }[]).reduce((s, r) => s + (r.batch_size ?? 0), 0)
}
