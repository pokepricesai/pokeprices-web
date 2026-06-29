// src/lib/account/useUserPlan.ts
// Block 5A-W-24 / 5A-W-25 — React hook that returns the signed-in
// user's plan.
//
// HISTORY
//   5A-W-24: hard-coded 'free' for everyone.
//   5A-W-25: fetches `/api/account/plan` so the server-side env
//            allowlist (ACCOUNT_PRO_USER_IDS) can elevate selected
//            users to 'pro' without billing.
//
// The full allowlist NEVER reaches the bundle — the route returns
// only the resolved `{ plan: 'free' | 'pro' }` boolean-shape.
//
// Caching: a module-level Map keys by user_id so a dashboard mount
// that renders six consumers (summary panel + watchlist + portfolio
// add buttons + override controls + alert prefs) fires the fetch
// exactly once. The cache is per-page-load; navigating away clears
// it on the next bundle load.
//
// loading=true on first render means the gate UIs should hide the
// "X / N" suffix and the upgrade banner until the plan settles —
// without that, a pro user briefly sees free-plan numbers.

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { UserPlan } from './entitlements'

export type UserPlanState = {
  /** Resolved plan. Defaults to 'free' until the fetch returns. */
  plan:    UserPlan
  /** True while the initial fetch is in flight. Settles to false
   *  on success OR failure (we fall back to 'free' on failure). */
  loading: boolean
}

// Module-level promise cache keyed by user_id. A second hook call
// for the same user reuses the in-flight promise instead of firing
// another network round trip. Cleared implicitly on page reload.
const planCache = new Map<string, Promise<UserPlan>>()

/** Force-invalidate the cache for a user. Not used today but
 *  exposed so a future "Refresh plan" admin button can pull a
 *  fresh value without a hard reload. */
export function invalidateUserPlanCache(userId: string | null | undefined): void {
  if (!userId) return
  planCache.delete(userId)
}

async function fetchPlanFromApi(userId: string): Promise<UserPlan> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return 'free'
    const res = await fetch('/api/account/plan', {
      method:  'GET',
      headers: { authorization: `Bearer ${session.access_token}` },
      cache:   'no-store',
    })
    if (!res.ok) return 'free'
    const body = await res.json() as { plan?: unknown }
    return body.plan === 'pro' ? 'pro' : 'free'
  } catch {
    // Network / parse failure → fail open to 'free'. The UI keeps
    // working with the safer (more restrictive) plan; a future
    // retry will pick up the real value.
    void userId
    return 'free'
  }
}

function getOrFetchPlan(userId: string): Promise<UserPlan> {
  const cached = planCache.get(userId)
  if (cached) return cached
  const promise = fetchPlanFromApi(userId)
  planCache.set(userId, promise)
  return promise
}

/**
 * @param userId  The signed-in user's id. Pass `null`/`undefined`
 *                while the session is still loading — the hook
 *                returns `{ plan: 'free', loading: false }`.
 */
export function useUserPlan(userId: string | null | undefined): UserPlanState {
  const [plan,    setPlan]    = useState<UserPlan>('free')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setPlan('free')
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    getOrFetchPlan(userId).then(p => {
      if (!live) return
      setPlan(p)
      setLoading(false)
    })
    return () => { live = false }
  }, [userId])

  return { plan, loading }
}
