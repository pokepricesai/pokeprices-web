// SetStructuredData — @graph of CollectionPage + ItemList + Dataset.
// Dataset is appropriate because each set page is a structured set of price observations.
export default function SetStructuredData({
  setName,
  slug,
  cards,
  releaseDate,
}: {
  setName: string
  slug: string
  cards: { card_name: string; card_url_slug: string | null; raw_usd: number | null; psa10_usd: number | null }[]
  releaseDate?: string | null
}) {
  const url = `https://www.pokeprices.io/set/${slug}`
  const topCards = cards.filter(c => c.raw_usd && c.raw_usd > 0).slice(0, 10)
  const cardsWithPrice = cards.filter(c => c.raw_usd && c.raw_usd > 0).length
  const now = new Date().toISOString()

  const graph: any = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${url}#collection`,
        name: `${setName} Card List`,
        description: `Pokémon card prices for ${setName} — raw, PSA 9 and PSA 10 values, grading data and market trends.`,
        url,
        isPartOf: { '@id': 'https://www.pokeprices.io/#website' },
        dateModified: now,
      },
      {
        '@type': 'Dataset',
        '@id': `${url}#dataset`,
        name: `${setName} — Pokémon Card Price Dataset`,
        description: `Daily price observations for every card in ${setName}. ${cards.length} cards tracked${cardsWithPrice ? `, ${cardsWithPrice} with active price data` : ''}. Covers raw, PSA 9 and PSA 10 grades plus PSA population data.`,
        url,
        license: 'https://www.pokeprices.io/terms',
        creator: { '@id': 'https://www.pokeprices.io/#org' },
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        isAccessibleForFree: true,
        keywords: [
          setName,
          'Pokémon TCG prices',
          'PSA 10 values',
          'card price history',
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
        temporalCoverage: releaseDate ? `${releaseDate.slice(0, 10)}/..` : '2020/..',
        dateModified: now,
      },
    ],
  }

  if (topCards.length > 0) {
    graph['@graph'].push({
      '@type': 'ItemList',
      '@id': `${url}#cardlist`,
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
    })
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
