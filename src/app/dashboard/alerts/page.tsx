// src/app/dashboard/alerts/page.tsx
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { requireAuthUser } from '@/lib/auth-server'
import AlertsClient from './AlertsClient'

export const metadata: Metadata = {
  title: 'Smart Alerts — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

// AlertsClient uses useSearchParams() (deep-link from /watchlist?new=…),
// which requires a Suspense boundary for static prerender.
export default async function AlertsPage() {
  await requireAuthUser('/dashboard/alerts')
  return (
    <Suspense fallback={null}>
      <AlertsClient />
    </Suspense>
  )
}
