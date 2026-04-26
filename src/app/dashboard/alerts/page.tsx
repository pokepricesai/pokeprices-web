// src/app/dashboard/alerts/page.tsx
import type { Metadata } from 'next'
import AlertsClient from './AlertsClient'

export const metadata: Metadata = {
  title: 'Smart Alerts — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function AlertsPage() {
  return <AlertsClient />
}
