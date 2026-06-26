// src/app/dashboard/watchlist-alerts/page.tsx
// Block 5A-W-18 — unified Watchlist & Alerts entry point.

import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireAuthUser } from '@/lib/auth-server'
import WatchlistAlertsClient from './WatchlistAlertsClient'

export const metadata: Metadata = {
  title: 'Watchlist & Alerts — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default async function WatchlistAlertsPage() {
  await requireAuthUser('/dashboard/watchlist-alerts')
  // Suspense boundary mirrors the old /dashboard/alerts page in case a
  // child component ever reaches for useSearchParams (no current call,
  // but the AlertsClient → WatchlistAlertsClient consolidation may grow
  // into one).
  return (
    <Suspense fallback={null}>
      <WatchlistAlertsClient />
    </Suspense>
  )
}
