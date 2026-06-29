// src/app/api/account/plan/route.ts
// Block 5A-W-25 — server-side plan lookup for the signed-in user.
//
// Returns `{ plan: 'free' | 'pro' }` after verifying the caller's
// Supabase Auth session via the Bearer JWT they send. The full
// `ACCOUNT_PRO_USER_IDS` allowlist NEVER leaves the server — the
// route is the privacy boundary that turns "is this id in the
// list?" into a single boolean the bundle can consume.
//
// Auth:
//   * Bearer token required. Anonymous callers fall back to the
//     'free' default with HTTP 200 — the page paints fine without
//     a session, and middleware/UI handle the "please log in" flow.
//   * Invalid / expired token → 401. The client treats that as
//     'free' (the hook's error path).
//
// Read-only. Never writes to any table. Never echoes the user_id
// or email in the response body.

import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolvePlanForUser } from '@/lib/account/accountPlan'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

export async function GET(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''

  // No bearer → treat as anonymous → free plan. We don't 401 here
  // because the dashboard pages call this before the session is
  // necessarily established; surfacing a 401 would noisily flash
  // free→error→free in the UI.
  if (!token) {
    return NextResponse.json({ plan: 'free' })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Misconfig: fail closed AND don't leak the cause.
    return NextResponse.json({ plan: 'free' }, { status: 503 })
  }

  // Fresh anon client purely to validate the token. Pass the token
  // to getUser() rather than to the client constructor so we never
  // attach the caller's session to the long-lived module.
  const supa = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data?.user) {
    return NextResponse.json({ plan: 'free' }, { status: 401 })
  }

  // `profiles.plan` doesn't exist today, so we pass `null`. When the
  // future Stripe block adds the column, swap this for a single
  // SELECT on profiles.plan + pass through to resolvePlanForUser.
  const plan = resolvePlanForUser({ userId: data.user.id, profile: null })
  return NextResponse.json({ plan })
}
