// src/lib/auth-server.ts
// Server-side authentication helpers for App Router pages and route
// handlers. The dashboard auth boundary is implemented at the page level
// (each protected dashboard page calls requireAuthUser at the top) rather
// than as middleware. /api routes keep their own per-route checks; they
// must not depend on this helper.

import 'server-only'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { getSupabaseServerClient } from './supabaseServer'
import { safeReturnTo } from './returnTo'

/**
 * Returns the verified Supabase user, or redirects to /dashboard/login
 * with a safe returnTo if there is no session.
 *
 * NEVER call this from a public catalogue page — it would push every
 * anonymous visitor into the login flow.
 *
 * NEVER trust an "unverified" session for authorisation. We call
 * supabase.auth.getUser() rather than getSession() so the JWT is
 * verified against the auth server, not just the cookie.
 */
export async function requireAuthUser(returnTo: string): Promise<User> {
  const supa = await getSupabaseServerClient()
  const { data, error } = await supa.auth.getUser()
  if (error || !data?.user) {
    const safe = safeReturnTo(returnTo) || '/dashboard'
    redirect(`/dashboard/login?returnTo=${encodeURIComponent(safe)}`)
  }
  return data.user
}

/**
 * Returns the verified user if one exists, otherwise null. Does not
 * redirect. Use for surfaces that render different content for signed-
 * in vs signed-out users without forcing a login.
 */
export async function getOptionalAuthUser(): Promise<User | null> {
  try {
    const supa = await getSupabaseServerClient()
    const { data } = await supa.auth.getUser()
    return data?.user ?? null
  } catch {
    return null
  }
}
