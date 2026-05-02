// /dashboard/card-shows — planner for the user's starred events.
// Server wrapper. Real work happens in CardShowsPlannerClient.

import type { Metadata } from 'next'
import CardShowsPlannerClient from './CardShowsPlannerClient'

export const metadata: Metadata = {
  title: 'Card Show Planner — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function CardShowsPlannerPage() {
  return <CardShowsPlannerClient />
}
