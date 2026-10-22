// src/app/api/cron/pp-tcg-migration-tick/route.ts
//
// PP-TCG automated full-catalogue migration — cron tick handler.
//
// Authentication: Authorization: Bearer <CRON_SECRET>. Verified with
// constant-time comparison. Rejects anything else with 401. Does NOT
// trust `x-vercel-cron` header (spoofable).
//
// Fires every 10 min (default; configured in vercel.json). On each
// tick, for each run with status='running':
//   1. Check daily cap + consecutive-failure threshold + run status.
//      If any gate is tripped, update status='paused' and exit.
//   2. Atomically claim up to batch_size items via DB function (SKIP
//      LOCKED). Lease = 240 s by default.
//   3. For each claimed item, run the per-item state machine:
//        strict re-check → cohort flip → revalidate → poll verify.
//      If verify fails, cohort rollback + poll legacy returned.
//      Mark item status terminal. Idempotent on reclaim.
//   4. After the batch, re-count consecutive failures; if ≥ threshold,
//      auto-pause the run.
//
// Idempotency: all mutations are safe to re-run. A reclaimed item
// resumes from its recorded state (activated_at persisted).
//
// Does NOT auto-start any run. Deploys with every run in draft/paused.

import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { claimBatch } from '@/lib/providerData/migration/claim'
import { processWorkItem } from '@/lib/providerData/migration/workItem'
import { runMetrics } from '@/lib/providerData/migration/metrics'
import type { MigrationRun, MigrationRunConfig } from '@/lib/providerData/migration/types'
import { DEFAULT_CONFIG } from '@/lib/providerData/migration/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300  // 5-card batches worst-case fit well inside this.

export async function GET(req: Request) {
  // ── 1. Auth: Authorization: Bearer $CRON_SECRET (constant-time check).
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const sb = getSupabaseServiceClient()
  const workerId = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const started_at = Date.now()
  const summary: Array<{ run_id: string; name: string; action: string; detail?: unknown }> = []

  // ── 2. Fetch runs with status='running'
  const { data: runs, error: runsErr } = await sb.from('pp_tcg_migration_run')
    .select('*').eq('status', 'running').order('started_at', { nullsFirst: false, ascending: true })
  if (runsErr) {
    return NextResponse.json({ ok: false, error: `runs read: ${runsErr.message}` }, { status: 500 })
  }
  if (!runs || runs.length === 0) {
    return NextResponse.json({ ok: true, worker_id: workerId, runs_active: 0, elapsed_ms: Date.now() - started_at })
  }

  for (const runRow of runs as MigrationRun[]) {
    const cfg: MigrationRunConfig = { ...DEFAULT_CONFIG, ...(runRow.config ?? {}) }
    const metrics = await runMetrics(sb, runRow.id)

    // ── 3a. Daily cap check
    if (metrics.throughput.today >= (cfg.daily_cap ?? DEFAULT_CONFIG.daily_cap)) {
      summary.push({ run_id: runRow.id, name: runRow.name, action: 'skip_daily_cap_met', detail: { today: metrics.throughput.today, cap: cfg.daily_cap } })
      continue
    }

    // ── 3b. Consecutive-failure auto-pause
    if (metrics.consecutive_failures >= (cfg.max_consecutive_failures ?? DEFAULT_CONFIG.max_consecutive_failures)) {
      await sb.from('pp_tcg_migration_run').update({
        status: 'paused',
        pause_reason: `auto-paused: ${metrics.consecutive_failures} consecutive failures`,
        updated_at: new Date().toISOString(),
      }).eq('id', runRow.id)
      summary.push({ run_id: runRow.id, name: runRow.name, action: 'auto_paused_consecutive_failures', detail: { consecutive_failures: metrics.consecutive_failures } })
      continue
    }

    // ── 3c. Failure-rate window auto-pause
    if (metrics.recent_failure_pct > (cfg.max_failure_pct_window ?? DEFAULT_CONFIG.max_failure_pct_window)) {
      await sb.from('pp_tcg_migration_run').update({
        status: 'paused',
        pause_reason: `auto-paused: ${metrics.recent_failure_pct}% failure rate in last 100 items`,
        updated_at: new Date().toISOString(),
      }).eq('id', runRow.id)
      summary.push({ run_id: runRow.id, name: runRow.name, action: 'auto_paused_failure_rate', detail: { pct: metrics.recent_failure_pct } })
      continue
    }

    // ── 4. Pick next batch, respecting what's left of today's cap
    const remaining_today = (cfg.daily_cap ?? DEFAULT_CONFIG.daily_cap) - metrics.throughput.today
    const effective_batch = Math.max(0, Math.min(cfg.batch_size ?? DEFAULT_CONFIG.batch_size, remaining_today))
    if (effective_batch === 0) {
      summary.push({ run_id: runRow.id, name: runRow.name, action: 'skip_cap_near_zero' })
      continue
    }

    let claimed
    try {
      claimed = await claimBatch(sb, {
        runId: runRow.id,
        batchSize: effective_batch,
        workerId,
        leaseDurationSec: cfg.lease_duration_sec ?? DEFAULT_CONFIG.lease_duration_sec,
      })
    } catch (e) {
      summary.push({ run_id: runRow.id, name: runRow.name, action: 'claim_error', detail: { error: (e as Error).message } })
      continue
    }

    if (claimed.length === 0) {
      // All items terminal? Mark run completed.
      const { count: pendingLeft } = await sb.from('pp_tcg_migration_run_item')
        .select('*', { count: 'exact', head: true }).eq('run_id', runRow.id).in('status', ['pending', 'claimed'])
      if ((pendingLeft ?? 0) === 0) {
        await sb.from('pp_tcg_migration_run').update({
          status: 'completed', stopped_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq('id', runRow.id)
        summary.push({ run_id: runRow.id, name: runRow.name, action: 'completed' })
      } else {
        summary.push({ run_id: runRow.id, name: runRow.name, action: 'no_items_claimed_but_pending_exist', detail: { pendingLeft } })
      }
      continue
    }

    // ── 5. Process each item sequentially within this tick.
    const results: Array<{ slug: string; terminal: string; activation_ms: number; error?: string }> = []
    for (const item of claimed) {
      // Budget guard: if we've burned 240s already, stop and leave remaining
      // items in `claimed` state — the next tick will re-claim them when
      // their lease expires.
      if (Date.now() - started_at > 240_000) break
      try {
        const r = await processWorkItem(sb, item, cfg)
        results.push({ slug: r.slug, terminal: r.terminal, activation_ms: r.activation_ms, error: r.error })
      } catch (e) {
        results.push({ slug: item.pp_card_slug, terminal: 'exception', activation_ms: 0, error: (e as Error).message })
        // Don't mark the item — let lease expire so next tick re-attempts.
      }
    }

    summary.push({
      run_id: runRow.id, name: runRow.name, action: 'processed_batch',
      detail: {
        claimed: claimed.length, processed: results.length, results,
        elapsed_ms_total: Date.now() - started_at,
      },
    })
  }

  return NextResponse.json({
    ok: true,
    worker_id: workerId,
    runs_active: runs.length,
    elapsed_ms: Date.now() - started_at,
    summary,
  })
}
