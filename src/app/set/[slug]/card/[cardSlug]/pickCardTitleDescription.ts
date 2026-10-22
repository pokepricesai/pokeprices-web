// Pure function that picks title/description for a card page's SEO
// metadata given the already-resolved price-cents triple + context.
// Extracted from generateMetadata so unit tests can exercise the
// exact string output under every provider-mode / fail-closed branch.
//
// NEVER mixes sources. Caller resolves `rawUsdCents / psa9UsdCents /
// psa10UsdCents` via resolveProviderMode first:
//   - provider-active → TCGGraph-adapted cents (psa9 is always null
//     because the adapter refuses to synthesise it from pooled any:9)
//   - certified legacy → legacy card.*_usd cents
//   - must-fail-closed → all three null
//
// The branch order below naturally omits a claim when a value is null,
// so "fail closed" renders the generic no-price title/description
// variant without any extra wiring.

function fmt(cents: number): string {
  const v = cents / 100
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`
}

export interface TitleDescriptionArgs {
  name:         string
  num:          string
  jpMarker:     string
  year:         number
  setLabel:     string
  descSetPhrase: string
  rawUsdCents:   number | null
  psa9UsdCents:  number | null
  psa10UsdCents: number | null
}

export function pickCardTitleDescription(args: TitleDescriptionArgs): { title: string; description: string } {
  const { name, num, jpMarker, year, setLabel, descSetPhrase, rawUsdCents, psa9UsdCents, psa10UsdCents } = args
  const rawUsd   = rawUsdCents   ? rawUsdCents   / 100 : null
  const psa10Usd = psa10UsdCents ? psa10UsdCents / 100 : null
  const multiple = rawUsd && psa10Usd ? psa10Usd / rawUsd : null
  const useGradingVariant = multiple != null && multiple >= 3

  if (useGradingVariant && rawUsdCents && psa10UsdCents) {
    return {
      title: `${name}${num}${jpMarker} Price: ${fmt(psa10UsdCents)} PSA 10 vs ${fmt(rawUsdCents)} Raw. Worth Grading? (${year})`,
      description: `Is ${name}${num} worth grading? PSA 10 ${fmt(psa10UsdCents)} is ${multiple!.toFixed(1)}× the raw price of ${fmt(rawUsdCents)}. ${descSetPhrase} price guide: gem rate, grading spread, PSA population and verified recent sales.`,
    }
  }
  if (rawUsdCents && psa10UsdCents) {
    return {
      title: `${name}${num}${jpMarker} Price & Value: ${fmt(rawUsdCents)} Raw, ${fmt(psa10UsdCents)} PSA 10 (${year}) | ${setLabel}`,
      description: `How much is ${name}${num} worth? ${descSetPhrase} price guide: ${fmt(rawUsdCents)} raw${psa9UsdCents ? `, ${fmt(psa9UsdCents)} PSA 9` : ''}, ${fmt(psa10UsdCents)} PSA 10. Price trend, grading spread, PSA population and verified recent sales.`,
    }
  }
  if (psa10UsdCents) {
    return {
      title: `${name}${num}${jpMarker} PSA 10 Price & Value: ${fmt(psa10UsdCents)} (${year}) | ${setLabel}`,
      description: `${name}${num} PSA 10 value: ${fmt(psa10UsdCents)}. ${descSetPhrase} price guide: price trend, PSA population, gem rate and verified recent sales. Updated nightly.`,
    }
  }
  if (rawUsdCents) {
    return {
      title: `${name}${num}${jpMarker} Price: ${fmt(rawUsdCents)} Raw (${year}) | ${setLabel}`,
      description: `How much is ${name}${num} worth? ${descSetPhrase} price guide: currently ${fmt(rawUsdCents)} raw. Price trend, grading data, PSA population and verified recent sales. Updated nightly.`,
    }
  }
  // All three null (fail-closed OR genuinely no prices) → generic variant.
  return {
    title: `${name}${num}${jpMarker} Pokémon Card Price Guide (${year}) | ${setLabel}`,
    description: `Track ${name}${num} from ${descSetPhrase}: raw, PSA 9 and PSA 10 prices, grading spreads, PSA population and verified recent sales. Price guide updated nightly.`,
  }
}
