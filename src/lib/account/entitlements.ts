// src/lib/account/entitlements.ts
// Block 5A-W-24 — central entitlement / plan-limits helper.
//
// SHAPE
//   * `UserPlan`         — narrow string union the rest of the app
//                          can switch on without stringly-typed bugs.
//   * `PLAN_LIMITS`      — single source of truth for what each plan
//                          gets. `-1` means unlimited.
//   * `getUserPlan(...)` — derives a plan from whatever profile shape
//                          we have today. Defaults to 'free' so a
//                          user with no plan field stays in the free
//                          bucket; safe-by-default for a foundation
//                          block that ships ahead of billing.
//   * `can*(...)`        — boolean+copy guards the UI calls before
//                          attempting an add. Each one returns the
//                          current count, the cap, and a friendly
//                          upgrade reason so the call site renders
//                          the same string everywhere.
//
// SCOPE
//   * No Stripe, no payment flow, no migration. Future block plugs
//     a real plan source into `getUserPlan` (e.g. `profiles.plan`
//     or a `subscriptions` table lookup) — the rest of the surface
//     keeps working unchanged.
//   * Existing users who are already OVER a limit are never asked
//     to delete anything. The guards block ADDITIONS only — read
//     paths, edits, and deletions stay open at every plan level.

/**
 * Known plan tiers. Add new tiers here AND give them a row in
 * PLAN_LIMITS below so the type system forces the limits to stay
 * in sync.
 */
export type UserPlan = 'free' | 'pro'

export type PlanLimits = {
  /** Total portfolio_items across ALL of the user's portfolios.
   *  `-1` = unlimited. */
  portfolioItems:        number
  /** Total rows in `watchlist`. `-1` = unlimited. */
  watchlistItems:        number
  /** Cards with an active per-card override (enabled=true AND
   *  use_global_defaults=false). `-1` = unlimited. */
  customAlertOverrides:  number
  /** Whether the user can turn on instant alert emails. Weekly
   *  digest is independent — see weeklyDigestAllowed. */
  instantAlertsAllowed:  boolean
  /** Whether the user receives the weekly digest. True for everyone
   *  today; the field exists so a future tier can disable it. */
  weeklyDigestAllowed:   boolean
}

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    portfolioItems:       25,
    watchlistItems:       10,
    customAlertOverrides: 3,
    instantAlertsAllowed: false,
    weeklyDigestAllowed:  true,
  },
  pro: {
    portfolioItems:       -1,
    watchlistItems:       -1,
    customAlertOverrides: -1,
    instantAlertsAllowed: true,
    weeklyDigestAllowed:  true,
  },
}

/**
 * Resolve a user's plan from a profile-shaped input. The block 5A-W-24
 * source-of-truth question is open: `profiles` doesn't carry a `plan`
 * column today, and no billing exists. For now every user resolves
 * to 'free'. The future Stripe block will:
 *   * add a `plan` column to `profiles` (or a `subscriptions` table)
 *   * pass `{ plan: row.plan }` to this helper from a server loader
 *
 * Block 5A-W-25 adds a second pro path via the env allowlist (see
 * `resolveUserPlan` below + `accountPlan.ts`). This narrower helper
 * stays for callers that ONLY have a profile shape and no auth
 * context — primarily the unit tests.
 */
export function getUserPlan(profile: { plan?: string | null } | null | undefined): UserPlan {
  const raw = profile?.plan
  if (raw === 'pro') return 'pro'
  return 'free'
}

/**
 * Block 5A-W-25 — canonical plan resolver used by the server route
 * `/api/account/plan`. Plan resolution priority (per the brief):
 *
 *    1. `allowlistedAsPro === true`  → 'pro'  (env ACCOUNT_PRO_USER_IDS)
 *    2. `profile.plan === 'pro'`     → 'pro'  (future Stripe column)
 *    3. otherwise                    → 'free'
 *
 *  Pure on purpose — the env read happens in `accountPlan.ts` (server-
 *  only) and the result is passed in here as a boolean. Keeps this
 *  module browser-safe; the allowlist itself never reaches the bundle.
 */
