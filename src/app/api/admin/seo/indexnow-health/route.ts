// src/app/api/admin/seo/indexnow-health/route.ts
// ============================================================================
// Stage 6A — IndexNow observability for the SEO Mission Control admin.
//
// GET /api/admin/seo/indexnow-health
//   Returns a compact health snapshot Mission Control's Data Health panel
//   can render:
//     * queue depth by status + page family
//     * submissions in last 24h / 7d (attempted, succeeded, failed)
//     * oldest pending row age
//     * last successful submission
//     * last worker run (row from seo_indexnow_submissions or null)
//     * feature-flag settings from seo_indexnow_settings
//     * last Bing ingest run (row from seo_bq_ingest_runs where source='bing')
//     * last Google ingest run (for symmetry)
//
// Auth: requireAdmin. Same pattern as every other /api/admin/seo/* route.
// No secrets leave the server. No IndexNow HTTP calls are made.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { loadSettings, submittedInLast24h } from '@/lib/indexnow/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StatusFamilyRow = { status: string; page_family: string }

async function queueDepth(supa: ReturnType<typeof getSupabaseServiceClient>) {
  const { data } = await supa
    .from('seo_indexnow_queue')
    .select('status, page_family')
    .limit(100_000)   // hard cap for the health check; the queue should
                      // never approach this size in practice.
  const rows = (data ?? []) as StatusFamilyRow[]
  const byStatus:  Record<string, number> = {}
  const byFamily:  Record<string, number> = {}
  const byStatusFamily: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    byFamily[r.page_family] = (byFamily[r.page_family] ?? 0) + 1
    if (!byStatusFamily[r.status]) byStatusFamily[r.status] = {}
    byStatusFamily[r.status][r.page_family] = (byStatusFamily[r.status][r.page_family] ?? 0) + 1
  }
  return { total: rows.length, byStatus, byFamily, byStatusFamily }
}

async function oldestPending(supa: ReturnType<typeof getSupabaseServiceClient>) {
  const { data } = await supa
    .from('seo_indexnow_queue')
    .select('id, url, first_queued_at, priority')
    .in('status', ['pending', 'retry'])
    .order('first_queued_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const ageMs = Date.now() - new Date((data as { first_queued_at: string }).first_queued_at).getTime()
  return {
    id:              (data as { id: number }).id,
    url:             (data as { url: string }).url,
    first_queued_at: (data as { first_queued_at: string }).first_queued_at,
    priority:        (data as { priority: number }).priority,
    age_hours:       Math.round(ageMs / 3_600_000 * 10) / 10,
  }
}

async function submissionSummary(supa: ReturnType<typeof getSupabaseServiceClient>, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString()
  const { data } = await supa
    .from('seo_indexnow_submissions')
    .select('batch_size, status_class, http_status, submitted_at, trigger')
    .gte('submitted_at', since)
    .order('submitted_at', { ascending: false })
    .limit(2000)
  const rows = (data ?? []) as Array<{ batch_size: number; status_class: string; http_status: number | null; submitted_at: string; trigger: string }>
  const succeeded = rows.filter(r => r.status_class === 'ok' || r.status_class === 'accepted')
  const failed    = rows.filter(r => r.status_class !== 'ok' && r.status_class !== 'accepted' && r.status_class !== 'skipped')
  return {
    window_hours:        windowHours,
    batches_recorded:    rows.length,
    batches_succeeded:   succeeded.length,
    batches_failed:      failed.length,
    urls_submitted:      succeeded.reduce((s, r) => s + (r.batch_size ?? 0), 0),
    urls_in_failed:      failed.reduce((s, r) => s + (r.batch_size ?? 0), 0),
    last_submission_at:  rows[0]?.submitted_at ?? null,
    last_success_at:     succeeded[0]?.submitted_at ?? null,
    last_failure_at:     failed[0]?.submitted_at ?? null,
    status_class_counts: rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status_class] = (acc[r.status_class] ?? 0) + 1
      return acc
    }, {}),
  }
}

