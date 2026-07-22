// src/app/api/account/email-digest/preview/route.ts
// Block 5A-W-45A — user-facing preview of the weekly portfolio /
// watchlist digest.
//
// The weekly-digest data builder + email renderer are already fully
// built (see src/lib/alerts/weeklyDigest.ts + weeklyDigestEmail.ts)
// and there is an admin-only preview route at
// /api/admin/alerts/preview-weekly-digest that lets an operator
// inspect any user's rendered email. This route is the equivalent
// surface for the CURRENT signed-in user only: it returns their
// generated digest so a future settings-page preview can render it
// without needing admin credentials.
//
// Auth:
//   * Bearer token required in the Authorization header.
//     Missing / invalid → 401. Unlike /api/account/plan (which
//     falls back to 'free' when anonymous), this route is entirely
//     useless without a real session — there is no meaningful
//     anonymous surface to return.
//
// Behaviour:
//   * Reads are scoped by RLS via an auth-attached anon client, so
//     the builder can only see the calling user's rows even though
//     it selects from RLS-protected tables (watchlist, portfolios,
//     portfolio_items, alert_events, user_alert_preferences,
//     user_email_preferences, email_delivery_log). Public tables
//     (cards, daily_prices, recent_sales) fall back to their public
//     grants.
//   * The digest builder RESPECTS user_alert_preferences: a user
//     who disabled the master switch OR the weekly digest gets a
//     `status: 'disabled_master' | 'disabled_weekly'` response and
//     an empty payload — the same shape the admin preview returns
//     for a disabled user.
//   * Never sends email. Never writes to any table. Never enqueues
//     a delivery. Purely a read + render surface.
//   * Response never echoes the user_id or email.

import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { buildWeeklyDigestForUser } from '@/lib/alerts/weeklyDigest'
import { buildWeeklyDigestEmail } from '@/lib/alerts/weeklyDigestEmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    // Fail closed WITHOUT leaking the specific missing env var.
    return NextResponse.json({ error: 'misconfigured' }, { status: 503 })
  }

  // Auth-attached anon client. Passing the token in `global.headers`
  // makes every subsequent PostgREST call carry the JWT, so RLS
  // scopes reads to the calling user — no service key on this path.
  const supa = createClient(url, anon, {
    auth:   { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  })
  const { data: userData, error: userErr } = await supa.auth.getUser(token)
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const userId = userData.user.id

  try {
    const data  = await buildWeeklyDigestForUser(supa, userId)
    const email = buildWeeklyDigestEmail(data)
    // Response shape mirrors the admin preview route's field names so
    // a future settings-page preview client can consume either surface
    // with the same TypeScript shape. `mode` is always 'real' here —
    // no `sample` fallback is offered on a user-scoped preview because
    // showing hand-crafted fake data to the actual owner would be
    // misleading.
    return NextResponse.json({
      mode:        'real',
      sample:      false,
      status:      data.status,
      subject:     email.subject,
      previewText: email.previewText,
      html:        email.html,
      text:        email.text,
      diagnostics: data.diagnostics,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'preview failed', detail: msg }, { status: 500 })
  }
}
