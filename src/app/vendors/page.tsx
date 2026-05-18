import VendorsPageClient from './VendorsPageClient'

export const metadata = {
  title: 'Pokémon Card Shop Directory — Stores, eBay Sellers & Graders | PokePrices',
  description: 'Find Pokémon card shops, online stores, eBay sellers and grading services. Vendor directory built for collectors.',
  alternates: { canonical: 'https://www.pokeprices.io/vendors' },
}

export default function VendorsPage() {
  return <VendorsPageClient />
}
