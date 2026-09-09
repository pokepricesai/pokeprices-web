// src/lib/editorial/opportunityRadar.ts
//
// EIC Block 4 — Opportunity Radar.
//
// Grounded, deterministic detection of "there may be a citeable
// article here" opportunities from real PokePrices market data.
//
// Design principles:
//   * Existing hardened RPCs / tables only. No new SQL layers.
//   * A handful of bounded aggregate queries per Radar run. NEVER
//     per-card loops.
//   * Quality gates first, ranking second — an opportunity that
//     survives the gates only then gets scored.
//   * The Radar is honest when the market is quiet. It is acceptable
//     to return three opportunities today.
//   * No LLM calls in Block 4. All labels/reasons are deterministic
//     strings.
//   * JSON-serialisable output. Future Editorial Strategist will
//     consume it directly alongside EditorialContext.
//
// Live-data reality (2026-09-06 snapshot):
//   * card_trends has ~196 tracked cards; ~127 have 30d pct moves;
//     joining to card_volume by bare slug + grade='Ungraded' gives
//     91 high-confidence and 47 medium-confidence rows.
//   * psa_population has ~33k rows across ~157 sets.
//   * release_calendar has 12 rows, 1 upcoming within +120d.
//   * At this scale most set-momentum patterns don't fire.
//     Grading-spread, population and release-driven opportunities
//     are today's strongest signals.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type { EditorialContext } from './context'
import type { ReleaseItem } from './releaseContext'
import { computeOverlap, type OverlapReport } from './overlap'
import { fetchAllPages } from './pageFetch'
import type { EditorialArticleType } from './projects'

// ─────────────────────────────────────────────────────────────────
// Public output shape
// ─────────────────────────────────────────────────────────────────

export type OpportunityKind =
  | 'movers_30d' | 'movers_90d'
  | 'set_momentum'
  | 'grading_spread'
  | 'population_scarcity'
  | 'cluster'
  | 'release_driven'
  | 'monthly_report'

export type OpportunityMetric = {
  label:  string
  value:  string    // pre-formatted for display
  hint?:  string    // optional secondary detail
}

export type OpportunityVisual =
  | 'ranking_table'
  | 'card_grid'
  | 'price_history_chart'
  | 'raw_psa9_psa10_comparison'
  | 'set_comparison'
  | 'large_stat_callout'
  | 'market_index_chart'
  | 'population_scatter'

// Alias the canonical whitelist so radar-suggested types can never
// drift from the values the DB write layer accepts. See
// EDITORIAL_ARTICLE_TYPES in ./projects.ts for the full list and
// intent. Radar currently only emits a narrow internal subset, but
// the type accepts every valid article_type so a future radar
// detector can freely suggest external ideas.
export type SuggestedArticleType = EditorialArticleType

export type Opportunity = {
  id:                  string
  kind:                OpportunityKind
  headlineSuggestion:  string
  angle:               string
  whyNow:              string
  score:               number             // 0..100
  scoreReasons:        readonly string[]
  dataStrength:        'strong' | 'medium' | 'weak'
  citationPotential:   'high' | 'medium' | 'low'
  suggestedArticleType: SuggestedArticleType
  suggestedTiming:     string | null      // free text: "1-2 weeks", "next 10 days", null
  relatedSets:         readonly string[]
  relatedCards:        readonly { slug: string; name: string; setName?: string | null; urlSlug?: string | null }[]
  metrics:             readonly OpportunityMetric[]
  evidenceSummary:     readonly string[]
  overlap:             { verdict: OverlapReport['verdict']; topMatchSlug: string | null; topMatchHeadline: string | null }
  visuals:             readonly OpportunityVisual[]
  /** Block 5C — when true, the underlying data has a known integrity
   *  problem (sample composition, coverage, or freshness) that must
   *  be resolved before this can be treated as a primary weekly
   *  recommendation. The Strategist's quality gate treats this as
   *  automatically primary-ineligible. */
  researchRequired?:   boolean
  /** Human-readable reason attached when researchRequired = true. */
  researchReason?:     string
}

export type OpportunityRadar = {
  meta: {
    today:            string
    generatedAt:      string
    detectorsRun:     readonly OpportunityKind[]
    detectorsSuppressed: ReadonlyArray<{ kind: OpportunityKind; reason: string }>
    dataFreshness:    { cardTrendsAsOf: string | null }
  }
  opportunities: readonly Opportunity[]
}

// ─────────────────────────────────────────────────────────────────
// Quality-gate constants
// ─────────────────────────────────────────────────────────────────

const MIN_PRICE_USD_CENTS_MOVER      = 300    // $3.00 min tracked price (very low bar today)
const MIN_PCT_ABS_MOVER              = 8      // suppress trivial ±<8% moves
const MIN_HEADLINE_MOVERS            = 3      // suppress "top movers" if fewer than N survive gates
const MIN_SET_MOMENTUM_CARDS         = 4      // suppress set momentum on <4 tracked cards
const MIN_SET_MOMENTUM_DIRECTION_PCT = 60     // >=60% of the set's tracked cards must move same direction
// Block 5D: a set-momentum story on a 4-card sample is fine as a
// backlog note but must NOT be eligible for a primary weekly slot.
// The detector still emits below this threshold, but flags the
// opportunity researchRequired so the strategist quality gate
// blocks primary promotion.
const MIN_SET_MOMENTUM_PRIMARY_CARDS = 8      // primary-eligible only at this sample size
const MIN_POP_TOTAL                  = 100    // psa_population sample must be >= 100 graded
const MIN_GRADING_SPREAD_CARDS       = 20     // grading-spread study needs >= N cards
// Block 5C: the *headline* ratio is only editorially meaningful when the
// raw side of the comparison is a real market, not a listing-floor
// artifact. When every card in the sample sits at $1-$3 raw (which is
// the current live state — see audit in the Block 5C report), the
// ratios are mechanically large without saying anything readers can
// use. Below this raw-price threshold the detector still emits the
// opportunity but flags it as weak+research_required so the 5B
// primary-recommendation gate blocks it.
const MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS = 1000  // $10
const MIN_GRADING_SPREAD_MEANINGFUL_COUNT     = 20    // need N cards at or above the raw floor
const MIN_RELEASE_CARD_COUNT_RETRO   = 50     // release retrospective needs cataloged cards
const CLUSTER_MIN_REPEAT             = 3      // >=N repeated entities in movers list = cluster
const MAX_OPPORTUNITIES              = 30
const OPPORTUNITY_BODY_TOP_CHARS     = 20_000 // per-article body char cap when computing overlap

// ─────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────

