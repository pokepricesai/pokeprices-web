// app/insights/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import InsightsArticleClient from './InsightsArticleClient'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params

  const { data } = await supabase
    .from('insights')
    .select('title, slug, excerpt, seo_title, seo_description, theme')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (!data) return { title: 'Article Not Found | PokePrices' }

  // Priority: seo_title > article title
  const title = data.seo_title || data.title
  // Priority: seo_description > excerpt > computed fallback
  const description = data.seo_description
    || data.excerpt
    || `${data.title} — practical Pokémon card collecting guide from PokePrices.`

  const canonical = `https://pokeprices.io/insights/${slug}`

  return {
    title: `${title} | PokePrices`,
    description,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: { canonical },
  }
}

export default async function InsightsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data } = await supabase
    .from('insights')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()
  if (!data) notFound()
  return <InsightsArticleClient article={data} />
}