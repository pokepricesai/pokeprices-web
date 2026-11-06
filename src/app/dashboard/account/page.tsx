// CN-IDENTITY-02 · PokePrices dashboard account surface.
//
// Hosts the shared Collector Network membership + Discord-link
// panel. Lives under /dashboard because that is where every other
// authenticated surface on PokePrices lives; the dashboard shell
// provides the sidebar + mobile drawer automatically.
//
// The IdentityPanel talks to the shared collector_memberships /
// collector_discord_links schema — linking Discord here is visible
// immediately on MTG / YGO / OnePiece / Lorcana.

import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { getUserDiscordLink, getUserMembership } from '@/lib/entitlements'
import IdentityPanel from '@/components/account/IdentityPanel'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Account | PokePrices',
  robots: { index: false, follow: false },
}

interface Props {
  searchParams?: Promise<{ discord?: string }>
}

export default async function DashboardAccountPage({ searchParams }: Props) {
  const user = await requireAuthUser('/dashboard/account')
  const supabase = await getSupabaseServerClient()
  const [membership, discordLink] = await Promise.all([
    getUserMembership(supabase, user.id),
    getUserDiscordLink(supabase, user.id),
  ])
  const sp = (await searchParams) ?? {}

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '8px 24px 80px' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted, #6B7280)' }}>
        Account
      </div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28 }}>Your Collector Network account</h1>
      <p style={{ marginTop: 8, color: 'var(--text-muted, #6B7280)', fontSize: 14, maxWidth: 620 }}>
        Your email, Google sign-in and (optional) Discord link all point at
        a single Collector Network account. Changes here apply everywhere
        on the network.
      </p>

      <IdentityPanel
        membership={membership}
        discordLink={discordLink}
        discordFlag={sp.discord ?? null}
      />
    </div>
  )
}
