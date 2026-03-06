import { redirect, notFound } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function OldCardRedirect({ params }: { params: { slug: string } }) {
  const { data: card } = await supabaseServer.rpc('get_card_detail', { slug: params.slug })

  if (!card) notFound()

  // Fetch the card_url_slug from the cards table
  const { data: cardRow } = await supabaseServer
    .from('cards')
    .select('card_url_slug, set_name')
    .eq('card_slug', params.slug)
    .single()

  if (!cardRow) notFound()

  const newUrl = `/set/${encodeURIComponent(cardRow.set_name)}/card/${cardRow.card_url_slug}`
  redirect(newUrl)
}
