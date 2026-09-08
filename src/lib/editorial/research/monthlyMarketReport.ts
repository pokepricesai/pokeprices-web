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
const MIN_INTERSECTION            = 15_000
const TOP_MOVER_MIN_START_CENTS   = 500        // $5
const TOP_MOVER_LIMIT             = 10
const NEAR_ENDPOINT_WINDOW_DAYS   = 2

// ── AGGREGATE sample thresholds (broad, for median / IQR / breadth) ──
const AGGREGATE_MIN_ENDPOINT_OBS  = 2          // 2 obs each side is plenty for aggregates
const AGGREGATE_STABILITY_RATIO   = 3.0        // loose — aggregates absorb noise

// ── MOVER CANDIDATE thresholds (much stricter) ──
// Distribution audit against real Aug-2026 endpoints:
//   worst_ratio < 1.10 catches 81% of pairs
//   worst_ratio < 1.20 catches 89%
//   worst_ratio < 1.30 catches 93%
// 1.30 is a defensible compromise: it removes the twitchiest 7% of
// cards without shrinking the candidate pool below the point where
// a decent article can be written.
const MOVER_MIN_ENDPOINT_OBS      = 3          // strict: full 3 snapshots at each end
const MOVER_STABILITY_RATIO       = 1.30       // strict: endpoint observations tightly grouped
const MOVER_MIN_START_CENTS       = 500        // $5 minimum start price

// ── Two-tier editorial confidence ──
// Anything outside the auto band goes to manual_review_required so a
// human can decide before it enters an article. Everything outside
// the outer band is excluded entirely.
const AUTO_PUBLISH_MAX_POSITIVE_PCT = 75       // > 75% up -> manual_review_required
const AUTO_PUBLISH_MAX_NEGATIVE_PCT = -40      // < -40% down -> manual_review_required
const REVIEW_MAX_POSITIVE_PCT       = 200      // > 200% up -> excluded
const REVIEW_MAX_NEGATIVE_PCT       = -60      // < -60% down -> excluded

