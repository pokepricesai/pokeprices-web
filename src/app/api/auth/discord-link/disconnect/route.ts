// CN-IDENTITY-02 · Discord disconnect endpoint for pokeprices-web.
//
// POST only. The dashboard Account page's Disconnect button submits
// here. We remove the Supabase Auth Discord identity FIRST and only
// flip the collector_discord_links row on success — if the auth
// identity removal fails, we leave our row untouched so the UI
// stays honest about the state.

import { NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { getOptionalAuthUser } from '@/lib/auth-server'
import { unlinkDiscord } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pokeprices.io'

export async function POST(): Promise<NextResponse> {
  const user = await getOptionalAuthUser()
  if (!user) {
    return NextResponse.redirect(
      new URL('/dashboard/login?returnTo=/dashboard/account', SITE_URL).toString(),
      { status: 303 },
    )
  }
  const supabase = await getSupabaseServerClient()
  const result = await unlinkDiscord(supabase, user.id)
  let flag: string
  if (result.ok) {
    flag = 'disconnected'
  } else {
    const err = result as { ok: false; code: string }
    if (err.code === 'identity_removal_failed') {
      flag = 'identity_removal_failed'
    } else if (err.code === 'not_authenticated') {
      flag = 'no_session'
    } else {
      flag = 'disconnect_failed'
    }
  }
  return NextResponse.redirect(
    new URL(`/dashboard/account?discord=${flag}`, SITE_URL).toString(),
    { status: 303 },
  )
}
