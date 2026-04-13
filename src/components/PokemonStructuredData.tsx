// src/components/PokemonStructuredData.tsx
// CollectionPage + ItemList schema for Pokémon species pages
export default function PokemonStructuredData({ name, slug, cards }: {
  name: string
  slug: string
  cards: { card_name: string; set_name: string; card_url_slug: string | null }[]
}) {
  const url = `https://pokeprices.io/pokemon/${slug}`
  const topCards = cards.slice(0, 10)

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${name} Pokémon Card Prices`,
    description: `All ${name} Pokémon cards with live raw prices, PSA 10 values, grading data and market trends.`,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: 'PokePrices',
      url: 'https://pokeprices.io',
    },
    ...(topCards.length > 0 ? {
      mainEntity: {
        '@type': 'ItemList',
        name: `${name} Cards`,
        numberOfItems: topCards.length,
        itemListElement: topCards.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${c.card_name} — ${c.set_name}`,
          url: c.card_url_slug
            ? `https://pokeprices.io/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`
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