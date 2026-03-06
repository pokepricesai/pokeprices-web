import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: 'https://pokeprices.io',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://pokeprices.io/browse',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://pokeprices.io/contact',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  // Set pages
  let setPages: MetadataRoute.Sitemap = []
  try {
    const { data: sets } = await supabase
      .from('cards')
      .select('set_name')
      .order('set_name')
    
    if (sets) {
      const uniqueSets = Array.from(new Set(sets.map((s: any) => s.set_name)))
      setPages = uniqueSets.map((setName: string) => ({
        url: `https://pokeprices.io/set/${encodeURIComponent(setName)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }))
    }
  } catch (e) {
    console.error('Sitemap: failed to load sets', e)
  }

  // Card pages — top 5000 by value (avoid 40k URL sitemap hitting rate limits)
  let cardPages: MetadataRoute.Sitemap = []
  try {
    const { data: cards } = await supabase
      .from('card_trends')
      .select('card_slug')
      .not('current_raw', 'is', null)
      .order('current_raw', { ascending: false })
      .limit(5000)

    if (cards) {
      cardPages = cards.map((c: any) => ({
        url: `https://pokeprices.io/card/${c.card_slug}`,
        lastModified: new Date(),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }))
    }
  } catch (e) {
    console.error('Sitemap: failed to load cards', e)
  }

  return [...staticPages, ...setPages, ...cardPages]
}
