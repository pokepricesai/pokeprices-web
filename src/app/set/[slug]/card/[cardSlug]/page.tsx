// app/set/[slug]/card/[cardSlug]/page.tsx
import type { Metadata } from 'next'
import { cache } from 'react'
import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import CardPageClient from './CardPageClient'
import RecentSalesSection from '@/components/recentSales/RecentSalesSection'
import { loadRecentSalesGroupedForCardIfEnabled } from '@/lib/recentSales/cardQueries'
import { isCardIndexable } from '@/lib/seo-indexability/cardIndexability'

// ISR: regenerate every 24h. Prices refresh nightly, so this aligns with data cadence.
// Dramatically reduces crawl-budget consumption across 40k+ card pages.
export const revalidate = 86400

const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Shared fetch — generateMetadata and the page handler de-dupe to one
// query via React.cache. Returning null here means "no row" cleanly,
// so the caller can notFound() rather than rendering a soft-404 page.
const getCard = cache(async (setName: string, cardSlug: string) => {
  const { data } = await supabaseServer.rpc('get_card_detail_by_url_slug', {
    p_set_name: setName,
    p_card_url_slug: cardSlug,
  })
  return data
})

function fmt(cents: number): string {
  const v = cents / 100
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; cardSlug: string }> }): Promise<Metadata> {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)

  const card = await getCard(setName, cardSlug)

  // Soft-404 fix: prior version returned { title: 'Card Not Found' } and
  // 200 OK, letting Google index a half-empty page for any URL slug.
  // Now we throw a true 404.
  if (!card) notFound()

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
    title = `${name}${num} Price: ${fmt(card.psa10_usd!)} PSA 10 vs ${fmt(card.raw_usd!)} Raw — Worth Grading? (${year})`
    description = `Is ${name}${num} worth grading? PSA 10 ${fmt(card.psa10_usd!)} is ${multiple!.toFixed(1)}× the raw price of ${fmt(card.raw_usd!)}. ${card.set_name} price guide — gem rate, grading spread, PSA population and recent sold listings.`
  } else if (rawUsd && psa10Usd) {
    title = `${name}${num} Price & Value: ${fmt(card.raw_usd!)} Raw, ${fmt(card.psa10_usd!)} PSA 10 (${year}) — ${card.set_name}`
    description = `How much is ${name}${num} worth? ${card.set_name} price guide — ${fmt(card.raw_usd!)} raw${psa9Usd ? `, ${fmt(card.psa9_usd!)} PSA 9` : ''}, ${fmt(card.psa10_usd!)} PSA 10. Price trend, grading spread, PSA population and recent sold listings.`
  } else if (psa10Usd) {
    title = `${name}${num} PSA 10 Price & Value: ${fmt(card.psa10_usd!)} (${year}) — ${card.set_name}`
    description = `${name}${num} PSA 10 value: ${fmt(card.psa10_usd!)}. ${card.set_name} price guide — price trend, PSA population, gem rate and recent sold listings. Updated daily.`
  } else if (rawUsd) {
    title = `${name}${num} Price: ${fmt(card.raw_usd!)} Raw (${year}) — ${card.set_name}`
    description = `How much is ${name}${num} worth? ${card.set_name} price guide — currently ${fmt(card.raw_usd!)} raw. Price trend, grading data, PSA population and recent sold listings. Updated daily.`
  } else {
    title = `${name}${num} Pokémon Card Price Guide (${year}) — ${card.set_name}`
    description = `Track ${name}${num} from ${card.set_name}: raw, PSA 9 and PSA 10 prices, grading spreads, PSA population and recent sold listings. Price guide updated daily.`
  }

  // Block 5A-W-35 — thin-card gate. Card rows with no market signal
  // on any grade tier get robots: { index: false, follow: true } so
  // Google stops evaluating them for the index, but users landing
  // from direct links / referrers still see the page (and if a price
  // ever appears, the card becomes indexable again on the next crawl
  // — no 410-then-recover dance).
  //
  // Scope note: this gate is price-signal based on the 20 tier fields
  // returned by get_card_detail_by_url_slug (raw_usd + PSA 1..10 +
  // half-grades + gem-mint from other graders). It does NOT consult
  // recent_sales — that path is only loaded below the metadata call
  // and is not mirrored in the sitemap query. Route + sitemap read
  // the same DB-level price signal.
  //
  // We chose noindex over notFound() because ~940 URLs would be
  // affected in one deploy. A 404 mass-drop is harder to reverse and
  // costs external referrers; noindex is the low-blast-radius option.
  const indexable = isCardIndexable(card)

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
      card: 'summary_large_image',
      title,
      description,
      images: card.image_url ? [card.image_url] : [],
    },
    alternates: { canonical },
    robots: indexable ? undefined : { index: false, follow: true },
  }
}

export default async function CardPage({ params }: { params: Promise<{ slug: string; cardSlug: string }> }) {
  const { slug, cardSlug } = await params
  const setName = decodeURIComponent(slug)
  const card = await getCard(setName, cardSlug)
  if (!card) notFound()

  // Recent verified sales — grouped by grade. Fail-closed: the loader
  // returns an empty group set when RECENT_SALES_FREE_PREVIEW_ENABLED
  // is not the literal "true", so the DB is not consulted while the
  // flag is off. The section renders nothing when total is zero.
  const recentSalesData = await loadRecentSalesGroupedForCardIfEnabled(card.card_slug)

  // Grade-aware affiliate link in the recent-sales section needs the
  // card's display metadata. Mirrors the shape EbayCardPriceActions
  // uses higher up the page; strips the pc- prefix from card_slug to
  // match the existing convention.
  const recentSalesCard = {
    cardName:   String(card.card_name ?? ''),
    setName:    String(card.set_name ?? ''),
    cardNumber: (card.card_number_display ?? card.card_number ?? null) as string | null,
    cardSlug:   String(card.card_slug ?? '').replace(/^pc-/, '') || null,
    isSealed:   !!card.is_sealed,
  }

  return (
    <>
      <CardPageClient setName={setName} cardUrlSlug={cardSlug} />
      <RecentSalesSection data={recentSalesData} card={recentSalesCard} />
    </>
  )
}