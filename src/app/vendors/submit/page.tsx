import type { Metadata } from 'next'
import VendorSubmitClient from './VendorSubmitClient'

// Block 5A-W-32 — was indexable (title + description but no robots
// directive). Submit forms have no public ranking value and risk
// duplicating the main /vendors page in SERPs. Marked noindex with
// a self-referencing canonical so any direct visits don't bleed
// rank to the vendors hub.
export const metadata: Metadata = {
  title:       'List Your Store | PokePrices Vendor Directory',
  description: 'Add your Pokémon card shop, online store or eBay store to the PokePrices vendor directory for free.',
  robots:      { index: false, follow: false },
  alternates:  { canonical: 'https://www.pokeprices.io/vendors/submit' },
}

export default function VendorSubmitPage() {
  return <VendorSubmitClient />
}
