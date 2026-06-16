// src/lib/email/send.ts
// Block 3A — the SINGLE application email send path.
//
// Every call:
//   1. validates + normalises the recipient
//   2. enforces non-production preview safety
//   3. upserts the contact
//   4. checks preferences (unless adminBypass)
//   5. checks suppressions (unless adminBypass)
//   6. reserves a delivery log row (UNIQUE idempotency_key)
//   7. calls Resend through the central client
//   8. writes the resulting Resend email id back to the log
//
// Returns a typed SendResult — callers branch on `outcome`, never on
// the underlying SDK error.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getResendClient } from './resend'
import { normalizeEmail, hashEmail } from './normalize'
import { upsertContact } from './contacts'
import { isOptedIn } from './preferences'
import { isSendBlocked, isTerminalSuppression } from './suppressions'
import { isMarketing, isTransactional, type EmailCategory } from './categories'
import { resolveFromAddress, resolveReplyTo } from './from'
import type { SendEmailInput, SendResult } from './types'

const PREVIEW_FLAG_ENABLED  = 'true'

function readEnvFlag(name: string): boolean {
  return ((process.env[name] ?? '').trim().toLowerCase()) === PREVIEW_FLAG_ENABLED
}

function readVercelEnv(): 'production' | 'preview' | 'development' | 'unknown' {
  const v = (process.env.VERCEL_ENV ?? '').trim().toLowerCase()
  if (v === 'production' || v === 'preview' || v === 'development') return v
  return 'unknown'
}

/**
 * Non-production safety rule:
 *   * production         → no restriction
 *   * preview            → recipient must equal EMAIL_TEST_RECIPIENT
 *                          UNLESS EMAIL_ALLOW_PREVIEW_SEND === 'true'
 *   * development        → recipient must equal EMAIL_TEST_RECIPIENT
 *                          UNLESS EMAIL_ALLOW_PREVIEW_SEND === 'true'
 *   * unknown            → treat as not-production (safer default)
 */
function checkPreviewRecipient(toEmail: string): { ok: boolean; reason: string } {
  const env = readVercelEnv()
  if (env === 'production') return { ok: true, reason: '' }
  if (readEnvFlag('EMAIL_ALLOW_PREVIEW_SEND')) return { ok: true, reason: '' }
  const locked = (process.env.EMAIL_TEST_RECIPIENT ?? '').trim().toLowerCase()
  if (!locked) return { ok: false, reason: 'preview_lock_no_recipient' }
  if (toEmail.trim().toLowerCase() !== locked) {
    return { ok: false, reason: 'preview_recipient_not_allowed' }
  }
  return { ok: true, reason: '' }
}