export type BuildOpportunityRadarOptions = {
  now?:             Date
  includeMonthly?:  boolean   // default true
}

export async function buildOpportunityRadar(
  context: EditorialContext,
  options: BuildOpportunityRadarOptions = {},
): Promise<OpportunityRadar> {
  const now       = options.now ?? new Date()
  const todayIso  = now.toISOString().slice(0, 10)
  const supa      = getSupabaseServiceClient()

  const detectorsRun:        OpportunityKind[] = []
  const detectorsSuppressed: OpportunityRadar['meta']['detectorsSuppressed'][number][] = []

  // Fetch card_trends first (a bounded, single-page query today — 196
  // rows in prod). Every downstream fetch is derived from these slugs
  // + set names, so it is safe to do the other three in a second
  // parallel batch. This ordering matters: pre-Block-5B we naïvely
  // asked for `.limit(200000)` on card_volume, but PostgREST silently
  // caps every response at `db-max-rows` (Supabase managed default is
  // 1000). That truncated the trusted-trend join to ~5% coverage and
  // suppressed grading_spread + population_scarcity in prod even when
  // the underlying data supported them. Fix: targeted `.in(...)` on
  // volume (bounded by trend size), and paged fetch on psa_population.
  const [trendsRes, freshRes] = await Promise.all([
    supa.from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, psa10_pct_30d, psa10_pct_90d, trend_quality, as_of')
      .not('current_raw', 'is', null)
      .limit(2000),
    supa.from('card_trends').select('as_of').order('as_of', { ascending: false }).limit(1),
  ])
  if (trendsRes.error) throw new Error(`radar: card_trends ${trendsRes.error.message}`)
  const trends = trendsRes.data ?? []
  const trendsAsOf = ((freshRes.data ?? [])[0]?.as_of as string | undefined) ?? null

  const trendSlugs    = Array.from(new Set(trends.map((t: any) => String(t.card_slug)).filter(Boolean)))
  const trendSetNames = Array.from(new Set(trends.map((t: any) => String(t.set_name || '')).filter(Boolean)))
  // psa_population uses "Pokemon <SetName>" for many sets; check both.
  const popSetCandidates = Array.from(new Set([
    ...trendSetNames,
    ...trendSetNames.map(s => `Pokemon ${s}`),
  ]))

  const [volumeResult, popResult] = await Promise.all([
    // Volume: targeted by slug — always <= trendSlugs.length rows,
    // therefore always <= 1000 in current prod, therefore no cap risk.
    trendSlugs.length === 0
      ? Promise.resolve({ rows: [] as any[], pagesFetched: 0, truncated: false })
      : fetchAllPages<any>(
          () => supa.from('card_volume')
            .select('card_slug, confidence, sales_30d, sales_90d')
            .eq('grade', 'Ungraded')
            .in('confidence', ['high', 'medium'])
            .in('card_slug', trendSlugs),
        ),
    // Population: bounded to sets that intersect our tracked-trend set,
    // plus the grade/total_graded thresholds, then paged. 3.8k rows in
    // current prod → ~4 pages.
    popSetCandidates.length === 0
      ? Promise.resolve({ rows: [] as any[], pagesFetched: 0, truncated: false })
      : fetchAllPages<any>(
          () => supa.from('psa_population')
            .select('set_name, card_name, card_number, psa_9, psa_10, total_graded')
            .gte('total_graded', MIN_POP_TOTAL)
            .in('set_name', popSetCandidates),
          { hardMaxRows: 20_000 },
        ),
  ])
  const volume = volumeResult.rows
  const pop    = popResult.rows

  // Volume index (bare-slug keyed) for cheap confidence lookups.
  const volumeBySlug = new Map<string, { confidence: string; sales_30d: number | null; sales_90d: number | null }>()
  for (const v of volume as any[]) volumeBySlug.set(String(v.card_slug), {
    confidence: v.confidence, sales_30d: v.sales_30d ?? null, sales_90d: v.sales_90d ?? null,
  })
  const isTrustworthy = (slug: string): boolean => {
    const v = volumeBySlug.get(slug)
    return !!v && (v.confidence === 'high' || v.confidence === 'medium')
  }

  // Trusted trend rows only.
  const trustedTrends = (trends as any[]).filter(t => isTrustworthy(String(t.card_slug)))

  // Pre-build article text for overlap (once per Radar run, not per opp).
  const overlapArticles = context.articles.map(a => ({
    id: a.id, slug: a.slug, headline: a.headline, intro: a.intro,
    theme: a.theme, articleType: null as string | null,
    setRefs: a.setRefs ?? null, cardRefs: a.cardRefs ?? null,
    plainText: a.bodyExcerpt,
    bodyJson: undefined,
  }))

  const raw: Opportunity[] = []

  // ── Detectors ────────────────────────────────────────────────

  const mov30 = detectMovers(trustedTrends, volumeBySlug, '30d', now, overlapArticles, context)
  if (mov30) { raw.push(mov30); detectorsRun.push('movers_30d') }
  else       { detectorsSuppressed.push({ kind: 'movers_30d', reason: `<${MIN_HEADLINE_MOVERS} trusted 30d movers over ${MIN_PCT_ABS_MOVER}%` }) }

  const mov90 = detectMovers(trustedTrends, volumeBySlug, '90d', now, overlapArticles, context)
  if (mov90) { raw.push(mov90); detectorsRun.push('movers_90d') }
  else       { detectorsSuppressed.push({ kind: 'movers_90d', reason: `<${MIN_HEADLINE_MOVERS} trusted 90d movers over ${MIN_PCT_ABS_MOVER}%` }) }

  const setMomentum = detectSetMomentum(trustedTrends, overlapArticles, context)
  if (setMomentum.length) { raw.push(...setMomentum); detectorsRun.push('set_momentum') }
  else                    { detectorsSuppressed.push({ kind: 'set_momentum', reason: `no set with ≥${MIN_SET_MOMENTUM_CARDS} tracked cards moving same direction` }) }

  const grading = detectGradingSpread(trustedTrends, overlapArticles, context)
  if (grading) { raw.push(grading); detectorsRun.push('grading_spread') }
  else         { detectorsSuppressed.push({ kind: 'grading_spread', reason: `<${MIN_GRADING_SPREAD_CARDS} cards with full raw/PSA10 data` }) }

  const population = detectPopulationScarcity(pop, trustedTrends, overlapArticles, context)
  if (population) { raw.push(population); detectorsRun.push('population_scarcity') }
  else            { detectorsSuppressed.push({ kind: 'population_scarcity', reason: 'no high-value + low-population overlap detected' }) }

  const clusters = detectClusters(trustedTrends, overlapArticles, context)
  if (clusters.length) { raw.push(...clusters); detectorsRun.push('cluster') }
  else                 { detectorsSuppressed.push({ kind: 'cluster', reason: `no entity repeated ≥${CLUSTER_MIN_REPEAT} times in trusted mover list` }) }

  const release = detectReleaseDriven(context, overlapArticles)
  if (release.length) { raw.push(...release); detectorsRun.push('release_driven') }
  else                { detectorsSuppressed.push({ kind: 'release_driven', reason: 'no release timing opportunity currently applicable' }) }

  if (options.includeMonthly !== false) {
    const monthly = detectMonthlyReport(now, context)
    if (monthly) { raw.push(monthly); detectorsRun.push('monthly_report') }
    else         { detectorsSuppressed.push({ kind: 'monthly_report', reason: 'previous month already covered or planned' }) }
  }

  // ── De-duplicate near-identical opportunities ────────────────

  const seenTitles = new Set<string>()
  const deduped: Opportunity[] = []
  for (const o of raw) {
    const k = o.headlineSuggestion.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seenTitles.has(k)) continue
    seenTitles.add(k)
    deduped.push(o)
  }

  // ── Sort by score, cap ───────────────────────────────────────

  const sorted = deduped
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OPPORTUNITIES)

  return {
    meta: {
      today:               todayIso,
      generatedAt:         now.toISOString(),
      detectorsRun:        Array.from(new Set(detectorsRun)),
      detectorsSuppressed,
      dataFreshness:       { cardTrendsAsOf: trendsAsOf },
    },
    opportunities: sorted,
  }
}

