// Per-page-type FAQ generators. Each returns an array of { question, answer }.
// Used by both visible accordion + FAQPage schema (rendered together via <FAQ>).

import type { FAQItem } from '@/components/FAQ'

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtUsd = (cents: number | null | undefined): string => {
  if (cents == null) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  if (v >= 100)  return `$${v.toFixed(0)}`
  return `$${v.toFixed(2)}`
}

const fmtMonthYear = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  } catch { return iso }
}

// ── Card FAQs ────────────────────────────────────────────────────────────────

export function getCardFaqItems({
  card,
  gemRate,
  psa10Multiple,
  gradingProfitCents,
}: {
  card: {
    card_name: string
    set_name: string
    card_number?: string | null
    raw_usd?: number | null
    psa9_usd?: number | null
    psa10_usd?: number | null
  }
  gemRate?: number | null
  psa10Multiple?: number | null
  gradingProfitCents?: number | null
}): FAQItem[] {
  const items: FAQItem[] = []
  const name = card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()
  const num  = card.card_number ? ` #${card.card_number}` : ''
  const fullName = `${name}${num}`
  const setName = card.set_name

  // Q1: Worth?
  if (card.raw_usd) {
    const parts = [`Raw: ${fmtUsd(card.raw_usd)}`]
    if (card.psa9_usd)  parts.push(`PSA 9: ${fmtUsd(card.psa9_usd)}`)
    if (card.psa10_usd) parts.push(`PSA 10: ${fmtUsd(card.psa10_usd)}`)
    items.push({
      question: `How much is ${fullName} from ${setName} worth?`,
      answer: `${fullName} from ${setName} is currently worth ${parts.join(', ')} based on recent sold listings. Prices update daily from real eBay sales.`,
    })
  }

  // Q2: Worth grading?
  if (card.raw_usd && card.psa10_usd && psa10Multiple != null) {
    const worthIt = gradingProfitCents != null && gradingProfitCents > 0
    if (worthIt) {
      items.push({
        question: `Is ${fullName} worth grading?`,
        answer: `The PSA 10 price of ${fmtUsd(card.psa10_usd)} is ${psa10Multiple.toFixed(1)}× the raw price of ${fmtUsd(card.raw_usd)}. After a ~$25 grading fee, a PSA 10 result would net approximately ${fmtUsd((gradingProfitCents ?? 0) + 2500)} — assuming the card grades a 10.${gemRate != null ? ` Only ${gemRate.toFixed(1)}% of submitted copies receive PSA 10, so factor that probability into the decision.` : ''}`,
      })
    } else {
      items.push({
        question: `Is ${fullName} worth grading?`,
        answer: `The PSA 10 price of ${fmtUsd(card.psa10_usd)} is ${psa10Multiple.toFixed(1)}× the raw price of ${fmtUsd(card.raw_usd)}. After grading fees the upside looks limited. Wait for the raw price to drop, or grade only if you have a near-mint copy you are confident about.`,
      })
    }
  }

  // Q3: Gem rate
  if (gemRate != null && card.psa10_usd) {
    let gemAnalysis = 'This is an average gem rate for Pokémon cards.'
    if (gemRate < 10)      gemAnalysis = 'This is a difficult card to gem — that low rate is part of why PSA 10 copies command a premium.'
    else if (gemRate > 40) gemAnalysis = 'PSA 10 copies are relatively common for this card, which limits scarcity-driven price upside.'
    items.push({
      question: `What is the PSA 10 gem rate for ${fullName}?`,
      answer: `${gemRate.toFixed(1)}% of submitted ${fullName} copies have received a PSA 10 grade. ${gemAnalysis}`,
    })
  }

  // Q4: Where do prices come from?
  items.push({
    question: `Where do PokePrices ${fullName} prices come from?`,
    answer: `Prices are tracked nightly from real sold listings on PriceCharting (raw, PSA 9 and PSA 10). PSA population data is sourced from PSA's public reports. We do not use asking prices — only confirmed sales.`,
  })

  return items
}

// ── Set FAQs ─────────────────────────────────────────────────────────────────

