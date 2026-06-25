// src/lib/alerts/flags.ts
// Block 5A-W-2 — server-only flag that gates the alert evaluator.
//
// Mirrors the literal-"true" fail-closed pattern used in
// src/lib/recentSales/flags.ts. The evaluator is OFF by default;
// flipping ALERTS_EVALUATOR_ENABLED to the exact lowercase string
// "true" in the deployment env unlocks the admin route. The write
// path (dryRun=false) requires the SAME flag — no separate write
// flag, because the route is already requireAdmin-gated and dryRun
// is the default.
//
// IMPORTANT: this flag is server-scoped (no public prefix). It is
// read only inside server-only modules — never bundled to the
// browser — matching the convention used for the recent-sales flags.

import 'server-only'

function readLiteralTrue(name: string): boolean {
  return (process.env[name] ?? '').trim() === 'true'
}

/**
 * Gates the admin alert-evaluator route AND the orchestrator inside
 * it. When false the route returns 503 and the orchestrator refuses
 * to run, regardless of dryRun.
 */
export function isAlertsEvaluatorEnabled(): boolean {
  return readLiteralTrue('ALERTS_EVALUATOR_ENABLED')
}

/**
 * Gates the admin email-preview route. Separate from the evaluator
 * flag so an operator can review the email design before turning the
 * evaluator on (or vice versa). The preview route accepts EITHER
 * flag — see src/app/api/admin/alerts/preview-email/route.ts.
 */
export function isAlertEmailPreviewEnabled(): boolean {
  return readLiteralTrue('ALERT_EMAIL_PREVIEW_ENABLED')
}

/**
 * Gates the admin send-test-email route. Accepts EITHER this flag or
 * ALERT_EMAIL_PREVIEW_ENABLED so an operator who already enabled
 * previewing can flip the test-send on without juggling two flags.
 * The route also enforces requireAdmin + a hard recipient allow-list
 * (admin email or ALERT_TEST_EMAIL_TO).
 */
export function isAlertTestEmailEnabled(): boolean {
  return readLiteralTrue('ALERT_TEST_EMAIL_ENABLED')
}

/**
 * Gates the admin batch-delivery route (Block 5A-W-6). Strictly its
 * own flag — the preview / test-send flags do NOT unlock real user
 * delivery. The route additionally enforces requireAdmin and
 * dryRun=true as the default.
 */
export function isAlertDeliveryEnabled(): boolean {
  return readLiteralTrue('ALERT_DELIVERY_ENABLED')
}

/**
 * Block 5A-W-15 — gates the admin-only weekly digest preview route
 * (/api/admin/alerts/preview-weekly-digest). Accepts EITHER this flag
 * or ALERT_EMAIL_PREVIEW_ENABLED so an operator who already enabled
 * alert previewing can review the weekly layout without juggling two
 * flags. The route still enforces requireAdmin and never sends email
 * or mutates the database regardless of this flag.
 */
export function isAlertWeeklyDigestPreviewEnabled(): boolean {
  return readLiteralTrue('ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED')
}

/**
 * Block 5A-W-16 — gates the admin-only weekly digest TEST-SEND route
 * (/api/admin/alerts/send-weekly-digest-test). Accepts EITHER this
 * flag or ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED so an operator who has
 * already enabled weekly preview can flip the test-send on without
 * juggling another flag. The route still enforces requireAdmin and a
 * HARD recipient allow-list (admin email or
 * ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO env var). No arbitrary recipient
 * input is accepted.
 */
export function isAlertWeeklyDigestTestEmailEnabled(): boolean {
  return readLiteralTrue('ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED')
}

/**
 * Block 5A-W-12 — per-user delivery cooldown (hours). If a user had
 * any alert_event marked delivered_at within this window, the next
 * batch SKIPS them with outcome=recent_delivery_cooldown — both in
 * preview and send mode. Default 24h; override via env. Out-of-range
 * values (negative / NaN / zero) fall back to the default rather than
 * silently disabling the cooldown.
 */
