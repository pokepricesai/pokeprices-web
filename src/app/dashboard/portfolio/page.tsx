// src/app/portfolio/page.tsx
import { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import PortfolioDashboard from './PortfolioDashboard'

export const metadata: Metadata = {
  title: 'My Portfolio | PokePrices',
  robots: { index: false, follow: false },
}

export default async function PortfolioPage() {
  await requireAuthUser('/dashboard/portfolio')
  return <PortfolioDashboard />
}
