// src/app/dashboard/settings/page.tsx
import type { Metadata } from 'next'
import SettingsClient from './SettingsClient'

export const metadata: Metadata = {
  title: 'Settings — PokePrices Dashboard',
  robots: { index: false, follow: false },
}

export default function SettingsPage() {
  return <SettingsClient />
}
