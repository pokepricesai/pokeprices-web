// src/app/dashboard/layout.tsx
// Default metadata for the entire logged-in dashboard area — noindex.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dashboard — PokePrices',
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
