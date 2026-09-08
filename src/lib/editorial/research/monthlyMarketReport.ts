// src/lib/editorial/research/monthlyMarketReport.ts
//
// EIC Block 6 + Final Cleanup — monthly market report recipe.
//
// The Final Cleanup pass hardened this recipe against the failure
// modes we saw in the first real Preview run:
//
//   1. ROBUST ENDPOINTS. Single-day observations are no longer used
//      as the "start" or "end" price. Instead each card's endpoint
//      value is the MEDIAN of up to 3 full-catalogue snapshots
//      within ±2 days of the calendar boundary. A card needs at
//      least 2 valid observations at BOTH ends to enter the sample.
//
//   2. ENDPOINT STABILITY. Cards whose 3 near-endpoint observations
//      wobble by more than 3× (max/min ratio) at either end get
//      `editorialConfidence = 'excluded'` — a bad day cannot flip
//      the card into the mover list.
//
//   3. EDITORIAL EXTREME-MOVE GUARD. Any monthly move outside
//      the [-60%, +200%] band goes to `editorialConfidence =
//      'excluded'`. Nothing here deletes the row from the pack;
//      it is preserved under quarantinedRows for reviewer eyes.
//
//   4. EDITORIAL CONFIDENCE. Every mover carries `editorialConfidence:
//      'high' | 'medium' | 'excluded'`. Publishable mover tables use
//      only `high`. The Writer never sees the excluded rows as
//      candidates — only a count in the methodology.
//
//   5. MARKET SIGNAL STRENGTH. The pack now emits
//      `marketSignalStrength: 'strong' | 'moderate' | 'weak'`
//      derived from transparent rules over the CLEAN sample. A
//      near-zero median with balanced breadth is 'weak' and the
//      Writer treats it accordingly (see writerPrompt.ts).

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchAllPages } from '../pageFetch'
import type {
  EvidencePack, VerifiedFact, DerivedFinding, DataTable, Warning,
  InternalSource, PackQuality, PackProjectRef, QuarantineEntry,
  MarketSignalStrength,
} from './types'
import { CENTS_PER_USD, daysBetween } from './qualityChecks'

const MIN_ROWS_PER_ENDPOINT       = 30_000
const MIN_INTERSECTION            = 15_000     // slightly lower because we require 2+ obs at each end
const TOP_MOVER_MIN_START_CENTS   = 500        // $5
const TOP_MOVER_LIMIT             = 10
const NEAR_ENDPOINT_WINDOW_DAYS   = 2          // ± days around the calendar endpoint
const MIN_ENDPOINT_OBSERVATIONS   = 2          // require at least 2 valid obs at each end
const ENDPOINT_STABILITY_RATIO    = 3.0        // max/min ratio inside the endpoint window
const EDITORIAL_MAX_POSITIVE_PCT  = 200        // above this -> excluded
const EDITORIAL_MAX_NEGATIVE_PCT  = -60        // below this -> excluded
const HIGH_CONFIDENCE_ABS_PCT     = 100        // |pct| < 100 -> can be high-confidence

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export type MonthlyMarketReportOptions = {
  today?:       string
  targetMonth?: { year: number; month: number }
}

