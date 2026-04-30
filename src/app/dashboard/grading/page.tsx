// src/app/dashboard/grading/page.tsx
import type { Metadata } from 'next'
import GradingCalculatorClient from './GradingCalculatorClient'

export const metadata: Metadata = {
  title: 'Grading Calculator — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function GradingPage() {
  return <GradingCalculatorClient />
}
