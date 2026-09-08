// src/lib/editorial/research/populationScarcity.ts
//
// EIC Block 6 — deterministic research recipe A.
//
// Target article template:
//   "20 Pokémon cards with high prices and very low PSA 10 populations"
//
// Recipe outline:
//   1. Fetch every psa_population row that clears the mechanical gates
//      (psa_10 < 200 AND total_graded >= 100). Uses paged fetches
//      because the current sample (6,595 rows) exceeds the PostgREST
//      1,000-row default cap.
//   2. Deduplicate on psa_spec_id (each PSA "spec" is one printing).
//      This is what correctly separates Charmeleon #31 Fire Red &
//      Leaf Green from the two Blaine's Charmeleon #31 rows in Gym
//      Challenge — they are legitimately distinct cards.
//   3. Filter out editorially unusable rows: reverse-foil variants,
//      known error printings, promo/oddball prints, and niche legacy
//      sets. These are excluded EXPLICITLY (excludedGroups) so the
//      methodology can name them, not silently dropped.
//   4. Join to `cards` on (set_name minus "Pokemon " prefix,
//      card_number) to attach canonical urls and slugs.
//   5. Join to `card_latest_prices` for raw/PSA-9/PSA-10 prices,
//      then apply a "high price" gate: raw >= $50 OR psa10 >= $100.
//   6. Rank by psa_10 ascending, then psa10_usd descending. Take
//      the top 20.
//   7. Emit verifiedFacts + derivedFindings (gem rate) with formulae.
//   8. Add warnings: PSA snapshot freshness, missing prices, priced
//      cards without match, etc.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchAllPages } from '../pageFetch'
import type {
  EvidencePack, VerifiedFact, DerivedFinding, DataTable, Warning,
  InternalSource, PackQuality, PackProjectRef, QuarantineEntry,
} from './types'
import {
  checkPopulationRow, isEditoriallyMeaningfulPopRow, popDedupKey,
  freshnessWarning, daysBetween, CENTS_PER_USD,
} from './qualityChecks'

const MIN_TOTAL_GRADED         = 100
const MAX_PSA10_POPULATION     = 200
const HIGH_PRICE_RAW_CENTS     = 5_000   // $50
const HIGH_PRICE_PSA10_CENTS   = 10_000  // $100
const TARGET_TOP_N             = 20
const PSA_FRESHNESS_STALE_DAYS = 60
const CANDIDATE_MIN            = 10      // must have at least N candidates or pack is blocked

export type PopulationScarcityOptions = {
  today?: string
  targetTopN?: number
}

