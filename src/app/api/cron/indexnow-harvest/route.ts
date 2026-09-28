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
// Runtime: nodejs. maxDuration=60.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { runIndexnowHarvester } from '@/lib/indexnow/harvester'
import { loadSettings } from '@/lib/indexnow/queue'

export const runtime      = 'nodejs'
export const dynamic      = 'force-dynamic'
export const maxDuration  = 60

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
  const eventsPerRun = Number((settings as any).harvester_events_per_run ?? 2000)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enqueueAggregates = ((settings as any).harvester_enqueue_aggregates ?? true) as boolean

  const trigger = req.method === 'GET' ? 'cron' : 'admin_manual'
  const result = await runIndexnowHarvester({ trigger, eventsPerRun, enqueueAggregates })
  const httpStatus = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status: httpStatus })
}

export async function GET  (req: Request) { return handle(req) }
export async function POST (req: Request) { return handle(req) }
