// src/app/api/account/pro-early-access/route.ts
// Block 5A-W-28 — capture Pro early-access interest in-app.
//
// Behaviour:
//   * Requires a valid Supabase Auth Bearer token. The caller's
//     user_id comes from the verified JWT — the body's user_id (if
//     present) is IGNORED so a client can never spoof another user.
//   * Body accepts an optional `source` (whitelist below) and an
//     optional free-text `message` (capped 1000 chars). Both are
//     defensively coerced; unknown sources fall back to 'unknown'.
//   * Dedupe: if the same user_id submitted within the last 24h,
//     the route returns `{ ok: true, alreadyRegistered: true }`
//     and does NOT insert a new row. Same success-shape so the UI
//     stays calm either way.
//   * On success: inserts a row using the service-role client. The
//     service-role bypasses RLS but the row carries the user's
//     own auth.uid() in `user_id`, so a downstream RLS-scoped read
//     would still surface it.
//
// Response shape (always 200 on the happy path so clients can
// branch on `alreadyRegistered`):
//   { ok: true, alreadyRegistered: boolean }

import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

/** Whitelist of source surfaces. Mirrors the mount points where
 *  AccountPlanBadge renders the CTA today. */
export const ALLOWED_SOURCES: ReadonlyArray<string> = [
  'dashboard',
  'watchlist_alerts',
  'portfolio',
  'settings',
  'limit_block',
  'unknown',
]
const SOURCE_SET = new Set(ALLOWED_SOURCES)

const MAX_MESSAGE_CHARS  = 1000
const DEDUPE_WINDOW_HOURS = 24
const DEDUPE_WINDOW_MS    = DEDUPE_WINDOW_HOURS * 60 * 60 * 1000

function safeSource(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown'
  return SOURCE_SET.has(raw) ? raw : 'unknown'
}

function safeMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > MAX_MESSAGE_CHARS
    ? trimmed.slice(0, MAX_MESSAGE_CHARS)
    : trimmed
}

export async function POST(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 503 })
  }

  // Verify the JWT and extract the user_id. We use a fresh anon
  // client so the caller's session never attaches to a long-lived
  // module instance.
  const verifier = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authErr } = await verifier.auth.getUser(token)
  if (authErr || !authData?.user) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }
  const user = authData.user

  let body: { source?: unknown; message?: unknown } = {}
  try {
    body = (await req.json()) as { source?: unknown; message?: unknown }
  } catch {
    // Empty body is fine — defaults apply.
  }
  const source  = safeSource(body.source)
  const message = safeMessage(body.message)

  try {
    const supa = getSupabaseServiceClient()

    // Dedupe: any row for this user_id within the last 24h is a hit.
    // We deliberately DON'T match by email — a single user with a
    // legacy email row should still dedupe under their current
    // user_id after re-signing-in.
    const cutoffIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
    const { data: existingRows, error: dedupeErr } = await supa
      .from('pro_early_access_requests')
      .select('id')
      .eq('user_id', user.id)
      .gte('created_at', cutoffIso)
      .limit(1)
    if (dedupeErr) {
      return NextResponse.json(
        { error: 'lookup failed', detail: dedupeErr.message },
        { status: 500 },
      )
    }
    if (Array.isArray(existingRows) && existingRows.length > 0) {
      return NextResponse.json({ ok: true, alreadyRegistered: true })
    }

    const { error: insertErr } = await supa
      .from('pro_early_access_requests')
      .insert({
        user_id:       user.id,
        email:         user.email ?? null,
        source,
        plan_interest: 'pro',
        message,
        metadata_json: {},
      })
    if (insertErr) {
      return NextResponse.json(
        { error: 'insert failed', detail: insertErr.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, alreadyRegistered: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'capture failed', detail: msg }, { status: 500 })
  }
}
