// src/app/api/cron/weekly-digests/route.ts
// Block 5A-W-17 — Vercel-Cron-invoked weekly digest delivery route.
//
// Double gate:
//   1. CRON_SECRET bearer match (also accepts legacy
//      ONBOARDING_CRON_SECRET — see src/lib/email/cronAuth.ts)
//   2. ALERT_WEEKLY_DIGEST_CRON_ENABLED='true' (literal)
//
// Either gate failing returns 401 (auth) or 503 (flag). No body is
// read — Vercel Cron sends a plain header request with no body, so
// all knobs come from env:
//   * ALERT_WEEKLY_DIGEST_CRON_MAX_USERS   — per-invocation cap (default 25)
//   * ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS    — cooldown floor (default 7)
//
// Source = 'cron' → engine enforces weekly_digest_day_of_week against
// today's ISO weekday (UTC). The daily 09:00 UTC schedule in
// vercel.json calls this every day; the day-of-week filter is what
// reduces the candidate pool to "users whose chosen day is today".
//
// dryRun MUST default to FALSE here — the cron route exists to actually
// send. The flag + secret double gate is the safety surface; once both
// gates pass, the run sends to all eligible candidates (subject to the
// cooldown + cap).
//
// SAFETY
//   * Never accepts an arbitrary recipient — engine routes to each
//     candidate user's own auth.users.email.
//   * Response never echoes user_id or email; recipients are masked.
//   * No alert_events.delivered_at mutations.
//   * No sample data ever — see weeklyDigestDelivery.ts header.

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import {
  isAlertWeeklyDigestCronEnabled,
  getAlertWeeklyDigestCronMaxUsers,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { makeAuthEmailLookup } from '@/lib/alerts/delivery'
import { deliverWeeklyDigests } from '@/lib/alerts/weeklyDigestDelivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  // Auth FIRST so an unauthenticated probe sees only an opaque 401 /
  // 503 with no detail about whether the flag is on.
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }
  if (!isAlertWeeklyDigestCronEnabled()) {
    return NextResponse.json({ error: 'weekly digest cron disabled' }, { status: 503 })
  }

  const maxUsers = getAlertWeeklyDigestCronMaxUsers()

  try {
    const supa = getSupabaseServiceClient()
    const result = await deliverWeeklyDigests(supa, {
      dryRun:       false,   // cron is the real-send path
      maxUsers,
      source:       'cron',
      getUserEmail: makeAuthEmailLookup(supa),
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'weekly digest cron failed', detail: msg }, { status: 500 })
  }
}

// Vercel Cron invokes GET; POST is offered so an operator can replay
// the cron locally with curl + bearer.
export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
