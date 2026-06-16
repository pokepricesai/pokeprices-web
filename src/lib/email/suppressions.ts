// src/lib/email/suppressions.ts
// Server-only helpers for email_suppressions.
//
// Suppression precedence — read once and treat as the canonical rule:
//
//   1. A per-category suppression (suppression.category = X) blocks
//      sends with sendCategory = X. It does NOT block other categories.
//
//   2. A GLOBAL suppression (suppression.category IS NULL) blocks
//      according to its reason:
//
//      Reason                  | Blocks
//      ------------------------+-------------------------------------
//      hard_bounce             | ALL categories (incl. transactional)
//      complaint               | ALL categories (incl. transactional)
//      invalid_address         | ALL categories (incl. transactional)
//      admin_suppression       | ALL categories (incl. transactional)
//      provider_rejection      | ALL categories (incl. transactional)
//      manual_unsubscribe      | marketing_newsletter only
//      soft_bounce_threshold   | all non-transactional
//
//   The five "always-block" reasons above are the TERMINAL_REASONS.
//   Even admin/test sends through adminBypass cannot send to a contact
//   carrying any of them. Operators see immediately when a test
//   recipient is in a terminal state.
//
//   Manual marketing unsubscribe deliberately does NOT block
//   transactional/service email — those messages are about an action
//   the recipient took and reach them regardless of marketing opt-out.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { type EmailCategory, EMAIL_CATEGORIES, isTransactional } from './categories'

export type SuppressionReason =
  | 'hard_bounce'
  | 'complaint'
  | 'manual_unsubscribe'
  | 'admin_suppression'
  | 'invalid_address'
  | 'provider_rejection'
  | 'soft_bounce_threshold'

export type SuppressionSource =
  | 'webhook_bounce'
  | 'webhook_complaint'
  | 'webhook_failed'
  | 'unsubscribe_link'
  | 'admin_action'
  | 'send_service'

export type Suppression = {
  id:                 string
  contact_id:         string
  reason:             SuppressionReason
  category:           string | null
  source:             SuppressionSource
  provider_event_id:  string | null
  created_at:         string
  lifted_at:          string | null
}

/**
 * Reasons that block ALL categories when applied globally — including
 * transactional. They also resist `adminBypass`. The five-reason
 * terminal set is the single source of truth for both the runtime
 * suppression check and the documentation in
 * docs/email-infrastructure.md.
 */
export const TERMINAL_SUPPRESSION_REASONS: ReadonlyArray<SuppressionReason> = [
  'hard_bounce',
  'complaint',
  'invalid_address',
  'admin_suppression',
  'provider_rejection',
]

export function isTerminalSuppression(reason: SuppressionReason): boolean {
  return (TERMINAL_SUPPRESSION_REASONS as ReadonlyArray<string>).includes(reason)
}

/**
 * Does a single active suppression block a send for the given
 * category? Pure rule: see the precedence table at the top of this
 * file.
 */
export function suppressionBlocks(
  suppression: { reason: SuppressionReason; category: string | null },
  sendCategory: EmailCategory,
): boolean {
  // Per-category suppression: blocks ONLY its own category.
  if (suppression.category != null) {
    return suppression.category === sendCategory
  }

  // Global suppression — branch on reason.
  switch (suppression.reason) {
    case 'hard_bounce':
    case 'complaint':
    case 'invalid_address':
    case 'admin_suppression':
    case 'provider_rejection':
      return true                                            // blocks everything

    case 'manual_unsubscribe':
      return sendCategory === EMAIL_CATEGORIES.MARKETING_NEWSLETTER

    case 'soft_bounce_threshold':
      return !isTransactional(sendCategory)
  }
  return !isTransactional(sendCategory) // defensive default
}

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Returns the active suppressions (lifted_at IS NULL) for a contact.
 * Empty array on error so callers can treat unknown failures as
 * "not suppressed" only when paired with a structural fallback at the
 * call site — sendEmail() bails on the read error rather than risking a
 * wrong send.
 */
export async function getActiveSuppressions(contactId: string): Promise<Suppression[]> {
  const supa = getSupabaseServiceClient()
  const r = await supa
    .from('email_suppressions')
    .select('id, contact_id, reason, category, source, provider_event_id, created_at, lifted_at')
    .eq('contact_id', contactId)
    .is('lifted_at', null)
  if (r.error) {
    console.error('[email/suppressions] read failed:', r.error.code)
    return []
  }
  return (r.data ?? []) as Suppression[]
}

/**
 * Returns the first active suppression that would block a send for
 * `category`, or null. See suppressionBlocks() for the precedence rule.
 */
export async function isSendBlocked(input: {
  contactId: string
  category:  EmailCategory
}): Promise<{ blocked: boolean; suppression?: Suppression }> {
  const active = await getActiveSuppressions(input.contactId)
  for (const s of active) {
    if (suppressionBlocks({ reason: s.reason, category: s.category }, input.category)) {
      return { blocked: true, suppression: s }
    }
  }
  return { blocked: false }
}

/**
 * Records a suppression. Idempotent thanks to the unique index on
 * (contact_id, reason, COALESCE(category, '__global__')).
 *
 * When a row already exists for that triple, the call succeeds without
 * overwriting `lifted_at` — only an explicit lift can do that.
 */
export async function applySuppression(input: {
  contactId:         string
  reason:            SuppressionReason
  category?:         EmailCategory | null
  source:            SuppressionSource
  providerEventId?:  string | null
  notesInternal?:    string | null
}): Promise<{ ok: boolean; created: boolean }> {
  const supa = getSupabaseServiceClient()
  const row = {
    contact_id:        input.contactId,
    reason:            input.reason,
    category:          input.category ?? null,
    source:            input.source,
    provider_event_id: input.providerEventId ?? null,
    notes_internal:    input.notesInternal   ?? null,
  }
  // INSERT … ON CONFLICT DO NOTHING semantics via upsert+ignoreDuplicates.
  const r = await supa
    .from('email_suppressions')
    .upsert(row, {
      onConflict:       'contact_id,reason,category',
      ignoreDuplicates: true,
    })
    .select('id')
  if (r.error) {
    console.error('[email/suppressions] apply failed:', r.error.code, r.error.message)
    return { ok: false, created: false }
  }
  return { ok: true, created: (r.data?.length ?? 0) > 0 }
}
