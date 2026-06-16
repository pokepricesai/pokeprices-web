// src/lib/email/types.ts
// Shared types for the central email send service.

import type { EmailCategory } from './categories'

export type SendOutcome =
  | 'sent'
  | 'suppressed'
  | 'unsubscribed'
  | 'preference_disabled'
  | 'duplicate'
  | 'invalid_recipient'
  | 'provider_error'
  | 'configuration_error'

export type SendResult = {
  outcome:        SendOutcome
  emailId?:       string | null  // Resend's message id
  deliveryLogId?: string | null  // our internal log row id
  reason?:        string         // short, operator-safe diagnostic
}

export type EmailTag = { name: string; value: string }

/**
 * Inputs accepted by sendEmail(). The recipient is always validated and
 * may be replaced when the environment forces a locked recipient (see
 * docs/email-infrastructure.md → Preview safeguards).
 */
export type SendEmailInput = {
  toEmail:        string
  category:       EmailCategory
  templateKey:    string
  subject:        string
  html:           string
  text:           string
  /**
   * Application-supplied idempotency key. Two calls with the same key
   * collapse into a single delivery log row (UNIQUE on the column).
   * Must be stable across retries.
   */
  idempotencyKey: string
  campaignKey?:   string | null
  metadata?:      Record<string, unknown>
  replyTo?:       string
  tags?:          ReadonlyArray<EmailTag>
  /**
   * Named bypass for admin/test routes only.
   *
   * What it bypasses:
   *   * user category preference checks
   *   * the marketing-context manual_unsubscribe suppression
   *   * the soft_bounce_threshold suppression
   *   * the Preview-environment recipient lock, BUT ONLY when the
   *     send is already targeted at EMAIL_TEST_RECIPIENT
   *     (recipientLocked: true)
   *
   * What it does NOT bypass — these always block, including from
   * admin/test routes, so operators see immediately when the test
   * recipient is in a terminal state:
   *   * invalid recipient (the address cannot be parsed)
   *   * hard_bounce, complaint, invalid_address, admin_suppression,
   *     provider_rejection on the contact
   *
   * The protected delivery-test route sets this with
   * `recipientLocked: true` so the operator opts in to the bypass
   * surface area explicitly.
   */
  adminBypass?:   { reason: string; recipientLocked: true }
}