async function lastIngestRun(supa: ReturnType<typeof getSupabaseServiceClient>, source: 'bing' | 'google') {
  const { data } = await supa
    .from('seo_bq_ingest_runs')
    .select('run_id, job_kind, status, started_at, ended_at, rows_ingested, error')
    .eq('site_key', 'pokeprices')
    .eq('source', source)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function enqueueRate24h(supa: ReturnType<typeof getSupabaseServiceClient>) {
  // Enqueues in the last 24 h. We count seo_change_events rather than
  // hitting seo_indexnow_queue directly (which has UNIQUE(url) and would
  // undercount re-observed URLs).
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const { data } = await supa
    .from('seo_change_events')
    .select('event_source')
    .gte('observed_at', since)
  return { rows: ((data ?? []) as unknown[]).length }
}

async function unprocessedEvents(supa: ReturnType<typeof getSupabaseServiceClient>) {
  const { data: oldest } = await supa
    .from('seo_change_events')
    .select('id, event_source, entity_key, observed_at')
    .is('processed_at', null)
    .order('observed_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  // Rough count via head:false + limit(0) isn't available; approximate with limit(2000).
  const { data: recent } = await supa
    .from('seo_change_events')
    .select('id')
    .is('processed_at', null)
    .limit(2000)
  const count = ((recent ?? []) as unknown[]).length
  return {
    unprocessed_count_at_least: count,
    unprocessed_saturated:      count >= 2000,
    oldest_unprocessed:         oldest ?? null,
  }
}

async function handle(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const supa = getSupabaseServiceClient()

  const [
    settings, depth, oldest, submitted24h, last24h, last7d,
    bingRun, googleRun, enqueue24h, events,
  ] = await Promise.all([
    loadSettings(supa),
    queueDepth(supa),
    oldestPending(supa),
    submittedInLast24h(supa),
    submissionSummary(supa, 24),
    submissionSummary(supa, 24 * 7),
    lastIngestRun(supa, 'bing'),
    lastIngestRun(supa, 'google'),
    enqueueRate24h(supa),
    unprocessedEvents(supa),
  ])

  const bingStale = bingRun
    ? (Date.now() - new Date((bingRun as { started_at: string }).started_at).getTime()) > 48 * 3_600_000
    : true
  const bingFailing = bingRun ? (bingRun as { status: string }).status === 'error' : false

  // Backlog + drain-rate summary.
  //
  // - enqueue_rate_per_hour  ~ observed change events / 24
  // - drain_rate_per_hour    ~ URLs submitted (ok) / 24
  // - net_growth_per_hour    = enqueue - drain
  // - hours_to_drain_backlog = pending / drain_rate  (null if drain=0)
  //
  // A sustained "growing" state (net > 0 AND pending > per_invocation_url_cap × 4)
  // flips growth_warning=true.
  const pending = (depth.byStatus['pending'] ?? 0) + (depth.byStatus['retry'] ?? 0)
  const enqueueRate = (enqueue24h.rows / 24)
  const drainRate   = (last24h.urls_submitted / 24)
  const netGrowth   = enqueueRate - drainRate
  const hoursToDrain = drainRate > 0.5 ? Math.round((pending / drainRate) * 10) / 10 : null
  const warningThresholdRows = settings.per_invocation_url_cap * 4
  const growthWarning = netGrowth > 0.5 && pending > warningThresholdRows

  return NextResponse.json({
    now:                     new Date().toISOString(),
    indexnow: {
      settings,
      queue:                 depth,
      oldest_pending:        oldest,
      urls_submitted_last_24h: submitted24h,
      last_24h:              last24h,
      last_7d:               last7d,
      throughput: {
        enqueue_rate_per_hour_24h:      Math.round(enqueueRate * 10) / 10,
        drain_rate_per_hour_24h:        Math.round(drainRate * 10) / 10,
        net_growth_per_hour_24h:        Math.round(netGrowth * 10) / 10,
        pending_backlog:                pending,
        hours_to_drain_current_backlog: hoursToDrain,
        growth_warning:                 growthWarning,
        growth_warning_threshold_rows:  warningThresholdRows,
      },
    },
    events: {
      last_24h_change_events:  enqueue24h.rows,
      unprocessed:             events,
      harvester_enabled:       settings.harvester_enabled,
    },
    bing_ingest: {
      last_run:              bingRun,
      is_stale:              bingStale,
      is_failing:            bingFailing,
    },
    google_ingest: {
      last_run:              googleRun,
    },
  })
}

export async function GET(req: Request) { return handle(req) }
