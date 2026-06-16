// src/app/api/onboarding/preference/route.ts
// Block 3B — user-facing endpoint that backs the "Getting started
// tips" toggle in the dashboard settings UI.
//
//   GET  → {
//            optedIn: boolean | null,         // most-recent consent state
//            sequenceStatus: 'pending'|'active'|'completed'|'paused'|'cancelled'|'not_enrolled',
//          }
//   POST → { optedIn: boolean }               (sets the toggle)
//
// Requires a valid Supabase session bearer token. The route does NOT
// trust any body-supplied user id — it reads the user from the token.
//
// Correction pass (Block 3B):
//   * GET now surfaces the user's onboarding-state.status so the UI
//     can render "Not enrolled" / "Completed" wording instead of an
//     ambiguous toggle.
//   * POST does NOT enrol existing users. Toggling ON only re-grants
//     consent; it never creates a new email_onboarding_state row.

import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { readOnboardingConsent, setOnboardingConsent } from '@/lib/email/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AuthResolution = { ok: boolean; userId: string; status: number; error: string }

async function resolveUserId(req: Request): Promise<AuthResolution> {
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  if (!token) return { ok: false, userId: '', status: 401, error: 'Missing bearer token' }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return { ok: false, userId: '', status: 500, error: 'Server misconfigured' }

  const supa = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data?.user) return { ok: false, userId: '', status: 401, error: 'Invalid session' }
  return { ok: true, userId: data.user.id, status: 200, error: '' }
}

async function readSequenceStatus(userId: string): Promise<
  'pending' | 'active' | 'completed' | 'paused' | 'cancelled' | 'not_enrolled'
> {
  const supa = getSupabaseServiceClient()
  const r = await supa
    .from('email_onboarding_state')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle()
  if (r.error || !r.data) return 'not_enrolled'
  const s = (r.data as { status: string }).status
  if (s === 'pending' || s === 'active' || s === 'completed' || s === 'paused' || s === 'cancelled') return s
  return 'not_enrolled'
}

export async function GET(req: Request) {
  const auth = await resolveUserId(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const consent = await readOnboardingConsent(auth.userId)
  const sequenceStatus = await readSequenceStatus(auth.userId)
  return NextResponse.json({
    optedIn:        consent.optedIn,
    sequenceStatus,
  })
}

export async function POST(req: Request) {
  const auth = await resolveUserId(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { optedIn?: unknown } = {}
  try { body = await req.json() } catch { /* empty body acceptable */ }
  const optedIn = body?.optedIn === true
  if (typeof body?.optedIn !== 'boolean') {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const r = await setOnboardingConsent({ userId: auth.userId, optedIn })
  if (!r.ok) {
    return NextResponse.json({ error: 'Save failed' }, { status: 500 })
  }
  return NextResponse.json({ optedIn, sequenceStatus: await readSequenceStatus(auth.userId) })
}
