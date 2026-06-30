// app/vendors/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import VendorDetailClient from './VendorDetailClient'
import { notFound } from 'next/navigation'

const SITE_URL = 'https://www.pokeprices.io'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type VendorRow = {
  name?: string | null
  description?: string | null
  city?: string | null
  country?: string | null
  image_url?: string | null
} | null

async function loadVendor(slug: string): Promise<VendorRow> {
  const { data } = await supabase
    .from('vendors')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single()
  return data as VendorRow
}

// Block 5A-W-32 — was missing entirely, so the page inherited the
// root layout's home-page title and canonical for every vendor URL.
// Generates per-vendor title/description/canonical/OG so each public
// vendor detail page has a unique, self-referencing SEO surface.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const vendor = await loadVendor(slug)
  const canonical = `${SITE_URL}/vendors/${slug}`

  if (!vendor) {
    return {
      title:       'Vendor not found — PokePrices',
      description: 'This vendor profile is no longer available.',
      robots:      { index: false, follow: false },
      alternates:  { canonical },
    }
  }

  const name        = vendor.name?.trim() || 'Pokémon card vendor'
  const location    = [vendor.city, vendor.country].filter(Boolean).join(', ')
  const fallbackDesc = location
    ? `${name} — Pokémon card shop based in ${location}. Listed in the PokePrices vendor directory.`
    : `${name} — listed in the PokePrices vendor directory of Pokémon card shops.`
  const description = vendor.description?.trim() || fallbackDesc

  const title = location
    ? `${name} — Pokémon Card Shop in ${location} | PokePrices`
    : `${name} — Pokémon Card Shop | PokePrices`

  const ogImage = vendor.image_url || `${SITE_URL}/og-image.png`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type:        'website',
      url:         canonical,
      siteName:    'PokePrices',
      title,
      description,
      images:      [{ url: ogImage, alt: name }],
    },
    twitter: {
      card:        'summary_large_image',
      title,
      description,
      images:      [ogImage],
    },
  }
}

export default async function VendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const data = await loadVendor(slug)

  if (!data) notFound()
  return <VendorDetailClient vendor={data} />
}