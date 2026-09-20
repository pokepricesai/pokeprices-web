// src/app/api/cron/seo-daily/route.ts
// ============================================================================
// SEO Mission Control · Stage 4C — daily automation orchestrator.
//
// Runs the full SEO pipeline unattended:
//   1) Discover every new BigQuery WEB partition since the last one
//      already in seo_gsc_page_daily.
//   2) Ingest all missing dates in chronological order (catch-up safe).
//   3) Compute the latest date now present in seo_gsc_page_daily.
//   4) Refresh seo_page_rollups + seo_kpi_daily to that date. Stage 4A
//      hard reconciliation aborts before the KPI write if anything is
//      off — never advance a broken snapshot.
//   5) Return a compact structured summary.
//
// Auth
//   Bearer $CRON_SECRET via Vercel Cron. Any other caller → 401 (or 503
//   when the secret env var is not configured). Same pattern as the
//   existing /api/cron/* routes.
//
// Runtime
//   maxDuration = 300 (Vercel's default cap). Empirical worst case
//   observed 2026-09-20: ~90s for typical daily (1-2 new dates + refresh
//   against 29-day history), ~240s for a 5-day catch-up. Well under
//   the cap; if catch-up scenarios ever push past it, split into two
//   crons (ingest-only, refresh-only) — the underlying modules are
//   independent enough to swap in.
//
// Safety
//   * Idempotent. A second immediate invocation ingests zero new
//     dates and re-runs refresh with identical result (0 stale rows,
//     9/9 invariants).
//   * Failure isolated. If ingest fails → don't advance KPI. If refresh
//     reconciliation fails → don't advance KPI. Raw data + prior
//     good KPI + prior good rollups all preserved.
//   * Every step records a telemetry row in seo_bq_ingest_runs
//     (job_kind = 'page_daily_ingest' or 'rollup_refresh') that
//     Mission Control's Data Health panel already reads.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runBqDailyIngest } from '@/lib/seo/pipeline/bqPageDaily'
import { runRollupRefresh } from '@/lib/seo/pipeline/rollupsAndKpi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function latestGscDate(supa: ReturnType<typeof getSupabaseServiceClient>): Promise<string | null> {
  const { data } = await supa
    .from('seo_gsc_page_daily')
    .select('date').eq('site_key', 'pokeprices').eq('source', 'google')
    .order('date', { ascending: false }).limit(1).maybeSingle()
  return (data?.date as string | undefined) ?? null
}
async function latestKpiDate(supa: ReturnType<typeof getSupabaseServiceClient>): Promise<string | null> {
  const { data } = await supa
    .from('seo_kpi_daily')
    .select('date').eq('site_key', 'pokeprices').eq('source', 'google')
    .order('date', { ascending: false }).limit(1).maybeSingle()
  return (data?.date as string | undefined) ?? null
}

async function handle(req: Request) {
  const started_at = new Date().toISOString()

  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const supa = getSupabaseServiceClient()

  const rawBefore = await latestGscDate(supa)
  const kpiBefore = await latestKpiDate(supa)

  // 1) Ingest missing BQ partitions.
  const ingest = await runBqDailyIngest(supa)
  if (ingest.status === 'error' || ingest.status === 'aborted_budget') {
    return NextResponse.json({
      status: 'ingest_failed',
      started_at,
      raw_daily_before: rawBefore,
      kpi_before: kpiBefore,
      ingest,
      refresh: null,
    }, { status: 500 })
  }

  // 2) Refresh rollups + KPI to the latest date now present.
  const rawAfter = await latestGscDate(supa)
  if (!rawAfter) {
    // No raw data at all — nothing to refresh yet.
    return NextResponse.json({
      status: 'noop_no_raw_data',
      started_at,
      raw_daily_before: rawBefore,
      raw_daily_after: rawAfter,
      kpi_before: kpiBefore,
      kpi_after: null,
      ingest,
      refresh: null,
    })
  }

  // If ingest was a no-op AND the KPI already matches the latest raw
  // daily date, no need to redo the ~2-minute refresh.
  if (ingest.status === 'noop_no_new_dates' && kpiBefore === rawAfter) {
    return NextResponse.json({
      status: 'noop_up_to_date',
      started_at,
      raw_daily_before: rawBefore,
      raw_daily_after: rawAfter,
      kpi_before: kpiBefore,
      kpi_after: kpiBefore,
      ingest,
      refresh: null,
    })
  }

  const refresh = await runRollupRefresh(supa, rawAfter)
  const kpiAfter = refresh.status === 'ok' ? refresh.as_of_date : kpiBefore

  // ingest.status is 'ok' or 'noop_no_new_dates' at this point; the
  // only remaining question is whether the refresh passed hard
  // reconciliation.
  const overallOk = refresh.status === 'ok'
  return NextResponse.json({
    status: overallOk ? 'ok' : 'refresh_failed',
    started_at,
    finished_at: new Date().toISOString(),
    raw_daily_before: rawBefore,
    raw_daily_after: rawAfter,
    kpi_before: kpiBefore,
    kpi_after: kpiAfter,
    ingest,
    refresh,
  }, { status: overallOk ? 200 : 500 })
}

// Vercel Cron invokes GET. POST accepted for operator replay via curl.
export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
