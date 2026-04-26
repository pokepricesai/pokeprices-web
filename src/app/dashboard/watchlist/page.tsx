// src/app/dashboard/watchlist/page.tsx
import type { Metadata } from 'next'
import WatchlistClient from './WatchlistClient'

export const metadata: Metadata = {
  title: 'Watchlist — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function WatchlistPage() {
  return <WatchlistClient />
}
