// src/app/api/webhooks/resend/route.ts
// Block 3A — Resend webhook receiver.
//
// Contract:
//   * Verify the Svix signature BEFORE inspecting the payload.
//   * Dedup by `provider_event_id` (UNIQUE in email_webhook_events).
//     A duplicate delivery is acknowledged with 200 so Resend does not
//     re-send forever.
//   * Reconcile to the delivery log row by `resend_email_id` when one
//     exists in the payload.
//   * Apply suppression rules for bounced/complained/failed using a
//     documented policy (see docs/email-infrastructure.md).
//   * Never trust payload fields before verification succeeds.
//   * Never log email bodies, full payloads, or recipient addresses
//     beyond what the operator console actually needs.

import 'server-only'
import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { verifyResendWebhook } from '@/lib/email/webhookVerify'
import { findContactByResendEmailId, findContactByEmail } from '@/lib/email/contacts'
import { applySuppression, type SuppressionReason, type SuppressionSource } from '@/lib/email/suppressions'
import { classifyBounce, classifyFailedReason } from '@/lib/email/providerEvents'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

// Resend's documented event types as of June 2026. Treat the full list
// as accept-only — any other type is stored (for forensics) but not
// processed.
const PROCESSED_EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.opened',
  'email.clicked',
])

// Only the fields we read are typed. We deliberately do NOT pull in
// `html`, `text`, `subject`, `headers`, full recipient arrays beyond
// the lookup helper, or any provider-internal IDs we do not use. See
// normalisePayload() for the operator-safe shape we actually persist.
type ResendWebhookEnvelope = {
  type?:       string
  created_at?: string
  data?: {
    email_id?:    string
    to?:          string[] | string
    bounce?:     { type?: string; subType?: string; message?: string }
    failed?:     { reason?: string }
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  // 1. Verify signature.
  const verify = verifyResendWebhook<ResendWebhookEnvelope>(rawBody, req.headers)
  if (!verify.ok) {
    const status = verify.reason === 'missing_secret' ? 503 : 400
    console.error('[webhooks/resend] reject:', verify.reason)
    return NextResponse.json({ error: 'invalid' }, { status })
  }
  const payload = verify.payload

  const eventId = req.headers.get('svix-id') ?? ''
  if (!eventId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  const eventType = typeof payload.type === 'string' ? payload.type : 'unknown'
  const eventAt   = typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString()
  const resendEmailId = typeof payload.data?.email_id === 'string' ? payload.data.email_id : null

  // 2. Dedup + store the raw event.
  const supa = getSupabaseServiceClient()
  const normalized = normalisePayload(payload)
  const insert = await supa
    .from('email_webhook_events')
    .insert({
      provider:           'resend',
      provider_event_id:  eventId,
      event_type:         eventType,
      event_at:           eventAt,
      resend_email_id:    resendEmailId,
      payload_normalized: normalized,
      signature_verified: true,
    })
    .select('id')
    .single()

  if (insert.error) {
    if ((insert.error as { code?: string }).code === '23505') {
      // Already processed — acknowledge so Resend stops retrying.
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[webhooks/resend] event insert failed:', insert.error.code)
    // Returning 500 here causes Resend to retry — desired behaviour.
    return NextResponse.json({ error: 'store_failed' }, { status: 500 })
  }
  const webhookEventRowId = insert.data!.id as string

  // 3. Reconcile to the delivery log.
  if (resendEmailId) {
    await reconcileDeliveryLog({ resendEmailId, eventType, eventAt, payload })
  }

  // 4. Apply suppressions where the event warrants.
  if (PROCESSED_EVENT_TYPES.has(eventType)) {
    await maybeSuppress({ eventType, resendEmailId, payload, providerEventId: eventId })
  }

  // 5. Mark processed.
  await supa
    .from('email_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', webhookEventRowId)

  return NextResponse.json({ ok: true })
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip the payload down to a small, operator-safe shape before
 * persisting. We deliberately do not store recipient strings unless
 * they are already stripped by Resend; everything else (raw bodies,
 * tags) is kept in case we need to debug a delivery without paging
 * Resend support.
 */
function normalisePayload(p: ResendWebhookEnvelope): Record<string, unknown> {
  return {
    type:       p.type,
    created_at: p.created_at,
    email_id:   p.data?.email_id ?? null,
    bounce: p.data?.bounce
      ? { type: p.data.bounce.type, subType: p.data.bounce.subType }
      : null,
    failed: p.data?.failed
      ? { reason: p.data.failed.reason }
      : null,
  }
}

async function reconcileDeliveryLog(input: {
  resendEmailId: string
  eventType:     string
  eventAt:       string
  payload:       ResendWebhookEnvelope
}): Promise<void> {
  const supa = getSupabaseServiceClient()
  const patch: Record<string, unknown> = {}
  switch (input.eventType) {
    case 'email.sent':
      patch.status  = 'sent'
      patch.sent_at = input.eventAt
      break
    case 'email.delivered':
      patch.status       = 'delivered'
      patch.delivered_at = input.eventAt
      break
    case 'email.delivery_delayed':
      patch.status = 'delivery_delayed'
      break
    case 'email.bounced':
      patch.status      = 'bounced'
      patch.bounced_at  = input.eventAt
      patch.error_code  = (input.payload.data?.bounce?.subType ?? input.payload.data?.bounce?.type) ?? 'bounced'
      break
    case 'email.complained':
      patch.status         = 'complained'
      patch.complained_at  = input.eventAt
      break
    case 'email.failed':
      // email.failed always updates the delivery log status, even when
      // the failure does not warrant a suppression. The operator gets
      // the diagnostic without losing deliverability for transient
      // failures.
      patch.status     = 'failed'
      patch.failed_at  = input.eventAt
      patch.error_code = input.payload.data?.failed?.reason ?? 'failed'
      break
    default:
      return
  }
  await supa
    .from('email_delivery_log')
    .update(patch)
    .eq('resend_email_id', input.resendEmailId)
}

/**
 * Suppression policy (Block 3A correction pass):
 *
 *   email.bounced
 *     - classifyBounce(data.bounce.type, data.bounce.subType)
 *     - 'hard'    → global hard_bounce suppression
 *     - 'soft'    → no suppression (status only)
 *     - 'unknown' → no suppression (fail safe)
 *
 *   email.complained
 *     - always applies a global complaint suppression. Complaints are
 *       treated as permanent: any complaint indicates the recipient
 *       does not want our mail.
 *
 *   email.failed
 *     - classifyFailedReason(data.failed.reason)
 *     - 'permanent_recipient' → global provider_rejection suppression
 *     - 'temporary'           → no suppression
 *     - 'unknown'             → no suppression (fail safe; operator
 *       can apply admin_suppression manually if a pattern emerges)
 *
 *   other event types → no-op.
 */
async function maybeSuppress(input: {
  eventType:       string
  resendEmailId:   string | null
  payload:         ResendWebhookEnvelope
  providerEventId: string
}): Promise<void> {
  if (
    input.eventType !== 'email.bounced'   &&
    input.eventType !== 'email.complained' &&
    input.eventType !== 'email.failed'
  ) return

  let reason: SuppressionReason | null = null
  let source: SuppressionSource | null = null

  if (input.eventType === 'email.bounced') {
    const cls = classifyBounce(
      input.payload.data?.bounce?.type,
      input.payload.data?.bounce?.subType,
    )
    if (cls === 'hard') {
      reason = 'hard_bounce'
      source = 'webhook_bounce'
    }
  } else if (input.eventType === 'email.complained') {
    reason = 'complaint'
    source = 'webhook_complaint'
  } else if (input.eventType === 'email.failed') {
    const cls = classifyFailedReason(input.payload.data?.failed?.reason)
    if (cls === 'permanent_recipient') {
      reason = 'provider_rejection'
      source = 'webhook_failed'
    }
  }
  if (!reason || !source) return

  const contact = await locateContact(input)
  if (!contact) return

  await applySuppression({
    contactId:        contact.id,
    reason,
    category:         null, // GLOBAL
    source,
    providerEventId:  input.providerEventId,
  })
}

async function locateContact(input: {
  resendEmailId: string | null
  payload:       ResendWebhookEnvelope
}): Promise<{ id: string } | null> {
  if (input.resendEmailId) {
    const c = await findContactByResendEmailId(input.resendEmailId)
    if (c) return c
  }
  const to = input.payload.data?.to
  const candidate = Array.isArray(to) ? to[0] : (typeof to === 'string' ? to : null)
  if (candidate) {
    const c = await findContactByEmail(candidate)
    if (c) return c
  }
  return null
}
