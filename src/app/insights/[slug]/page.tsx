import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import InsightsArticleClient from './InsightsArticleClient'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function InsightsArticlePage({ params }: { params: { slug: string } }) {
  const { data } = await supabase
    .from('insights')
    .select('*')
    .eq('slug', params.slug)
    .eq('status', 'published')
    .single()

  if (!data) notFound()

  return <InsightsArticleClient article={data} />
}
