// Canonical site origin used in metadata canonicals. Matches every other
// canonical-URL site-constant in the repository.
const SITE = 'https://www.pokeprices.io'

// ── Card page ─────────────────────────────────────────────
// Variant A: grading-focused — when PSA 10 multiple is strong
// Variant B: price-focused — when grading upside is modest
export function getCardSeo(card: {
  card_name: string
  card_number?: string | null
  card_number_display?: string | null
  set_printed_total?: number | null
  set_name: string
  raw_usd?: number | null
  psa9_usd?: number | null
  psa10_usd?: number | null
  card_url_slug?: string | null
  card_slug?: string
}) {
  // Strip trailing " #NN" from card_name (DB stores "Pikachu #55")
  // Also handles "Pikachu [1st Edition] #55" → "Pikachu [1st Edition]"
  const cleanName = card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()

  // Build number suffix: prefer "95/165" when set_printed_total > 1, else "#95"
  let numSuffix = ''
  if (card.card_number_display && card.set_printed_total && card.set_printed_total > 1) {
    numSuffix = ` ${card.card_number_display}`
  } else if (card.card_number) {
    numSuffix = ` #${card.card_number}`
  }

  const slug    = card.card_url_slug || card.card_slug || ''
  const setSlug = encodeURIComponent(card.set_name)
  const canonical = `${SITE}/set/${setSlug}/card/${slug}`

  const rawUsd   = card.raw_usd   ? card.raw_usd   / 100 : null
  const psa10Usd = card.psa10_usd ? card.psa10_usd / 100 : null
  const psa9Usd  = card.psa9_usd  ? card.psa9_usd  / 100 : null
  const multiple = rawUsd && psa10Usd ? psa10Usd / rawUsd : null

  const fmt = (v: number) => v >= 1000
    ? `$${(v / 1000).toFixed(1)}k`
    : `$${v.toFixed(0)}`

  // Variant A: grading-focused — multiplier >= 3x
  const useGradingVariant = multiple != null && multiple >= 3

  let title: string
  let description: string

  if (useGradingVariant) {
    title       = `${cleanName}${numSuffix}: Is It Worth Grading? Raw vs PSA 10`
    description = psa10Usd && rawUsd
      ? `${cleanName}${numSuffix} — Raw ${fmt(rawUsd)}, PSA 10 ${fmt(psa10Usd)} (${multiple.toFixed(1)}x). See the grading gap, recent trend, PSA population data and whether the upside is worth the risk.`
      : `See raw, PSA 9 and PSA 10 prices for ${cleanName}${numSuffix}. Compare the grading gap, recent trend and whether the upside looks worth the risk.`
  } else {
    title       = `${cleanName}${numSuffix} Price: Raw, PSA 9, PSA 10`
    description = rawUsd
      ? `${cleanName}${numSuffix} from ${card.set_name} — Raw ${fmt(rawUsd)}${psa9Usd ? `, PSA 9 ${fmt(psa9Usd)}` : ''}${psa10Usd ? `, PSA 10 ${fmt(psa10Usd)}` : ''}. Price trend, grading spread, PSA population data and live eBay listings.`
      : `Track ${cleanName}${numSuffix} prices across raw, PSA 9 and PSA 10. See current value, grading spread, recent trend and population-backed context.`
  }

  return {
    title: `${title} | PokePrices`,
    description,
    canonical,
    ogTitle: title,
    ogDescription: description,
  }
}

// ─── Block 5A-W-34A — insights / set / pokemon copy helpers ────────
//
// Each helper is pure so we can pin the exact strings in unit tests.
// The templates (`src/app/{insights,set/[slug],pokemon/[slug]}/page.tsx`)
// import from here so a copy change is one edit + one test update.

export const INSIGHTS_HUB_TITLE       = 'Pokémon Card Market Insights, Price Trends & Grading Reports | PokePrices'
export const INSIGHTS_HUB_DESCRIPTION = 'Read Pokémon card market reports, price trends, grading insights and collecting analysis. Track movers, PSA 10 values, set trends and cards worth watching.'
export const INSIGHTS_HUB_CANONICAL   = `${SITE}/insights`

/** Compact OG variant — keeps under 90 chars for share previews. */
export const INSIGHTS_HUB_OG_TITLE       = 'Pokémon Card Market Insights, Price Trends & Grading Reports'
export const INSIGHTS_HUB_OG_DESCRIPTION = 'Pokémon card market reports, price trends and grading insights. Track movers, PSA 10 values and cards worth watching.'

