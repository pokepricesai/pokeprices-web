import type { Metadata } from 'next'
import { getCardShowsByCountry } from '@/data/cardShows'
import { getCountrySeo } from '@/lib/cardShowSeo'
import CountryLandingBody from '../CountryLandingBody'

// Block 5A-W-54B — metadata is generated dynamically so the title,
// description and OG copy always reflect the live upcoming count and
// the current year.
export async function generateMetadata(): Promise<Metadata> {
  const shows = getCardShowsByCountry('uk')
  const seo   = getCountrySeo('uk', new Date().getFullYear(), shows.length)
  return {
    title:       seo.title,
    description: seo.description,
    alternates:  { canonical: seo.canonical },
    openGraph: {
      title: seo.title, description: seo.description, url: seo.canonical,
      siteName: 'PokePrices', type: 'website',
    },
  }
}

export default function UKCardShowsPage() {
  return <CountryLandingBody country="uk" />
}
