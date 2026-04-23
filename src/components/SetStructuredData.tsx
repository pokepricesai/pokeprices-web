// src/components/SetStructuredData.tsx
// CollectionPage + ItemList schema for set pages
export default function SetStructuredData({ setName, slug, cards }: {
  setName: string
  slug: string
  cards: { card_name: string; card_url_slug: string | null; raw_usd: number | null }[]
}) {
  const url = `https://www.pokeprices.io/set/${slug}`
  const topCards = cards.filter(c => c.raw_usd && c.raw_usd > 0).slice(0, 10)

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${setName} Price Guide`,
    description: `Pokémon card prices for ${setName} — raw, PSA 9 and PSA 10 values, grading data and market trends.`,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: 'PokePrices',
      url: 'https://www.pokeprices.io',
    },
    ...(topCards.length > 0 ? {
      mainEntity: {
        '@type': 'ItemList',
        name: `${setName} Card Prices`,
        numberOfItems: topCards.length,
        itemListElement: topCards.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.card_name,
          url: c.card_url_slug
            ? `https://www.pokeprices.io/set/${slug}/card/${c.card_url_slug}`
            : url,
        })),
      },
    } : {}),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}