// src/lib/account/serverEntitlements.ts
// Block 5A-W-27 — server-side entitlement helpers used by the alert
// evaluator + delivery engines. Keeps the env allowlist behind the
// `server-only` boundary so the evaluator can ask "should I create
// an instant alert for this user?" without touching the network or
// pulling the full allowlist into the response.
//
// Today this is a thin wrapper around `isUserInProAllowlist` plus
// the pure `canUseInstantAlerts` entitlement check. When a future
// Stripe block adds `profiles.plan`, extend `getInstantAlertEntitlement`
// to load profile rows in batch and pass them to `resolveUserPlan`.

import 'server-only'
import { isUserInProAllowlist } from './accountPlan'
import { canUseInstantAlerts, resolveUserPlan, type UserPlan } from './entitlements'

export type InstantAlertEntitlement = {
  plan:                 UserPlan
  instantAlertsAllowed: boolean
}

/**
 * Per-user instant-alert entitlement. Currently:
 *   * If ACCOUNT_PRO_USER_IDS contains the user_id → plan='pro' →
 *     instant alerts allowed.
 *   * Otherwise → plan='free' → instant alerts NOT allowed (paid
 *     feature placeholder).
 *
 * Weekly digest is independent of this helper — see
 * `canUseWeeklyDigest` for the parallel check (today free for
 * everyone). The brief is explicit that weekly digest delivery is
 * unaffected by instant-alert gating.
 *
 * The future Stripe block extends this with a `profile.plan` read:
 *   plan = resolveUserPlan({
 *     profile: { plan: row?.plan },
 *     allowlistedAsPro: isUserInProAllowlist(userId),
 *   })
 */
export function getInstantAlertEntitlement(userId: string | null | undefined): InstantAlertEntitlement {
  if (!userId) {
    return { plan: 'free', instantAlertsAllowed: false }
  }
  const plan = resolveUserPlan({
    profile:          null,                          // no profiles.plan column yet
    allowlistedAsPro: isUserInProAllowlist(userId),
  })
  return {
    plan,
    instantAlertsAllowed: canUseInstantAlerts(plan).allowed,
  }
}

/** Convenience boolean — most callers only care about the gate. */
export function isInstantAlertEntitled(userId: string | null | undefined): boolean {
  return getInstantAlertEntitlement(userId).instantAlertsAllowed
}
