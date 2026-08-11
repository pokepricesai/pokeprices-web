// app/cards/search/page.tsx
//
// Block 5A-W-56A — Deep Card Search hub. Server component; SEO-critical
// hero + delegate the search UX to the client shell.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { createClient } from '@supabase/supabase-js'
import DeepCardSearchClient from './DeepCardSearchClient'

const SITE = 'https://www.pokeprices.io'

export const metadata: Metadata = {
  title:       'Pokémon Card Search — Filter by Price, PSA Grade & Set | PokePrices',
  description: 'Search all English and Japanese Pokémon cards by price, PSA grade, Pokémon, set, release date and price movement. Find cards that match your budget and collection goals.',
  alternates:  { canonical: `${SITE}/cards/search` },
  openGraph: {
    title:       'Pokémon Card Search — Filter by Price, PSA Grade & Set | PokePrices',
    description: 'Search all English and Japanese Pokémon cards by price, PSA grade, Pokémon, set, release date and price movement.',
    url:         `${SITE}/cards/search`,
    siteName:    'PokePrices',
    type:        'website',
  },
  // Faceted-URL discipline (Block spec §20): only the canonical URL
  // is indexable. Query-string variants share the same canonical so
  // Google collapses them into one entry.
  robots:      { index: true, follow: true },
}

// Read once at request time (cheap COUNT). Falls back to a
// conservative estimate if the RPC is unreachable — the page still
// renders, users just see a rounder "40,000+" style number.
async function getCatalogueCount(): Promise<number | null> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { data, error } = await sb.rpc('count_deep_search_catalogue')
    if (error || typeof data !== 'number') return null
    return data
  } catch { return null }
}

export default async function DeepCardSearchPage() {
  const catalogueCount = await getCatalogueCount()
  return (
    // Next.js requires useSearchParams() consumers to sit behind a
    // Suspense boundary so static prerender can bail without failing.
    <Suspense fallback={
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
        <div className="skeleton" style={{ height: 40, width: '40%', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 20, width: '70%' }} />
      </div>
    }>
      <DeepCardSearchClient catalogueCount={catalogueCount} />
    </Suspense>
  )
}
