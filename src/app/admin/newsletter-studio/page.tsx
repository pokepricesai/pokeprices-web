import type { Metadata } from 'next'
import NewsletterStudioClient from './NewsletterStudioClient'

export const metadata: Metadata = {
  title: 'Newsletter Studio — PokePrices Admin',
  robots: { index: false, follow: false },
}

export default function NewsletterStudioPage() {
  return <NewsletterStudioClient />
}
