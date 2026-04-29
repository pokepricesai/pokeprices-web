// PokemonStructuredData — @graph of CollectionPage + ItemList + Dataset.
export default function PokemonStructuredData({
  name,
  slug,
  cards,
}: {
  name: string
  slug: string
  cards: { card_name: string; set_name: string; card_url_slug: string | null }[]
}) {
  const url = `https://www.pokeprices.io/pokemon/${slug}`
  const topCards = cards.slice(0, 10)
  const now = new Date().toISOString()

  const graph: any = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#collection`,
        name: `${name} Pokémon Card Prices`,
        description: `All ${name} Pokémon cards with live raw prices, PSA 10 values, grading data and market trends.`,
        url,
        isPartOf: { '@id': 'https://www.pokeprices.io/#website' },
        dateModified: now,
      },
      {
        '@type': 'Dataset',
        '@id': `${url}#dataset`,
        name: `${name} — Card Price Dataset`,
        description: `Daily price observations for every ${name} Pokémon card across all sets. Covers raw, PSA 9 and PSA 10 grades plus PSA population data.`,
        url,
        license: 'https://www.pokeprices.io/terms',
        creator: { '@id': 'https://www.pokeprices.io/#org' },
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        isAccessibleForFree: true,
        keywords: [
          name,
          `${name} Pokémon card`,
          `${name} card value`,
          'Pokémon TCG prices',
          'PSA 10 values',
          'graded card prices',
        ],
        variableMeasured: [
          'Raw card price (USD)',
          'PSA 9 price (USD)',
          'PSA 10 price (USD)',
          '7-day price change',
          '30-day price change',
          'PSA 10 population',
        ],
        temporalCoverage: '2020/..',
        dateModified: now,
      },
    ],
  }

  if (topCards.length > 0) {
    graph['@graph'].push({
      '@type': 'ItemList',
      '@id': `${url}#cardlist`,
      name: `${name} Cards`,
      numberOfItems: topCards.length,
      itemListElement: topCards.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${c.card_name} — ${c.set_name}`,
        url: c.card_url_slug
          ? `https://www.pokeprices.io/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`
          : url,
      })),
    })
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