// ── Persistence check (post-endpoint sanity) ──
// A dramatic endpoint value must not immediately snap back. Compare
// the end-endpoint median against the median of the next 3 full
// snapshots; if they disagree by more than 25%, the endpoint was a
// spike, not a trend.
const PERSISTENCE_WINDOW_MIN_DAYS = 2          // start looking >= 2 days after the calendar endpoint
const PERSISTENCE_WINDOW_MAX_DAYS = 8          // stop 8 days after
const PERSISTENCE_MAX_DEVIATION   = 0.25       // 25% max deviation of post-median vs end-median

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

  // ── Step 1: pick full-catalogue days near each endpoint ──
  const startWindow = await pickEndpointDays(supa, startDate)
  const endWindow   = await pickEndpointDays(supa, endDate)
  if (startWindow.length < AGGREGATE_MIN_ENDPOINT_OBS) {
    warnings.push({ id: 'endpoint-start-thin', severity: 'critical',
      message: `Only ${startWindow.length} full-catalogue snapshot(s) within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of ${startDate}. Robust start endpoint needs ${AGGREGATE_MIN_ENDPOINT_OBS}+.` })
  }
  if (endWindow.length < AGGREGATE_MIN_ENDPOINT_OBS) {
    warnings.push({ id: 'endpoint-end-thin', severity: 'critical',
      message: `Only ${endWindow.length} full-catalogue snapshot(s) within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of ${endDate}. Robust end endpoint needs ${AGGREGATE_MIN_ENDPOINT_OBS}+.` })
  }

  // ── Step 2: fetch every card observation across the two windows ──
  const [startPages, endPages] = await Promise.all([
    fetchDaysPaged(supa, startWindow),
    fetchDaysPaged(supa, endWindow),
  ])
  const startRobust = groupToRobustEndpoint(startPages, AGGREGATE_STABILITY_RATIO)
  const endRobust   = groupToRobustEndpoint(endPages,   AGGREGATE_STABILITY_RATIO)

  const startOnly: string[] = []
  const endOnly:   string[] = []

  type MonthlyDelta = {
    cardSlug:      string
    startCents:    number
    endCents:      number
    startObsCount: number
    endObsCount:   number
    startMin: number; startMax: number
    endMin:   number; endMax:   number
    pct:           number
  }

  const deltas: MonthlyDelta[] = []
  const allSlugs = new Set<string>([...Array.from(startRobust.keys()), ...Array.from(endRobust.keys())])
  for (const slug of Array.from(allSlugs)) {
    const s = startRobust.get(slug)
    const e = endRobust.get(slug)
    if (!s && !e) continue
    if (s && !e) { startOnly.push(slug); continue }
    if (!s && e) { endOnly.push(slug);   continue }
    if (s!.count < AGGREGATE_MIN_ENDPOINT_OBS || e!.count < AGGREGATE_MIN_ENDPOINT_OBS) continue
    // AGGREGATE sample stability: loose 3× rule. This is only used
    // for median / IQR / breadth counts. Individual movers get the
    // stricter check below.
    const looseStable = (s!.max / Math.max(1, s!.min)) < AGGREGATE_STABILITY_RATIO
                      && (e!.max / Math.max(1, e!.min)) < AGGREGATE_STABILITY_RATIO
    if (!looseStable) continue
    deltas.push({
      cardSlug: slug,
      startCents: s!.median, endCents: e!.median,
      startObsCount: s!.count, endObsCount: e!.count,
      startMin: s!.min, startMax: s!.max, endMin: e!.min, endMax: e!.max,
      pct: safePct(s!.median, e!.median),
    })
  }

  // Aggregate CLEAN sample (loose stability, no editorial-band gate)
  const aggregateSample = deltas
  if (aggregateSample.length < MIN_INTERSECTION) {
    warnings.push({ id: 'intersection-thin', severity: 'critical',
      message: `Aggregate sample is ${aggregateSample.length} cards (below ${MIN_INTERSECTION}). Robust monthly report requires more overlap between endpoint windows.` })
  }
  if (startOnly.length + endOnly.length > 0) {
    warnings.push({ id: 'survivorship', severity: 'minor',
      message: `${startOnly.length} cards priced at start but not end; ${endOnly.length} vice versa. Sample restricted to intersection.` })
  }

  // ── Step 3: aggregate stats ──
  const aggPcts = aggregateSample.map(d => d.pct)
  const median  = medianOf(aggPcts)
  const q1      = percentile(aggPcts, 0.25)
  const q3      = percentile(aggPcts, 0.75)
  const rising  = aggPcts.filter(p => p >   1).length
  const falling = aggPcts.filter(p => p <  -1).length
  const flat    = aggPcts.length - rising - falling
  const risingPctOfSample  = aggregateSample.length ? (100 * rising  / aggregateSample.length) : 0
  const fallingPctOfSample = aggregateSample.length ? (100 * falling / aggregateSample.length) : 0

  // ── Step 4: build the MOVER CANDIDATE pool (stricter). ──
  //
  // Rules layered on top of the aggregate sample:
  //   A. product filter: English, not sealed, not Topps, no obvious sealed-product names
  //   B. 3 valid observations at BOTH endpoints (99.2% of the sample already has this)
  //   C. endpoint stability worst-ratio < 1.30 (93% of the sample)
  //   D. start median >= $5
  //   E. within outer editorial band [-60%, +200%]; anything outside is excluded
  //   F. persistence check: end-endpoint median must not immediately snap back
  //
  // Then a two-tier editorial confidence:
  //   * `high` when within [-40%, +75%]
  //   * `manual_review_required` when in the outer bands
  //   * `excluded` when it fails any of A-F
  //
  // The Writer receives only `high` PLUS any human-approved slugs
  // in `pack.approvedLargeMoverSlugs`. `manual_review_required`
  // rows sit under Large moves requiring review in the Research
  // Room until the editor approves them.

  // (A) product filter: fetch cards metadata for every slug in the aggregate sample.
  const aggSlugs = aggregateSample.map(d => d.cardSlug)
  const aggSlugsBare = aggSlugs.map(s => s.replace(/^pc-/, ''))
  const cardMeta = aggSlugsBare.length === 0
    ? { rows: [] as any[], pagesFetched: 0, truncated: false }
    : await fetchAllPages<any>(
        () => supa.from('cards').select('card_slug, card_name, set_name, card_number, url_slug, is_sealed, language').in('card_slug', aggSlugsBare),
        { hardMaxRows: 200_000 },
      )
  const cardBySlug = new Map<string, any>()
  for (const c of cardMeta.rows) {
    cardBySlug.set(String(c.card_slug), c)
    cardBySlug.set(`pc-${c.card_slug}`, c)
  }

  type ProductFilterResult = { included: boolean; reason?: 'sealed' | 'non_english' | 'topps' | 'sealed_name_pattern' | 'unknown_card' }
  const productFilter = (slug: string): ProductFilterResult => {
    const c = cardBySlug.get(slug)
    if (!c) return { included: false, reason: 'unknown_card' }
    if (c.is_sealed === true) return { included: false, reason: 'sealed' }
    if (c.language && c.language !== 'en') return { included: false, reason: 'non_english' }
    const setName = String(c.set_name ?? '')
    if (/topps/i.test(setName)) return { included: false, reason: 'topps' }
    const name = String(c.card_name ?? '')
    if (/\b(booster (pack|box)|theme deck|premium collection|elite trainer box|starter deck|preconstructed|bundle)\b/i.test(name)) return { included: false, reason: 'sealed_name_pattern' }
    return { included: true }
  }

  // (E) editorial band + (F) persistence — first prep the persistence
  // window: full-catalogue snapshots strictly AFTER the calendar end.
  const persistenceWindow = await pickPersistenceDays(supa, endDate)
  const persistencePages = persistenceWindow.length === 0
    ? [] as Array<{ card_slug: string; date: string; raw_usd: number | null }>
    : await fetchDaysPaged(supa, persistenceWindow)
  const persistenceRobust = groupToRobustEndpoint(persistencePages, AGGREGATE_STABILITY_RATIO)

  type MoverCandidate = MonthlyDelta & {
    productReason?: ProductFilterResult['reason']
    strictStability?: number   // max/min ratio worst-of-both-sides
    persistenceDeviation?: number  // |persistence_median - end_median| / end_median
    confidence: 'high' | 'manual_review_required' | 'excluded'
    exclusionReason?: 'product' | 'insufficient_obs' | 'unstable_endpoint' | 'below_min_price' | 'extreme_move' | 'failed_persistence'
  }

  const candidatePool: MoverCandidate[] = aggregateSample.map(d => {
    // (A) product
    const p = productFilter(d.cardSlug)
    if (!p.included) return { ...d, productReason: p.reason, confidence: 'excluded', exclusionReason: 'product' }
    // (B) 3 obs each side
    if (d.startObsCount < MOVER_MIN_ENDPOINT_OBS || d.endObsCount < MOVER_MIN_ENDPOINT_OBS) {
      return { ...d, confidence: 'excluded', exclusionReason: 'insufficient_obs' }
    }
    // (C) tighter stability
    const worst = Math.max(
      d.startMax / Math.max(1, d.startMin),
      d.endMax   / Math.max(1, d.endMin),
    )
    if (worst >= MOVER_STABILITY_RATIO) {
      return { ...d, strictStability: worst, confidence: 'excluded', exclusionReason: 'unstable_endpoint' }
    }
    // (D) min start price
    if (d.startCents < MOVER_MIN_START_CENTS) {
      return { ...d, strictStability: worst, confidence: 'excluded', exclusionReason: 'below_min_price' }
    }
    // (E) outer editorial band
    if (d.pct > REVIEW_MAX_POSITIVE_PCT || d.pct < REVIEW_MAX_NEGATIVE_PCT) {
      return { ...d, strictStability: worst, confidence: 'excluded', exclusionReason: 'extreme_move' }
    }
    // (F) persistence
    const pr = persistenceRobust.get(d.cardSlug)
    let deviation: number | undefined
    if (pr && pr.count >= 2) {
      deviation = Math.abs(pr.median - d.endCents) / Math.max(1, d.endCents)
      if (deviation > PERSISTENCE_MAX_DEVIATION) {
        return { ...d, strictStability: worst, persistenceDeviation: deviation, confidence: 'excluded', exclusionReason: 'failed_persistence' }
      }
    }
    // Two-tier: auto vs manual review
    const auto = d.pct <= AUTO_PUBLISH_MAX_POSITIVE_PCT && d.pct >= AUTO_PUBLISH_MAX_NEGATIVE_PCT
    return {
      ...d,
      strictStability: worst,
      persistenceDeviation: deviation,
      confidence: auto ? 'high' : 'manual_review_required',
    }
  })

  const highCandidates   = candidatePool.filter(c => c.confidence === 'high')
  const manualCandidates = candidatePool.filter(c => c.confidence === 'manual_review_required')
  const excludedByProduct = candidatePool.filter(c => c.exclusionReason === 'product')
  const excludedExtreme   = candidatePool.filter(c => c.exclusionReason === 'extreme_move')
  const excludedPersist   = candidatePool.filter(c => c.exclusionReason === 'failed_persistence')
  const excludedUnstable  = candidatePool.filter(c => c.exclusionReason === 'unstable_endpoint')
  const excludedInsuffObs = candidatePool.filter(c => c.exclusionReason === 'insufficient_obs')

  // Rank + limit — do NOT force 10; publish only what exists.
  const topRisers   = [...highCandidates].filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, TOP_MOVER_LIMIT)
  const topFallers  = [...highCandidates].filter(c => c.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, TOP_MOVER_LIMIT)
  const reviewRisers  = [...manualCandidates].filter(c => c.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 20)
  const reviewFallers = [...manualCandidates].filter(c => c.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 20)

  const enrichMover = (d: MoverCandidate) => {
    const c = cardBySlug.get(d.cardSlug) ?? {}
    return {
      cardSlug:     d.cardSlug,
      cardName:     trimName(String(c.card_name ?? '')),
      cardNumber:   String(c.card_number ?? ''),
      setName:      String(c.set_name ?? ''),
      urlSlug:      c.url_slug ?? '',
      startUsd:     round2(d.startCents / CENTS_PER_USD),
      endUsd:       round2(d.endCents   / CENTS_PER_USD),
      pct:          round2(d.pct),
      startObs:     d.startObsCount,
      endObs:       d.endObsCount,
      startMinUsd:  round2(d.startMin / CENTS_PER_USD),
      startMaxUsd:  round2(d.startMax / CENTS_PER_USD),
      endMinUsd:    round2(d.endMin   / CENTS_PER_USD),
      endMaxUsd:    round2(d.endMax   / CENTS_PER_USD),
      stability:    d.strictStability != null ? round2(d.strictStability) : null,
      persistenceDeviationPct: d.persistenceDeviation != null ? round2(100 * d.persistenceDeviation) : null,
      confidence:   d.confidence,
    }
  }
  const topRisersRows    = topRisers.map(enrichMover)
  const topFallersRows   = topFallers.map(enrichMover)
  const reviewRisersRows = reviewRisers.map(enrichMover)
  const reviewFallersRows= reviewFallers.map(enrichMover)

  // Quarantined rows (visible in Research Room, not usable by Writer)
  const quarantinedRows: QuarantineEntry[] = [...excludedExtreme, ...excludedPersist, ...excludedUnstable].slice(0, 60).map(d => {
    const en = enrichMover(d)
    const reasonLabel =
      d.exclusionReason === 'extreme_move'      ? `moved ${fmtSignedPct(d.pct)} — outside the editorial [-${-REVIEW_MAX_NEGATIVE_PCT}%, +${REVIEW_MAX_POSITIVE_PCT}%] band` :
      d.exclusionReason === 'failed_persistence' ? `end-endpoint value did not persist — post-window median deviated by ${en.persistenceDeviationPct}% (max ${PERSISTENCE_MAX_DEVIATION * 100}% allowed)` :
      `endpoint observations wobble beyond the ${MOVER_STABILITY_RATIO}× stability ratio (worst = ${en.stability}×)`
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
        stability: en.stability, persistenceDeviationPct: en.persistenceDeviationPct,
        reason: d.exclusionReason ?? 'excluded',
      },
      contaminatesPublishable: false,
    }
  })

  // ── Step 7: market signal strength (transparent rules) ──
  const signal = classifyMarketSignal({
    sampleSize: aggregateSample.length,
    absMedian:  Math.abs(median),
    breadthGap: Math.abs(risingPctOfSample - fallingPctOfSample),
    iqrWidth:   q3 - q1,
    trustworthyMoversCount: topRisersRows.length + topFallersRows.length,
  })

  const internalSources: InternalSource[] = [
    { id: 'src-dp-start', kind: 'internal', label: `daily_prices near ${startDate}`, table: 'daily_prices', filters: `date IN (${startWindow.join(', ')})`, asOf: startDate, rowCount: startPages.length },
    { id: 'src-dp-end',   kind: 'internal', label: `daily_prices near ${endDate}`,   table: 'daily_prices', filters: `date IN (${endWindow.join(', ')})`,   asOf: endDate,   rowCount: endPages.length },
    { id: 'src-dp-persistence', kind: 'internal', label: `daily_prices persistence window`, table: 'daily_prices', filters: `date IN (${persistenceWindow.join(', ')})`, asOf: persistenceWindow[persistenceWindow.length - 1] ?? endDate, rowCount: persistencePages.length },
    { id: 'src-cards-movers', kind: 'internal', label: 'cards — mover metadata', table: 'cards', filters: `card_slug IN (${aggSlugsBare.length} slugs)`, asOf: today, rowCount: cardMeta.rows.length },
  ]

  const moverTableColumns = [
    { key: 'cardName',    label: 'Card' },
    { key: 'cardNumber',  label: '#',        align: 'right' as const },
    { key: 'setName',     label: 'Set' },
    { key: 'startUsd',    label: `Start $ (median near ${startDate})`, align: 'right' as const },
    { key: 'endUsd',      label: `End $ (median near ${endDate})`,     align: 'right' as const },
    { key: 'startMinUsd', label: 'Start min',  align: 'right' as const },
    { key: 'startMaxUsd', label: 'Start max',  align: 'right' as const },
    { key: 'endMinUsd',   label: 'End min',    align: 'right' as const },
    { key: 'endMaxUsd',   label: 'End max',    align: 'right' as const },
    { key: 'pct',         label: '% change',   align: 'right' as const },
    { key: 'stability',   label: 'Stability ×', align: 'right' as const },
    { key: 'persistenceDeviationPct', label: 'Post-window deviation %', align: 'right' as const },
  ]

  const dataTables: DataTable[] = [
    {
      id: `mover-risers-${year}-${String(month).padStart(2,'0')}`,
      title: `High-confidence raw-price risers, ${monthLabel} (${topRisersRows.length} card${topRisersRows.length === 1 ? '' : 's'})`,
      source: `daily_prices (${startWindow.length}-day start + ${endWindow.length}-day end + ${persistenceWindow.length}-day persistence) + cards, English TCG only, sealed excluded`,
      asOf: endDate, columns: moverTableColumns, rows: topRisersRows,
    },
    {
      id: `mover-fallers-${year}-${String(month).padStart(2,'0')}`,
      title: `High-confidence raw-price fallers, ${monthLabel} (${topFallersRows.length} card${topFallersRows.length === 1 ? '' : 's'})`,
      source: `daily_prices (${startWindow.length}-day start + ${endWindow.length}-day end + ${persistenceWindow.length}-day persistence) + cards, English TCG only, sealed excluded`,
      asOf: endDate, columns: moverTableColumns, rows: topFallersRows,
    },
    {
      id: `mover-review-risers-${year}-${String(month).padStart(2,'0')}`,
      title: `Large-move riser candidates requiring manual review (${reviewRisersRows.length})`,
      source: `Same pipeline as high-confidence; pct is above +${AUTO_PUBLISH_MAX_POSITIVE_PCT}% but ≤ +${REVIEW_MAX_POSITIVE_PCT}%. Not writable until approved in the Research Room.`,
      asOf: endDate, columns: moverTableColumns, rows: reviewRisersRows,
    },
    {
      id: `mover-review-fallers-${year}-${String(month).padStart(2,'0')}`,
      title: `Large-move faller candidates requiring manual review (${reviewFallersRows.length})`,
      source: `Same pipeline as high-confidence; pct is below ${AUTO_PUBLISH_MAX_NEGATIVE_PCT}% but ≥ ${REVIEW_MAX_NEGATIVE_PCT}%. Not writable until approved in the Research Room.`,
      asOf: endDate, columns: moverTableColumns, rows: reviewFallersRows,
    },
  ]

  const verifiedFacts: VerifiedFact[] = [
    { id: 'fact-window',            type: 'verified_fact', statement: `Report window: ${startDate} to ${endDate} (${monthLabel}). Endpoint prices are the median of each card's observations within ±${NEAR_ENDPOINT_WINDOW_DAYS} days of the calendar boundary.`, evidenceRefs: [], asOf: endDate },
    { id: 'fact-aggregate-sample',  type: 'verified_fact', statement: `${aggregateSample.length} cards enter the aggregate sample used for median / IQR / breadth (loose ${AGGREGATE_STABILITY_RATIO}× stability).`, evidenceRefs: ['src-dp-start', 'src-dp-end'], asOf: endDate },
    { id: 'fact-mover-pool',        type: 'verified_fact', statement: `${highCandidates.length} card${highCandidates.length === 1 ? ' is' : 's are'} high-confidence movers, ${manualCandidates.length} require manual review, ${excludedByProduct.length + excludedInsuffObs.length + excludedUnstable.length + excludedExtreme.length + excludedPersist.length} excluded from the mover pool by product / stability / extreme / persistence filters.`, evidenceRefs: ['src-dp-start', 'src-dp-end', 'src-dp-persistence'], asOf: endDate },
    { id: 'fact-mover-scope',       type: 'verified_fact', statement: `Mover pool product scope: English-language TCG cards, sealed products excluded, Topps and similar non-TCG lines excluded, obvious sealed-name products (booster pack / box, theme deck, premium collection, elite trainer box, bundle) excluded.`, evidenceRefs: ['src-cards-movers'], asOf: today },
  ]

  const derivedFindings: DerivedFinding[] = [
    { id: 'finding-median-raw', type: 'derived_finding', statement: `Median monthly raw-price change across the aggregate sample was ${fmtSignedPct(median)}.`, formula: 'median(rawPct) over aggregate sample', evidenceRefs: ['fact-aggregate-sample'], asOf: endDate },
    { id: 'finding-iqr',        type: 'derived_finding', statement: `Interquartile range of monthly raw-price change was ${fmtSignedPct(q1)} to ${fmtSignedPct(q3)}.`, formula: 'p25(rawPct), p75(rawPct)', evidenceRefs: ['fact-aggregate-sample'], asOf: endDate },
    { id: 'finding-direction',  type: 'derived_finding', statement: `${rising} cards rose more than 1%, ${falling} fell more than 1%, ${flat} were within a percentage point of flat.`, formula: 'count where rawPct > 1; count where rawPct < -1; remainder', evidenceRefs: ['fact-aggregate-sample'], asOf: endDate },
    { id: 'finding-signal',     type: 'derived_finding', statement: `Market signal strength: ${signal.strength}. ${signal.reason}`, formula: 'classify(median, breadth, IQR, sample size, mover count)', evidenceRefs: ['fact-aggregate-sample'], asOf: endDate },
  ]

  const gaps: string[] = []
  if (aggregateSample.length < MIN_INTERSECTION) gaps.push(`Aggregate sample of ${aggregateSample.length} is below the ${MIN_INTERSECTION} publishability bar. Extend endpoint scraping coverage.`)
  if (highCandidates.length === 0)               gaps.push(`Zero high-confidence movers this month. The article should describe the aggregate story only or lean on manually-approved candidates.`)
  if (manualCandidates.length > 0)               gaps.push(`${manualCandidates.length} large-move candidates await manual review in the Research Room. Approve any you want the Writer to use.`)

  const rejectedClaims: Array<{ claim: string; reason: string }> = [
    { claim: `The Pokemon market moved X% in ${monthLabel}.`, reason: 'Sample is the PokePrices tracked catalogue on daily_prices, not the whole Pokemon TCG market.' },
    { claim: `Card X gained N,NNN% in ${monthLabel}.`,        reason: `Mover pool excludes anything outside [-60%, +200%] and anything a human has not approved above ±${AUTO_PUBLISH_MAX_POSITIVE_PCT}% up or ${AUTO_PUBLISH_MAX_NEGATIVE_PCT}% down.` },
    { claim: `Japanese card X was among the biggest movers.`, reason: 'Mover pool is English-language TCG only by default. Japanese cards may exist in the aggregate stats but are not eligible for the automated mover ranking of a Pokemon Card Market Report.' },
    { claim: `Booster Pack / Booster Box / theme deck X moved N%.`, reason: 'Sealed products are excluded from card-mover rankings; they belong in a sealed-product story, not a card story.' },
  ]
  if (signal.strength === 'weak') {
    rejectedClaims.push({ claim: `The big story in ${monthLabel} was a ${fmtSignedPct(median)} median.`, reason: 'Near-zero median with balanced breadth is a quiet month, not a headline. Do not manufacture excitement.' })
    rejectedClaims.push({ claim: `${monthLabel} marked a major shift in the Pokemon market.`,           reason: 'Market signal strength is "weak". Reserve dramatic wording for robust evidence.' })
  }

  const quality = computeQuality({
    cleanSize:       aggregateSample.length,
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
        `Two-tier methodology. AGGREGATE stats (median / IQR / breadth) come from every card with >= ${AGGREGATE_MIN_ENDPOINT_OBS} endpoint observations at each side and loose ${AGGREGATE_STABILITY_RATIO}× stability. MOVER CANDIDATES apply a stricter product filter (English-language TCG only; sealed products, Topps and similar excluded), require 3 endpoint observations at each side, tighter ${MOVER_STABILITY_RATIO}× stability, and a persistence check against the next full-catalogue snapshots after ${endDate}. Movers are then split into "high-confidence" (auto-eligible; ${AUTO_PUBLISH_MAX_NEGATIVE_PCT}% to +${AUTO_PUBLISH_MAX_POSITIVE_PCT}%) and "manual review" (${REVIEW_MAX_NEGATIVE_PCT}% to +${REVIEW_MAX_POSITIVE_PCT}% but outside the auto band). Anything outside the outer band, or that fails product / stability / persistence, is excluded.`,
      filters: [
        { label: 'Start window',   value: startWindow.join(', ') },
        { label: 'End window',     value: endWindow.join(', ') },
        { label: 'Persistence window', value: persistenceWindow.join(', ') || '(none available)' },
        { label: 'Endpoint value', value: `median(raw_usd) over full snapshots in each window` },
        { label: 'Aggregate sample rules', value: `>= ${AGGREGATE_MIN_ENDPOINT_OBS} obs/side, loose ${AGGREGATE_STABILITY_RATIO}× stability` },
        { label: 'Mover candidate rules',  value: `>= ${MOVER_MIN_ENDPOINT_OBS} obs/side, ${MOVER_STABILITY_RATIO}× stability, English TCG, non-sealed, non-Topps, start >= $${MOVER_MIN_START_CENTS / CENTS_PER_USD}` },
        { label: 'Auto-publish band',      value: `[${AUTO_PUBLISH_MAX_NEGATIVE_PCT}%, +${AUTO_PUBLISH_MAX_POSITIVE_PCT}%]` },
        { label: 'Manual-review band',     value: `[${REVIEW_MAX_NEGATIVE_PCT}%, ${AUTO_PUBLISH_MAX_NEGATIVE_PCT}%) ∪ (+${AUTO_PUBLISH_MAX_POSITIVE_PCT}%, +${REVIEW_MAX_POSITIVE_PCT}%]` },
        { label: 'Persistence tolerance',  value: `end-window median must not deviate by > ${PERSISTENCE_MAX_DEVIATION * 100}% from the post-window median` },
      ],
      excludedGroups: [
        { label: 'start-only cards',            reason: `${startOnly.length} cards priced at start but not end` },
        { label: 'end-only cards',              reason: `${endOnly.length} cards priced at end but not start` },
        { label: 'product-scope excluded',      reason: `${excludedByProduct.length} cards (sealed / Topps / non-English / bundle names)` },
        { label: 'insufficient mover observations', reason: `${excludedInsuffObs.length} cards with <${MOVER_MIN_ENDPOINT_OBS} observations at an endpoint` },
        { label: 'unstable endpoints (strict)', reason: `${excludedUnstable.length} cards where endpoint observations wobble beyond ${MOVER_STABILITY_RATIO}× (worst-of-both-sides)` },
        { label: 'failed persistence',          reason: `${excludedPersist.length} cards whose end-endpoint value snapped back on the next full snapshots` },
        { label: 'extreme moves',               reason: `${excludedExtreme.length} cards outside the outer editorial band` },
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

type RobustEndpoint = { median: number; count: number; min: number; max: number }

function groupToRobustEndpoint(rows: Array<{ card_slug: string; date: string; raw_usd: number | null }>, _stabilityRatio: number): Map<string, RobustEndpoint> {
  // stabilityRatio no longer used inside the aggregator; callers
  // apply their own strict/loose stability rule downstream so that
  // aggregate + mover pools can share this cheap computation.
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
    out.set(slug, { median: medianOf(vals), count: vals.length, min, max })
  }
  return out
}

/** Pick full-catalogue days STRICTLY AFTER the calendar endpoint,
 *  starting at least PERSISTENCE_WINDOW_MIN_DAYS past it. Used by
 *  the mover-candidate persistence check. */
async function pickPersistenceDays(supa: ReturnType<typeof getSupabaseServiceClient>, endpointDate: string): Promise<string[]> {
  const target = new Date(endpointDate + 'T00:00:00Z')
  const candidates: string[] = []
  for (let dx = PERSISTENCE_WINDOW_MIN_DAYS; dx <= PERSISTENCE_WINDOW_MAX_DAYS; dx++) {
    const d = new Date(target); d.setUTCDate(target.getUTCDate() + dx)
    candidates.push(d.toISOString().slice(0, 10))
  }
  const rows = await Promise.all(candidates.map(async (d) => {
    const { count } = await supa.from('daily_prices').select('card_slug', { count: 'exact', head: true }).eq('date', d)
    return { date: d, c: Number(count ?? 0) }
  }))
  return rows.filter(x => x.c >= MIN_ROWS_PER_ENDPOINT).slice(0, 3).map(x => x.date)
}

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