// ─────────────────────────────────────────────────────────────────
// Detectors
// ─────────────────────────────────────────────────────────────────

type TrendRow = {
  card_slug: string; card_name: string; set_name: string;
  current_raw: number | null; current_psa9: number | null; current_psa10: number | null;
  raw_pct_7d: number | string | null;
  raw_pct_30d: number | string | null;
  raw_pct_90d: number | string | null;
  psa10_pct_30d: number | string | null;
  psa10_pct_90d: number | string | null;
  trend_quality: string | null;
  as_of: string | null;
}
type VolumeIndex = Map<string, { confidence: string; sales_30d: number | null; sales_90d: number | null }>
type OverlapArt = Parameters<typeof computeOverlap>[1][number]

// ── A. Movers ────────────────────────────────────────────────────

function detectMovers(
  trends: TrendRow[], volume: VolumeIndex, period: '30d' | '90d',
  now: Date, overlapArticles: OverlapArt[], context: EditorialContext,
): Opportunity | null {
  const pctKey = period === '30d' ? 'raw_pct_30d' : 'raw_pct_90d'
  const enriched = trends
    .filter(t => (t.current_raw ?? 0) >= MIN_PRICE_USD_CENTS_MOVER)
    .map(t => ({ ...t, pct: numeric(t[pctKey as keyof TrendRow]) }))
    .filter(t => t.pct != null && Math.abs(t.pct!) >= MIN_PCT_ABS_MOVER)
  if (enriched.length < MIN_HEADLINE_MOVERS) return null

  // Split rising / falling and pick the direction with more entries.
  const risers  = enriched.filter(t => t.pct! > 0).sort((a, b) => (b.pct! - a.pct!))
  const fallers = enriched.filter(t => t.pct! < 0).sort((a, b) => (a.pct! - b.pct!))
  const useRisers = risers.length >= fallers.length
  const list = useRisers ? risers : fallers
  if (list.length < MIN_HEADLINE_MOVERS) return null

  const top = list.slice(0, 8)
  const direction = useRisers ? 'risers' : 'fallers'
  const monthText = period === '30d' ? '30-day' : '90-day'
  const headline = useRisers
    ? `The biggest ${monthText} Pokémon card risers on PokePrices right now`
    : `Which Pokémon cards have dropped the most in the last ${period === '30d' ? 'month' : 'three months'}?`
  const angle = useRisers
    ? `Ranked list of the strongest ${monthText} raw-price gains among high-confidence tracked cards, with context on why each move is trustworthy.`
    : `Ranked list of the sharpest ${monthText} raw-price declines among high-confidence tracked cards, with volume context to distinguish soft demand from noise.`
  const whyNow = `${enriched.length} trusted cards have moved ≥${MIN_PCT_ABS_MOVER}% over the ${monthText} window as of ${top[0].as_of ?? context.meta.today}.`

  const relatedCards = top.map(t => ({
    slug: String(t.card_slug),
    name: t.card_name,
    setName: t.set_name,
    urlSlug: null,
  }))
  const relatedSets = Array.from(new Set(top.map(t => t.set_name).filter(Boolean)))

  const totalVol = top.reduce((s, t) => s + (volume.get(String(t.card_slug))?.sales_30d ?? 0), 0)
  const metrics: OpportunityMetric[] = [
    { label: 'Trusted movers', value: String(enriched.length), hint: `≥${MIN_PCT_ABS_MOVER}% ${monthText} move` },
    { label: `Top ${direction[0].toUpperCase() + direction.slice(1)}`, value: `${top[0].card_name} (${fmtPct(top[0].pct!)})`, hint: top[0].set_name },
    { label: '30-day sales volume', value: String(totalVol), hint: 'sum across the top movers' },
  ]

  const overlap = computeOverlap({ title: headline, angle, theme: 'market' }, overlapArticles)
  const evidence = [
    `card_trends filtered to high/medium-confidence (${enriched.length} rows) with ≥${MIN_PCT_ABS_MOVER}% ${monthText} move.`,
    `Direction chosen: ${direction} (${list.length} vs ${useRisers ? fallers.length : risers.length}).`,
    'Volume context from card_volume where grade = Ungraded.',
  ]

  const dataStrength = enriched.length >= 20 ? 'strong' : enriched.length >= 8 ? 'medium' : 'weak'
  const citationPotential: Opportunity['citationPotential'] = enriched.length >= 15 ? 'medium' : 'low'
  const score = scoreOpportunity({
    baseline:            useRisers ? 45 : 40,
    dataBoost:           Math.min(20, enriched.length),
    magnitudeBoost:      Math.min(15, Math.abs(top[0].pct!) / 2),
    timelinessBoost:     10,
    overlapPenalty:      overlapPenalty(overlap),
  })

  return {
    id: `movers-${period}-${useRisers ? 'up' : 'down'}`,
    kind: period === '30d' ? 'movers_30d' : 'movers_90d',
    headlineSuggestion: headline,
    angle,
    whyNow,
    score,
    scoreReasons: [
      `${enriched.length} trusted ${direction} ≥${MIN_PCT_ABS_MOVER}%`,
      `top move ${fmtPct(top[0].pct!)}`,
      overlap.verdict === 'low' ? 'no existing article on this topic' : `${overlap.verdict} overlap with existing article`,
    ],
    dataStrength,
    citationPotential,
    suggestedArticleType: 'market_analysis',
    suggestedTiming: 'this week',
    relatedSets,
    relatedCards,
    metrics,
    evidenceSummary: evidence,
    overlap: {
      verdict:          overlap.verdict,
      topMatchSlug:     overlap.matches[0]?.slug ?? null,
      topMatchHeadline: overlap.matches[0]?.headline ?? null,
    },
    visuals: ['ranking_table', 'price_history_chart', 'card_grid'],
  }
}

