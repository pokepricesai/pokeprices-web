// src/app/api/admin/alerts/preview-weekly-digest/route.ts
// Block 5A-W-15 — admin-only POST endpoint that renders a WEEKLY
// portfolio/watchlist digest preview WITHOUT sending or persisting
// anything.
//
// Triple gate:
//   1. ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED='true'
//      OR ALERT_EMAIL_PREVIEW_ENABLED='true'   (503 otherwise)
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only.
//
// Body (all optional):
//   {
//     "userId"?: string,                  // defaults to the admin's own uid
//     "mode"?:   'auto' | 'real' | 'sample'
//   }
//   auto    (default) — real if the target user has ANY portfolio /
//                       watchlist / alerts data; else fall back to
//                       sample so the layout is still reviewable.
//   real              — always build from the target's real data; if
//                       there's nothing, the email reports a quiet
//                       week (no sample injection).
//   sample            — never read the DB; always render hand-crafted
//                       sample data so the design can be inspected on
//                       an empty system.
//
// Response (success):
//   {
//     mode:        'real' | 'sample',
//     sample:      boolean,
//     status:      WeeklyDigestStatus,   // ok / disabled_master / disabled_weekly
//     subject:     string,
//     previewText: string,
//     html:        string,
//     text:        string,
//     diagnostics: WeeklyDigestDiagnostics,
//   }
//
// SAFETY: no email send, no Resend call, no INSERT/UPDATE/DELETE on
// any table. The weekly digest builder is pure-read; this route only
// adds an admin gate around it. The response never includes user_id,
// email, or any field that could identify the recipient — even when
// the admin previews someone else's digest.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertEmailPreviewEnabled, isAlertWeeklyDigestPreviewEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildWeeklyDigestForUser, type WeeklyDigestData } from '@/lib/alerts/weeklyDigest'
import {
  buildSampleWeeklyDigestData,
  buildWeeklyDigestEmail,
} from '@/lib/alerts/weeklyDigestEmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Mode = 'auto' | 'real' | 'sample'

function parseMode(v: unknown): Mode {
  if (v === 'real' || v === 'sample' || v === 'auto') return v
  return 'auto'
}

function hasAnyContent(d: WeeklyDigestData): boolean {
  if (d.status !== 'ok') return false
  const pHas = (d.portfolio?.itemCount ?? 0) > 0
  const wHas = (d.watchlist?.itemCount ?? 0) > 0
  const aHas = d.alertSummary.cardBlocks.length > 0
  return pHas || wHas || aHas
}

export async function POST(req: Request) {
  if (!isAlertWeeklyDigestPreviewEnabled() && !isAlertEmailPreviewEnabled()) {
    return NextResponse.json({ error: 'weekly digest preview disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: { userId?: unknown; mode?: unknown } = {}
  try { body = (await req.json()) as { userId?: unknown; mode?: unknown } } catch { /* empty body acceptable */ }

  const mode      = parseMode(body.mode)
  const targetUid = typeof body.userId === 'string' && body.userId.length > 0
    ? body.userId
    : admin.userId

  try {
    let data: WeeklyDigestData
    let resolvedMode: 'real' | 'sample'

    if (mode === 'sample') {
      data         = buildSampleWeeklyDigestData()
      resolvedMode = 'sample'
    } else {
      const supa = getSupabaseServiceClient()
      data       = await buildWeeklyDigestForUser(supa, targetUid)
      if (hasAnyContent(data)) {
        resolvedMode = 'real'
      } else if (mode === 'real') {
        // Honour the explicit request — render the quiet/disabled real
        // digest as-is rather than injecting sample data.
        resolvedMode = 'real'
      } else {
        // auto + no real content → sample fallback so the layout is
        // still inspectable.
        data         = buildSampleWeeklyDigestData()
        resolvedMode = 'sample'
      }
    }

    const email = buildWeeklyDigestEmail(data, { sample: resolvedMode === 'sample' })
    return NextResponse.json({
      mode:        resolvedMode,
      sample:      resolvedMode === 'sample',
      status:      data.status,
      subject:     email.subject,
      previewText: email.previewText,
      html:        email.html,
      text:        email.text,
      diagnostics: data.diagnostics,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'preview failed', detail: msg }, { status: 500 })
  }
}
