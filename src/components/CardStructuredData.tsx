// CardStructuredData — WebPage markup for an individual card page.
//
// PP-GOOGLE-02: dropped the per-card Dataset @graph entry that this
// component used to emit on all ~44,000 card URLs. Google's Dataset
// schema is intended for "structured collections of data about a
// specific topic" (government, scientific, OpenAIRE-style records with
// a DOI or similar persistent identifier). A single trading-card
// price snapshot does not meet that intent, and emitting Dataset at
// catalogue scale was a plausible contributor to the Oct 2026 quality
// re-weighting. The WebPage entry below is standard, correct, and
// kept intact. BreadcrumbList is emitted separately from the server
// layer; FAQPage is emitted via <FAQ>. Deliberately still avoids
// Product/Offer/InStock, which caused false "In Stock" search snippets
// before.
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
    '@type': 'WebPage',
    '@id': `${pageUrl}#webpage`,
    name: `${card.card_name} Price Guide`,
    description: priceStr
      ? `${card.card_name} from ${card.set_name}. Current price-guide values: ${priceStr}. Includes PSA population data, price trend and grading analysis.`
      : `${card.card_name} from ${card.set_name}. PSA population data, price trend and grading analysis.`,
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
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  )
}
