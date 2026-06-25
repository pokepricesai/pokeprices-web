// src/app/api/admin/alerts/send-weekly-digest-test/route.ts
// Block 5A-W-16 — admin-only POST endpoint that sends ONE weekly
// portfolio/watchlist digest email to the authenticated admin or a
// configured test recipient.
//
// Triple gate:
//   1. ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED='true' OR
//      ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED='true'
//      (503 otherwise — both flags accept the literal "true" only)
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only
//
// Recipient resolution (in order, NO arbitrary recipients from body):
//   1. process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO — operator override
//   2. admin.email                                   — authenticated admin
//   ⊥ neither                                        — 400 hard fail
//
// Body (all optional):
//   {
//     "mode"?:   'auto' | 'real' | 'sample',   // default 'auto'
//     "userId"?: string                        // defaults to admin.userId
//   }
//   * mode=auto    — real digest for the target if there's any content,
//                    else falls back to sample so the email still has
//                    something to inspect.
//   * mode=real    — real digest as-is (quiet weeks render quiet body).
//   * mode=sample  — always sample data; never touches the DB.
//
// Subject ALWAYS prefixed `[TEST] ` (renderer test:true). Sample mode
// stacks to `[TEST] [SAMPLE] …` as per the weekly digest renderer.
//
// Category: 'weekly_report' — semantically the right bucket for a
// weekly portfolio/watchlist digest. adminBypass={recipientLocked:true}
// keeps the admin's own preferences from blocking their own test send.
//
// SAFETY
//   * No alert_events.delivered_at updates.
//   * No INSERT / UPDATE / DELETE on any table except whatever
//     sendEmail internally writes to email_delivery_log (documented
//     surface — same as the existing alert test-send route).
//   * No cron, no batch path, no other user emailed.
//   * Recipient is LOCKED — the request body's `userId` only affects
//     which user's DIGEST is built; it never affects WHO RECEIVES the
//     email. That stays the admin / env override.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  isAlertWeeklyDigestTestEmailEnabled,
  isAlertWeeklyDigestPreviewEnabled,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildWeeklyDigestForUser, type WeeklyDigestData } from '@/lib/alerts/weeklyDigest'
import {
  buildSampleWeeklyDigestData,
  buildWeeklyDigestEmail,
} from '@/lib/alerts/weeklyDigestEmail'
import { sendEmail } from '@/lib/email/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_LOOSE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Mode = 'auto' | 'real' | 'sample'

function parseMode(v: unknown): Mode {
  if (v === 'real' || v === 'sample' || v === 'auto') return v
  return 'auto'
}

function resolveRecipient(adminEmail: string): { email: string; source: 'env' | 'admin' } | { error: string } {
  const envRecipient = (process.env.ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO ?? '').trim()
  if (envRecipient) {
    if (!EMAIL_LOOSE_RE.test(envRecipient)) {
      return { error: 'ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO is set but is not a valid email address' }
    }
    return { email: envRecipient, source: 'env' }
  }
  const trimmed = (adminEmail ?? '').trim()
  if (trimmed && EMAIL_LOOSE_RE.test(trimmed)) {
    return { email: trimmed, source: 'admin' }
  }
  return { error: 'No recipient configured: set ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO or sign in as an admin with an email' }
}

function hasAnyContent(d: WeeklyDigestData): boolean {
  if (d.status !== 'ok') return false
  const pHas = (d.portfolio?.itemCount ?? 0) > 0
  const wHas = (d.watchlist?.itemCount ?? 0) > 0
  const aHas = d.alertSummary.cardBlocks.length > 0
  return pHas || wHas || aHas
}

export async function POST(req: Request) {
  if (!isAlertWeeklyDigestTestEmailEnabled() && !isAlertWeeklyDigestPreviewEnabled()) {
    return NextResponse.json({ error: 'weekly digest test send disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  // Recipient is locked — never read from the request body.
  const recipient = resolveRecipient(admin.email)
  if ('error' in recipient) {
    return NextResponse.json({ error: recipient.error }, { status: 400 })
  }

  let body: { mode?: unknown; userId?: unknown } = {}
  try { body = (await req.json()) as { mode?: unknown; userId?: unknown } } catch { /* empty body acceptable */ }

  const mode = parseMode(body.mode)
  // userId only chooses which user's DIGEST to build. The RECIPIENT is
  // always the admin / env override — locked above. Defaults to the
  // admin's own uid so previewing is "your own digest" by default.
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
        // Honour the explicit request — send the quiet/disabled real
        // digest as-is rather than swapping in sample data.
        resolvedMode = 'real'
      } else {
        // auto + no real content → sample fallback so the email body
        // is still inspectable in the operator's inbox.
        data         = buildSampleWeeklyDigestData()
        resolvedMode = 'sample'
      }
    }

    const email = buildWeeklyDigestEmail(data, {
      sample: resolvedMode === 'sample',
      test:   true,
    })

    const sendResult = await sendEmail({
      toEmail:        recipient.email,
      category:       'weekly_report',
      templateKey:    'weekly-digest-test',
      subject:        email.subject,
      html:           email.html,
      text:           email.text,
      // Fresh idempotency key per click so successive admin clicks
      // each send (matches the existing alert test-send convention).
      idempotencyKey: `weekly-digest-test-${admin.userId}-${Date.now()}`,
      adminBypass:    { reason: 'admin_test_weekly_digest', recipientLocked: true },
      metadata: {
        source:      'admin_send_weekly_digest_test',
        mode:        resolvedMode,
        status:      data.status,
        // Block 5A-W-16G — snapshot fields read back on the NEXT
        // digest as the "since last weekly" baseline. Keeps the
        // baseline calculation honest: the digest renderer compares
        // a real previous total to the current total, no fabrication.
        // Stored only on REAL sends (sample previews of the same
        // user would otherwise pollute the baseline).
        portfolioTotalMinorUnits: resolvedMode === 'real'
          ? data.portfolio?.currentTotalCents ?? null
          : null,
        currency:                 resolvedMode === 'real' ? data.currency : null,
        portfolioItemCount:       resolvedMode === 'real'
          ? data.portfolio?.itemCount ?? 0
          : null,
        portfolioScope:           resolvedMode === 'real'
          ? data.diagnostics.portfolioScope
          : null,
      },
    })

    return NextResponse.json({
      ok:              sendResult.outcome === 'sent',
      outcome:         sendResult.outcome,
      deliveryLogId:   sendResult.deliveryLogId ?? null,
      emailId:         sendResult.emailId ?? null,
      reason:          sendResult.reason ?? null,
      recipient:       recipient.email,
      recipientSource: recipient.source,
      mode:            resolvedMode,
      status:          data.status,
      subject:         email.subject,
      diagnostics:     data.diagnostics,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'send failed', detail: msg }, { status: 500 })
  }
}
