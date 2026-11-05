// src/app/api/cron/indexnow-harvest/route.ts
// ============================================================================
// Stage 6A — IndexNow queue producer cron.
//
// Runs every 5 minutes via Vercel Cron (see vercel.json). Reads unprocessed
// rows from seo_change_events (populated by the DB triggers in migration
// 02), joins to source tables, hashes user-visible content, and calls the
// queue's enqueueUrl(). The queue's own hash-dedupe ensures no-op refreshes.
//
// This route does NOT submit to IndexNow — that is the worker's job.
//
// Auth:  Bearer $CRON_SECRET.
// Runtime: nodejs. maxDuration=300.
//
// CN-06.02 (2026-11-04): raised from 60 → 300 after Vercel runtime
// logs showed roughly half of the 5-min-schedule invocations hitting
// the 60s cap (`Vercel Runtime Timeout Error: Task timed out after
// 60 seconds`) on the pokeprices-web production deployment. The
// default `eventsPerRun=2000` + per-event source-table joins plus
// per-card `enqueueUrl` round-trips simply does not fit in 60s under
// realistic queue depth. 300s matches Vercel Pro's new default
// function timeout and still leaves a wide margin before the next
// 5-min cron fire. Vercel bills by active CPU time, not wall-clock,
// so this does not 5× the function cost; it only removes a false
// timeout ceiling.
//
// Secondary safeguard: EVENTS_PER_RUN_CEILING caps the effective
// batch size regardless of the settings row. Operators can still
// tune LOWER via settings.harvester_events_per_run (useful on a
// backlog-light day); the ceiling only prevents a misconfigured
// settings row from blowing past the 300s budget.
//
// CN-06.02 follow-up (2026-11-04): ceiling lowered from 1000 → 500.
// The first post-deploy run with ceiling=1000 completed 1,000 events
// in 294s — essentially at the 300s wall-time cap. The subsequent
// run timed out at 300s before reaching the mark-processed step,
// yielding ~50% success rate. Per-event cost under the current
// backlog is ~300ms (source-table joins + enqueueUrl round-trip);
// 500 events × 300ms ≈ 150s, leaving ~50% headroom under the 300s
// cap. Projected throughput at full success: 500 × 288 runs/day =
// 144,000 events/day — ~13 days to drain the 1.86M-event backlog
// assuming no new arrivals and adequate downstream capacity.
//
// The harvester is already idempotent (hash-dedup on enqueueUrl +
// bulk mark-processed at the end), so a partial run — if ever still
// hits the ceiling — simply leaves unprocessed events for the next
// 5-min fire; no duplication, no data loss.
//
// Why not a per-stage AbortController timer? The underlying
// supabase-js v2 queries do not reliably honour AbortSignal across
// PostgREST chunk boundaries, so a timer would not actually cancel
// an in-flight query. Capping the input batch size is the only
// reliable work bound at the route layer without rewriting the
// harvester's queue architecture.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { runIndexnowHarvester } from '@/lib/indexnow/harvester'
import { loadSettings } from '@/lib/indexnow/queue'

export const runtime      = 'nodejs'
export const dynamic      = 'force-dynamic'
export const maxDuration  = 300

/** Hard upper bound on events pulled per run. Independent of
 *  settings.harvester_events_per_run — the ceiling only prevents
 *  a settings misconfiguration from bursting past the 300s budget.
 *  Operator can tune LOWER via settings.
 *
 *  Lowered 1000 → 500 on 2026-11-04 after production telemetry
 *  showed 1000 events landing at 294s (first fire) and a 300s
 *  timeout (second fire). See file header for details. */
export const EVENTS_PER_RUN_CEILING = 500

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const settings = await loadSettings()
  // The harvester obeys a separate flag from the worker: producing queue
  // rows is safe even when the worker is disabled, because the queue's
  // job is exactly to buffer submissions until the worker is enabled.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const harvesterEnabled = (settings as any).harvester_enabled ?? true
  if (!harvesterEnabled) {
    return NextResponse.json({ status: 'skipped', reason: 'harvester_disabled' })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requested = Number((settings as any).harvester_events_per_run ?? 2000)
  const eventsPerRun = Math.max(1, Math.min(requested, EVENTS_PER_RUN_CEILING))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enqueueAggregates = ((settings as any).harvester_enqueue_aggregates ?? true) as boolean

  const trigger = req.method === 'GET' ? 'cron' : 'admin_manual'
  const t0 = Date.now()
  const result = await runIndexnowHarvester({ trigger, eventsPerRun, enqueueAggregates })
  const elapsedMs = Date.now() - t0
  // Observability: single structured log per invocation. Operators
  // can grep Vercel runtime logs to see the per-run distribution.
  console.log('[indexnow-harvest]', JSON.stringify({
    trigger,
    status: result.status,
    reason: result.reason,
    events_read: result.events_read,
    events_marked_processed: result.events_marked_processed,
    requested_events_per_run: requested,
    effective_events_per_run: eventsPerRun,
    capped_by_ceiling: requested > EVENTS_PER_RUN_CEILING,
    elapsed_ms: elapsedMs,
    errors_count: (result as { errors?: unknown[] }).errors?.length ?? 0,
  }))
  const httpStatus = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status: httpStatus })
}

export async function GET  (req: Request) { return handle(req) }
export async function POST (req: Request) { return handle(req) }