function result(outcome: SendResult['outcome'], extra: Partial<SendResult> = {}): SendResult {
  return { outcome, ...extra }
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const email = normalizeEmail(input.toEmail)
  if (!email) return result('invalid_recipient', { reason: 'normalize_failed' })

  // 1. Non-production safety.
  const preview = checkPreviewRecipient(email)
  if (!preview.ok) {
    return result('configuration_error', { reason: preview.reason })
  }

  // 2. Resend client — fail fast if the key is absent.
  const clientResult = getResendClient()
  if (!clientResult.ok || !clientResult.client) {
    console.error('[email/send] missing env:', clientResult.missing || 'RESEND_API_KEY')
    return result('configuration_error', { reason: 'missing_api_key' })
  }
  const resendClient = clientResult.client

  const supa = getSupabaseServiceClient()

  // 3. Resolve contact.
  const contact = await upsertContact({
    email,
    source: 'send_service',
  })
  if (!contact) {
    return result('configuration_error', { reason: 'contact_upsert_failed' })
  }

  // 4. Preference + suppression checks.
  //
  //    adminBypass scope (see types.ts):
  //      * preference check  → bypassed
  //      * non-terminal suppressions (manual_unsubscribe,
  //                                   soft_bounce_threshold) → bypassed
  //      * TERMINAL suppressions (hard_bounce, complaint,
  //                               invalid_address, admin_suppression,
  //                               provider_rejection) → ALWAYS block,
  //                               even for admin/test sends, so an
  //                               operator notices when the test
  //                               recipient is in a terminal state.
  const bypassPrefAndUnsub = !!input.adminBypass

  if (!bypassPrefAndUnsub) {
    const pref = await isOptedIn({
      contactId: contact.id,
      userId:    contact.user_id,
      category:  input.category,
    })
    if (!pref.optedIn) {
      const log = await reserveDeliveryLog({
        contact, email, input,
        status: 'preference_disabled',
        errorCode: pref.source,
      })
      return result('preference_disabled', { deliveryLogId: log?.id ?? null, reason: pref.source })
    }
  }

  // Suppression check runs unconditionally. Only terminal reasons
  // block when adminBypass is set; non-terminal reasons (e.g. a
  // marketing manual_unsubscribe) are allowed through.
  const block = await isSendBlocked({ contactId: contact.id, category: input.category })
  if (block.blocked && block.suppression) {
    const terminal = isTerminalSuppression(block.suppression.reason)
    if (terminal || !bypassPrefAndUnsub) {
      const isUnsub =
        block.suppression.reason === 'manual_unsubscribe' ||
        block.suppression.source === 'unsubscribe_link'
      const status = isUnsub ? 'unsubscribed' : 'suppressed'
      const log = await reserveDeliveryLog({
        contact, email, input,
        status,
        errorCode: block.suppression.reason,
      })
      return result(isUnsub ? 'unsubscribed' : 'suppressed', {
        deliveryLogId: log?.id ?? null,
        reason: block.suppression.reason,
      })
    }
  }

  // 5. Reserve delivery log row with UNIQUE idempotency_key.
  const log = await reserveDeliveryLog({
    contact, email, input,
    status: 'pending',
  })
  if (!log) {
    return result('configuration_error', { reason: 'delivery_log_reserve_failed' })
  }
  if (log.duplicate) {
    // Another concurrent call already reserved this idempotency key.
    return result('duplicate', { deliveryLogId: log.id, reason: 'idempotency_conflict' })
  }

  // 6. Send.
  const from    = resolveFromAddress()
  const replyTo = input.replyTo ?? resolveReplyTo()
  const headers: Record<string, string> = {}
  // Marketing/newsletter MUST carry one-click unsubscribe headers per
  // RFC 8058. Transactional/auth MUST NOT — Supabase Auth's own SMTP
  // path handles those messages and adding the headers would clash.
  if (isMarketing(input.category)) {
    const unsubUrl = buildUnsubscribePlaceholder()
    if (unsubUrl) {
      headers['List-Unsubscribe']      = `<${unsubUrl}>`
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    }
  }
  if (isTransactional(input.category)) {
    // Auth/transactional sends through this service are explicitly
    // separate from Supabase Auth SMTP. Document the choice in the
    // operator runbook before routing any auth mail this way.
  }

  let resendEmailId: string | null = null
  let providerErrorCode: string | null = null

  try {
    const { data, error } = await resendClient.emails.send({
      from,
      to:        email,
      subject:   input.subject,
      html:      input.html,
      text:      input.text,
      replyTo,
      headers,
      tags:      input.tags ? [...input.tags] : undefined,
    })
    if (error) {
      providerErrorCode = (error as { name?: string }).name ?? 'provider_error'
      console.error(
        '[email/send] resend error:',
        providerErrorCode,
        (error as { message?: string }).message ?? '',
      )
    } else if (data && typeof (data as { id?: string }).id === 'string') {
      resendEmailId = (data as { id: string }).id
    }
  } catch (e) {
    providerErrorCode = 'sdk_exception'
    console.error(
      '[email/send] resend threw:',
      e instanceof Error ? e.name + ': ' + e.message : 'non-Error throw',
    )
  }

  // 7. Record the outcome on the reserved log row.
  const finalStatus: 'sent' | 'provider_error' = resendEmailId ? 'sent' : 'provider_error'
  const nowIso = new Date().toISOString()
  await supa
    .from('email_delivery_log')
    .update({
      status:          finalStatus,
      resend_email_id: resendEmailId,
      error_code:      providerErrorCode,
      sent_at:         resendEmailId ? nowIso : null,
      failed_at:       resendEmailId ? null    : nowIso,
    })
    .eq('id', log.id)

  if (resendEmailId) {
    return result('sent', { emailId: resendEmailId, deliveryLogId: log.id })
  }
  return result('provider_error', { deliveryLogId: log.id, reason: providerErrorCode ?? 'unknown' })
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function reserveDeliveryLog(args: {
  contact: { id: string; user_id: string | null }
  email:   string
  input:   SendEmailInput
  status:  'pending' | 'preference_disabled' | 'suppressed' | 'unsubscribed'
  errorCode?: string | null
}): Promise<{ id: string; duplicate: boolean } | null> {
  const supa = getSupabaseServiceClient()
  let recipientHash: string | null = null
  try { recipientHash = await hashEmail(args.email) }
  catch { recipientHash = null }

  const row = {
    contact_id:           args.contact.id,
    user_id:              args.contact.user_id,
    recipient_email_hash: recipientHash,
    template_key:         args.input.templateKey,
    category:             args.input.category,
    campaign_key:         args.input.campaignKey ?? null,
    status:               args.status,
    idempotency_key:      args.input.idempotencyKey,
    error_code:           args.errorCode ?? null,
    metadata_json:        sanitiseMetadata(args.input.metadata),
  }

  const insert = await supa
    .from('email_delivery_log')
    .insert(row)
    .select('id')
    .single()
  if (insert.error) {
    // Postgres unique_violation = 23505. Treat as concurrent dup.
    if ((insert.error as { code?: string }).code === '23505') {
      const existing = await supa
        .from('email_delivery_log')
        .select('id')
        .eq('idempotency_key', args.input.idempotencyKey)
        .maybeSingle()
      if (existing.data?.id) {
        return { id: existing.data.id as string, duplicate: true }
      }
      return null
    }
    console.error('[email/send] reserve insert failed:', insert.error.code, insert.error.message)
    return null
  }
  return { id: insert.data!.id as string, duplicate: false }
}

const META_MAX_KEYS  = 16
const META_MAX_VALUE = 200

/**
 * Drops anything that looks like a token, recipient or HTML body. The
 * delivery log metadata is operator-visible; we never let a caller
 * stash sensitive content there.
 */
function sanitiseMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {}
  const banned = /token|secret|password|cookie|body|html|recipient/i
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(meta)) {
    if (count >= META_MAX_KEYS) break
    if (banned.test(k)) continue
    if (typeof v === 'string') {
      out[k] = v.length > META_MAX_VALUE ? v.slice(0, META_MAX_VALUE) : v
    } else if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v
    } else {
      continue
    }
    count++
  }
  return out
}

function buildUnsubscribePlaceholder(): string | null {
  // The marketing send path will fill this in with a real per-contact
  // token URL in a future block. We emit a stable placeholder today so
  // the header presence is testable without leaking a token URL with
  // no backing record.
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pokeprices.io').trim()
  return origin ? `${origin}/api/unsubscribe` : null
}
