// src/app/dashboard/grading/page.tsx
import type { Metadata } from 'next'
import { requireAuthUser } from '@/lib/auth-server'
import GradingCalculatorClient from './GradingCalculatorClient'

export const metadata: Metadata = {
  title: 'Grading Calculator — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default async function GradingPage() {
  await requireAuthUser('/dashboard/grading')
  return <GradingCalculatorClient />
}
