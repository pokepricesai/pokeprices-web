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