import type { Metadata } from 'next'
import { getCardShowsByCountry } from '@/data/cardShows'
import { getCountrySeo } from '@/lib/cardShowSeo'
import CountryLandingBody from '../CountryLandingBody'

export async function generateMetadata(): Promise<Metadata> {
  const shows = getCardShowsByCountry('us')
  const seo   = getCountrySeo('us', new Date().getFullYear(), shows.length)
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

export default function USCardShowsPage() {
  return <CountryLandingBody country="us" />
}
