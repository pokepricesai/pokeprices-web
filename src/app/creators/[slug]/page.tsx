// app/creators/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import CreatorProfileClient from './CreatorProfileClient'

export const revalidate = 3600

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared fetch — generateMetadata and the page handler share one query.
// Previously this page was a 'use client' component that returned null
// for unknown slugs (200 OK soft-404). Refactored to a server wrapper
// so we get a true 404 response status when the creator doesn't exist.
const getCreator = cache(async (slug: string) => {
  const { data } = await supabaseServer
    .from('creators')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'approved')
    .maybeSingle()
  return data
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const creator = await getCreator(slug)
  if (!creator) notFound()
  const title       = `${creator.name} — Pokémon TCG creator profile | PokePrices`
  const description = creator.description
    ? `${creator.name}: ${creator.description.slice(0, 150)}`
    : `${creator.name} — Pokémon TCG creator profile on PokePrices. Find their YouTube, X, Instagram and more.`
  const canonical = `https://www.pokeprices.io/creators/${slug}`
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'profile',
      ...(creator.image_url ? { images: [{ url: creator.image_url }] } : {}),
    },
    twitter: {
      card: 'summary',
      title,
      description,
      ...(creator.image_url ? { images: [creator.image_url] } : {}),
    },
  }
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const creator = await getCreator(slug)
  if (!creator) notFound()
  return <CreatorProfileClient creator={creator} />
}
