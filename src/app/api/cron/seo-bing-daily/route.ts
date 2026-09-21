// src/app/api/cron/seo-bing-daily/route.ts
// ============================================================================
// Stage 5B — Bing warehouse daily orchestrator.
//
// Runs the five-source Bing ingest unattended:
//   1) Ensure BigQuery dataset + tables exist (idempotent DDL).
//   2) Ingest GetRankAndTrafficStats → bing_site_daily.
//   3) Ingest GetPageStats           → bing_page_weekly.
//   4) Ingest GetQueryStats          → bing_query_weekly.
//   5) Ingest GetCrawlStats          → bing_crawl_daily.
//   6) Ingest GetFeeds               → bing_feed_snapshots.
//   7) Record the outcome in bing_ingest_runs.
//
// Idempotent by construction — every source is a MERGE upsert on its
// logical key. First run performs the full historical backfill; every
// subsequent run is a clean no-op unless Bing has published new data.
//
// Auth
//   Bearer $CRON_SECRET via Vercel Cron. Any other caller → 401 (or 503
//   when the secret env var is not configured).
//
// Runtime
//   maxDuration = 180. Empirically fits comfortably: 5 API calls +
//   ~2000 rows of MERGE-upsert take under 30 s on the WIF-authenticated
//   BigQuery path.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { runBingIngest } from '@/lib/seo/bing/pipeline/orchestrator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 180

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  // Vercel Cron invokes GET at the scheduled time. Operator replay via
  // curl is typically POST. We treat both the same, but tag the trigger.
  const trigger = req.method === 'GET' ? 'cron' : 'admin_manual'
  const result = await runBingIngest(trigger)
  const httpStatus = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status: httpStatus })
}

export async function GET (req: Request) { return handle(req) }
export async function POST(req: Request) { return handle(req) }
