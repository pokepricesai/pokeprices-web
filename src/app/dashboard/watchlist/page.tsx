// src/app/dashboard/watchlist/page.tsx
import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import WatchlistClient from './WatchlistClient'

export const metadata: Metadata = {
  title: 'Watchlist — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default async function WatchlistPage() {
  await requireAuthUser('/dashboard/watchlist')
  return <WatchlistClient />
}