export const DEFAULT_ALERT_DELIVERY_USER_COOLDOWN_HOURS = 24

export function getAlertDeliveryUserCooldownHours(): number {
  const raw = (process.env.ALERT_DELIVERY_USER_COOLDOWN_HOURS ?? '').trim()
  if (raw.length === 0) return DEFAULT_ALERT_DELIVERY_USER_COOLDOWN_HOURS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_ALERT_DELIVERY_USER_COOLDOWN_HOURS
  return n
}

/**
 * Block 5A-W-17 — gates the admin-only WEEKLY digest BATCH route
 * (/api/admin/alerts/send-weekly-digest-batch). Strictly its own flag
 * — the preview / test-send flags do NOT unlock real user batch
 * delivery. The route additionally enforces requireAdmin, dryRun=true
 * as the default, and the engine-level user cap.
 */
export function isAlertWeeklyDigestBatchEnabled(): boolean {
  return readLiteralTrue('ALERT_WEEKLY_DIGEST_BATCH_ENABLED')
}

/**
 * Block 5A-W-17 — gates the Vercel-Cron-invoked weekly digest route
 * (/api/cron/weekly-digests). The route is also CRON_SECRET-gated, so
 * this flag is the SECOND lock specifically for the cron path; the
 * admin batch route uses ALERT_WEEKLY_DIGEST_BATCH_ENABLED instead.
 * When off, the cron route returns 503 even with a valid secret —
 * lets the operator freeze automation without revoking the secret.
 */
export function isAlertWeeklyDigestCronEnabled(): boolean {
  return readLiteralTrue('ALERT_WEEKLY_DIGEST_CRON_ENABLED')
}

/**
 * Block 5A-W-17 — per-recipient WEEKLY cooldown (days). Default 7
 * (one calendar week between baseline-eligible sends). Out-of-range
 * values fall back to the default rather than silently disabling the
 * cooldown — same posture as getAlertDeliveryUserCooldownHours.
 *
 * Cooldown only counts BASELINE-ELIGIBLE prior sends (Block 5A-W-16I)
 * — admin test sends and samples are explicitly excluded by the
 * orchestrator's metadata filter.
 */
export const DEFAULT_ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS = 7

export function getAlertWeeklyDigestCooldownDays(): number {
  const raw = (process.env.ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS ?? '').trim()
  if (raw.length === 0) return DEFAULT_ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS
  return n
}

/**
 * Block 5A-W-17 — per-invocation cap for the cron route. Caller is
 * Vercel Cron, so we can't read a body. Default 25, hard cap 100 is
 * enforced engine-side regardless of this value.
 */
export const DEFAULT_ALERT_WEEKLY_DIGEST_CRON_MAX_USERS = 25

export function getAlertWeeklyDigestCronMaxUsers(): number {
  const raw = (process.env.ALERT_WEEKLY_DIGEST_CRON_MAX_USERS ?? '').trim()
  if (raw.length === 0) return DEFAULT_ALERT_WEEKLY_DIGEST_CRON_MAX_USERS
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_ALERT_WEEKLY_DIGEST_CRON_MAX_USERS
  return n
}

export const ALERTS_EVALUATOR_FLAG_NAMES: ReadonlyArray<string> = [
  'ALERTS_EVALUATOR_ENABLED',
  'ALERT_EMAIL_PREVIEW_ENABLED',
  'ALERT_TEST_EMAIL_ENABLED',
  'ALERT_DELIVERY_ENABLED',
  'ALERT_DELIVERY_USER_COOLDOWN_HOURS',
  'ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED',
  'ALERT_WEEKLY_DIGEST_TEST_EMAIL_ENABLED',
  'ALERT_WEEKLY_DIGEST_TEST_EMAIL_TO',
  'ALERT_WEEKLY_DIGEST_BATCH_ENABLED',
  'ALERT_WEEKLY_DIGEST_CRON_ENABLED',
  'ALERT_WEEKLY_DIGEST_COOLDOWN_DAYS',
  'ALERT_WEEKLY_DIGEST_CRON_MAX_USERS',
]
