// app/set/[slug]/card/[cardSlug]/page.tsx
import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import CardPageClient from './CardPageClient'

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function fmt(cents: number): string {
  const v = cents / 100
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; cardSlug: string }> }): Promise<Metadata> {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)

  const { data: card } = await supabaseServer.rpc('get_card_detail_by_url_slug', {
    p_set_name: setName,
    p_card_url_slug: cardSlug,
  })

  if (!card) return { title: 'Card Not Found | PokePrices' }

  // Strip trailing " #NN" from card_name (DB stores "Pikachu #55")
  // Regex handles "Pikachu #55", "Pikachu [1st Edition] #55", and trailing suffixes
  const name = card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()

  // Number suffix: prefer "95/165" when set has multiple cards, else "#95"
  let num = ''
  if (card.card_number_display && card.set_printed_total && card.set_printed_total > 1) {
    num = ` ${card.card_number_display}`
  } else if (card.card_number) {
    num = ` #${card.card_number}`
  }

  const rawUsd   = card.raw_usd   ? card.raw_usd   / 100 : null
  const psa9Usd  = card.psa9_usd  ? card.psa9_usd  / 100 : null
  const psa10Usd = card.psa10_usd ? card.psa10_usd / 100 : null
  const multiple = rawUsd && psa10Usd ? psa10Usd / rawUsd : null
  const canonical = `https://www.pokeprices.io/set/${slug}/card/${cardSlug}`
  const year = new Date().getFullYear()

  // Grading variant: PSA 10 is 3x+ raw — grading angle beats raw price angle
  const useGradingVariant = multiple != null && multiple >= 3

  let title: string
  let description: string

  if (useGradingVariant && rawUsd && psa10Usd) {
    title = `${name}${num}: Is It Worth Grading? ${fmt(card.psa10_usd!)} PSA 10 vs ${fmt(card.raw_usd!)} Raw (${year})`
    description = `Is ${name}${num} worth grading? PSA 10 ${fmt(card.psa10_usd!)} is ${multiple!.toFixed(1)}× the raw price of ${fmt(card.raw_usd!)}. ${card.set_name} — gem rate, grading spread, PSA population and recent sold listings.`
  } else if (rawUsd && psa10Usd) {
    title = `${name}${num} Value: ${fmt(card.psa10_usd!)} PSA 10, ${fmt(card.raw_usd!)} Raw (${year}) — ${card.set_name}`
    description = `How much is ${name}${num} worth? ${card.set_name} — ${fmt(card.raw_usd!)} raw${psa9Usd ? `, ${fmt(card.psa9_usd!)} PSA 9` : ''}, ${fmt(card.psa10_usd!)} PSA 10. Price trend, grading spread, PSA population and recent sold listings.`
  } else if (psa10Usd) {
    title = `${name}${num} PSA 10 Value: ${fmt(card.psa10_usd!)} (${year}) — ${card.set_name}`
    description = `${name}${num} PSA 10 value: ${fmt(card.psa10_usd!)}. ${card.set_name} — price trend, PSA population, gem rate and recent sold listings. Updated daily.`
  } else if (rawUsd) {
    title = `${name}${num} Price: ${fmt(card.raw_usd!)} Raw (${year}) — ${card.set_name}`
    description = `How much is ${name}${num} worth? ${card.set_name} — currently ${fmt(card.raw_usd!)} raw. Price trend, grading data, PSA population and recent sold listings. Updated daily.`
  } else {
    title = `${name}${num} Pokémon Card Price Guide (${year}) — ${card.set_name}`
    description = `Track ${name}${num} from ${card.set_name}: raw, PSA 9 and PSA 10 prices, grading spreads, PSA population and recent sold listings. Updated daily.`
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: card.image_url ? [{ url: card.image_url, width: 245, height: 342, alt: name }] : [],
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
    alternates: { canonical },
  }
}

export default async function CardPage({ params }: { params: Promise<{ slug: string; cardSlug: string }> }) {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)
  return <CardPageClient setName={setName} cardUrlSlug={cardSlug} />
}