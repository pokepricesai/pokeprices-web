// src/app/dashboard/sets/page.tsx
import type { Metadata } from 'next'
import SetTrackerClient from './SetTrackerClient'

export const metadata: Metadata = {
  title: 'Set Completion — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function SetsPage() {
  return <SetTrackerClient />
}
