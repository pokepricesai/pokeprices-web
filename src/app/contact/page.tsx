// app/contact/page.tsx
import type { Metadata } from 'next'
import ContactPageClient from './ContactPageClient'

export const metadata: Metadata = {
  title: 'Contact — PokePrices',
  description: 'Get in touch with PokePrices. Found a bug, got a feature request, or want to say hi? We read everything.',
  openGraph: {
    title: 'Contact — PokePrices',
    description: 'Get in touch with PokePrices. Found a bug, got a feature request, or want to say hi?',
    url: 'https://www.pokeprices.io/contact',
    type: 'website',
  },
  alternates: { canonical: 'https://www.pokeprices.io/contact' },
}

export default function ContactPage() {
  return <ContactPageClient />
}
