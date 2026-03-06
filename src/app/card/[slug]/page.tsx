// app/card/[slug]/page.tsx
// Server component wrapper — handles metadata only, renders client component

import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CardPageClient from './CardPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { data: card } = await supabaseServer.rpc('get_card_detail', { slug: params.slug })

  if (!card) return { title: 'Card Not Found' }

  const rawPrice = card.raw_usd ? `$${(card.raw_usd / 100).toFixed(2)}` : null
  const psa10Price = card.psa10_usd ? ` — PSA 10: $${(card.psa10_usd / 100).toFixed(2)}` : ''
  const priceStr = rawPrice ? ` — Raw: ${rawPrice}${psa10Price}` : ''
  const title = `${card.card_name} — ${card.set_name}${priceStr}`
  const description = `${card.card_name} from ${card.set_name}. Current market prices, PSA population data, price trends and grading advice. Updated daily.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: card.image_url ? [{ url: card.image_url, width: 240, alt: card.card_name }] : [],
      url: `https://pokeprices.io/card/${params.slug}`,
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
  }
}

export default function CardPage({ params }: { params: { slug: string } }) {
  return <CardPageClient slug={params.slug} />
}
