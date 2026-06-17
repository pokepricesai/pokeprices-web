// src/lib/email/onboardingProcessor.ts
// Block 3D — single internal entry point for the onboarding
// processor with built-in run-log persistence + status resolution.
//
// Public function:
//
//   runProcessor({ source, limit }): Promise<RunResult>
//
// Lifecycle:
//   1. If onboarding is disabled, write a `disabled` run row with zero
//      counts and short-circuit.
//   2. Otherwise insert a `running` run row, recording the source.
//   3. Call processOnboardingBatch (Block 3B). Catch any throw.
//   4. Resolve status:
//        running           (never returned externally — intermediate)
//        success           failed_count === 0 AND retried_count === 0
//        partial           failed_count > 0  OR retried_count > 0
//        failed            the batch threw
//        disabled          feature flag off
//   5. Update the run row with completed_at, duration_ms, counts,
//      error_code, and the resolved status.
//   6. Emit a structured `[onboarding:run]` log line carrying run_id,
//      source, status, counts and duration_ms. No PII.
//
// The route handlers (cron + manual) never write to the run-log
// table directly — every path goes through this wrapper.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { processOnboardingBatch, isOnboardingEnabled, type ProcessSummary } from './onboarding'

export type RunSource = 'cron' | 'manual'
export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'disabled'

export type RunResult = ProcessSummary & {
  runId:  string | null
  status: RunStatus
}

const HARD_BATCH_CAP = 25

function clampLimit(limit: number | undefined): number | undefined {
  if (limit == null) return undefined
  if (!Number.isFinite(limit) || limit <= 0) return undefined
  return Math.min(Math.floor(limit), HARD_BATCH_CAP)
}

function logStructured(line: Record<string, unknown>): void {
  // Single JSON-encoded log line per run. Never contains email, user
  // id, recipient or any secret.
  console.info('[onboarding:run]', JSON.stringify(line))
}

export async function runProcessor(input: { source: RunSource; limit?: number }): Promise<RunResult> {
  const supa = getSupabaseServiceClient()
  const startedAt    = new Date()
  const startedAtIso = startedAt.toISOString()
  const limit        = clampLimit(input.limit)

  // ── Disabled short-circuit ──
  if (!isOnboardingEnabled()) {
    const insert = await supa
      .from('email_onboarding_runs')
      .insert({
        source:          input.source,
        started_at:      startedAtIso,
        completed_at:    startedAtIso,
        status:          'disabled',
        processed_count: 0,
        sent_count:      0,
        skipped_count:   0,
        retried_count:   0,
        cancelled_count: 0,
        failed_count:    0,
        duration_ms:     0,
      })
      .select('id')
      .maybeSingle()
    const runId = (insert.data as { id?: string } | null)?.id ?? null
    logStructured({
      run_id: runId, source: input.source, status: 'disabled',
      processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0,
      duration_ms: 0,
    })
    return {
      runId, status: 'disabled',
      processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0,
      disabled: true,
    }
  }

  // ── Insert a 'running' row (best-effort; the run continues either way) ──
  let runId: string | null = null
  try {
    const r = await supa
      .from('email_onboarding_runs')
      .insert({
        source:     input.source,
        started_at: startedAtIso,
        status:     'running',
      })
      .select('id')
      .maybeSingle()
    if (!r.error && r.data) runId = (r.data as { id: string }).id
    else if (r.error) console.error('[onboarding:run] insert failed:', r.error.code)
  } catch (e) {
    console.error('[onboarding:run] insert threw:', e instanceof Error ? e.message : 'unknown')
  }

  // ── Run the batch ──
  let summary: ProcessSummary = { processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false }
  let threwError = false
  let errorCode: string | null = null
  try {
    summary = await processOnboardingBatch({ limit })
  } catch (e) {
    threwError = true
    errorCode = e instanceof Error ? (e.name || 'unknown_error') : 'unknown_error'
    console.error('[onboarding:run] batch threw:',
      e instanceof Error ? `${e.name}: ${e.message}` : 'non-Error throw')
  }

  // ── Resolve status ──
  const completedAt = new Date()
  const durationMs  = completedAt.getTime() - startedAt.getTime()
  let status: RunStatus
  if (threwError)                                                status = 'failed'
  else if (summary.disabled)                                     status = 'disabled'
  else if (summary.failed > 0 || summary.retried > 0)            status = 'partial'
  else                                                            status = 'success'

  // ── Update the run row ──
  if (runId) {
    await supa
      .from('email_onboarding_runs')
      .update({
        completed_at:    completedAt.toISOString(),
        status,
        processed_count: summary.processed,
        sent_count:      summary.sent,
        skipped_count:   summary.skipped,
        retried_count:   summary.retried,
        cancelled_count: summary.cancelled,
        failed_count:    summary.failed,
        duration_ms:     durationMs,
        error_code:      errorCode,
      })
      .eq('id', runId)
  }

  logStructured({
    run_id: runId, source: input.source, status,
    processed:  summary.processed, sent:      summary.sent,
    skipped:    summary.skipped,   retried:   summary.retried,
    cancelled:  summary.cancelled, failed:    summary.failed,
    duration_ms: durationMs,
    error_code:  errorCode,
  })

  return { runId, status, ...summary }
}