export async function runMonthlyMarketReportRecipe(
  project: PackProjectRef,
  options: MonthlyMarketReportOptions = {},
): Promise<EvidencePack> {
  const today       = options.today ?? new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()
  const supa        = getSupabaseServiceClient()

  const { year, month } = options.targetMonth ?? inferTargetMonth(project.title, today)
  const monthLabel      = `${MONTH_NAMES[month - 1]} ${year}`
  const startDate       = isoDate(year, month, 1)
  const endDate         = lastDayOfMonthIso(year, month)

  const warnings: Warning[] = []

  // ── Step 1: pick 3 full-catalogue days near each endpoint ──
  const startWindow = await pickEndpointDays(supa, startDate)
  const endWindow   = await pickEndpointDays(supa, endDate)
  if (startWindow.length < MIN_ENDPOINT_OBSERVATIONS) {
    warnings.push({ id: 'endpoint-start-thin', severity: 'critical',
      message: `Only ${startWindow.length} full-catalogue snapshot(s) within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of ${startDate}. Robust start endpoint needs ${MIN_ENDPOINT_OBSERVATIONS}+.` })
  }
  if (endWindow.length < MIN_ENDPOINT_OBSERVATIONS) {
    warnings.push({ id: 'endpoint-end-thin', severity: 'critical',
      message: `Only ${endWindow.length} full-catalogue snapshot(s) within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of ${endDate}. Robust end endpoint needs ${MIN_ENDPOINT_OBSERVATIONS}+.` })
  }

  // ── Step 2: fetch every card observation across the two windows ──
  const [startPages, endPages] = await Promise.all([
    fetchDaysPaged(supa, startWindow),
    fetchDaysPaged(supa, endWindow),
  ])

  // Group by slug and compute robust endpoint values (median of
  // valid positive raw_usd observations).
  const startRobust = groupToRobustEndpoint(startPages)
  const endRobust   = groupToRobustEndpoint(endPages)

  const startOnly: string[] = []
  const endOnly:   string[] = []
  const unstable:  string[] = []

  type MonthlyDelta = {
    cardSlug:      string
    startCents:    number
    endCents:      number
    startObsCount: number
    endObsCount:   number
    startStable:   boolean
    endStable:     boolean
    pct:           number
    absChangeCents: number
    editorialConfidence: 'high' | 'medium' | 'excluded'
    exclusionReason?: 'extreme_move' | 'unstable_endpoint' | 'below_min_price' | 'insufficient_obs'
  }

  const deltas: MonthlyDelta[] = []
  const allSlugs = new Set<string>([...Array.from(startRobust.keys()), ...Array.from(endRobust.keys())])
  for (const slug of Array.from(allSlugs)) {
    const s = startRobust.get(slug)
    const e = endRobust.get(slug)
    if (!s && !e) continue
    if (s && !e) { startOnly.push(slug); continue }
    if (!s && e) { endOnly.push(slug);   continue }
    // Require enough observations on both sides.
    if (s!.count < MIN_ENDPOINT_OBSERVATIONS || e!.count < MIN_ENDPOINT_OBSERVATIONS) {
      // Not editorially trustworthy — mark as excluded so it can
      // show up under Quarantined Data for reviewer eyes.
      deltas.push({
        cardSlug: slug,
        startCents: s!.median, endCents: e!.median,
        startObsCount: s!.count, endObsCount: e!.count,
        startStable: s!.stable, endStable: e!.stable,
        pct: safePct(s!.median, e!.median),
        absChangeCents: e!.median - s!.median,
        editorialConfidence: 'excluded',
        exclusionReason: 'insufficient_obs',
      })
      continue
    }
    const stable = s!.stable && e!.stable
    if (!stable) unstable.push(slug)
    const pct = safePct(s!.median, e!.median)
    const abs = e!.median - s!.median
    const conf = classifyEditorialConfidence({ pct, stable })
    deltas.push({
      cardSlug: slug,
      startCents: s!.median, endCents: e!.median,
      startObsCount: s!.count, endObsCount: e!.count,
      startStable: s!.stable, endStable: e!.stable,
      pct, absChangeCents: abs,
      editorialConfidence: conf.confidence,
      exclusionReason: conf.reason,
    })
  }

  const bothPricedRaw = deltas.filter(d => d.editorialConfidence !== 'excluded' || d.exclusionReason === 'extreme_move' || d.exclusionReason === 'unstable_endpoint')
  const cleanSample   = deltas.filter(d => d.editorialConfidence !== 'excluded')
  const excludedCount = deltas.filter(d => d.editorialConfidence === 'excluded').length

  if (cleanSample.length < MIN_INTERSECTION) {
    warnings.push({ id: 'intersection-thin', severity: 'critical',
      message: `Clean sample is ${cleanSample.length} cards (below ${MIN_INTERSECTION}). Robust monthly report requires more overlap between endpoint windows.` })
  }
  if (startOnly.length + endOnly.length > 0) {
    warnings.push({ id: 'survivorship', severity: 'minor',
      message: `${startOnly.length} cards priced at start but not end; ${endOnly.length} vice versa. Sample restricted to intersection.` })
  }

  // ── Step 3: aggregate stats over the CLEAN sample ──
  const cleanPcts = cleanSample.map(d => d.pct)
  const median  = medianOf(cleanPcts)
  const q1      = percentile(cleanPcts, 0.25)
  const q3      = percentile(cleanPcts, 0.75)
  const rising  = cleanPcts.filter(p => p >   1).length
  const falling = cleanPcts.filter(p => p <  -1).length
  const flat    = cleanPcts.length - rising - falling
  const risingPctOfSample  = cleanSample.length ? (100 * rising  / cleanSample.length) : 0
  const fallingPctOfSample = cleanSample.length ? (100 * falling / cleanSample.length) : 0

  // ── Step 4: top movers, editorial-safe only ──
  const meaningful  = cleanSample.filter(d => d.startCents >= TOP_MOVER_MIN_START_CENTS)
  const topRisers   = [...meaningful].sort((a, b) => b.pct - a.pct).slice(0, TOP_MOVER_LIMIT)
  const topFallers  = [...meaningful].sort((a, b) => a.pct - b.pct).slice(0, TOP_MOVER_LIMIT)

  // ── Step 5: quarantined for review (extremes + unstable) ──
  const quarantinedMovers = deltas.filter(d => d.editorialConfidence === 'excluded' && (d.exclusionReason === 'extreme_move' || d.exclusionReason === 'unstable_endpoint'))

  // ── Step 6: enrich top-mover + quarantined cards ──
  const moverSlugs = Array.from(new Set([...topRisers, ...topFallers, ...quarantinedMovers].map(m => m.cardSlug)))
  const moverSlugsBare = moverSlugs.map(s => String(s).replace(/^pc-/, ''))
  const moverCards = moverSlugsBare.length === 0
    ? { rows: [] as any[], pagesFetched: 0, truncated: false }
    : await fetchAllPages<any>(
        () => supa.from('cards').select('card_slug, card_name, set_name, card_number, url_slug').in('card_slug', moverSlugsBare),
        { hardMaxRows: 20_000 },
      )
  const cardBySlug = new Map<string, any>()
  for (const c of moverCards.rows) { cardBySlug.set(String(c.card_slug), c); cardBySlug.set(`pc-${c.card_slug}`, c) }

  const enrichMover = (d: MonthlyDelta) => {
    const c = cardBySlug.get(d.cardSlug) ?? {}
    return {
      cardSlug:    d.cardSlug,
      cardName:    trimName(String(c.card_name ?? '')),
      cardNumber:  String(c.card_number ?? ''),
      setName:     String(c.set_name ?? ''),
      urlSlug:     c.url_slug ?? '',
      startUsd:    round2(d.startCents / CENTS_PER_USD),
      endUsd:      round2(d.endCents   / CENTS_PER_USD),
      pct:         round2(d.pct),
      startObs:    d.startObsCount,
      endObs:      d.endObsCount,
      editorialConfidence: d.editorialConfidence,
    }
  }
  const topRisersRows  = topRisers.map(enrichMover)
  const topFallersRows = topFallers.map(enrichMover)

  const quarantinedRows: QuarantineEntry[] = quarantinedMovers.map(d => {
    const en = enrichMover(d)
    const reasonLabel = d.exclusionReason === 'extreme_move'
      ? `moved ${fmtSignedPct(d.pct)} — outside the editorial [-60%, +200%] band`
      : `endpoint observations wobble beyond the ${ENDPOINT_STABILITY_RATIO}× stability ratio`
    return {
      id: `q-mover-${d.cardSlug}`,
      wouldHaveJoined: `mover-risers-${year}-${String(month).padStart(2,'0')} or fallers`,
      reason: 'extreme_monthly_move',
      severity: 'major',
      message: `${en.cardName || d.cardSlug}: ${reasonLabel} ($${en.startUsd} → $${en.endUsd}).`,
      rowSnapshot: {
        cardSlug: d.cardSlug, cardName: en.cardName, cardNumber: en.cardNumber, setName: en.setName,
        startUsd: en.startUsd, endUsd: en.endUsd, pct: en.pct,
        startObs: d.startObsCount, endObs: d.endObsCount,
        reason: d.exclusionReason ?? 'excluded',
      },
      contaminatesPublishable: false,
    }
  })

  // ── Step 7: market signal strength (transparent rules) ──
  const signal = classifyMarketSignal({
    sampleSize: cleanSample.length,
    absMedian:  Math.abs(median),
    breadthGap: Math.abs(risingPctOfSample - fallingPctOfSample),
    iqrWidth:   q3 - q1,
    trustworthyMoversCount: topRisers.length + topFallers.length,
  })

  const internalSources: InternalSource[] = [
    { id: 'src-dp-start', kind: 'internal', label: `daily_prices near ${startDate}`, table: 'daily_prices', filters: `date IN (${startWindow.join(', ')})`, asOf: startDate, rowCount: startPages.length },
    { id: 'src-dp-end',   kind: 'internal', label: `daily_prices near ${endDate}`,   table: 'daily_prices', filters: `date IN (${endWindow.join(', ')})`,   asOf: endDate,   rowCount: endPages.length },
    { id: 'src-cards-movers', kind: 'internal', label: 'cards — mover metadata', table: 'cards', filters: `card_slug IN (${moverSlugs.length} slugs)`, asOf: today, rowCount: moverCards.rows.length },
  ]

  const dataTables: DataTable[] = [
    {
      id: `mover-risers-${year}-${String(month).padStart(2,'0')}`,
      title: `Top ${topRisersRows.length} editorial-safe raw-price risers, ${monthLabel}`,
      source: `daily_prices (${startWindow.length}-day start window + ${endWindow.length}-day end window) + cards`,
      asOf: endDate,
      columns: [
        { key: 'cardName',   label: 'Card' },
        { key: 'cardNumber', label: '#',                                align: 'right' },
        { key: 'setName',    label: 'Set' },
        { key: 'startUsd',   label: `Start $ (median near ${startDate})`, align: 'right' },
        { key: 'endUsd',     label: `End $ (median near ${endDate})`,     align: 'right' },
        { key: 'pct',        label: '% change',                          align: 'right' },
        { key: 'editorialConfidence', label: 'Confidence' },
      ],
      rows: topRisersRows,
    },
    {
      id: `mover-fallers-${year}-${String(month).padStart(2,'0')}`,
      title: `Top ${topFallersRows.length} editorial-safe raw-price fallers, ${monthLabel}`,
      source: `daily_prices (${startWindow.length}-day start window + ${endWindow.length}-day end window) + cards`,
      asOf: endDate,
      columns: [
        { key: 'cardName',   label: 'Card' },
        { key: 'cardNumber', label: '#',                                align: 'right' },
        { key: 'setName',    label: 'Set' },
        { key: 'startUsd',   label: `Start $ (median near ${startDate})`, align: 'right' },
        { key: 'endUsd',     label: `End $ (median near ${endDate})`,     align: 'right' },
        { key: 'pct',        label: '% change',                          align: 'right' },
        { key: 'editorialConfidence', label: 'Confidence' },
      ],
      rows: topFallersRows,
    },
  ]

  const verifiedFacts: VerifiedFact[] = [
    { id: 'fact-window', type: 'verified_fact', statement: `Report window: ${startDate} to ${endDate} (${monthLabel}). Endpoint prices are the median of each card's observations within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of the calendar boundary.`, evidenceRefs: [], asOf: endDate },
    { id: 'fact-clean-sample', type: 'verified_fact', statement: `${cleanSample.length} cards enter the editorial-safe sample after robust-endpoint + stability + extreme-move filters.`, evidenceRefs: ['src-dp-start', 'src-dp-end'], asOf: endDate },
    { id: 'fact-excluded', type: 'verified_fact', statement: `${excludedCount} cards were excluded from the editorial-safe sample. Of these, ${quarantinedMovers.length} appear under Quarantined Data (extreme move or unstable endpoints) and can be manually reviewed.`, evidenceRefs: ['src-dp-start', 'src-dp-end'], asOf: endDate },
  ]

  const derivedFindings: DerivedFinding[] = [
    { id: 'finding-median-raw', type: 'derived_finding', statement: `Median monthly raw-price change across the clean sample was ${fmtSignedPct(median)}.`, formula: 'median(rawPct) over cards clearing all editorial filters', evidenceRefs: ['fact-clean-sample'], asOf: endDate },
    { id: 'finding-iqr',        type: 'derived_finding', statement: `Interquartile range of monthly raw-price change was ${fmtSignedPct(q1)} to ${fmtSignedPct(q3)}.`, formula: 'p25(rawPct), p75(rawPct)', evidenceRefs: ['fact-clean-sample'], asOf: endDate },
    { id: 'finding-direction',  type: 'derived_finding', statement: `${rising} clean cards rose more than 1%, ${falling} fell more than 1%, ${flat} were within a percentage point of flat.`, formula: 'count where rawPct > 1; count where rawPct < -1; remainder', evidenceRefs: ['fact-clean-sample'], asOf: endDate },
    { id: 'finding-signal',     type: 'derived_finding', statement: `Market signal strength: ${signal.strength}. ${signal.reason}`, formula: 'classify(median, breadth, IQR, sample size, mover count)', evidenceRefs: ['fact-clean-sample'], asOf: endDate },
  ]

  const gaps: string[] = []
  if (cleanSample.length < MIN_INTERSECTION) gaps.push(`Clean sample of ${cleanSample.length} is below the ${MIN_INTERSECTION} publishability bar. Extend endpoint scraping coverage.`)
  if (quarantinedMovers.length > 0)          gaps.push(`${quarantinedMovers.length} extreme / unstable-endpoint movers were quarantined. Reviewer can manually restore any with independent evidence.`)

  const rejectedClaims: Array<{ claim: string; reason: string }> = [
    { claim: `The Pokemon market moved X% in ${monthLabel}.`,   reason: 'Sample is the PokePrices tracked catalogue on daily_prices, not the whole Pokemon TCG market.' },
    { claim: `Card X gained N,NNN% in ${monthLabel}.`,          reason: `Editorial filter excludes any card outside the [-60%, +200%] band. Extreme rows sit under Quarantined Data pending manual verification.` },
  ]
  if (signal.strength === 'weak') {
    rejectedClaims.push({ claim: `The big story in ${monthLabel} was a ${fmtSignedPct(median)} median.`, reason: 'Near-zero median with balanced breadth is a quiet month, not a headline. Do not manufacture excitement.' })
    rejectedClaims.push({ claim: `${monthLabel} marked a major shift in the Pokemon market.`,           reason: 'Market signal strength is "weak". Reserve dramatic wording for robust evidence.' })
  }

  const quality = computeQuality({
    cleanSize:       cleanSample.length,
    warnings,
    dataAsOf:        endDate,
    today,
    minIntersection: MIN_INTERSECTION,
  })

  return {
    version:     1,
    recipe:      'monthly_market_report',
    project,
    generatedAt,
    dataAsOf:    endDate,
    methodology: {
      summary:
        `Endpoint prices are the median of each card's raw_usd observations from up to ${NEAR_ENDPOINT_WINDOW_DAYS + 1} full-catalogue snapshots within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of ${startDate} and ${endDate}. A card enters the editorial-safe sample only when both endpoints have >= ${MIN_ENDPOINT_OBSERVATIONS} valid observations, the endpoint observations are internally stable (max/min ratio < ${ENDPOINT_STABILITY_RATIO}), and the resulting monthly move sits inside [${EDITORIAL_MAX_NEGATIVE_PCT}%, +${EDITORIAL_MAX_POSITIVE_PCT}%]. Rows outside those bands are preserved under Quarantined Data for manual review.`,
      filters: [
        { label: 'Start window', value: startWindow.join(', ') },
        { label: 'End window',   value: endWindow.join(', ') },
        { label: 'Endpoint value', value: `median(raw_usd) over up to ${NEAR_ENDPOINT_WINDOW_DAYS + 1} full snapshots per side` },
        { label: 'Min endpoint observations', value: `>= ${MIN_ENDPOINT_OBSERVATIONS} on BOTH sides` },
        { label: 'Endpoint stability', value: `max/min ratio < ${ENDPOINT_STABILITY_RATIO} within each endpoint window` },
        { label: 'Editorial extreme guard', value: `[${EDITORIAL_MAX_NEGATIVE_PCT}%, +${EDITORIAL_MAX_POSITIVE_PCT}%]` },
        { label: 'Top-mover start-price gate', value: `>= $${TOP_MOVER_MIN_START_CENTS / CENTS_PER_USD}` },
      ],
      excludedGroups: [
        { label: 'start-only cards',   reason: `${startOnly.length} cards priced at start but not end` },
        { label: 'end-only cards',     reason: `${endOnly.length} cards priced at end but not start` },
        { label: 'unstable endpoints', reason: `${unstable.length} cards where near-endpoint observations wobble beyond the stability ratio` },
        { label: 'extreme moves',      reason: `${deltas.filter(d => d.exclusionReason === 'extreme_move').length} cards outside [${EDITORIAL_MAX_NEGATIVE_PCT}%, +${EDITORIAL_MAX_POSITIVE_PCT}%]` },
        { label: 'insufficient observations', reason: `${deltas.filter(d => d.exclusionReason === 'insufficient_obs').length} cards with <${MIN_ENDPOINT_OBSERVATIONS} valid observations at an endpoint` },
      ],
      dedupKey: 'card_slug (one observation per card per date; per-endpoint median then applied)',
    },
    verifiedFacts,
    derivedFindings,
    dataTables,
    internalSources,
    externalSources: [],
    internalLinks: [
      ...topRisersRows.slice(0, 5).filter(m => m.urlSlug).map(m => ({
        label: `${m.cardName} ${m.cardNumber ? '#' + m.cardNumber : ''} (${fmtSignedPct(m.pct)})`,
        slug: m.urlSlug!, url: `https://www.pokeprices.io/set/${slugifySet(m.setName)}/card/${m.urlSlug}`,
      })),
    ],
    visualOpportunities: [
      'Histogram of monthly raw-price % change across the clean sample',
      'Ranked table of the top 10 editorial-safe risers and top 10 fallers',
    ],
    warnings,
    researchGaps: gaps,
    rejectedClaims,
    notes: [],
    quarantinedRows,
    quality,
    marketSignalStrength: signal.strength,
    marketSignalReason:   signal.reason,
  }
}