/**
 * Fallback description used by the article template when the article
 * has neither `seo_description`, `intro`, nor `excerpt`. Kept in one
 * place so the wording matches the hub's positioning language.
 */
export function getInsightsArticleFallbackDescription(headline: string): string {
  const safe = headline?.trim() || 'Pokémon card insight'
  return `${safe} — Pokémon card market trends, price analysis and grading insights from PokePrices.`
}

// ── Set page ───────────────────────────────────────────────────────

/** Long set-page title. Used when the composed title stays ≤ 60 chars. */
function longSetTitle(setName: string): string {
  return `${setName} Card List & Prices | Most Valuable Cards & PSA 10 Values`
}
/** Short set-page title. Used when the long variant would exceed 60 chars. */
function shortSetTitle(setName: string): string {
  return `${setName} Card List & Prices | PSA 10 Values`
}

export type SetSeo = {
  title:       string
  description: string
  canonical:   string
}

/** SERP title budget. Google's mobile SERP typically truncates around
 *  580px ≈ 70 chars for average glyphs; we allow a small buffer. */
const SERP_TITLE_MAX = 72

/**
 * Build title / description / canonical for /set/{setName}.
 *
 * The long title variant matches the W34A brief; when it would blow
 * past the SERP cut-off, we shrink to a short variant that still
 * carries the "PSA 10 Values" anchor.
 */
export function getSetSeo(setName: string, slug?: string): SetSeo {
  const safeName = setName?.trim() || 'Pokémon'
  const long     = longSetTitle(safeName)
  const title    = long.length <= SERP_TITLE_MAX ? long : shortSetTitle(safeName)
  const description = `Browse ${safeName} Pokémon cards with raw and PSA 10 prices. See the most valuable cards, chase cards, grading opportunities and current set price trends.`
  const canonical = `${SITE}/set/${slug ?? encodeURIComponent(safeName)}`
  return { title, description, canonical }
}

// ── Pokémon species page ───────────────────────────────────────────

export type PokemonSeoInput = {
  /** Display name (capitalised species name, e.g. "Greninja"). */
  name:  string
  /** URL slug used in the canonical (e.g. "greninja"). */
  slug:  string
  /** Total distinct cards known for this species; null when unknown. */
  totalCards?: number | null
  /** Top card fact for the description tail; falsy → no top-card line. */
  topCard?: {
    cardName: string
    setName:  string
    priceLabel: string
  } | null
}

export type PokemonSeo = {
  title:       string
  description: string
  canonical:   string
}

/**
 * Build title / description / canonical for /pokemon/{slug}.
 *
 * Title variants:
 *   * When totalCards is a positive integer AND the composed length
 *     stays ≤ 60 chars, we emit the count-anchored variant:
 *       "{Name} Card Prices Across {N} Cards | Raw & PSA 10 Values"
 *   * Otherwise the plain-benefit variant.
 *   * If that's still too long (very long species names), fall back
 *     to a compact variant that always fits.
 */
export function getPokemonSeo(input: PokemonSeoInput): PokemonSeo {
  const safeName = input.name?.trim() || 'Pokémon'
  const total    = typeof input.totalCards === 'number' && input.totalCards > 0
    ? Math.floor(input.totalCards)
    : null

  const countTitle   = total !== null
    ? `${safeName} Card Prices Across ${total} Cards | Raw & PSA 10 Values`
    : null
  const benefitTitle = `${safeName} Card Prices | Most Valuable ${safeName} Cards & PSA 10 Values`
  const compactTitle = `${safeName} Card Prices — Raw & PSA 10 Values | PokePrices`

  const title =
    countTitle   && countTitle.length   <= SERP_TITLE_MAX ? countTitle   :
    benefitTitle.length                 <= SERP_TITLE_MAX ? benefitTitle :
    compactTitle

  // Description: prefer the count-anchored lead when available.
  const lead = total !== null
    ? `View ${safeName} Pokémon card prices across ${total} cards.`
    : `View ${safeName} Pokémon card prices across sets.`
  const body = `Compare raw, PSA 9 and PSA 10 values, recent movement and the most valuable ${safeName} cards.`
  const topTail = input.topCard
    ? ` Top: ${input.topCard.cardName} from ${input.topCard.setName} at ${input.topCard.priceLabel}.`
    : ''
  let description = `${lead} ${body}${topTail}`
  if (description.length > 300) description = description.slice(0, 297) + '…'

  const canonical = `${SITE}/pokemon/${input.slug}`
  return { title, description, canonical }
}