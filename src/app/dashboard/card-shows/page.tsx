// /dashboard/card-shows — planner for the user's starred events.
// Server wrapper. Real work happens in CardShowsPlannerClient.

import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import CardShowsPlannerClient from './CardShowsPlannerClient'

export const metadata: Metadata = {
  title: 'Card Show Planner — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default async function CardShowsPlannerPage() {
  await requireAuthUser('/dashboard/card-shows')
  return <CardShowsPlannerClient />
}
