// src/app/api/cron/seo-bing-daily/route.ts
// ============================================================================
// Stage 5B — Bing warehouse daily orchestrator.
//
// Runs the five-source Bing ingest unattended:
//   1) Verify (or, opt-in, provision) BigQuery dataset + tables.
//   2) Ingest GetRankAndTrafficStats → bing_site_daily.
//   3) Ingest GetPageStats           → bing_page_weekly.
//   4) Ingest GetQueryStats          → bing_query_weekly.
//   5) Ingest GetCrawlStats          → bing_crawl_daily.
//   6) Ingest GetFeeds               → bing_feed_snapshots.
//   7) Record the outcome in bing_ingest_runs (BigQuery, for cost audit)
//      AND in public.seo_bq_ingest_runs (Supabase, so Mission Control's
//      Data Health panel surfaces every Bing run regardless of BQ state).
//
// Idempotent by construction — every source is a MERGE upsert on its
// logical key. First run performs the full historical backfill; every
// subsequent run is a clean no-op unless Bing has published new data.
//
// Stage 6A note
//   The orchestrator no longer requires `bigquery.datasets.create` in
//   normal production. Dataset + table DDL is opt-in via SEO_BQ_ALLOW_DDL=1.
//   Default posture is "probe only": we SELECT LIMIT 0 against a required
//   table and surface a single actionable error if it does not exist.
//
// Auth
//   Bearer $CRON_SECRET via Vercel Cron. Any other caller → 401 (or 503
//   when the secret env var is not configured).
//
// Runtime
//   maxDuration = 180. Empirically fits comfortably.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runBingIngest } from '@/lib/seo/bing/pipeline/orchestrator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

async function recordSupabaseAudit(params: {
  runId: string; startedAt: string; finishedAt: string;
  status: 'ok' | 'error' | 'in_progress'; error: string | null; rowsIngested: number | null;
}) {
  try {
    const supa = getSupabaseServiceClient()
    await supa.from('seo_bq_ingest_runs').insert({
      run_id:        params.runId,
      site_key:      'pokeprices',
      source:        'bing',
      job_kind:      'bing_warehouse_ingest',
      started_at:    params.startedAt,
      ended_at:      params.finishedAt,
      status:        params.status,
      rows_ingested: params.rowsIngested,
      error:         params.error,
    })
  } catch { /* best-effort; never break the ingest response on audit failure */ }
}

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  // Vercel Cron invokes GET at the scheduled time. Operator replay via
  // curl is typically POST. We treat both the same, but tag the trigger.
  const trigger = req.method === 'GET' ? 'cron' : 'admin_manual'

  let result: Awaited<ReturnType<typeof runBingIngest>>
  try {
    result = await runBingIngest(trigger)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown ingest error'
    const now = new Date().toISOString()
    await recordSupabaseAudit({
      runId: crypto.randomUUID(), startedAt: now, finishedAt: now,
      status: 'error', error: msg.slice(0, 500), rowsIngested: 0,
    })
    return NextResponse.json({ status: 'error', error: msg.slice(0, 500) }, { status: 500 })
  }

  await recordSupabaseAudit({
    runId:        result.run_id,
    startedAt:    result.started_at,
    finishedAt:   result.finished_at,
    status:       result.status === 'error' ? 'error' : 'ok',
    error:        result.error ?? null,
    rowsIngested: (result.site_daily.rows_seen ?? 0)
                + (result.page_weekly.rows_seen ?? 0)
                + (result.query_weekly.rows_seen ?? 0)
                + (result.crawl_daily.rows_seen ?? 0)
                + (result.feed_snapshots.rows_seen ?? 0),
  })

  const httpStatus = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status: httpStatus })
}

export async function GET (req: Request) { return handle(req) }
export async function POST(req: Request) { return handle(req) }