// ── B. Set momentum ──────────────────────────────────────────────

function detectSetMomentum(trends: TrendRow[], overlapArticles: OverlapArt[], context: EditorialContext): Opportunity[] {
  const groups = new Map<string, { total: number; rising: number; falling: number; sumPct: number; topCards: TrendRow[] }>()
  for (const t of trends) {
    const p = numeric(t.raw_pct_30d)
    if (p == null) continue
    const g = groups.get(t.set_name) ?? { total: 0, rising: 0, falling: 0, sumPct: 0, topCards: [] }
    g.total += 1
    if (p > 0) g.rising += 1
    if (p < 0) g.falling += 1
    g.sumPct += p
    g.topCards.push(t)
    groups.set(t.set_name, g)
  }
  const out: Opportunity[] = []
  for (const [setName, g] of Array.from(groups.entries())) {
    if (g.total < MIN_SET_MOMENTUM_CARDS) continue
    const risingPct  = 100 * g.rising / g.total
    const fallingPct = 100 * g.falling / g.total
    if (Math.max(risingPct, fallingPct) < MIN_SET_MOMENTUM_DIRECTION_PCT) continue
    const direction = risingPct >= fallingPct ? 'outperforming' : 'underperforming'
    const avgPct = g.sumPct / g.total
    const headline = direction === 'outperforming'
      ? `${setName} is outperforming the wider Pokémon market`
      : `${setName} is underperforming — a data breakdown`
    const angle = `${g.total} tracked ${setName} cards, ${direction === 'outperforming' ? g.rising : g.falling} moving ${direction === 'outperforming' ? 'up' : 'down'} over 30 days (average ${fmtPct(avgPct)}).`
    const overlap = computeOverlap({ title: headline, angle, setRefs: [setName], theme: 'market' }, overlapArticles)
    const score = scoreOpportunity({
      baseline:        50,
      dataBoost:       Math.min(15, g.total),
      magnitudeBoost:  Math.min(10, Math.abs(avgPct)),
      timelinessBoost: 10,
      overlapPenalty:  overlapPenalty(overlap),
    })
    // Block 5D — small-sample gate. A set-momentum story on 4-7
    // tracked cards is fine as a backlog note or callout but not
    // primary-eligible. Flag researchRequired so the strategist gate
    // blocks primary promotion regardless of user rejection cycles.
    const primaryEligibleSample = g.total >= MIN_SET_MOMENTUM_PRIMARY_CARDS
    out.push({
      id: `set-momentum-${slugify(setName)}`,
      kind: 'set_momentum',
      headlineSuggestion: headline,
      angle,
      whyNow: `${Math.round(Math.max(risingPct, fallingPct))}% of the ${g.total} tracked ${setName} cards are ${direction === 'outperforming' ? 'rising' : 'falling'}. A visible cluster in the current 30-day data.`,
      score,
      scoreReasons: [
        `${g.total} tracked cards in the set`,
        `${Math.round(Math.max(risingPct, fallingPct))}% same-direction`,
        `avg move ${fmtPct(avgPct)}`,
        primaryEligibleSample ? 'sample size meets the primary-recommendation bar' : `sample size (${g.total}) below the primary bar of ${MIN_SET_MOMENTUM_PRIMARY_CARDS}`,
      ],
      dataStrength: primaryEligibleSample ? (g.total >= 12 ? 'strong' : 'medium') : 'weak',
      citationPotential: primaryEligibleSample ? (g.total >= 12 ? 'medium' : 'low') : 'low',
      suggestedArticleType: 'market_analysis',
      suggestedTiming: 'this week',
      relatedSets: [setName],
      relatedCards: g.topCards.slice(0, 6).map(t => ({ slug: String(t.card_slug), name: t.card_name, setName: t.set_name, urlSlug: null })),
      metrics: [
        { label: 'Tracked cards in set', value: String(g.total) },
        { label: `% ${direction === 'outperforming' ? 'rising' : 'falling'} 30d`, value: `${Math.round(Math.max(risingPct, fallingPct))}%` },
        { label: 'Average 30d move', value: fmtPct(avgPct) },
      ],
      evidenceSummary: [
        `Grouped card_trends by set_name, filtered to sets with at least ${MIN_SET_MOMENTUM_CARDS} tracked cards.`,
        `Direction threshold: at least ${MIN_SET_MOMENTUM_DIRECTION_PCT}% same-direction moves.`,
        primaryEligibleSample
          ? `Primary-recommendation bar: sample of ${g.total} tracked cards meets the ${MIN_SET_MOMENTUM_PRIMARY_CARDS}-card minimum.`
          : `Primary-recommendation bar: this ${g.total}-card sample is below the ${MIN_SET_MOMENTUM_PRIMARY_CARDS}-card minimum, so this can only be a callout or alternative, not a standalone weekly article.`,
      ],
      overlap: { verdict: overlap.verdict, topMatchSlug: overlap.matches[0]?.slug ?? null, topMatchHeadline: overlap.matches[0]?.headline ?? null },
      visuals: ['ranking_table', 'set_comparison', 'price_history_chart'],
      researchRequired: !primaryEligibleSample,
      researchReason: primaryEligibleSample
        ? undefined
        : `Set-momentum sample is only ${g.total} tracked cards. A standalone weekly article needs at least ${MIN_SET_MOMENTUM_PRIMARY_CARDS} same-direction cards in the same set to support the headline claim.`,
    })
  }
  return out
}

// ── C. Grading spread ────────────────────────────────────────────

