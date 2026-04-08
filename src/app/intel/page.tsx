// src/app/intel/page.tsx
// Hidden from public nav — auth protected via middleware

import { Metadata } from 'next'
import IntelDashboard from './IntelDashboard'

export const metadata: Metadata = {
  title: 'Intel | PokePrices',
  robots: { index: false, follow: false },
}

export default function IntelPage() {
  return <IntelDashboard />
}
