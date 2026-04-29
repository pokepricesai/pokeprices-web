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

// ── Homepage FAQs ────────────────────────────────────────────────────────────

export function getHomeFaqItems(): FAQItem[] {
  return [
    {
      question: 'Where does the Pokémon card price data come from?',
      answer: 'PokePrices tracks sold listings from PriceCharting, updated nightly. Every price you see reflects what cards have actually sold for, not asking prices. PSA population data is scraped directly from PSA\'s public population reports and refreshed biweekly.',
    },
    {
      question: 'Is PokePrices really free to use?',
      answer: 'Yes. No login, no paywall, no hidden fees. The full Pokémon card price guide, PSA 10 values, grading data and AI assistant are free forever. Future tools may include optional paid features but the core card price data will always be free.',
    },
    {
      question: 'Do you sell my data or run ads?',
      answer: 'No. We do not collect personal data, track users across other sites, or run advertising. The site uses basic analytics (anonymous page views) only. There is no email capture or popup unless you explicitly opt in to a tool that needs it.',
    },
    {
      question: 'How often are Pokémon card prices updated?',
      answer: 'Raw, PSA 9 and PSA 10 prices for every tracked card refresh nightly. The 7-day, 30-day and 90-day percentage moves are recomputed at the same time. PSA population numbers are updated biweekly from PSA.com.',
    },
    {
      question: 'How do I know the PSA population data is accurate?',
      answer: 'PSA population figures come straight from PSA\'s public population reports. We save the source pages and parse them locally to keep numbers consistent. If you spot a discrepancy, the contact form gets read.',
    },
    {
      question: 'Can I submit corrections or request a card I cannot find?',
      answer: 'Yes. Use the contact form to flag a price you think is wrong, a missing card, or a set we have not added yet. Every submission is read.',
    },
    {
      question: 'How is the grading calculator different from other tools?',
      answer: 'PokePrices factors in the real PSA 10 gem rate for each card, a $25 grading fee, and the current raw and PSA 10 prices to estimate probability-weighted profit. Other tools assume every card grades a 10 — most do not.',
    },
  ]
}

// ── /browse hub FAQs ─────────────────────────────────────────────────────────

export function getBrowseFaqItems(setCount?: number | null): FAQItem[] {
  const total = setCount ? `${setCount}+ ` : ''
  return [
    {
      question: 'How many Pokémon TCG sets are tracked on PokePrices?',
      answer: `PokePrices tracks ${total}Pokémon TCG sets from Base Set (1999) through to the latest Scarlet & Violet releases. Each set page lists every card with current raw, PSA 9 and PSA 10 prices, plus grading and population data.`,
    },
    {
      question: 'What does a "card list" page show me?',
      answer: 'Each set page is a complete card list — every card from that set with its number, image, raw price, PSA 9 and PSA 10 prices, 30-day price change, and a link to the individual card page with the full grading and trend breakdown.',
    },
    {
      question: 'How do I find the most valuable cards in a set?',
      answer: 'Click any set, then sort by raw price (descending) or PSA 10 price. The top of the list will show the chase cards. Each card page also flags whether it is currently above or below its all-time high.',
    },
    {
      question: 'Are sealed product prices tracked too?',
      answer: 'Yes — booster boxes, ETBs, premium collections and other sealed products are tracked on the relevant set pages where data is available. Sealed listings appear in a separate "Sealed Product" section on each set page.',
    },
    {
      question: 'How often do set prices update?',
      answer: 'Every set page refreshes nightly with the latest sold-listing prices. The 7-day and 30-day percent moves and the chase-card rankings are recomputed at the same time.',
    },
  ]
}

// ── /pokemon hub FAQs ────────────────────────────────────────────────────────

export function getPokemonHubFaqItems(speciesCount?: number | null): FAQItem[] {
  const total = speciesCount ? `${speciesCount}` : '1,025'
  return [
    {
      question: 'How many Pokémon species are tracked on PokePrices?',
      answer: `All ${total} Pokémon species are listed. Each species page shows every Pokémon TCG card that species has appeared on, the current raw and PSA 10 prices, the most valuable card, and which sets it has been printed in.`,
    },
    {
      question: 'How do I find every card a Pokémon has appeared on?',
      answer: 'Search the Pokémon by name on the /pokemon page or click any species in the list. The species page shows every card across every Pokémon TCG set, sorted by price, set, name, or release order.',
    },
    {
      question: 'Why are some species more valuable than others?',
      answer: 'Card value depends on rarity, condition, age and demand — not just the species. Vintage holos, full arts and special illustrations command the highest prices. Species pages on PokePrices show both the most valuable card and the average raw price.',
    },
    {
      question: 'Do species pages include Pokédex info or just card prices?',
      answer: 'Both. Each species page combines Pokédex data (type, height, weight, abilities, base stats, flavour text) from PokeAPI with full card market data from our nightly price tracker. You get game info and TCG data on the same page.',
    },
    {
      question: 'Are first-form and evolution cards tracked separately?',
      answer: 'Each evolution stage has its own species page (e.g. Charmander, Charmeleon, Charizard each have separate pages). Cards belong to whichever species the card is named after.',
    },
  ]
}

