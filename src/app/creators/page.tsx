// app/creators/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CreatorsClient from './CreatorsClient'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Pokémon TCG Creators & Content Directory | PokePrices',
  description: 'Browse Pokémon TCG creators on YouTube, X, TikTok, Instagram and beyond. Featured collectors, openers, investors and grading reviewers.',
  alternates: { canonical: 'https://www.pokeprices.io/creators' },
  openGraph: {
    title: 'Pokémon TCG Creators & Content Directory',
    description: 'Browse Pokémon TCG creators on YouTube, X, TikTok, Instagram and beyond.',
    url: 'https://www.pokeprices.io/creators',
    siteName: 'PokePrices',
    type: 'website',
  },
}

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function CreatorsPage() {
  const { data: creators } = await supabaseServer
    .from('creators')
    .select('*')
    .eq('status', 'approved')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
  return <CreatorsClient creators={creators || []} />
}
