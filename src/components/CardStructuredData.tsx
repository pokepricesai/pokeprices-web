// CardStructuredData — @graph of WebPage + Dataset
// Dataset type is accurate for price data and can unlock Google's Dataset label
// Deliberately avoids Product/Offer/InStock which caused false "In Stock" search snippets
export default function CardStructuredData({ card }: { card: any }) {
  if (!card) return null

  const rawPrice   = card.raw_usd   ? (card.raw_usd   / 100).toFixed(2) : null
  const psa10Price = card.psa10_usd ? (card.psa10_usd / 100).toFixed(2) : null
  const psa9Price  = card.psa9_usd  ? (card.psa9_usd  / 100).toFixed(2) : null

  const priceStr = [
    rawPrice   ? `Raw $${rawPrice}`    : null,
    psa9Price  ? `PSA 9 $${psa9Price}` : null,
    psa10Price ? `PSA 10 $${psa10Price}` : null,
  ].filter(Boolean).join(', ')

  const pageUrl = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug || card.card_slug}`
  const now = new Date().toISOString()

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        name: `${card.card_name} Price Guide`,
        description: `${card.card_name} from ${card.set_name}. Current market prices: ${priceStr}. Includes PSA population data, price trend and grading analysis.`,
        url: pageUrl,
        image: card.image_url || undefined,
        isPartOf: { '@id': 'https://www.pokeprices.io/#website' },
        about: {
          '@type': 'Thing',
          name: card.card_name,
          description: `${card.card_name} Pokémon trading card from ${card.set_name}`,
          image: card.image_url || undefined,
        },
        primaryImageOfPage: card.image_url ? { '@type': 'ImageObject', url: card.image_url } : undefined,
        dateModified: now,
      },
      {
        '@type': 'Dataset',
        '@id': `${pageUrl}#dataset`,
        name: `${card.card_name} (${card.set_name}) — Price Data`,
        description: `Historical and current market prices for ${card.card_name} from ${card.set_name}. Covers raw, PSA 9 and PSA 10 grades with PSA population data. Updated daily from real sold listings.`,
        url: pageUrl,
        license: 'https://www.pokeprices.io/terms',
        creator: { '@id': 'https://www.pokeprices.io/#org' },
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        isAccessibleForFree: true,
        keywords: [
          card.card_name,
          card.set_name,
          'Pokémon card prices',
          'PSA 10 value',
          'PSA population',
          'trading card price history',
        ],
        variableMeasured: [
          'Raw card price (USD)',
          'PSA 9 price (USD)',
          'PSA 10 price (USD)',
          'PSA 10 population',
          '30-day price change',
        ],
        temporalCoverage: '2020/..',
        dateModified: now,
      },
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