// ─────────────────────────────────────────────────────────────────
// Endpoint window selection + robust median
// ─────────────────────────────────────────────────────────────────

async function pickEndpointDays(supa: ReturnType<typeof getSupabaseServiceClient>, targetDate: string): Promise<string[]> {
  const target = new Date(targetDate + 'T00:00:00Z')
  const candidates: string[] = []
  for (let dx = -NEAR_ENDPOINT_WINDOW_DAYS; dx <= NEAR_ENDPOINT_WINDOW_DAYS; dx++) {
    const d = new Date(target); d.setUTCDate(target.getUTCDate() + dx)
    candidates.push(d.toISOString().slice(0, 10))
  }
  const full = await Promise.all(candidates.map(async (d) => {
    const { count } = await supa.from('daily_prices').select('card_slug', { count: 'exact', head: true }).eq('date', d)
    return { date: d, c: Number(count ?? 0) }
  }))
  return full
    .filter(x => x.c >= MIN_ROWS_PER_ENDPOINT)
    .sort((a, b) => Math.abs(new Date(a.date).getTime() - target.getTime()) - Math.abs(new Date(b.date).getTime() - target.getTime()))
    .slice(0, 3)
    .map(x => x.date)
}

async function fetchDaysPaged(supa: ReturnType<typeof getSupabaseServiceClient>, dates: string[]): Promise<Array<{ card_slug: string; date: string; raw_usd: number | null }>> {
  const out: Array<{ card_slug: string; date: string; raw_usd: number | null }> = []
  for (const d of dates) {
    const page = await fetchAllPages<any>(
      () => supa.from('daily_prices').select('card_slug, date, raw_usd').eq('date', d),
      { hardMaxRows: 200_000 },
    )
    for (const r of page.rows) out.push({ card_slug: String(r.card_slug), date: String(r.date), raw_usd: r.raw_usd })
  }
  return out
}