function detectGradingSpread(trends: TrendRow[], overlapArticles: OverlapArt[], context: EditorialContext): Opportunity | null {
  const usable = trends.filter(t => (t.current_raw ?? 0) > 0 && (t.current_psa10 ?? 0) > 0)
  if (usable.length < MIN_GRADING_SPREAD_CARDS) return null

  // Block 5C — meaningful-raw filter. A card whose raw side is a
  // couple of dollars is not evidence of a "grading premium"; it is
  // evidence of a listing floor. Editorial claims about the grading
  // multiple must come from cards where the raw market is a real
  // market. The 135-card sample in prod today has ZERO cards over
  // $5 raw, so this branch fires and downgrades the opportunity.
  const meaningful = usable.filter(t => (t.current_raw ?? 0) >= MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS)
  const meaningfulEnough = meaningful.length >= MIN_GRADING_SPREAD_MEANINGFUL_COUNT

  // Statistics always computed on the FULL usable set so the diagnostic
  // is honest about the state of the data. The reason field explains
  // why the number is not necessarily editorial gold.
  const ratios = usable.map(t => (t.current_psa10! / t.current_raw!)).filter(r => Number.isFinite(r) && r > 0)
  const median = medianOf(ratios)
  const p90    = percentile(ratios, 0.9)
  const over10x = usable.filter(t => (t.current_psa10! / t.current_raw!) >= 10).length
  const rawMedianUsd = medianOf(usable.map(t => (t.current_raw ?? 0) / 100))
  const rawMaxUsd    = Math.max(...usable.map(t => (t.current_raw ?? 0) / 100))

  const topOutliers = usable
    .map(t => ({ ...t, mult: (t.current_psa10! / t.current_raw!) }))
    .sort((a, b) => b.mult - a.mult)
    .slice(0, 8)

  const headline = meaningfulEnough
    ? `The PSA 10 premium across ${meaningful.length} PokePrices tracked cards`
    : `Grading multiple in the current PokePrices tracked sample: research required`
  const angle = meaningfulEnough
    ? `Analysis of the raw-to-PSA-10 price multiple across ${meaningful.length} cards where the raw market itself is meaningful (raw >= $${MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS / 100}). Median multiple, top decile, and the outliers where grading really matters.`
    : `The current tracked sample has ${usable.length} cards with both raw and PSA 10 prices, but every one sits at $${rawMedianUsd.toFixed(2)} raw or below (max $${rawMaxUsd.toFixed(2)}). Any raw-to-PSA-10 ratio in this sample reflects listing-floor pricing on common cards, not a grading premium the reader can act on.`
  const whyNow = meaningfulEnough
    ? `${over10x} of the ${meaningful.length} qualifying cards command a PSA 10 price of at least 10x raw.`
    : `The mechanical median multiple across the ${usable.length} tracked cards is ${median.toFixed(1)}x, but the underlying raw prices are all $1 to $${rawMaxUsd.toFixed(2)}. This is a data-composition artifact. Extend tracked-card coverage to higher-value raw markets before publishing.`

  const overlap = computeOverlap({ title: headline, angle, theme: 'grading' }, overlapArticles)
  const score = meaningfulEnough
    ? scoreOpportunity({
        baseline:        70,
        dataBoost:       Math.min(15, meaningful.length / 10),
        magnitudeBoost:  Math.min(10, over10x / 5),
        timelinessBoost: 5,
        overlapPenalty:  overlapPenalty(overlap),
      })
    : scoreOpportunity({
        // Not zero, so it still appears in the Radar for planning.
        baseline: 30, dataBoost: 0, magnitudeBoost: 0, timelinessBoost: 0,
        overlapPenalty: overlapPenalty(overlap),
      })

  return {
    id: 'grading-spread-study',
    kind: 'grading_spread',
    headlineSuggestion: headline,
    angle,
    whyNow,
    score,
    scoreReasons: meaningfulEnough
      ? [
          `${meaningful.length}-card sample with raw>=$${MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS / 100} and PSA 10 prices`,
          `median multiple ${median.toFixed(1)}x`,
          `${over10x} cards >=10x raw`,
          overlap.verdict === 'low' ? 'no direct competitor article' : `${overlap.verdict} overlap`,
        ]
      : [
          `${usable.length} cards match the raw+PSA10 join`,
          `only ${meaningful.length} of those have raw >= $${MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS / 100}`,
          `research required: sample composition unfit for a citable grading study`,
        ],
    dataStrength: meaningfulEnough
      ? (meaningful.length >= 100 ? 'strong' : meaningful.length >= 50 ? 'medium' : 'weak')
      : 'weak',
    citationPotential: meaningfulEnough
      ? (meaningful.length >= 100 ? 'high' : 'medium')
      : 'low',
    suggestedArticleType: 'data_study',
    suggestedTiming: null,
    relatedSets: Array.from(new Set(topOutliers.map(t => t.set_name))).slice(0, 5),
    relatedCards: topOutliers.map(t => ({ slug: String(t.card_slug), name: t.card_name, setName: t.set_name, urlSlug: null })),
    metrics: [
      { label: 'Cards with raw + PSA 10', value: String(usable.length) },
      { label: `Cards at raw >= $${MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS / 100}`, value: String(meaningful.length) },
      { label: 'Median raw price', value: `$${rawMedianUsd.toFixed(2)}` },
      { label: 'Maximum raw price', value: `$${rawMaxUsd.toFixed(2)}` },
      { label: 'Median PSA 10 / raw multiple (whole sample)', value: `${median.toFixed(1)}x` },
      { label: '90th-percentile multiple (whole sample)', value: `${p90.toFixed(1)}x` },
      { label: '>=10x multiple (whole sample)', value: String(over10x) },
    ],
    evidenceSummary: meaningfulEnough
      ? [
          'Joined card_trends filtered by high or medium confidence card_volume.',
          'Filtered to cards where raw side is a meaningful market (raw >= $10).',
          'Reported median, 90th percentile, and count of >=10x outliers.',
        ]
      : [
          `Joined card_trends filtered by high/medium confidence card_volume: ${usable.length} cards.`,
          `Every card in the sample has raw price between $${(Math.min(...usable.map(t => (t.current_raw ?? 0) / 100))).toFixed(2)} and $${rawMaxUsd.toFixed(2)}.`,
          'Ratio statistics are mathematically correct but semantically weak: dividing a listing-floor raw price by a real graded market price mechanically produces large multiples.',
          'A citable grading-spread study needs cards where the raw market itself is meaningful (raw at least $10, ideally higher). Waiting on broader tracked-card coverage.',
        ],
    overlap: { verdict: overlap.verdict, topMatchSlug: overlap.matches[0]?.slug ?? null, topMatchHeadline: overlap.matches[0]?.headline ?? null },
    visuals: ['raw_psa9_psa10_comparison', 'ranking_table', 'large_stat_callout'],
    researchRequired: !meaningfulEnough,
    researchReason:   meaningfulEnough
      ? undefined
      : `The 135-card tracked sample has zero cards at raw >= $${MIN_GRADING_SPREAD_MEANINGFUL_RAW_CENTS / 100}. Any headline ratio is a listing-floor artifact, not a grading premium.`,
  }
}

