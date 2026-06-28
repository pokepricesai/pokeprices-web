// src/lib/account/useUserPlan.ts
// Block 5A-W-24 — React hook that returns the signed-in user's plan.
//
// TODAY: returns 'free' unconditionally. The `profiles` table does
// not carry a plan column and no billing/subscription system exists
// yet (Block 5A-W-24's scope is the foundation, not Stripe).
//
// FUTURE: when Stripe + a real plan source land, swap the body for a
// supabase load:
//
//   const { data } = await supabase
//     .from('profiles')
//     .select('plan')
//     .eq('user_id', userId)
//     .maybeSingle()
//   return getUserPlan(data)
//
// Every consumer already calls `useUserPlan(userId)` and switches on
// the returned plan, so the swap is invisible to the call sites. The
// hook is async-shaped (returns `{ plan, loading }`) for that reason
// — even today's no-op return surfaces a stable shape callers can
// destructure without conditionals.

'use client'

import type { UserPlan } from './entitlements'

export type UserPlanState = {
  /** Current plan. Defaults to 'free' until a real loader is wired. */
  plan:    UserPlan
  /** True while a future async loader is in flight. Always false
   *  today because the value is static; the property exists so
   *  callers don't need to refactor when an async load lands. */
  loading: boolean
}

/**
 * @param _userId  Reserved for the future async load. Accepted today
 *                 so call sites already pass it; ignored by the
 *                 current static return.
 */
export function useUserPlan(_userId: string | null | undefined): UserPlanState {
  // Underscore-prefix the unused param to keep the eslint
  // no-unused-vars rule quiet without changing the public shape.
  void _userId
  return { plan: 'free', loading: false }
}
