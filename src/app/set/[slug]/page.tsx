import type { Metadata } from 'next'
import SetPageClient from './SetPageClient'

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const setName = decodeURIComponent(params.slug)
  const title = `${setName} Card Prices`
  const description = `All ${setName} Pokemon card prices with PSA population data, price history and grading insights. Updated daily. Free, no login required.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://pokeprices.io/set/${params.slug}`,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  }
}

export default function SetPage({ params }: { params: { slug: string } }) {
  return <SetPageClient slug={params.slug} />
}
