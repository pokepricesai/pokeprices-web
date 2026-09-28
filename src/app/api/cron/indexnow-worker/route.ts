// src/app/api/cron/indexnow-worker/route.ts
// ============================================================================
// Stage 6A — scheduled IndexNow queue drain worker.
//
// Trigger:  Vercel Cron every 15 minutes (see vercel.json). Also invocable
//           manually via POST for admin re-drain / debugging.
// Auth:     Bearer $CRON_SECRET (via isCronAuthOk). Any other caller → 401.
// Runtime:  Node.js. maxDuration=60s so the worker has clear headroom under
//           the per_invocation_time_budget_ms setting (default 55s).
//
// The worker itself lives in src/lib/indexnow/worker.ts. This route is a
// thin wrapper that (a) authenticates, (b) invokes the worker, (c) returns
// a JSON summary that Mission Control can display.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { runIndexnowWorker } from '@/lib/indexnow/worker'

export const runtime      = 'nodejs'
export const dynamic      = 'force-dynamic'
export const maxDuration  = 60

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const trigger = req.method === 'GET' ? 'cron' : 'admin_manual'
  const result = await runIndexnowWorker({ trigger })
  const httpStatus = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status: httpStatus })
}

export async function GET  (req: Request) { return handle(req) }
export async function POST (req: Request) { return handle(req) }
