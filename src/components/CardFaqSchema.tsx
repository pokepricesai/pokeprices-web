// src/components/CardFaqSchema.tsx
// FAQ schema for card pages — built from grading calculator content
// Only renders when there is enough data to support real answers
export default function CardFaqSchema({ card, gemRate, psa10Multiple, gradingProfitCents }: {
  card: { card_name: string; card_number?: string | null; set_name: string; raw_usd?: number | null; psa10_usd?: number | null; psa9_usd?: number | null }
  gemRate?: number | null
  psa10Multiple?: number | null
  gradingProfitCents?: number | null
}) {
  if (!card) return null

  const name    = card.card_name
  const num     = card.card_number ? ` #${card.card_number}` : ''
  const fmt     = (cents: number) => {
    const v = cents / 100
    return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
  }

  const faqs: { question: string; answer: string }[] = []

  // Q1: What is the card worth?
  if (card.raw_usd) {
    const parts = [`Raw: ${fmt(card.raw_usd)}`]
    if (card.psa9_usd)  parts.push(`PSA 9: ${fmt(card.psa9_usd)}`)
    if (card.psa10_usd) parts.push(`PSA 10: ${fmt(card.psa10_usd)}`)
    faqs.push({
      question: `How much is ${name}${num} worth?`,
      answer: `${name}${num} from ${card.set_name} is currently worth ${parts.join(', ')} based on recent market sales. Prices are updated daily from real sold listings.`,
    })
  }

  // Q2: Is it worth grading?
  if (card.raw_usd && card.psa10_usd && psa10Multiple != null) {
    const worthIt = gradingProfitCents != null && gradingProfitCents > 0
    faqs.push({
      question: `Is ${name}${num} worth grading?`,
      answer: worthIt
        ? `The PSA 10 price of ${fmt(card.psa10_usd)} is ${psa10Multiple.toFixed(1)}x the raw price of ${fmt(card.raw_usd)}. After a ~$25 grading fee, a PSA 10 result would net approximately ${fmt(gradingProfitCents! + 2500)} — though this assumes a perfect grade.${gemRate != null ? ` Only ${gemRate.toFixed(1)}% of submitted copies receive PSA 10.` : ''}`
        : `The PSA 10 price of ${fmt(card.psa10_usd)} is ${psa10Multiple.toFixed(1)}x the raw price. After grading fees, the upside may be limited — check recent population data before submitting.`,
    })
  }

  // Q3: Gem rate
  if (gemRate != null && card.psa10_usd) {
    faqs.push({
      question: `What is the PSA 10 gem rate for ${name}${num}?`,
      answer: `${gemRate.toFixed(1)}% of submitted ${name}${num} cards have received a PSA 10 grade. ${gemRate < 10 ? 'This is a difficult card to gem, which contributes to the premium on PSA 10 copies.' : gemRate > 40 ? 'PSA 10 copies are relatively common for this card.' : 'This is an average gem rate for Pokémon cards.'}`,
    })
  }

  if (faqs.length === 0) return null

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}