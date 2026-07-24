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

// Block 5A-W-46E-Lite — shortened + brand-tail insights index metadata.
// Prior wording ("Insights, Price Trends & Grading Reports") tripped
// the SERP snippet's ellipsis on mobile. The new title leads with
// intent-first tokens (Market Trends / Prices / Insights) followed by
// the PokePrices brand.
export const INSIGHTS_HUB_TITLE       = 'Pokémon Card Market Trends, Prices & Insights | PokePrices'
export const INSIGHTS_HUB_DESCRIPTION = 'Track Pokémon card market trends, price movements, grading premiums and data-led analysis of popular cards and sets.'
export const INSIGHTS_HUB_CANONICAL   = `${SITE}/insights`

/** Compact OG variant — keeps under 90 chars for share previews. */
export const INSIGHTS_HUB_OG_TITLE       = 'Pokémon Card Market Trends, Prices & Insights'
export const INSIGHTS_HUB_OG_DESCRIPTION = 'Pokémon card market trends, price movements, grading premiums and data-led analysis of popular cards and sets.'

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
//
// Block 5A-W-46E-Lite-FIX1 — authoritative Pokémon display-name
// extractor. The Supabase RPC returns species.name in slug form
// ("mr-mime", "farfetchd", "ho-oh") which loses punctuation. PokeAPI's
// pokemon-species endpoint returns a `names[]` array with the
// official English display name, correctly punctuated for every
// variant (e.g. "Mr. Mime", "Farfetch’d", "Ho-Oh", "Nidoran♀",
// "Type: Null", "Mime Jr."). This pure helper extracts that string
// so the page can pass it into getPokemonSeo() and use it for the
// visible H1 without hard-coding a per-species name table.

/** Extract the official English display name from a PokeAPI
 *  pokemon-species response. Returns null when the input is missing
 *  or malformed so callers can fall back to their slug-derived name. */
export function pokeApiEnglishDisplayName(
  speciesData: { names?: readonly { language?: { name?: string } | null; name?: string }[] | null } | null | undefined,
): string | null {
  if (!speciesData || !Array.isArray(speciesData.names)) return null
  const en = speciesData.names.find(n => n?.language?.name === 'en')
  const name = typeof en?.name === 'string' ? en.name.trim() : ''
  return name || null
}


export type PokemonSeoInput = {
  /** Display name (capitalised species name, e.g. "Greninja"). */
  name:  string
  /** URL slug used in the canonical (e.g. "greninja"). */
  slug:  string
  /** Total distinct cards known for this species; null when unknown. */
  totalCards?: number | null
  /** True when at least one card carries a positive PSA 10 value.
   *  Drives the conditional "PSA 10 values" clause in the description. */
  hasPsa10Data?: boolean
  /** True when at least one card has recent-movement data
   *  (raw_pct_30d present + non-zero). Drives the conditional
   *  "recent movers" clause in the description. */
  hasMovementData?: boolean
  /** Kept for backwards compatibility with any surviving caller; the
   *  W46E-Lite description path does not reference it. */
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
 * Block 5A-W-46E-Lite — shared search-intent Pokémon metadata.
 *
 * Length-aware fallback ladder — species name renders whole, never
 * truncated, never ellipsised:
 *   1. `{Name} Pokémon Card Prices & Values | PokePrices` (primary)
 *   2. `{Name} Card Prices & Values | PokePrices`         (drops "Pokémon")
 *   3. `{Name} Card Prices | PokePrices`                  (drops "& Values")
 *   4. `{Name} Card Prices`                               (drops brand tail)
 *
 * Description:
 *   `See current prices for {N} {Name} Pokémon cards, including raw
 *    [and PSA 10 values], the most valuable cards[, recent movers]
 *    and represented sets.`
 *
 * Rules baked in:
 *   * No year token.
 *   * No card count in the title.
 *   * No duplicated "Pokémon".
 *   * No raw/PSA keyword stuffing in the title.
 *   * PSA 10 clause only when `hasPsa10Data === true`.
 *   * Recent-movers clause only when `hasMovementData === true`.
 *   * Species name never truncated to fit the SERP budget.
 */
export function getPokemonSeo(input: PokemonSeoInput): PokemonSeo {
  const safeName = input.name?.trim() || 'Pokémon'
  const total    = typeof input.totalCards === 'number' && input.totalCards > 0
    ? Math.floor(input.totalCards)
    : null

  // Length-aware title. Optional tokens drop in order; species name
  // is preserved intact at every step.
  const t1 = `${safeName} Pokémon Card Prices & Values | PokePrices`
  const t2 = `${safeName} Card Prices & Values | PokePrices`
  const t3 = `${safeName} Card Prices | PokePrices`
  const t4 = `${safeName} Card Prices`
  const title =
      t1.length <= SERP_TITLE_MAX ? t1
    : t2.length <= SERP_TITLE_MAX ? t2
    : t3.length <= SERP_TITLE_MAX ? t3
    : t4

  // Description assembly — every clause is conditional on real data.
  const nounPhrase = total !== null
    ? `${total} ${safeName} Pokémon card${total === 1 ? '' : 's'}`
    : `${safeName} Pokémon cards`
  const facts: string[] = []
  if (input.hasPsa10Data)    facts.push('raw and PSA 10 values')
  else                       facts.push('raw values')
  facts.push('the most valuable cards')
  if (input.hasMovementData) facts.push('recent movers')
  facts.push('represented sets')
  const factsJoined = facts.length > 1
    ? facts.slice(0, -1).join(', ') + ' and ' + facts[facts.length - 1]
    : facts[0]
  let description = `See current prices for ${nounPhrase}, including ${factsJoined}.`
  if (description.length > 300) description = description.slice(0, 297) + '…'

  const canonical = `${SITE}/pokemon/${input.slug}`
  return { title, description, canonical }
}