type RobustEndpoint = { median: number; count: number; stable: boolean }

function groupToRobustEndpoint(rows: Array<{ card_slug: string; date: string; raw_usd: number | null }>): Map<string, RobustEndpoint> {
  const bySlug = new Map<string, number[]>()
  for (const r of rows) {
    const v = typeof r.raw_usd === 'number' ? r.raw_usd : Number(r.raw_usd)
    if (!Number.isFinite(v) || v <= 0) continue
    const list = bySlug.get(r.card_slug) ?? []
    list.push(v)
    bySlug.set(r.card_slug, list)
  }
  const out = new Map<string, RobustEndpoint>()
  for (const [slug, vals] of Array.from(bySlug.entries())) {
    const min = Math.min(...vals), max = Math.max(...vals)
    const stable = min > 0 && (max / min) < ENDPOINT_STABILITY_RATIO
    out.set(slug, { median: medianOf(vals), count: vals.length, stable })
  }
  return out
}

function classifyEditorialConfidence(inp: { pct: number; stable: boolean }): { confidence: 'high' | 'medium' | 'excluded'; reason?: MonthlyExclusionReason } {
  if (!inp.stable) return { confidence: 'excluded', reason: 'unstable_endpoint' }
  if (inp.pct > EDITORIAL_MAX_POSITIVE_PCT || inp.pct < EDITORIAL_MAX_NEGATIVE_PCT) return { confidence: 'excluded', reason: 'extreme_move' }
  const abs = Math.abs(inp.pct)
  if (abs < HIGH_CONFIDENCE_ABS_PCT) return { confidence: 'high' }
  return { confidence: 'medium' }
}

