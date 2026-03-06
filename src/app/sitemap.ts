import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: 'https://pokeprices.io', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: 'https://pokeprices.io/browse', lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: 'https://pokeprices.io/insights', lastModified: new Date(), changeFrequency: 'daily', priority: 0.7 },
    { url: 'https://pokeprices.io/contact', lastModified: new Date(), changeFrequency: 'monthly', priority: 0.3 },
  ]

  let setPages: MetadataRoute.Sitemap = []
  try {
    const { data: sets } = await supabase.rpc('get_distinct_set_names')
    if (sets) {
      setPages = sets.map((s: any) => ({
        url: `https://pokeprices.io/set/${encodeURIComponent(s.set_name)}`,
        lastModified: new Date(),
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      }))
    }
  } catch (e) {
    console.error('Sitemap: failed to load sets', e)
  }

  let cardPages: MetadataRoute.Sitemap = []
  try {
    const { data: cards } = await supabase.rpc('get_sitemap_cards', { max_cards: 5000 })
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
