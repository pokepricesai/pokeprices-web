// app/page.tsx
import type { Metadata } from 'next'
import HomeClient from './HomeClient'

export const metadata: Metadata = {
  title: 'Pokemon Card Prices — Free Market Data for Collectors',
  description: 'Real Pokemon card prices for 40,000+ cards. PSA population data, price trends, grading advice and true UK landed costs. Free, no login required. Updated daily.',
  openGraph: {
    title: 'Pokemon Card Prices — Free Market Data for Collectors',
    description: 'Real Pokemon card prices for 40,000+ cards. PSA population data, price trends, grading advice and true UK landed costs.',
    url: 'https://pokeprices.io',
  },
}

export default function HomePage() {
  return <HomeClient />
}
