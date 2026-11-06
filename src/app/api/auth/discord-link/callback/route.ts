// CN-IDENTITY-02 · Discord link OAuth callback for pokeprices-web.
//
// The dashboard Account page kicks off
// supabase.auth.linkIdentity({ provider: 'discord' }) from the
// browser. Supabase handles the OAuth round trip and returns here
// with a ?code param. We exchange the code (attaches the new
// Discord identity to the existing auth.users row) and then mirror
// the identity into collector_discord_links via the server RPC that
// uses auth.uid() to identify the row owner.

import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { linkDiscordFromAuthIdentity } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(new URL('/dashboard/account?discord=denied', url.origin))
  }
  if (!code) {
    return NextResponse.redirect(new URL('/dashboard/account?discord=invalid', url.origin))
  }

  const supabase = await getSupabaseServerClient()
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code)
  if (exchangeErr) {
    return NextResponse.redirect(new URL('/dashboard/account?discord=exchange_failed', url.origin))
  }

  const { data: userResp, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userResp?.user) {
    return NextResponse.redirect(new URL('/dashboard/account?discord=no_session', url.origin))
  }

  const result = await linkDiscordFromAuthIdentity(supabase, userResp.user.id)
  if (result.ok) {
    return NextResponse.redirect(new URL('/dashboard/account?discord=connected', url.origin))
  }
  const err = result as { ok: false; code: string }
  const flag = err.code === 'already_linked'
    ? 'already_linked'
    : err.code === 'no_discord_identity'
    ? 'no_discord_identity'
    : 'link_failed'
  return NextResponse.redirect(new URL(`/dashboard/account?discord=${flag}`, url.origin))
}
