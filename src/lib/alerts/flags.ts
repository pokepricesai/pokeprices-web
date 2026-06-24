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

export const ALERTS_EVALUATOR_FLAG_NAMES: ReadonlyArray<string> = [
  'ALERTS_EVALUATOR_ENABLED',
  'ALERT_EMAIL_PREVIEW_ENABLED',
  'ALERT_TEST_EMAIL_ENABLED',
]
