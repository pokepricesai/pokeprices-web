// app/set/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import SetPageClient from './SetPageClient'
import { getSetSeo } from '@/lib/seo-helpers'
// Block 5A-W-46B — server-side breadcrumb emitter. SetPageClient used
// to emit BreadcrumbSchema, but it fetches its card list via useEffect
// so the initial HTML shipped no breadcrumb JSON-LD. SetStructuredData
// stays in the client for now because it needs the card list; a later
// block should lift that fetch into the server so the CollectionPage +
// Dataset schema also arrive in initial HTML.
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

export const revalidate = 86400

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared existence check. Two layers, both cheap:
//   1. set_metadata row by exact set_name match (canonical source of
//      truth that drives sitemap-sets.xml)
//   2. fallback to a cards.set_name lookup — sets without a metadata
//      row but with cards in the DB still render rather than 404
// We don't gate on either query failing transiently; only when BOTH
// return zero rows do we call notFound().
const setExists = cache(async (setName: string): Promise<boolean> => {
  try {
    const { data: meta } = await supabaseServer
      .from('set_metadata')
      .select('set_name')
      .eq('set_name', setName)
      .maybeSingle()
    if (meta) return true
    const { data: card } = await supabaseServer
      .from('cards')
      .select('set_name')
      .eq('set_name', setName)
      .limit(1)
      .maybeSingle()
    return !!card
  } catch (e) {
    console.error('[set/[slug]] existence check error:', e)
    return true   // fail-open: don't 404 on a transient DB error
  }
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const setName = decodeURIComponent(slug)

  // Soft-404 fix: prior version rendered metadata for any URL slug,
  // even nonsense ones. Confirm the set exists before promising Google
  // a canonical for it.
  if (!(await setExists(setName))) notFound()

  // Block 5A-W-34A — title/description rewritten to match the queries
  // GSC + Bing show people actually use for set pages: "{set} card
  // list", "{set} card prices", "most valuable cards", "PSA 10
  // values", "chase cards". Baseline before this change (Chaos
  // Rising): 1,313 impressions / 6 clicks / 0.46% CTR / pos 10.8.
  const seo = getSetSeo(setName, slug)
  const title       = seo.title
  const description = seo.description
  const canonical   = seo.canonical

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: { card: 'summary', title, description },
    alternates: { canonical },
  }
}

export default async function SetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const setName = decodeURIComponent(slug)
  if (!(await setExists(setName))) notFound()
  return (
    <>
      {/* Block 5A-W-46B — server-emitted BreadcrumbList so the schema
          is present in initial HTML. `SetPageClient` no longer emits
          this to avoid a duplicate BreadcrumbList node. */}
      <BreadcrumbSchema items={[
        { name: 'Sets', url: '/browse' },
        { name: setName },
      ]} />
      <SetPageClient slug={slug} />
    </>
  )
}
