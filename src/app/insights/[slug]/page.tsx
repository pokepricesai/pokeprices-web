// app/insights/[slug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import InsightsArticleClient from './InsightsArticleClient'

export const revalidate = 3600

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared fetcher. React.cache de-dupes the call within a single render,
// so generateMetadata and the page handler get the SAME row from a SINGLE
// query. They can no longer diverge — previously the metadata function
// could return null (yielding "Article Not Found" + homepage metadata)
// while the page body simultaneously rendered the real article from a
// second query that happened to succeed. .maybeSingle() (rather than
// .single()) makes the zero-row case explicit rather than an error
// silently swallowed by destructuring.
const getArticle = cache(async (slug: string) => {
  const { data, error } = await supabase
    .from('insights')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error) {
    // Don't swallow — surface in build/runtime logs so future flakes are
    // visible. Still return null so callers handle the missing case.
    console.error('[insights/[slug]] fetch error for slug=' + slug + ':', error.message)
    return null
  }
  return data
})

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const article = await getArticle(slug)

  // If the article truly does not exist (or status != published), let
  // Next route to the 404 page. Don't return a half-set metadata object —
  // that fills in title only and leaves description/og/canonical to
  // inherit the homepage defaults from layout.tsx, which is exactly the
  // bug we're fixing.
  if (!article) notFound()

  // Column source-of-truth (verified against InsightsArticleClient):
  //   - headline = article H1 (PRIMARY, always populated)
  //   - intro    = lead paragraph (used as the meta description fallback)
  //   - title / excerpt = legacy/optional columns; kept as fallbacks
  //   - seo_title / seo_description = explicit per-article overrides
  const headline = article.headline || article.title || 'Pokémon card insight'
  const title       = article.seo_title       || headline
  const description = article.seo_description
                   || article.intro
                   || article.excerpt
                   || `${headline} — practical Pokémon card collecting guide from PokePrices.`
  const canonical = `https://www.pokeprices.io/insights/${slug}`
  const image = article.image_url || null

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'article',
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

export default async function InsightsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await getArticle(slug)
  if (!article) notFound()
  return <InsightsArticleClient article={article} />
}