// ── /insights hub FAQs ───────────────────────────────────────────────────────

export function getInsightsHubFaqItems(): FAQItem[] {
  return [
    {
      question: 'What kind of guides are on PokePrices Insights?',
      answer: 'Practical guides on grading (when to grade, PSA vs CGC, gem rate analysis), market trends, set previews, chase card analysis, and price breakdowns. Every article is grounded in real sold-listing data, not speculation.',
    },
    {
      question: 'How often are new articles published?',
      answer: 'New articles are published regularly across themes including grading, market analysis, vintage cards, modern sets and collecting strategy. Use the theme filter to narrow to the topics you care about.',
    },
    {
      question: 'Are these guides written for investors or collectors?',
      answer: 'Collectors first. PokePrices is built for people who love the cards, not just the prices. Articles cover the realities of grading risk, fees, and the difference between hype and durable value.',
    },
    {
      question: 'How are claims and figures fact-checked?',
      answer: 'Every price figure comes from the live PokePrices dataset of sold listings and PSA population data. Articles link out to the relevant card and set pages so you can verify the underlying numbers yourself.',
    },
  ]
}

// ── /creators hub FAQs ───────────────────────────────────────────────────────

export function getCreatorsHubFaqItems(): FAQItem[] {
  return [
    {
      question: 'What is the PokePrices creator directory?',
      answer: 'A curated list of YouTubers, streamers, podcasters and writers covering the Pokémon TCG. Each creator has a profile with their platforms, focus areas and links.',
    },
    {
      question: 'How do I add my Pokémon TCG channel to the directory?',
      answer: 'Use the "Submit your channel" link on the creators page. Submissions are reviewed manually — we look for genuine, ongoing Pokémon TCG content. There is no fee.',
    },
    {
      question: 'How are creators ranked or featured?',
      answer: 'Featured creators are picked editorially based on consistent output and community trust. There is no pay-to-feature. Featured slots rotate periodically.',
    },
    {
      question: 'Does PokePrices have an affiliate or sponsorship deal with these creators?',
      answer: 'No. The directory is editorial — listings are not sponsored. We may link to creator content from articles or feature collaborations separately, but inclusion in the directory is not paid placement.',
    },
  ]
}

// ── /vendors hub FAQs ────────────────────────────────────────────────────────

export function getVendorsHubFaqItems(): FAQItem[] {
  return [
    {
      question: 'What kinds of Pokémon card vendors are listed?',
      answer: 'Physical card shops, online stores, eBay sellers, retailers, grading services, and specialist Pokémon TCG suppliers. Each vendor has a profile with location (where applicable), what they sell, and links.',
    },
    {
      question: 'How do I add my Pokémon card shop?',
      answer: 'Use the "Submit a vendor" link on the vendors page. We review submissions for legitimacy — physical shops need a real address; online sellers need a public storefront. Listings are free.',
    },
    {
      question: 'Are these vendors verified by PokePrices?',
      answer: 'Vendors marked "Verified" have been manually checked — we have confirmed the address, looked at customer feedback, and checked the storefront is live. Unverified listings are user submissions awaiting review.',
    },
    {
      question: 'Does PokePrices take a cut from purchases?',
      answer: 'No. Some links may be affiliate where the vendor offers a public affiliate program (this never affects which vendors are listed). Most listings have no commercial relationship with PokePrices at all.',
    },
  ]
}

// ── /studio FAQs ─────────────────────────────────────────────────────────────

export function getStudioFaqItems(): FAQItem[] {
  return [
    {
      question: 'What is PokePrices Studio?',
      answer: 'A free tool that turns Pokémon TCG market data into shareable visuals — PSA gauges, market temperature charts, peak-distance graphics and more. Designed for posting to Twitter, Reddit, Discord or YouTube.',
    },
    {
      question: 'Do I need an account to use Studio?',
      answer: 'No. Studio is free and public — pick a card, choose a visual, export as PNG. No login, no watermark, no paywall.',
    },
    {
      question: 'Can I use the visuals commercially?',
      answer: 'Yes, for editorial and personal use including monetised YouTube videos and creator content. Please credit PokePrices when sharing. Reach out via the contact form if you want to use them in paid advertising.',
    },
    {
      question: 'What card and set data is available in Studio?',
      answer: 'Every card and set tracked on PokePrices is available — that is 40,000+ cards across 156+ sets. Visuals refresh against the latest nightly price update.',
    },
  ]
}

