// src/app/api/cron/publish-scheduled/route.ts
//
// Vercel-Cron-invoked scheduled publisher.
//
// Scans editorial_projects for rows that satisfy ALL of:
//   * scheduled_publish_at <= now()
//   * signed_off_at IS NOT NULL     (human editorial approval still current)
//   * insights_id IS NULL           (never yet published)
//
// For each match, calls the canonical runPublicationAction(...,
// 'publish') so the auto-publish path shares EVERY safeguard with
// the manual Publish Now button: preflight, payload conversion, RPC
// transaction, revalidation, IndexNow. No duplicate CMS logic here.
//
// Auth: bearer CRON_SECRET (see src/lib/email/cronAuth.ts). Vercel
// Cron sends `Authorization: Bearer <secret>`. An operator can also
// replay this endpoint locally with the same header for debugging.
//
// Safety:
//   * Small hard cap (25 per run) so a mis-scheduled batch cannot
//     hammer the DB in one tick. Anything left over publishes on
//     the next cron tick.
//   * Per-row try/catch — one project failing preflight does not
//     stop the next one.
//   * Never mutates rows on failure. `runPublicationAction` sets
//     insights_id on success; the cron only reports the aggregate.

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runPublicationAction } from '@/lib/editorial/publishing/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PER_RUN = 25

type Outcome = { projectId: number; slug?: string; published?: string; error?: string }

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  const supa = getSupabaseServiceClient()
  const nowIso = new Date().toISOString()
  const { data, error } = await supa
    .from('editorial_projects')
    .select('id, title, scheduled_publish_at, signed_off_at, insights_id')
    .lte('scheduled_publish_at', nowIso)
    .not('signed_off_at', 'is', null)
    .is('insights_id', null)
    .order('scheduled_publish_at', { ascending: true })
    .limit(MAX_PER_RUN)
  if (error) return NextResponse.json({ error: 'query failed', detail: error.message }, { status: 500 })

  const candidates = (data ?? []) as Array<{ id: number; title: string; scheduled_publish_at: string; signed_off_at: string; insights_id: string | null }>
  const results: Outcome[] = []
  for (const c of candidates) {
    try {
      // runPublicationAction re-runs preflight, gates on sign-off,
      // constructs the payload deterministically, and calls the
      // eic_finalize_article RPC. Any failure surfaces as a thrown
      // Error and stays on this project only.
      const res = await runPublicationAction(c.id, 'publish', { adminEmail: 'cron:scheduled-publisher' })
      results.push({ projectId: c.id, slug: res.slug, published: nowIso })
    } catch (e) {
      results.push({ projectId: c.id, error: e instanceof Error ? e.message : 'unknown' })
    }
  }

  const publishedCount = results.filter(r => r.published && !r.error).length
  const failedCount    = results.filter(r =>  r.error).length
  return NextResponse.json({
    stage:    'ok',
    scanned:  candidates.length,
    published: publishedCount,
    failed:   failedCount,
    outcomes: results,
    at:       nowIso,
  })
}

// Vercel Cron issues GET; POST supported so an operator can replay
// the cron locally with curl + bearer.
export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
