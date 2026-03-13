// app/sitemap.ts
// Generates /sitemap.xml dynamically at build time (or on-demand with ISR)
// Covers all PokePrices routes: static pages + sets + cards + pokemon species + insights + vendors

import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

// Use service role key for server-side sitemap generation
// These env vars are already set in your Vercel project
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch all rows by paginating in batches (bypasses Supabase 1000-row limit) */
async function fetchAll<T>(
  table: string,
  select: string,
  filter?: (q: any) => any
): Promise<T[]> {
  const BATCH = 1000
  let offset = 0
  const results: T[] = []

  while (true) {
    let query: any = supabase.from(table).select(select).range(offset, offset + BATCH - 1)
    if (filter) query = filter(query)
    const { data, error } = await query
    if (error || !data || data.length === 0) break
    results.push(...(data as T[]))
    if (data.length < BATCH) break
    offset += BATCH
  }

  return results
}

// ── Sitemap ───────────────────────────────────────────────────────────────────

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // ── 1. Static pages ──────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/browse`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/dealer`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/vendors`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ]

  // ── 2. Set pages (/set/[setName]) ────────────────────────────────────────
  let setPages: MetadataRoute.Sitemap = []
  try {
    const sets = await fetchAll<{ set_name: string; updated_at?: string }>(
      'set_metadata',
      'set_name, updated_at'
    )
    setPages = sets.map(s => ({
      url: `${BASE_URL}/set/${encodeURIComponent(s.set_name)}`,
      lastModified: s.updated_at ? new Date(s.updated_at) : now,
      changeFrequency: 'daily' as const,
      priority: 0.85,
    }))
  } catch (e) {
    console.error('sitemap: failed to fetch sets', e)
  }

  // ── 3. Card pages (/set/[setName]/card/[slug]) ───────────────────────────
  let cardPages: MetadataRoute.Sitemap = []
  try {
    const cards = await fetchAll<{ card_url_slug: string; set_name: string; updated_at?: string }>(
      'cards',
      'card_url_slug, set_name, updated_at',
      q => q.not('card_url_slug', 'is', null)
    )
    cardPages = cards
      .filter(c => c.card_url_slug && c.set_name)
      .map(c => ({
        url: `${BASE_URL}/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
        lastModified: c.updated_at ? new Date(c.updated_at) : now,
        changeFrequency: 'daily' as const,
        priority: 0.75,
      }))
  } catch (e) {
    console.error('sitemap: failed to fetch cards', e)
  }

  // ── 4. Pokémon species pages (/pokemon/[slug]) ──────────────────────────
  let pokemonPages: MetadataRoute.Sitemap = []
  try {
    const species = await fetchAll<{ name: string }>(
      'pokemon_species',
      'name'
    )
    pokemonPages = species.map(s => ({
      url: `${BASE_URL}/pokemon/${s.name.toLowerCase()}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  } catch (e) {
    console.error('sitemap: failed to fetch pokemon species', e)
  }

  // ── 5. Insights articles (/insights/[slug]) ──────────────────────────────
  let insightPages: MetadataRoute.Sitemap = []
  try {
    const insights = await fetchAll<{ slug: string; published_at: string }>(
      'insights',
      'slug, published_at',
      q => q.eq('status', 'published')
    )
    insightPages = insights.map(a => ({
      url: `${BASE_URL}/insights/${a.slug}`,
      lastModified: new Date(a.published_at),
      changeFrequency: 'monthly' as const,
      priority: 0.65,
    }))
  } catch (e) {
    console.error('sitemap: failed to fetch insights', e)
  }

  // ── 6. Vendor pages — disabled until vendor directory is populated
  const vendorPages: MetadataRoute.Sitemap = []

  return [
    ...staticPages,
    ...setPages,
    ...cardPages,
    ...pokemonPages,
    ...insightPages,
    ...vendorPages,
  ]
}