// ── D. Population scarcity ───────────────────────────────────────

function detectPopulationScarcity(pop: any[], trends: TrendRow[], overlapArticles: OverlapArt[], context: EditorialContext): Opportunity | null {
  // Find high-value cards (>= $100 PSA 10 or >= $50 raw) with SMALL psa_10
  // population (<200). Match by set_name + card_number.
  const trendsByKey = new Map<string, TrendRow>()
  for (const t of trends) {
    const key = keyForPop(t.set_name, extractCardNumber(t.card_name))
    if (key) trendsByKey.set(key, t)
  }
  type Row = { setName: string; cardName: string; cardNumber: string; psa10Pop: number; totalGraded: number; price: number; kind: 'psa10' | 'raw' }
  const rows: Row[] = []
  for (const p of pop) {
    const psa10 = Number(p.psa_10 ?? 0)
    const totalGraded = Number(p.total_graded ?? 0)
    if (totalGraded < MIN_POP_TOTAL) continue
    if (psa10 > 200) continue  // "surprisingly low population" gate
    const key = keyForPop(String(p.set_name || ''), String(p.card_number || ''))
    if (!key) continue
    const t = trendsByKey.get(key)
    if (!t) continue
    const psa10Price = Number(t.current_psa10 ?? 0)
    const rawPrice   = Number(t.current_raw   ?? 0)
    if (psa10Price >= 10_000)     rows.push({ setName: t.set_name, cardName: t.card_name, cardNumber: String(p.card_number || ''), psa10Pop: psa10, totalGraded, price: psa10Price, kind: 'psa10' })
    else if (rawPrice >= 5_000)   rows.push({ setName: t.set_name, cardName: t.card_name, cardNumber: String(p.card_number || ''), psa10Pop: psa10, totalGraded, price: rawPrice,   kind: 'raw'   })
  }
  if (rows.length < 3) return null

  rows.sort((a, b) => (a.psa10Pop - b.psa10Pop) || (b.price - a.price))
  const top = rows.slice(0, 10)

  const headline = 'High-value Pokémon cards with surprisingly low PSA 10 populations'
  const angle = `Cross-referenced ${rows.length} cards where PSA population is low (<200 PSA 10 copies with ≥${MIN_POP_TOTAL} graded overall) and price is high. Scarcity + demand meeting on real numbers.`
  const whyNow = 'PSA population is the strongest evidence base we currently have — 33k+ rows, 157 sets — and this cross-cut is a defensible data-story format.'

  const overlap = computeOverlap({ title: headline, angle, theme: 'grading' }, overlapArticles)
  const score = scoreOpportunity({
    baseline:        60,
    dataBoost:       Math.min(15, rows.length),
    magnitudeBoost:  10,
    timelinessBoost: 5,
    overlapPenalty:  overlapPenalty(overlap),
  })

  return {
    id: 'population-scarcity',
    kind: 'population_scarcity',
    headlineSuggestion: headline,
    angle,
    whyNow,
    score,
    scoreReasons: [
      `${rows.length} candidate cards`,
      'psa_population sample ≥ 100 graded',
      overlap.verdict === 'low' ? 'no direct competitor article' : `${overlap.verdict} overlap`,
    ],
    dataStrength: rows.length >= 10 ? 'strong' : rows.length >= 5 ? 'medium' : 'weak',
    citationPotential: 'high',
    suggestedArticleType: 'data_study',
    suggestedTiming: null,
    relatedSets: Array.from(new Set(top.map(r => r.setName))).slice(0, 6),
    relatedCards: top.map(r => ({ slug: '', name: `${r.cardName} #${r.cardNumber}`, setName: r.setName, urlSlug: null })),
    metrics: [
      { label: 'Candidate cards', value: String(rows.length) },
      { label: 'Lowest PSA 10 population in shortlist', value: String(top[0].psa10Pop) },
      { label: 'Highest priced in shortlist', value: `$${(top.slice().sort((a,b)=>b.price-a.price)[0].price / 100).toFixed(0)}` },
    ],
    evidenceSummary: [
      `psa_population rows with total_graded ≥ ${MIN_POP_TOTAL} joined to card_trends by (set_name, card_number).`,
      'Filter: PSA 10 population < 200 AND (PSA 10 price ≥ $100 OR raw ≥ $50).',
      'Ordered by PSA 10 population ascending then price descending.',
    ],
    overlap: { verdict: overlap.verdict, topMatchSlug: overlap.matches[0]?.slug ?? null, topMatchHeadline: overlap.matches[0]?.headline ?? null },
    visuals: ['population_scatter', 'ranking_table', 'card_grid'],
  }
}

// ── E. Clusters ──────────────────────────────────────────────────