export function resolveUserPlan(args: {
  profile?:           { plan?: string | null } | null
  allowlistedAsPro?:  boolean
}): UserPlan {
  if (args.allowlistedAsPro === true) return 'pro'
  return getUserPlan(args.profile ?? null)
}

export function getPlanLimits(plan: UserPlan): PlanLimits {
  return PLAN_LIMITS[plan]
}

// ─────────────────────────────────────────────────────────────────────
// User-facing upgrade copy. Centralised so the same wording lands in
// every modal / toast / banner without drifting. Friendly tone per
// the brief: "Upgrade coming soon" / "Unlock more …" — no aggressive
// paywalls.
// ─────────────────────────────────────────────────────────────────────

export const UPGRADE_COPY = {
  watchlistLimit:
    'Free accounts can watch up to 10 cards. Upgrade coming soon for unlimited watchlist alerts.',
  portfolioLimit:
    'Free accounts can hold up to 25 cards in their portfolio. Upgrade coming soon to track an unlimited collection.',
  customAlertLimit:
    'Free accounts can customise alerts on 3 cards. Upgrade coming soon for unlimited custom alerts.',
  instantAlerts:
    'Instant alert emails are part of the upcoming paid plan. Weekly overview emails remain free for every account.',
} as const

// ─────────────────────────────────────────────────────────────────────
// Per-feature guards
//
// Each returns a `EntitlementCheck` so the UI surface can render the
// same shape regardless of which feature triggered it. The `limit`
// is `-1` when the plan grants unlimited access; the `current` is
// echoed back so the UI can show "X / N" without re-counting.
// ─────────────────────────────────────────────────────────────────────

export type EntitlementCheck = {
  allowed:  boolean
  /** -1 = unlimited. */
  limit:    number
  current:  number
  /** Friendly upgrade message; only populated when allowed=false. */
  reason?:  string
}

function check(plan: UserPlan, limit: number, current: number, reason: string): EntitlementCheck {
  if (limit < 0) return { allowed: true, limit, current }
  if (current < limit) return { allowed: true, limit, current }
  return { allowed: false, limit, current, reason }
  // We deliberately compare current < limit (not <=) so a user at
  // exactly the limit can still see their N-th item; the next add
  // blocks. Matches what "watch up to 10" reads like.
}

export function canAddPortfolioItem(plan: UserPlan, currentCount: number): EntitlementCheck {
  return check(plan, getPlanLimits(plan).portfolioItems, currentCount, UPGRADE_COPY.portfolioLimit)
}

export function canAddWatchlistItem(plan: UserPlan, currentCount: number): EntitlementCheck {
  return check(plan, getPlanLimits(plan).watchlistItems, currentCount, UPGRADE_COPY.watchlistLimit)
}

export function canAddCustomAlertOverride(plan: UserPlan, currentCount: number): EntitlementCheck {
  return check(plan, getPlanLimits(plan).customAlertOverrides, currentCount, UPGRADE_COPY.customAlertLimit)
}

export function canUseInstantAlerts(plan: UserPlan): EntitlementCheck {
  const allowed = getPlanLimits(plan).instantAlertsAllowed
  return {
    allowed,
    limit:   allowed ? -1 : 0,
    current: 0,
    ...(allowed ? {} : { reason: UPGRADE_COPY.instantAlerts }),
  }
}

export function canUseWeeklyDigest(plan: UserPlan): EntitlementCheck {
  const allowed = getPlanLimits(plan).weeklyDigestAllowed
  return {
    allowed,
    limit:   allowed ? -1 : 0,
    current: 0,
    ...(allowed ? {} : { reason: 'Weekly digest is unavailable on this plan.' }),
  }
}