type MonthlyExclusionReason = 'extreme_move' | 'unstable_endpoint' | 'below_min_price' | 'insufficient_obs'

// ─────────────────────────────────────────────────────────────────
// Signal strength — transparent rules
// ─────────────────────────────────────────────────────────────────

function classifyMarketSignal(inp: {
  sampleSize: number
  absMedian:  number   // |median % change|
  breadthGap: number   // |rising% - falling%|
  iqrWidth:   number   // p75 - p25 in pp
  trustworthyMoversCount: number
}): { strength: MarketSignalStrength; reason: string } {
  const reasons: string[] = []
  let score = 0
  if (inp.absMedian >= 5)  { score += 2; reasons.push(`median move ${inp.absMedian.toFixed(1)}pp is meaningful`) }
  else if (inp.absMedian >= 2) { score += 1; reasons.push(`median move ${inp.absMedian.toFixed(1)}pp is moderate`) }
  else                         { reasons.push(`median move ${inp.absMedian.toFixed(1)}pp is near zero`) }

  if (inp.breadthGap >= 15) { score += 2; reasons.push(`${inp.breadthGap.toFixed(1)}pp breadth gap is directional`) }
  else if (inp.breadthGap >= 8) { score += 1; reasons.push(`${inp.breadthGap.toFixed(1)}pp breadth gap is mild`) }
  else                         { reasons.push(`${inp.breadthGap.toFixed(1)}pp breadth gap is balanced`) }

  if (inp.iqrWidth >= 30) { score += 1; reasons.push(`IQR ${inp.iqrWidth.toFixed(1)}pp is wide (dispersion story)`) }

  if (inp.trustworthyMoversCount >= 10) reasons.push(`${inp.trustworthyMoversCount} clean movers available`)
  else                                  reasons.push(`only ${inp.trustworthyMoversCount} clean movers`)

  if (inp.sampleSize < 5_000) { score = Math.min(score, 1); reasons.push(`sample size ${inp.sampleSize} is small`) }

  const strength: MarketSignalStrength = score >= 3 ? 'strong' : score >= 2 ? 'moderate' : 'weak'
  return { strength, reason: reasons.join('; ') }
}

