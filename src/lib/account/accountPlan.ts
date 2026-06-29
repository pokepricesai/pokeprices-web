// src/lib/account/accountPlan.ts
// Block 5A-W-25 — server-only entitlement resolution.
//
// Hosts the temporary `ACCOUNT_PRO_USER_IDS` allowlist used to
// elevate selected users (founders, early access, internal testers)
// to the 'pro' plan before Stripe exists. The allowlist is read from
// process.env and NEVER reaches the browser bundle — only the
// boolean result of "is this user pro?" / the final `UserPlan`
// string is sent client-side via `/api/account/plan`.
//
// Resolution priority is documented on `resolveUserPlan` over in
// entitlements.ts; this module just supplies the env-side inputs.

import 'server-only'
import { resolveUserPlan, type UserPlan } from './entitlements'

/**
 * Parse `ACCOUNT_PRO_USER_IDS` into a Set. Comma-separated; trims
 * whitespace; drops empty entries; case-sensitive (user_ids are
 * UUIDs, so case doesn't apply — but we trim defensively for the
 * "u1 ,, , u2" copy-paste case).
 *
 * Exported so the unit tests can pin parsing semantics without
 * having to round-trip through the API route.
 */
export function parseAccountProUserIds(raw: string | undefined): Set<string> {
  const value = (raw ?? '').trim()
  if (value.length === 0) return new Set()
  const parts = value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  return new Set(parts)
}

/** Convenience: returns true when the supplied user_id appears in
 *  the allowlist. The full allowlist never leaves this module. */
export function isUserInProAllowlist(userId: string | null | undefined): boolean {
  if (!userId) return false
  const set = parseAccountProUserIds(process.env.ACCOUNT_PRO_USER_IDS)
  return set.has(userId)
}

/** Top-level server-side plan resolver. Wraps the allowlist read
 *  and delegates the actual resolution to the pure
 *  `resolveUserPlan` helper. Routes call this with the verified
 *  user_id (from the Bearer JWT) and the profile row (if any).
 *  Profile lookup is optional — block 5A-W-24 ships before the
 *  `profiles.plan` column exists, so passing `null` is fine. */
export function resolvePlanForUser(args: {
  userId:    string | null | undefined
  profile?:  { plan?: string | null } | null
}): UserPlan {
  return resolveUserPlan({
    profile:          args.profile ?? null,
    allowlistedAsPro: isUserInProAllowlist(args.userId),
  })
}
