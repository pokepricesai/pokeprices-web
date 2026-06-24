// src/app/api/admin/alerts/send-test-email/route.ts
// Block 5A-W-5 — admin-only POST endpoint that sends ONE alert digest
// email to the authenticated admin (or a configured test recipient).
//
// Triple gate:
//   1. ALERT_TEST_EMAIL_ENABLED='true' OR ALERT_EMAIL_PREVIEW_ENABLED='true'
//      (503 otherwise — both flags accept the literal "true" only)
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only
//
// Recipient resolution (in order):
//   1. process.env.ALERT_TEST_EMAIL_TO — operator-supplied override
//   2. admin.email                     — the authenticated admin's address
//   ⊥ neither                          — 400 hard fail
//
// Mode:
//   * Always passes `test: true` to the digest builder so the subject
//     is prefixed `[TEST]`. If the admin has no undelivered events the
//     digest falls back to sample data and the subject becomes
//     `[TEST] [SAMPLE] …`.
//
// SAFETY:
//   * No update to alert_events.delivered_at.
//   * No insert/update/delete on alert_events.
//   * No cron, no batch path, no other user touched.
//   * Send goes through the central src/lib/email/send.ts service
//     (Block 3A) — that path writes an email_delivery_log row by
//     design; this is the documented logging surface for every send
//     including test sends.
//   * adminBypass={ recipientLocked: true } so a Vercel preview
//     environment with EMAIL_TEST_RECIPIENT set still allows the test
//     send through, but only when the recipient matches the lock.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  isAlertTestEmailEnabled,
  isAlertEmailPreviewEnabled,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import {
  buildEmailDigest,
  buildSampleEvents,
  type DigestEvent,
} from '@/lib/alerts/emailDigest'
import { sendEmail } from '@/lib/email/send'
import type { AlertRule } from '@/lib/alerts/preferences'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

const REAL_EVENT_LIMIT = 20

// Minimal email shape check. Anything that passes will be re-validated
// by `normalizeEmail()` inside sendEmail; this is just a first cut so
// a malformed override produces a meaningful 400 here.
const EMAIL_LOOSE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function resolveRecipient(adminEmail: string): { email: string; source: 'env' | 'admin' } | { error: string } {
  const envRecipient = (process.env.ALERT_TEST_EMAIL_TO ?? '').trim()
  if (envRecipient) {
    if (!EMAIL_LOOSE_RE.test(envRecipient)) {
      return { error: 'ALERT_TEST_EMAIL_TO is set but is not a valid email address' }
    }
    return { email: envRecipient, source: 'env' }
  }
  const trimmed = (adminEmail ?? '').trim()
  if (trimmed && EMAIL_LOOSE_RE.test(trimmed)) {
    return { email: trimmed, source: 'admin' }
  }
  return { error: 'No recipient configured: set ALERT_TEST_EMAIL_TO or sign in as an admin with an email' }
}

export async function POST(req: Request) {
  if (!isAlertTestEmailEnabled() && !isAlertEmailPreviewEnabled()) {
    return NextResponse.json({ error: 'alerts test send disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const recipient = resolveRecipient(admin.email)
  if ('error' in recipient) {
    return NextResponse.json({ error: recipient.error }, { status: 400 })
  }

  try {
    const supa  = getSupabaseServiceClient()
    let events: DigestEvent[] = await loadAdminAlertEvents(supa, admin.userId, REAL_EVENT_LIMIT)
    const usedSample = events.length === 0
    if (usedSample) events = buildSampleEvents()

    const digest = buildEmailDigest(events, { sample: usedSample, test: true })

    const sendResult = await sendEmail({
      toEmail:        recipient.email,
      category:       'transactional',
      templateKey:    'alert-digest-test',
      subject:        digest.subject,
      html:           digest.html,
      text:           digest.text,
      // Fresh idempotency key per click so successive admin clicks
      // each send (instead of collapsing into one log row).
      idempotencyKey: `alert-test-${admin.userId}-${Date.now()}`,
      adminBypass:    { reason: 'admin_test_alert_digest', recipientLocked: true },
      metadata:       {
        source:      'admin_send_test_email',
        mode:        usedSample ? 'sample' : 'real',
        event_count: events.length,
      },
    })

    // ── Operator-safe response shape ──────────────────────────────
    // Echo the resolved RECIPIENT, the digest SUBJECT (so the admin
    // can confirm the [TEST] prefix lands), the chosen mode, and the
    // central send service's typed outcome + log id. Nothing about
    // alert_events is mutated and nothing user-identifying is leaked.
    return NextResponse.json({
      ok:             sendResult.outcome === 'sent',
      outcome:        sendResult.outcome,
      deliveryLogId:  sendResult.deliveryLogId ?? null,
      emailId:        sendResult.emailId ?? null,
      reason:         sendResult.reason ?? null,
      recipient:      recipient.email,
      recipientSource:recipient.source,
      mode:           usedSample ? 'sample' : 'real',
      eventCount:     events.length,
      subject:        digest.subject,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'send failed', detail: msg }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────
// Read-only DB plumbing — identical shape to the preview route so the
// two surfaces stay consistent.
// ─────────────────────────────────────────────────────────────────────

async function loadAdminAlertEvents(
  supa:   SupabaseClient,
  userId: string,
  limit:  number,
): Promise<DigestEvent[]> {
  if (!userId) return []
  const { data, error } = await supa
    .from('alert_events')
    .select('card_slug, card_name, set_name, rule, severity, payload_json')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .order('detected_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data) || data.length === 0) return []
  const rows = data as Array<Record<string, unknown>>
  const slugs = Array.from(new Set(rows.map(r => String(r.card_slug)).filter(Boolean)))
  const urlMap = await loadCardUrlMap(supa, slugs)
  return rows.map(r => {
    const slug = String(r.card_slug)
    return {
      cardName: String(r.card_name ?? slug),
      setName:  r.set_name == null ? '' : String(r.set_name),
      cardUrl:  urlMap.get(slug),
      rule:     String(r.rule) as AlertRule,
      severity: (String(r.severity) as 'low'|'normal'|'high') ?? 'normal',
      payload:  (r.payload_json && typeof r.payload_json === 'object') ? r.payload_json as Record<string, unknown> : {},
    }
  })
}

async function loadCardUrlMap(supa: SupabaseClient, bareSlugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (bareSlugs.length === 0) return out
  const { data, error } = await supa
    .from('cards')
    .select('card_slug, set_name, card_url_slug')
    .in('card_slug', bareSlugs)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const slug    = String(r.card_slug)
    const setName = r.set_name      == null ? '' : String(r.set_name)
    const urlSlug = r.card_url_slug == null ? '' : String(r.card_url_slug)
    if (slug && setName && urlSlug) {
      out.set(slug, `https://www.pokeprices.io/set/${encodeURIComponent(setName)}/card/${urlSlug}`)
    }
  }
  return out
}
