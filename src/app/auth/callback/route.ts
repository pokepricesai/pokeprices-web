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
    const { error } = await supa.auth.exchangeCodeForSession(code)
    if (error) {
      const target = new URL('/dashboard/login', req.url)
      target.searchParams.set('error', error.message || 'Could not complete sign-in.')
      return NextResponse.redirect(target)
    }
  }

  return NextResponse.redirect(new URL(safe, req.url))
}
