// src/app/dashboard/sets/page.tsx
import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import SetTrackerClient from './SetTrackerClient'

export const metadata: Metadata = {
  title: 'Set Completion — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default async function SetsPage() {
  await requireAuthUser('/dashboard/sets')
  return <SetTrackerClient />
}