function detectClusters(trends: TrendRow[], overlapArticles: OverlapArt[], context: EditorialContext): Opportunity[] {
  const enriched = trends
    .filter(t => (t.current_raw ?? 0) >= MIN_PRICE_USD_CENTS_MOVER)
    .map(t => ({ ...t, pct: numeric(t.raw_pct_30d) }))
    .filter(t => t.pct != null && Math.abs(t.pct!) >= MIN_PCT_ABS_MOVER)
  const risers = enriched.filter(t => t.pct! > 0).sort((a, b) => b.pct! - a.pct!).slice(0, 15)

  const byPokemon = new Map<string, TrendRow[]>()
  for (const t of risers) {
    const pokemon = extractPokemonName(t.card_name)
    if (!pokemon) continue
    const arr = byPokemon.get(pokemon) ?? []
    arr.push(t)
    byPokemon.set(pokemon, arr)
  }
  const out: Opportunity[] = []
  for (const [pokemon, list] of Array.from(byPokemon.entries())) {
    if (list.length < CLUSTER_MIN_REPEAT) continue
    const headline = `${list.length} of the strongest recent risers are ${pokemon} cards`
    const angle = `A ${pokemon}-shaped pattern in the 30-day mover list: ${list.length} tracked ${pokemon} cards up ≥${MIN_PCT_ABS_MOVER}%. Investigate whether this is a real demand story or catalogue coverage bias.`
    const overlap = computeOverlap({ title: headline, angle, theme: 'market' }, overlapArticles)
    const score = scoreOpportunity({
      baseline: 55, dataBoost: Math.min(10, list.length * 2), magnitudeBoost: 10, timelinessBoost: 10,
      overlapPenalty: overlapPenalty(overlap),
    })
    out.push({
      id: `cluster-pokemon-${slugify(pokemon)}`,
      kind: 'cluster',
      headlineSuggestion: headline,
      angle,
      whyNow: `${pokemon} appears ${list.length} times in the current trusted 30-day riser shortlist — a repeatable pattern.`,
      score,
      scoreReasons: [
        `${list.length}× ${pokemon} in recent risers`,
        overlap.verdict === 'low' ? 'no existing article on this cluster' : `${overlap.verdict} overlap`,
      ],
      dataStrength: list.length >= 5 ? 'strong' : 'medium',
      citationPotential: 'medium',
      suggestedArticleType: 'market_analysis',
      suggestedTiming: 'this week',
      relatedSets: Array.from(new Set(list.map(t => t.set_name))),
      relatedCards: list.slice(0, 6).map(t => ({ slug: String(t.card_slug), name: t.card_name, setName: t.set_name, urlSlug: null })),
      metrics: [
        { label: `${pokemon} in mover shortlist`, value: String(list.length) },
        { label: 'Distinct sets involved', value: String(new Set(list.map(t => t.set_name)).size) },
      ],
      evidenceSummary: [
        'Extracted Pokémon name from card_name (word before # / trailing " V/VMAX/GX/…").',
        'Counted repeats inside the trusted-30d riser shortlist of size 15.',
      ],
      overlap: { verdict: overlap.verdict, topMatchSlug: overlap.matches[0]?.slug ?? null, topMatchHeadline: overlap.matches[0]?.headline ?? null },
      visuals: ['card_grid', 'ranking_table'],
    })
  }
  return out
}

// ── F. Release-driven ────────────────────────────────────────────

function detectReleaseDriven(context: EditorialContext, overlapArticles: OverlapArt[]): Opportunity[] {
  const all: ReleaseItem[] = [...context.release.recent, ...context.release.upcoming]
  const out: Opportunity[] = []

  for (const r of all) {
    const applicable = r.timingOpportunities.filter(o => o.applicable)
    if (applicable.length === 0) continue
    if (r.coverage.status !== 'none' && r.coverage.status !== 'planned') continue

    for (const opp of applicable) {
      const { headline, angle, whyNow, articleType, timing } = releaseOpportunityCopy(r, opp)
      // Suppress retrospective if catalogue is too thin.
      if ((opp.key === 'reaction' || opp.key === 'performance') && (r.cardCount ?? 0) < MIN_RELEASE_CARD_COUNT_RETRO) continue

      const overlap = computeOverlap({ title: headline, angle, setRefs: [r.setName], theme: 'market' }, overlapArticles)
      const score = scoreOpportunity({
        baseline: opp.key === 'launch' ? 78 : opp.key === 'preview' ? 65 : 60,
        dataBoost: r.cardCount ? Math.min(15, r.cardCount / 20) : 0,
        magnitudeBoost: 5,
        timelinessBoost: 15,
        overlapPenalty: overlapPenalty(overlap) + (r.coverage.status === 'planned' ? 15 : 0),
      })
      out.push({
        id: `release-${slugify(r.setName)}-${opp.key}`,
        kind: 'release_driven',
        headlineSuggestion: headline,
        angle,
        whyNow,
        score,
        scoreReasons: [
          `set ${r.setName} in "${opp.label}" window`,
          r.confirmed === false ? 'release date unconfirmed' : 'release date confirmed',
          r.cardCount ? `${r.cardCount} catalogue cards available` : 'catalogue coverage not yet available',
          r.coverage.status === 'planned' ? 'a project is already planned for this set' : 'no existing article / project on this set',
        ],
        dataStrength: (r.cardCount ?? 0) >= MIN_RELEASE_CARD_COUNT_RETRO ? 'strong' : r.cardCount ? 'medium' : 'weak',
        citationPotential: (r.cardCount ?? 0) >= MIN_RELEASE_CARD_COUNT_RETRO ? 'high' : 'medium',
        suggestedArticleType: articleType,
        suggestedTiming: timing,
        relatedSets: [r.setName],
        relatedCards: [],
        metrics: [
          { label: 'Days until release', value: r.daysDelta > 0 ? `+${r.daysDelta}` : String(r.daysDelta) },
          { label: 'Catalogue cards', value: String(r.cardCount ?? 0) },
          { label: 'Confirmed', value: r.confirmed === true ? 'yes' : r.confirmed === false ? 'no' : 'unknown' },
        ],
        evidenceSummary: [
          `Release date: ${r.releaseDate}${r.jpReleaseDate ? ` (JP ${r.jpReleaseDate})` : ''}.`,
          `Timing window: ${opp.reason}`,
          r.coverage.publishedInsights.length > 0
            ? `Existing coverage: ${r.coverage.publishedInsights.map(c => c.headline).join('; ')}`
            : 'No existing published article mentions this set.',
        ],
        overlap: { verdict: overlap.verdict, topMatchSlug: overlap.matches[0]?.slug ?? null, topMatchHeadline: overlap.matches[0]?.headline ?? null },
        visuals: opp.key === 'launch' || opp.key === 'reaction' || opp.key === 'performance'
          ? ['ranking_table', 'raw_psa9_psa10_comparison', 'price_history_chart']
          : ['card_grid', 'large_stat_callout'],
      })
    }
  }
  return out
}

