// src/app/portfolio/page.tsx
import { Metadata } from 'next'
import PortfolioDashboard from './PortfolioDashboard'

export const metadata: Metadata = {
  title: 'My Portfolio | PokePrices',
  robots: { index: false, follow: false },
}

export default function PortfolioPage() {
  return <PortfolioDashboard />
}
