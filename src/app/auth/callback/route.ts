// src/app/auth/callback/route.ts
// Single callback for every Supabase auth flow:
//
//   * OAuth (Google) — Supabase redirects here with ?code=…
//   * Magic link sign-in — same shape: ?code=…
//   * Password recovery — same code exchange, then we route the user to
//     /auth/reset-password to set a new password.
//
// The handler:
//   1. Exchanges the code for a session.
//   2. Validates the returnTo against an internal-paths-only allow-list.
//   3. Redirects to the validated target on success.
//   4. Surfaces a clear error via /dashboard/login?error=… on failure.

import 'server-only'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { safeReturnTo } from '@/lib/returnTo'
import { tryEnrolOnboarding } from '@/lib/email/onboarding'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code             = url.searchParams.get('code')
  const oauthError       = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description') || oauthError
  const typeParam        = url.searchParams.get('type')
  const requestedReturn  = url.searchParams.get('returnTo')

  // Validate returnTo with a strict internal-only check. For recovery
  // flows, force the user to the reset-password page regardless of what
  // the email link tried to do.
  const defaultReturn = typeParam === 'recovery' ? '/auth/reset-password' : '/dashboard'
  const safe          = safeReturnTo(requestedReturn) ?? defaultReturn

  if (oauthError) {
    const target = new URL('/dashboard/login', req.url)
    target.searchParams.set('error', errorDescription || oauthError || 'Authentication failed.')
    return NextResponse.redirect(target)
  }

  if (code) {
    let supa
    try {
      supa = await getSupabaseServerClient()
    } catch {
      const target = new URL('/dashboard/login', req.url)
      target.searchParams.set('error', 'Server misconfigured.')
      return NextResponse.redirect(target)
    }
    const { data, error } = await supa.auth.exchangeCodeForSession(code)
    if (error) {
      const target = new URL('/dashboard/login', req.url)
      target.searchParams.set('error', error.message || 'Could not complete sign-in.')
      return NextResponse.redirect(target)
    }

    // Best-effort onboarding enrolment. NEVER blocks the redirect:
    //   * the helper short-circuits when EMAIL_ONBOARDING_ENABLED is unset
    //   * any DB or contact upsert failure is logged and swallowed
    //   * the helper has its own PK-collision idempotency so a recovery
    //     flow that re-enters this branch does not duplicate state.
    // Recovery flow (?type=recovery) intentionally skips enrolment.
    const userId = data?.user?.id
    if (typeParam !== 'recovery' && typeof userId === 'string' && userId.length > 0) {
      try {
        const result = await tryEnrolOnboarding(userId)
        if (result.outcome !== 'enrolled' && result.outcome !== 'already_enrolled' && result.outcome !== 'feature_disabled') {
          // Operator visibility — never paged on.
          console.info('[auth/callback] onboarding enrolment skipped:', result.outcome)
        }
      } catch (e) {
        console.error('[auth/callback] onboarding enrolment threw:',
          e instanceof Error ? e.name + ': ' + e.message : 'non-Error throw')
      }
    }
  }

  return NextResponse.redirect(new URL(safe, req.url))
}