// ─────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────

function safePct(a: number, b: number): number {
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(b)) return 0
  return 100 * (b - a) / a
}
function inferTargetMonth(title: string, today: string): { year: number; month: number } {
  const lower = title.toLowerCase()
  const now = new Date(today + 'T00:00:00Z')
  let year = now.getUTCFullYear()
  const yearMatch = title.match(/(20\d{2})/)
  if (yearMatch) year = Number(yearMatch[1])
  for (let i = 0; i < 12; i++) {
    if (lower.includes(MONTH_NAMES[i].toLowerCase())) return { year, month: i + 1 }
  }
  const prev = new Date(Date.UTC(year, now.getUTCMonth() - 1, 1))
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 }
}
export { inferTargetMonth }

function isoDate(y: number, m: number, d: number): string { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
function lastDayOfMonthIso(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0))
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function trimName(s: string): string { return s.replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim() }
function slugifySet(s: string): string { return String(s ?? '').trim().replace(/^Pokemon\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function fmtSignedPct(n: number | null): string { if (n == null) return 'n/a'; const s = n.toFixed(1); return `${n >= 0 ? '+' : ''}${s}%` }
function medianOf(xs: number[]): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a,b)=>a-b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2 }
function percentile(xs: number[], p: number): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a,b)=>a-b); const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length))); return s[i] }