export async function runPopulationScarcityRecipe(
  project: PackProjectRef,
  options: PopulationScarcityOptions = {},
): Promise<EvidencePack> {
  const today   = options.today ?? new Date().toISOString().slice(0, 10)
  const topN    = options.targetTopN ?? TARGET_TOP_N
  const supa    = getSupabaseServiceClient()
  const generatedAt = new Date().toISOString()

  const warnings:    Warning[]        = []
  const excludedGroups: Array<{ label: string; reason: string }> = []

  // ── Step 1: paged fetch of qualifying psa_population rows ──────
  const popPage = await fetchAllPages<any>(
    () => supa.from('psa_population')
      .select('set_name, card_number, card_name, variant, psa_9, psa_10, total_graded, gem_rate, scraped_date, psa_spec_id')
      .lt('psa_10', MAX_PSA10_POPULATION)
      .gte('total_graded', MIN_TOTAL_GRADED)
      .order('psa_10', { ascending: true }),
    { hardMaxRows: 20_000 },
  )
  if (popPage.truncated) {
    warnings.push({
      id: 'pop-truncated',
      severity: 'major',
      message: `psa_population fetch was truncated at ${popPage.rows.length} rows — the recipe may have missed rows outside this window.`,
    })
  }
  const popRawCount = popPage.rows.length

  // Latest scrape date from the fetched rows.
  const scrapeDates = popPage.rows
    .map((r: any) => r.scraped_date)
    .filter(Boolean)
    .sort()
  const latestScrape  = scrapeDates[scrapeDates.length - 1] ?? null
  const earliestScrape = scrapeDates[0] ?? null

  if (latestScrape) {
    const fw = freshnessWarning(latestScrape, today, PSA_FRESHNESS_STALE_DAYS, 'PSA population', 'psa_population snapshot')
    if (fw) warnings.push(fw)
  } else {
    warnings.push({ id: 'pop-no-scraped-date', severity: 'major', message: 'psa_population rows carry no scraped_date — freshness unknown.' })
  }

  // ── Step 2: dedup on psa_spec_id ───────────────────────────────
  const dedupMap = new Map<string, any>()
  for (const r of popPage.rows) {
    const key = popDedupKey(r)
    if (!dedupMap.has(key)) dedupMap.set(key, r)
  }
  const deduped = Array.from(dedupMap.values())
  const dedupDropped = popRawCount - deduped.length

  // ── Step 3: editorial-usability filter ─────────────────────────
  const excludeReasonCounts = new Map<string, number>()
  const editoriallyKeep: any[] = []
  for (const r of deduped) {
    const check = isEditoriallyMeaningfulPopRow(r)
    if (!check.keep) {
      const reason = check.excludedReason ?? 'other'
      excludeReasonCounts.set(reason, (excludeReasonCounts.get(reason) ?? 0) + 1)
      continue
    }
    editoriallyKeep.push(r)
  }
  for (const [reason, count] of Array.from(excludeReasonCounts.entries())) {
    excludedGroups.push({ label: reason, reason: `${count} row(s) removed` })
  }

  // Row-level quality warnings (only for the rows that survive to
  // candidate stage — avoids drowning the pack in errors on the
  // excluded tail).
  for (const r of editoriallyKeep) {
    const rowWarns = checkPopulationRow(r, { affects: `psa_population psa_spec_id=${r.psa_spec_id ?? 'none'}` })
    // Only surface criticals for excluded rows; keep majors + minors
    // in-band so reviewers see the full picture on kept rows.
    for (const w of rowWarns) warnings.push(w)
  }

  // ── Step 4: join to cards for canonical urls ───────────────────
  // psa_population set_name uses "Pokemon <SetName>"; cards.set_name
  // is bare. Build both candidate keys.
  const cardKeys = new Set<string>()
  const kAll: Array<{ key1: string; key2: string; pop: any }> = []
  for (const r of editoriallyKeep) {
    const setBare = normalizeSetName(r.set_name)
    const setWithPrefix = String(r.set_name || '').trim()
    const num = String(r.card_number || '').trim().toLowerCase()
    if (!num) continue
    const k1 = `${setBare.toLowerCase()}|${num}`
    const k2 = `${setWithPrefix.toLowerCase()}|${num}`
    cardKeys.add(k1); cardKeys.add(k2)
    kAll.push({ key1: k1, key2: k2, pop: r })
  }

  // Fetch cards only for the sets involved (bounded query).
  const setBareList = Array.from(new Set(editoriallyKeep.map(r => normalizeSetName(r.set_name)).filter(Boolean)))
  const cardsRes = setBareList.length === 0
    ? { rows: [] as any[], pagesFetched: 0, truncated: false }
    : await fetchAllPages<any>(
        () => supa.from('cards')
          .select('card_slug, card_name, set_name, card_number, url_slug, card_url_slug, language, image_url')
          .in('set_name', setBareList),
        { hardMaxRows: 30_000 },
      )
  if (cardsRes.truncated) {
    warnings.push({ id: 'cards-truncated', severity: 'minor', message: `cards fetch truncated at ${cardsRes.rows.length} rows — some pop rows may fail to attach a canonical url.` })
  }

  const cardsBySetNum = new Map<string, any>()
  for (const c of cardsRes.rows) {
    if ((c.language ?? 'en') !== 'en') continue    // English only for now
    const key = `${String(c.set_name || '').toLowerCase()}|${String(c.card_number || '').toLowerCase()}`
    // Keep the first-seen card for a given (set, number). Reverse
    // holos and variants share the number; the pop-side filter
    // already stripped reverse-foil rows, so the first entry is
    // usually the standard print.
    if (!cardsBySetNum.has(key)) cardsBySetNum.set(key, c)
  }

  // ── Step 5: join to card_latest_prices for the matched slugs ──
  const matched: Array<{ pop: any; card: any | null }> = kAll.map(({ pop, key1, key2 }) => ({
    pop,
    card: cardsBySetNum.get(key1) ?? cardsBySetNum.get(key2) ?? null,
  }))
  // card_latest_prices.card_slug uses "pc-<numeric>"; cards.card_slug is
  // bare. Same convention as daily_prices — see CLAUDE.md. Convert
  // both directions to make the join work.
  const slugList = Array.from(new Set(
    matched.map(m => m.card?.card_slug).filter(Boolean) as string[]
  ))
  const pcSlugList = slugList.map(s => `pc-${s}`)

  const pricesRes = slugList.length === 0
    ? { rows: [] as any[], pagesFetched: 0, truncated: false }
    : await fetchAllPages<any>(
        () => supa.from('card_latest_prices')
          .select('card_slug, price_date, raw_usd, psa9_usd, psa10_usd, updated_at')
          .in('card_slug', pcSlugList),
        { hardMaxRows: 50_000 },
      )
  const pricesBySlug = new Map<string, any>()
  for (const p of pricesRes.rows) {
    const bare = String(p.card_slug).replace(/^pc-/, '')
    pricesBySlug.set(bare, p)
  }

  const unmatchedPop = matched.filter(m => !m.card).length
  if (unmatchedPop > 0) {
    warnings.push({
      id: 'pop-unmatched-cards',
      severity: 'minor',
      message: `${unmatchedPop} qualifying psa_population rows have no matching entry in cards — likely name mismatch. These are excluded from the priced ranking.`,
    })
  }

  // ── Step 6: apply the high-price gate + rank ───────────────────
  type Candidate = {
    setName:      string
    cardName:     string
    cardNumber:   string
    variant:      string | null
    psaSpecId:    string | null
    psa9:         number | null
    psa10:        number | null
    totalGraded:  number
    gemRate:      number
    scrapedDate:  string | null
    cardSlug:     string | null
    urlSlug:      string | null
    imageUrl:     string | null
    rawCents:     number | null
    psa9Cents:    number | null
    psa10Cents:   number | null
    priceAsOf:    string | null
  }
  const candidates: Candidate[] = matched.map(({ pop, card }) => {
    const priceRow = card ? pricesBySlug.get(String(card.card_slug)) : null
    return {
      setName:     String(pop.set_name || ''),
      cardName:    String(pop.card_name ?? ''),
      cardNumber:  String(pop.card_number || ''),
      variant:     pop.variant ?? null,
      psaSpecId:   pop.psa_spec_id ?? null,
      psa9:        toNum(pop.psa_9),
      psa10:       toNum(pop.psa_10),
      totalGraded: Number(pop.total_graded ?? 0),
      gemRate:     round2(100 * Number(pop.psa_10 ?? 0) / Math.max(1, Number(pop.total_graded ?? 1))),
      scrapedDate: pop.scraped_date ?? null,
      cardSlug:    card?.card_slug ?? null,
      urlSlug:     card?.url_slug ?? card?.card_url_slug ?? null,
      imageUrl:    card?.image_url ?? null,
      rawCents:    priceRow?.raw_usd   ?? null,
      psa9Cents:   priceRow?.psa9_usd  ?? null,
      psa10Cents:  priceRow?.psa10_usd ?? null,
      priceAsOf:   priceRow?.price_date ?? null,
    }
  })

  const priceEligible = candidates.filter(c => {
    if (c.rawCents  != null && c.rawCents   >= HIGH_PRICE_RAW_CENTS)   return true
    if (c.psa10Cents != null && c.psa10Cents >= HIGH_PRICE_PSA10_CENTS) return true
    return false
  })

  // ── Block 6B — quarantine population/price contradictions ─────
  //
  // A candidate that reports zero PSA 10 copies in the (stale)
  // population snapshot but a positive PSA 10 sale price is
  // logically incoherent. Either a PSA 10 emerged since the last
  // pop scrape and we should not claim "0 exist", or the price
  // observation is misattributed. Either way, do not include the
  // row in a publishable scarcity ranking. Isolate it so a
  // reviewer can see what was excluded and why.
  const quarantinedRows: QuarantineEntry[] = []
  const publishable: typeof priceEligible = []
  for (const c of priceEligible) {
    const isZeroPopWithPrice = (c.psa10 === 0) && (c.psa10Cents ?? 0) > 0
    if (isZeroPopWithPrice) {
      quarantinedRows.push({
        id: `q-zero-pop-${c.psaSpecId ?? `${c.setName}-${c.cardNumber}-${c.variant ?? ''}`}`,
        wouldHaveJoined: 'population-scarcity-top20',
        reason: 'zero_pop_with_price',
        severity: 'major',
        message: `${trimName(c.cardName)} #${c.cardNumber} (${c.setName}) reports 0 PSA 10 copies in the psa_population snapshot (scraped ${c.scrapedDate ?? 'unknown'}) but a $${((c.psa10Cents ?? 0)/CENTS_PER_USD).toFixed(2)} PSA 10 sale price (${c.priceAsOf ?? 'today'}). Contradiction — either a PSA 10 has been graded since the last scrape or the price is misattributed. Excluded from the publishable ranking.`,
        rowSnapshot: {
          setName:         c.setName,
          cardName:        c.cardName,
          cardNumber:      c.cardNumber,
          variant:         c.variant ?? '',
          psa10:           c.psa10 ?? 0,
          totalGraded:     c.totalGraded,
          gemRate:         c.gemRate,
          rawUsd:          c.rawCents  != null ? Number((c.rawCents  / CENTS_PER_USD).toFixed(2)) : null,
          psa9Usd:         c.psa9Cents != null ? Number((c.psa9Cents / CENTS_PER_USD).toFixed(2)) : null,
          psa10Usd:        c.psa10Cents!= null ? Number((c.psa10Cents/ CENTS_PER_USD).toFixed(2)) : null,
          populationAsOf:  c.scrapedDate ?? '',
          priceAsOf:       c.priceAsOf  ?? '',
        },
        // Passive contaminant — the article can still ship if the
        // reviewer accepts that this specific card is not in the ranking.
        contaminatesPublishable: false,
      })
      continue
    }
    publishable.push(c)
  }

  publishable.sort((a, b) => {
    const p = (a.psa10 ?? Number.MAX_SAFE_INTEGER) - (b.psa10 ?? Number.MAX_SAFE_INTEGER)
    if (p !== 0) return p
    return (b.psa10Cents ?? 0) - (a.psa10Cents ?? 0)
  })
  const shortlist = publishable.slice(0, topN)
  const finalCount = shortlist.length

  // Add warnings for candidates missing prices
  const noPriceCount = candidates.filter(c => c.rawCents == null && c.psa10Cents == null).length
  if (noPriceCount > 0) {
    warnings.push({
      id: 'pop-no-price',
      severity: 'minor',
      message: `${noPriceCount} candidates matched a card row but have no raw or PSA 10 price in card_latest_prices — excluded from the priced ranking.`,
    })
  }

  // ── Step 7: pack construction ──────────────────────────────────
  const internalSources: InternalSource[] = [
    {
      id:       'src-psa-population',
      kind:     'internal',
      label:    'psa_population — PSA scarcity snapshot',
      table:    'psa_population',
      filters:  `psa_10 < ${MAX_PSA10_POPULATION} AND total_graded >= ${MIN_TOTAL_GRADED}`,
      asOf:     latestScrape ?? today,
      rowCount: popRawCount,
      note:     earliestScrape && earliestScrape !== latestScrape
        ? `psa_population contains rows scraped between ${earliestScrape} and ${latestScrape}. Freshness varies by set.`
        : undefined,
    },
    {
      id:       'src-cards',
      kind:     'internal',
      label:    'cards — canonical card catalogue',
      table:    'cards',
      filters:  `language = 'en' AND set_name IN (${setBareList.length} sets)`,
      asOf:     today,
      rowCount: cardsRes.rows.length,
    },
    {
      id:       'src-card-latest-prices',
      kind:     'internal',
      label:    'card_latest_prices — latest observed prices per grade',
      table:    'card_latest_prices',
      filters:  `card_slug IN (${slugList.length} candidates)`,
      asOf:     today,
      rowCount: pricesRes.rows.length,
    },
  ]

  const dataTables: DataTable[] = [
    {
      id: 'population-scarcity-top20',
      title: `Top ${finalCount} cards by lowest PSA 10 population (high-price gate applied)`,
      source: 'psa_population + cards + card_latest_prices',
      asOf:   latestScrape ?? today,
      columns: [
        { key: 'setName',        label: 'Set' },
        { key: 'cardName',       label: 'Card' },
        { key: 'cardNumber',     label: '#',                     align: 'right' },
        { key: 'variant',        label: 'Variant' },
        { key: 'psa10',          label: 'PSA 10 pop',            align: 'right' },
        { key: 'totalGraded',    label: 'Total graded',          align: 'right' },
        { key: 'gemRate',        label: 'Gem rate %',            align: 'right' },
        { key: 'rawUsd',         label: 'Raw ($)',               align: 'right' },
        { key: 'psa9Usd',        label: 'PSA 9 ($)',             align: 'right' },
        { key: 'psa10Usd',       label: 'PSA 10 ($)',            align: 'right' },
        { key: 'populationAsOf', label: 'Pop as of' },
        { key: 'priceAsOf',      label: 'Price as of' },
        { key: 'urlSlug',        label: 'PokePrices slug' },
      ],
      rows: shortlist.map(c => ({
        setName:        c.setName,
        cardName:       c.cardName,
        cardNumber:     c.cardNumber,
        variant:        c.variant ?? '',
        psa10:          c.psa10   ?? 0,
        totalGraded:    c.totalGraded,
        gemRate:        c.gemRate,
        rawUsd:         c.rawCents  != null ? Number((c.rawCents / CENTS_PER_USD).toFixed(2)) : null,
        psa9Usd:        c.psa9Cents != null ? Number((c.psa9Cents / CENTS_PER_USD).toFixed(2)) : null,
        psa10Usd:       c.psa10Cents!= null ? Number((c.psa10Cents/ CENTS_PER_USD).toFixed(2)) : null,
        populationAsOf: c.scrapedDate ?? '',
        priceAsOf:      c.priceAsOf  ?? '',
        urlSlug:        c.urlSlug ?? '',
      })),
    },
  ]

  const verifiedFacts: VerifiedFact[] = [
    {
      id: 'fact-sample-size',
      type: 'verified_fact',
      statement: `${popRawCount} psa_population rows have PSA 10 < ${MAX_PSA10_POPULATION} and total graded >= ${MIN_TOTAL_GRADED}.`,
      evidenceRefs: ['src-psa-population'],
      asOf: latestScrape ?? today,
    },
    {
      id: 'fact-editorial-shortlist',
      type: 'verified_fact',
      statement: `${finalCount} cards clear the shortlist after excluding ${dedupDropped} dedup collisions, ${sumExcluded(excludeReasonCounts)} editorially unsuitable rows, ${unmatchedPop} unmatched to cards, and ${noPriceCount} lacking price data.`,
      evidenceRefs: ['src-psa-population','src-cards','src-card-latest-prices'],
      asOf: today,
    },
    ...shortlist.slice(0, 5).map<VerifiedFact>((c, i) => ({
      id: `fact-top-${i+1}`,
      type: 'verified_fact',
      statement: `${trimName(c.cardName)} ${c.cardNumber ? '#' + c.cardNumber : ''} (${c.setName}) has ${c.psa10 ?? 0} PSA 10 copies out of ${c.totalGraded} total graded.`,
      evidenceRefs: ['src-psa-population'],
      asOf: c.scrapedDate ?? latestScrape ?? today,
    })),
  ]

  const derivedFindings: DerivedFinding[] = shortlist.slice(0, 5).map<DerivedFinding>((c, i) => ({
    id: `finding-gem-${i+1}`,
    type: 'derived_finding',
    statement: `${trimName(c.cardName)} PSA 10 gem rate is ${c.gemRate.toFixed(2)}%.`,
    formula: `${c.psa10 ?? 0} / ${c.totalGraded} * 100`,
    evidenceRefs: [`fact-top-${i+1}`, 'src-psa-population'],
    asOf: c.scrapedDate ?? latestScrape ?? today,
  }))

  const gaps: string[] = []
  if (finalCount < CANDIDATE_MIN) gaps.push(`Only ${finalCount} candidates clear all gates. An article promising 20 cards needs at least ${CANDIDATE_MIN}.`)
  if (unmatchedPop > 0)           gaps.push(`Improve psa_population → cards matching (${unmatchedPop} rows failed to attach a canonical URL).`)
  if (noPriceCount > 0)           gaps.push(`Extend card_latest_prices coverage to include ${noPriceCount} otherwise-qualifying cards.`)
  if (quarantinedRows.length > 0) gaps.push(`${quarantinedRows.length} rows quarantined for zero-pop-with-price contradictions. See Quarantined rows.`)

  const popDaysOld = latestScrape ? daysBetween(latestScrape, today) : 0
  const populationIsStale = latestScrape ? popDaysOld > PSA_FRESHNESS_STALE_DAYS : true

  // Block 6B — stale-population framing rules.
  //
  // When the PSA snapshot is materially stale, the study can still
  // be published but only if it explicitly frames the population
  // figures as "PSA population as of <scrape date>" and avoids
  // current-state wording like "these are the rarest PSA 10s today".
  const rejectedClaims = [
    { claim: 'These are the 20 rarest Pokémon cards.',                        reason: 'The sample is bounded by our psa_population coverage (157 sets, ~33k rows). "Rarest overall" would require every set PSA has graded, not just those we track.' },
    { claim: 'Gem rate below 5% means the card is impossible to grade well.', reason: 'Low gem rate reflects submitter selection and print quality; it does not imply future gem rates will match. Preserve as "historical gem rate" only.' },
  ] as Array<{ claim: string; reason: string }>
  if (populationIsStale) rejectedClaims.push({
    claim: 'Only <N> PSA 10 copies exist today.',
    reason: `Population data is ${popDaysOld} days old (snapshot: ${latestScrape ?? 'unknown'}). New PSA 10s may exist. Article must attribute counts to the snapshot date, not to "today".`,
  })

  const requiredCaveats: string[] = []
  if (populationIsStale) requiredCaveats.push(`Article must frame every PSA 10 population figure as "PSA population as of ${latestScrape}". Do not write "currently" or "today" against the population numbers.`)
  if (quarantinedRows.length > 0) requiredCaveats.push(`${quarantinedRows.length} rows were quarantined for zero-pop-with-price contradictions and are NOT in the ranking. The reviewer must not restore them without independent verification.`)

  const quality: PackQuality = computeQuality({
    shortlistSize:   finalCount,
    warnings,
    dataAsOf:        latestScrape ?? today,
    today,
    minSample:       CANDIDATE_MIN,
    populationIsStale,
    quarantinedCount: quarantinedRows.length,
    requiredCaveats,
  })

  const pack: EvidencePack = {
    version:     1,
    recipe:      'population_scarcity',
    project,
    generatedAt,
    dataAsOf:    latestScrape ?? today,
    methodology: {
      summary:
        `Every psa_population row with PSA 10 < ${MAX_PSA10_POPULATION} and total graded >= ${MIN_TOTAL_GRADED} was fetched, deduplicated by psa_spec_id, filtered to editorially usable prints (excluding reverse foils, error variants, promo/oddball printings, and niche legacy sets), joined to the cards catalogue for canonical URLs, and gated by a "high price" filter of raw >= $${HIGH_PRICE_RAW_CENTS/CENTS_PER_USD} or PSA 10 >= $${HIGH_PRICE_PSA10_CENTS/CENTS_PER_USD}. Ranked by PSA 10 population ascending, then PSA 10 price descending. Top ${topN} kept.`,
      filters: [
        { label: 'PSA 10 population', value: `< ${MAX_PSA10_POPULATION}` },
        { label: 'Total graded',      value: `>= ${MIN_TOTAL_GRADED}` },
        { label: 'Price gate',        value: `raw >= $${HIGH_PRICE_RAW_CENTS/CENTS_PER_USD} OR PSA 10 >= $${HIGH_PRICE_PSA10_CENTS/CENTS_PER_USD}` },
        { label: 'Language',          value: `en (cards.language)` },
        { label: 'Ranking',           value: `psa_10 ASC, psa10_usd DESC` },
        { label: 'Top N',             value: String(topN) },
      ],
      excludedGroups,
      dedupKey: 'psa_spec_id (falls back to normalised set_name+card_number+card_name+variant when missing)',
    },
    verifiedFacts,
    derivedFindings,
    dataTables,
    internalSources,
    externalSources: [],
    internalLinks: shortlist.slice(0, topN).map(c => ({
      label: `${trimName(c.cardName)} ${c.cardNumber ? '#' + c.cardNumber : ''}`,
      slug:  c.urlSlug ?? '',
      url:   c.urlSlug ? `https://www.pokeprices.io/set/${slugifySet(c.setName)}/card/${c.urlSlug}` : '',
    })).filter(l => l.slug),
    visualOpportunities: [
      'Ranked table of the top 20 (headline artifact)',
      'PSA 10 population vs. PSA 10 price scatter plot',
      'Gem-rate histogram across the qualifying sample',
      'Card grid with cover art for the top 5',
    ],
    warnings,
    researchGaps: gaps,
    rejectedClaims,
    notes: [],
    quarantinedRows,
    quality,
  }

  return pack
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function normalizeSetName(s: string | null | undefined): string {
  return String(s ?? '').trim().replace(/^Pokemon\s+/i, '')
}
function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function trimName(s: string): string { return s.replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim() }
function slugifySet(s: string): string { return normalizeSetName(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function sumExcluded(m: Map<string, number>): number { let n = 0; for (const v of Array.from(m.values())) n += v; return n }

function computeQuality(inp: {
  shortlistSize:    number
  warnings:         Warning[]
  dataAsOf:         string
  today:            string
  minSample:        number
  populationIsStale: boolean
  quarantinedCount: number
  requiredCaveats:  readonly string[]
}): PackQuality {
  const daysOld = daysBetween(inp.dataAsOf, inp.today)
  const isStale = inp.populationIsStale
  const critical = inp.warnings.some(w => w.severity === 'critical')
  // Publishable ONLY when no critical warnings, sample meets bar, and
  // the pack is not held back by unresolved contradictions in the
  // published set. Quarantined rows are cleanly isolated (they are
  // NOT in the top-N shortlist), so their existence does not by
  // itself block publishability — but the reviewer must accept the
  // required caveats. Staleness pushes status to needs_review, which
  // the Analyst guardrail already downgrades ready -> ready_with_caveats.
  const publishable = !critical && inp.shortlistSize >= inp.minSample
  const reasons: string[] = []
  if (critical)                            reasons.push('One or more critical data-quality warnings must be resolved.')
  if (inp.shortlistSize < inp.minSample)   reasons.push(`Shortlist has only ${inp.shortlistSize} cards — the article template needs at least ${inp.minSample}.`)
  if (isStale)                             reasons.push(`PSA snapshot is ${daysOld} days old. Article can ship ONLY if population figures are framed as "PSA population as of ${inp.dataAsOf}" (see required caveats).`)
  if (inp.quarantinedCount > 0)            reasons.push(`${inp.quarantinedCount} rows quarantined for population/price contradictions. Isolated from the ranking, but the reviewer must NOT restore them without independent verification.`)
  if (reasons.length === 0)                reasons.push('All gates cleared.')
  for (const caveat of inp.requiredCaveats) reasons.push(`Required caveat: ${caveat}`)
  const status: PackQuality['status'] =
      critical                              ? 'blocked'
    : inp.shortlistSize < inp.minSample     ? 'blocked'
    : isStale                               ? 'needs_review'
    : 'ok'
  const dataStrength: PackQuality['dataStrength'] =
      inp.shortlistSize >= 15 && !isStale ? 'strong'
    : inp.shortlistSize >= 10             ? 'medium'
    : 'weak'
  return {
    status,
    dataStrength,
    sampleSize: inp.shortlistSize,
    freshness: { asOf: inp.dataAsOf, daysOld, isStale },
    publishable,
    reasons,
  }
}
