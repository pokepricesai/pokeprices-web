// src/app/api/cron/seo-daily/route.ts
// ============================================================================
// TEMPORARY MINIMAL STUB — isolating the Vercel-build ENOENT.
//
// The full Stage 4C orchestrator (BQ ingest + rollup refresh) is temporarily
// stripped from this file so that a deploy can succeed and prove the route
// path itself is registrable. The full implementation lives in the two
// pipeline modules already committed to src/lib/seo/pipeline/ and will be
// wired back in once the build passes.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }
  return NextResponse.json({
    status: 'stub',
    note: 'Stage 4C route registered but orchestrator temporarily stubbed while build issue is isolated.',
    started_at: new Date().toISOString(),
  })
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
