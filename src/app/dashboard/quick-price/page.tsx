import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import QuickPriceClient from './QuickPriceClient'

export const metadata: Metadata = {
  title: 'Quick Price Checker — PokePrices',
  description: 'Scan a batch of cards, see live market values, apply a percentage and override manual prices. Login required.',
  robots: { index: false, follow: false },
}

export default async function QuickPricePage() {
  await requireAuthUser('/dashboard/quick-price')
  return <QuickPriceClient />
}
