import { createClient } from '@supabase/supabase-js'
import { redirect, notFound } from 'next/navigation'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function CardPage({ params }: { params: { slug: string } }) {
  const { data: card } = await supabaseServer.rpc('get_card_detail', { slug: params.slug })
  
  if (!card) notFound()
  
  const setEncoded = encodeURIComponent(card.set_name)
  const cardSlug = card.card_url_slug || params.slug
  
  redirect(`/set/${setEncoded}/card/${cardSlug}`)
}
