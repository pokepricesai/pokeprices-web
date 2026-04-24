// Site-wide Organization + WebSite schema
// Tells Google the site identity and canonical name for SERP rendering
export default function SiteStructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': 'https://www.pokeprices.io/#org',
        name: 'PokePrices',
        alternateName: 'PokePrices.io',
        url: 'https://www.pokeprices.io',
        logo: {
          '@type': 'ImageObject',
          url: 'https://www.pokeprices.io/logo.png',
          width: 512,
          height: 512,
        },
        description: 'Free Pokémon TCG price guide with live raw and PSA 10 values, PSA population data and grading analysis for 40,000+ cards.',
      },
      {
        '@type': 'WebSite',
        '@id': 'https://www.pokeprices.io/#website',
        url: 'https://www.pokeprices.io',
        name: 'PokePrices',
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        inLanguage: 'en-GB',
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
