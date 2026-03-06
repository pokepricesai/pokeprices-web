// app/insights/[slug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import InsightArticleClient from './InsightArticleClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { data: article } = await supabaseServer
    .from('insights')
    .select('title, summary, published_at, category')
    .eq('slug', params.slug)
    .single()

  if (!article) return { title: 'Article Not Found' }

  const title = article.title
  const description = article.summary || `${article.category} insight from PokePrices — Pokemon TCG market analysis powered by real data.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://pokeprices.io/insights/${params.slug}`,
      type: 'article',
      publishedTime: article.published_at,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  }
}

export default function InsightArticlePage({ params }: { params: { slug: string } }) {
  return <InsightArticleClient slug={params.slug} />
}
