// Drop this component into your card page — it adds Product schema for Google
// Usage: <CardStructuredData card={card} />

export default function CardStructuredData({ card }: { card: any }) {
  if (!card) return null

  const rawPrice = card.raw_usd ? (card.raw_usd / 100).toFixed(2) : null

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: card.card_name,
    description: `${card.card_name} Pokemon card from ${card.set_name}`,
    image: card.image_url || undefined,
    brand: {
      '@type': 'Brand',
      name: 'Pokemon',
    },
    category: 'Pokemon Trading Cards',
    offers: rawPrice ? {
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: rawPrice,
      availability: 'https://schema.org/InStock',
      url: `https://pokeprices.io/card/${card.card_slug}`,
      seller: {
        '@type': 'Organization',
        name: 'PokePrices',
      },
    } : undefined,
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
