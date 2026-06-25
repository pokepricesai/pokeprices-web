// src/app/api/admin/alerts/send-weekly-digest-batch/route.ts
// Block 5A-W-17 — admin-triggered batch delivery of real WEEKLY
// portfolio/watchlist digests to ELIGIBLE users. Wraps the shared
// engine in src/lib/alerts/weeklyDigestDelivery.ts.
//
// Triple gate:
//   1. ALERT_WEEKLY_DIGEST_BATCH_ENABLED='true' (literal) — 503 otherwise.
//      Strictly its own flag — the preview / test-send flags do NOT
//      unlock real user batch delivery.
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only.
//
// Body (all optional):
//   {
//     "dryRun":       true | false,   // default TRUE
//     "maxUsers":     number,         // clamped to engine HARD cap (100)
//     "cooldownDays": number,         // overrides env default of 7
//     "asOf":         ISO-8601 string // operator can replay a specific day
//   }
//
// Admin source IGNORES weekly_digest_day_of_week so an operator can
// always preview / send, regardless of which weekday the run lands on.
// Cron is the authority for day-of-week. The per-user `weeklyDayOfWeek`
// value is still echoed in the response so the admin sees what each
// user has configured.
//
// SAFETY
//   * dryRun defaults TRUE; only literal boolean `false` sends.
//   * Never accepts an arbitrary recipient — engine routes to each
//     candidate user's own auth.users.email via makeAuthEmailLookup.
//   * Response never echoes user_id or email; recipients are masked.
//   * No alert_events.delivered_at mutations.
//   * No sample data ever — see weeklyDigestDelivery.ts header.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertWeeklyDigestBatchEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { makeAuthEmailLookup } from '@/lib/alerts/delivery'
import { deliverWeeklyDigests } from '@/lib/alerts/weeklyDigestDelivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  dryRun?:       unknown
  maxUsers?:     unknown
  cooldownDays?: unknown
  asOf?:         unknown
}

function asPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const i = Math.floor(v)
  return i > 0 ? i : undefined
}
function asPositiveNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v > 0 ? v : undefined
}
function asDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export async function POST(req: Request) {
  if (!isAlertWeeklyDigestBatchEnabled()) {
    return NextResponse.json({ error: 'weekly digest batch disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* empty body acceptable */ }

  const dryRun       = body.dryRun !== false                  // default TRUE
  const maxUsers     = asPositiveInt(body.maxUsers)
  const cooldownDays = asPositiveNumber(body.cooldownDays)
  const asOf         = asDate(body.asOf)

  try {
    const supa = getSupabaseServiceClient()
    const result = await deliverWeeklyDigests(supa, {
      dryRun,
      maxUsers,
      cooldownDays,
      asOf,
      source:       'admin',
      getUserEmail: makeAuthEmailLookup(supa),
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'weekly digest batch failed', detail: msg }, { status: 500 })
  }
}