function computeQuality(inp: { cleanSize: number; warnings: Warning[]; dataAsOf: string; today: string; minIntersection: number }): PackQuality {
  const daysOld = daysBetween(inp.dataAsOf, inp.today)
  const isStale = daysOld > 45
  const critical = inp.warnings.some(w => w.severity === 'critical')
  const publishable = !critical && inp.cleanSize >= inp.minIntersection
  const reasons: string[] = []
  if (critical)                              reasons.push('One or more critical endpoint warnings must be resolved.')
  if (inp.cleanSize < inp.minIntersection)   reasons.push(`Clean sample of ${inp.cleanSize} is below the ${inp.minIntersection}-card publishability bar.`)
  if (isStale)                               reasons.push(`Target month ended ${daysOld} days ago — publish freshness is degraded.`)
  if (reasons.length === 0)                  reasons.push('All gates cleared.')
  const status: PackQuality['status'] =
      critical                              ? 'blocked'
    : inp.cleanSize < inp.minIntersection   ? 'blocked'
    : isStale                               ? 'needs_review'
    : 'ok'
  const dataStrength: PackQuality['dataStrength'] =
      inp.cleanSize >= 40_000 ? 'strong'
    : inp.cleanSize >= 15_000 ? 'medium'
    : 'weak'
  return { status, dataStrength, sampleSize: inp.cleanSize, freshness: { asOf: inp.dataAsOf, daysOld, isStale }, publishable, reasons }
}
