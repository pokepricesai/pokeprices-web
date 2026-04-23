// CardStructuredData — uses WebPage + Dataset schema
// Deliberately avoids Product/Offer/InStock which caused false "In Stock" search snippets
export default function CardStructuredData({ card }: { card: any }) {
  if (!card) return null

  const rawPrice  = card.raw_usd   ? (card.raw_usd   / 100).toFixed(2) : null
  const psa10Price = card.psa10_usd ? (card.psa10_usd / 100).toFixed(2) : null
  const psa9Price  = card.psa9_usd  ? (card.psa9_usd  / 100).toFixed(2) : null

  const priceStr = [
    rawPrice   ? `Raw $${rawPrice}`    : null,
    psa9Price  ? `PSA 9 $${psa9Price}` : null,
    psa10Price ? `PSA 10 $${psa10Price}` : null,
  ].filter(Boolean).join(', ')

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${card.card_name} Price Guide`,
    description: `${card.card_name} from ${card.set_name}. Current market prices: ${priceStr}. Includes PSA population data, price trend and grading analysis.`,
    url: `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug || card.card_slug}`,
    image: card.image_url || undefined,
    about: {
      '@type': 'Thing',
      name: card.card_name,
      description: `${card.card_name} Pokémon trading card from ${card.set_name}`,
      image: card.image_url || undefined,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'PokePrices',
      url: 'https://www.pokeprices.io',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}