export function getSetFaqItems({
  setName,
  cards,
  releaseDate,
  totalSetValueCents,
  cardsTracked,
}: {
  setName: string
  cards: Array<{ card_name: string; raw_usd: number | null; psa10_usd: number | null; is_sealed?: boolean }>
  releaseDate?: string | null
  totalSetValueCents?: number | null
  cardsTracked?: number | null
}): FAQItem[] {
  const items: FAQItem[] = []
  const regular = cards.filter(c => !c.is_sealed)
  const withPrice = regular.filter(c => c.raw_usd && c.raw_usd > 0)
  const total = cardsTracked ?? regular.length

  // Q1: How many cards
  items.push({
    question: `How many cards are in ${setName}?`,
    answer: `${setName} has ${total} cards tracked on PokePrices.${withPrice.length > 0 ? ` ${withPrice.length} of those have current price data from recent sold listings.` : ''}`,
  })

  // Q2: When released
  if (releaseDate) {
    items.push({
      question: `When was ${setName} released?`,
      answer: `${setName} was released in ${fmtMonthYear(releaseDate)}.`,
    })
  }

  // Q3: Most valuable card
  if (regular.length > 0) {
    const mostValRaw = [...regular].sort((a, b) => (b.raw_usd ?? 0) - (a.raw_usd ?? 0))[0]
    const mostValPsa10 = [...regular].sort((a, b) => (b.psa10_usd ?? 0) - (a.psa10_usd ?? 0))[0]
    if (mostValRaw && mostValRaw.raw_usd) {
      const psa10Bit = mostValPsa10 && mostValPsa10.psa10_usd
        ? ` In PSA 10 the chase card is ${mostValPsa10.card_name} at ${fmtUsd(mostValPsa10.psa10_usd)}.`
        : ''
      items.push({
        question: `What is the most valuable card in ${setName}?`,
        answer: `The most valuable raw card in ${setName} is ${mostValRaw.card_name} at ${fmtUsd(mostValRaw.raw_usd)} based on recent sold listings.${psa10Bit}`,
      })
    }
  }

  // Q4: Complete set value
  if (totalSetValueCents && totalSetValueCents > 0 && withPrice.length > 5) {
    items.push({
      question: `How much does it cost to complete ${setName} in raw condition?`,
      answer: `Buying every card in ${setName} at current raw prices would cost approximately ${fmtUsd(totalSetValueCents)}, calculated by summing the current sold-listing price of each tracked card. Singles can almost always be bought below sealed/booster rates.`,
    })
  }

  // Q5: Where prices come from
  items.push({
    question: `How are ${setName} prices calculated on PokePrices?`,
    answer: `Every ${setName} card price comes from real sold listings tracked nightly via PriceCharting. We never use asking prices. PSA 9 and PSA 10 prices reflect graded sales of the same card. PSA population numbers come from PSA's public reports.`,
  })

  return items
}

// ── Pokémon species FAQs ─────────────────────────────────────────────────────

export function getPokemonFaqItems({
  name,
  cards,
  uniqueSets,
  primaryType,
  isLegendary,
  isMythical,
}: {
  name: string
  cards: Array<{ card_name: string; set_name: string; raw_usd: number | null; psa10_usd: number | null }>
  uniqueSets: number
  primaryType?: string | null
  isLegendary?: boolean
  isMythical?: boolean
}): FAQItem[] {
  const items: FAQItem[] = []
  const withPrice = cards.filter(c => c.raw_usd && c.raw_usd > 0)

  items.push({
    question: `How many ${name} cards are there?`,
    answer: `PokePrices tracks ${cards.length} ${name} cards across ${uniqueSets} ${uniqueSets === 1 ? 'set' : 'different sets'} of the Pokémon TCG. ${withPrice.length} have current price data.`,
  })

  if (withPrice.length > 0) {
    const top = [...withPrice].sort((a, b) => (b.raw_usd ?? 0) - (a.raw_usd ?? 0))[0]
    const topPsa10 = [...cards].filter(c => c.psa10_usd).sort((a, b) => (b.psa10_usd ?? 0) - (a.psa10_usd ?? 0))[0]
    const psa10Bit = topPsa10 && topPsa10.psa10_usd
      ? ` In PSA 10, the most valuable ${name} card is ${topPsa10.card_name} (${topPsa10.set_name}) at ${fmtUsd(topPsa10.psa10_usd)}.`
      : ''
    items.push({
      question: `What is the most valuable ${name} card?`,
      answer: `The most valuable ${name} card by raw price is ${top.card_name} from ${top.set_name} at ${fmtUsd(top.raw_usd)} based on recent sold listings.${psa10Bit}`,
    })
  }

  if (primaryType) {
    const lineage = isLegendary ? 'a Legendary' : isMythical ? 'a Mythical' : null
    items.push({
      question: `What type is ${name}?`,
      answer: `${name} is ${lineage ? `${lineage} ` : 'a '}${primaryType.charAt(0).toUpperCase() + primaryType.slice(1)}-type Pokémon. In the TCG, ${name} cards are typically printed as ${primaryType.charAt(0).toUpperCase() + primaryType.slice(1)} energy types.`,
    })
  }

  items.push({
    question: `How are ${name} card prices tracked?`,
    answer: `Prices for every ${name} card come from real sold listings tracked nightly. Raw, PSA 9 and PSA 10 prices update daily, and PSA population data is sourced from PSA's public reports. No asking prices, only confirmed sales.`,
  })

  return items
}