// ── G. Monthly report ────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function detectMonthlyReport(now: Date, context: EditorialContext): Opportunity | null {
  // Previous calendar month.
  const yy = now.getUTCFullYear()
  const mm = now.getUTCMonth() // 0..11
  const prev = new Date(Date.UTC(yy, mm - 1, 1))
  const prevYear  = prev.getUTCFullYear()
  const prevMonth = prev.getUTCMonth()
  const prevLabel = `${MONTH_NAMES[prevMonth]} ${prevYear}`

  // Already covered by an existing published article?
  const covered = context.articles.some(a => {
    const t = `${a.headline} ${a.intro ?? ''}`.toLowerCase()
    return t.includes(prevLabel.toLowerCase()) || t.includes(`${MONTH_NAMES[prevMonth].toLowerCase()} ${prevYear} market`)
  })
  if (covered) return null

  // Already planned by a project?
  const planned = context.projects.some(p => {
    if (p.status === 'archived' || p.status === 'published') return false
    const t = `${p.title} ${p.angle ?? ''} ${p.notes ?? ''}`.toLowerCase()
    return t.includes(prevLabel.toLowerCase())
  })
  if (planned) return null

  const headline = `Pokémon Card Market Report — ${prevLabel}`
  const angle = `Monthly retrospective on the PokePrices dataset for ${prevLabel}: overall market movement, notable set-level moves, biggest risers/fallers among high-confidence tracked cards, and grading spread commentary.`
  const whyNow = `The previous calendar month (${prevLabel}) has ended and no existing or planned article covers it. Monthly reports are strategically important editorial anchors.`

  const score = scoreOpportunity({
    baseline: 85,
    dataBoost: 8,
    magnitudeBoost: 5,
    timelinessBoost: 15,
    overlapPenalty: 0,
  })

  return {
    id: `monthly-report-${prevYear}-${String(prevMonth + 1).padStart(2, '0')}`,
    kind: 'monthly_report',
    headlineSuggestion: headline,
    angle,
    whyNow,
    score,
    scoreReasons: [
      `covers ${prevLabel}`,
      'no existing or planned coverage',
      'strategically important recurring format',
    ],
    dataStrength: 'strong',
    citationPotential: 'high',
    suggestedArticleType: 'monthly_market_report',
    suggestedTiming: 'this week',
    relatedSets: [],
    relatedCards: [],
    metrics: [
      { label: 'Month covered', value: prevLabel },
      { label: 'Existing coverage', value: 'none' },
    ],
    evidenceSummary: [
      `Previous calendar month = ${prevLabel} (relative to today ${context.meta.today}).`,
      `Checked ${context.articles.length} published articles and ${context.projects.length} editorial projects for a "${prevLabel}" mention.`,
    ],
    overlap: { verdict: 'low', topMatchSlug: null, topMatchHeadline: null },
    visuals: ['ranking_table', 'market_index_chart', 'raw_psa9_psa10_comparison', 'large_stat_callout'],
  }
}

// ─────────────────────────────────────────────────────────────────
// Scoring helpers
// ─────────────────────────────────────────────────────────────────

function scoreOpportunity(inp: {
  baseline: number
  dataBoost: number
  magnitudeBoost: number
  timelinessBoost: number
  overlapPenalty: number
}): number {
  const raw = inp.baseline + inp.dataBoost + inp.magnitudeBoost + inp.timelinessBoost - inp.overlapPenalty
  return Math.max(1, Math.min(100, Math.round(raw)))
}

function overlapPenalty(o: OverlapReport): number {
  if (o.verdict === 'strong')   return 40
  if (o.verdict === 'possible') return 15
  return 0
}

// ─────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────

function numeric(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN)
  return Number.isFinite(n) ? n : null
}
function fmtPct(n: number): string { const s = n.toFixed(1); return `${n >= 0 ? '+' : ''}${s}%` }
function medianOf(xs: number[]): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
function percentile(xs: number[], p: number): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.floor(p * s.length)); return s[i] }
function slugify(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) }

/** Extract "12/165" style card numbers from names like "Pikachu #55". */
function extractCardNumber(cardName: string): string {
  const m = (cardName || '').match(/#\s*([0-9a-zA-Z\-\/]+)\s*$/)
  return m ? m[1] : ''
}

/** Best-effort "which Pokémon does this card feature" from a card name. */
function extractPokemonName(cardName: string): string | null {
  if (!cardName) return null
  // Strip the trailing "#NN" and any suffix like " V", " VMAX", " GX", " ex".
  let n = cardName.replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim()
  n = n.replace(/\s+\[.*?\]$/, '').trim() // strip trailing "[Reverse Holo]" etc
  // Drop trailing modifiers.
  n = n.replace(/\s+(V|VMAX|VSTAR|GX|EX|BREAK|Prime|LEGEND|Delta|LV\.X|LV X|ex)$/i, '').trim()
  return n || null
}

function keyForPop(setName: string, cardNumber: string): string | null {
  const s = (setName || '').replace(/^Pokemon\s+/i, '').trim().toLowerCase()
  const n = (cardNumber || '').trim().toLowerCase()
  if (!s || !n) return null
  return `${s}|${n}`
}

// ── Release copy generator ───────────────────────────────────────

function releaseOpportunityCopy(r: ReleaseItem, opp: ReleaseItem['timingOpportunities'][number]): {
  headline: string; angle: string; whyNow: string; articleType: SuggestedArticleType; timing: string | null;
} {
  const days = r.daysDelta
  switch (opp.key) {
    case 'preview':
      return {
        headline: `${r.setName}: everything we know so far`,
        angle:    `An upcoming-set primer covering release date, set code, format, chase cards signalled from any Japanese release, and what we already know about the wider ${r.setName} concept.`,
        whyNow:   `Set releases ${days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`} and search interest for upcoming-set primers is highest in this window.`,
        articleType: 'upcoming_set',
        timing: 'within the next 2 weeks',
      }
    case 'reveal':
      return {
        headline: `${r.setName}: the confirmed chase cards`,
        angle:    `Rundown of what has been officially revealed for ${r.setName}, likely price bands based on comparable prior sets, and where to look for hidden gems.`,
        whyNow:   `We are ${days} days from release — the reveal window when interest is highest and there is enough information to write with confidence.`,
        articleType: 'upcoming_set',
        timing: 'within the next 7-14 days',
      }
    case 'launch':
      return {
        headline: `${r.setName}: full launch guide and opening prices`,
        angle:    `Launch-week guide to ${r.setName}: opening prices, most valuable cards, sealed vs singles behaviour, and how the market received the release.`,
        whyNow:   `${r.setName} is in its launch week (${days} days from release). Launch-week guides tend to be a site's most cited content of the release cycle.`,
        articleType: 'new_set',
        timing: 'this week',
      }
    case 'reaction':
      return {
        headline: `${r.setName} one week in: early winners and losers`,
        angle:    `Post-launch reaction: which ${r.setName} cards popped hardest, which fizzled, and what raw-versus-sealed behaviour is telling us so far.`,
        whyNow:   `Set released ${Math.abs(days)} days ago — enough time for real signal but early enough to matter.`,
        articleType: 'market_analysis',
        timing: 'this week',
      }
    case 'performance':
      return {
        headline: `${r.setName} at 30 days: which cards held their value?`,
        angle:    `A month-in retrospective on ${r.setName}: chase-card price movement, PSA 10 emergence, and how the release measures up against the previous ${r.setName.includes('Mega Evolution') ? 'Mega Evolution set' : 'comparable release'}.`,
        whyNow:   `Set released ${Math.abs(days)} days ago. This is the moment to lock in the "which chase cards held their value?" analysis.`,
        articleType: 'market_analysis',
        timing: 'within the next 2 weeks',
      }
  }
}
