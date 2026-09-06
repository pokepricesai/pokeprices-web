// src/lib/editorial/research/monthlyMarketReport.ts
//
// EIC Block 6 — deterministic research recipe B.
//
// Target article template:
//   "Pokémon Card Market Report — <Month YYYY>"
//
// Recipe outline:
//   1. Parse the target month from the project title. If it can't
//      be inferred, default to the previous calendar month.
//   2. Query daily_prices at the exact month boundaries (first and
//      last day of the month). daily_prices uses `date`, not `as_of`
//      or `price_date`. The August 2026 audit found 62,880 rows on
//      2026-08-01 and 62,735 rows on 2026-08-31 — the intersection
//      (~62,600 cards priced on both dates) is a defensible base.
//   3. Compute per-card raw price deltas across the month. Also
//      compute PSA 10 deltas where both endpoints exist.
//   4. Aggregate: sample size, median monthly % move, IQR, % rising
//      / falling / flat, and top movers up/down.
//   5. Join to cards + set metadata for set-level cluster aggregates.
//   6. When start or end coverage is thin, downgrade the pack to
//      needs_review or blocked and explain in `reasons`.
//   7. Emit verifiedFacts + derivedFindings with formulae; add a
//      warnings section for cards that appear only on one endpoint,
//      to make survivorship risk explicit.
//
// This recipe intentionally NEVER substitutes "last 30 days from
// today" for the requested month. If the exact date coverage is
// insufficient, the pack is BLOCKED, not silently backfilled.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchAllPages } from '../pageFetch'
import type {
  EvidencePack, VerifiedFact, DerivedFinding, DataTable, Warning,
  InternalSource, PackQuality, PackProjectRef, QuarantineEntry,
} from './types'
import { CENTS_PER_USD, daysBetween } from './qualityChecks'

const MIN_ROWS_PER_ENDPOINT      = 30_000  // full daily_prices snapshot is ~62k; partials ~35k
const MIN_INTERSECTION           = 20_000  // must have this many cards on BOTH endpoints
const TOP_MOVER_MIN_START_CENTS  = 500     // $5 minimum start price so % moves are meaningful
const TOP_MOVER_LIMIT            = 10

// Block 6B — extreme-mover quarantine rule (derived from the live
// 2026-08 distribution: 22,071 movers with start >= $5; 21 had
// pct >= 500% and 3 exceeded 3,000%). A month-over-month raw price
// move of 500% or more is almost always a scraper artifact (raw/PSA
// cross-attribution, listing floor bounce, or delisting). A move of
// 200%+ combined with a $5,000+ absolute change catches the extreme
// price-swap cases even when the pct alone would be plausible.
const QUARANTINE_ABS_PCT              = 500    // |pct| >= 500%
const QUARANTINE_BIG_PCT              = 200    // 200%+ combined ...
const QUARANTINE_BIG_ABS_CHANGE_CENTS = 500_000 // ... with $5,000 absolute change

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export type MonthlyMarketReportOptions = {
  today?:      string
  targetMonth?: { year: number; month: number }   // 1..12
}

export async function runMonthlyMarketReportRecipe(
  project: PackProjectRef,
  options: MonthlyMarketReportOptions = {},
): Promise<EvidencePack> {
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const generatedAt = new Date().toISOString()
  const supa = getSupabaseServiceClient()

  const { year, month } = options.targetMonth ?? inferTargetMonth(project.title, today)
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
  const startDate  = isoDate(year, month, 1)
  const endDate    = lastDayOfMonthIso(year, month)

  const warnings: Warning[] = []

  // ── Step 1: endpoint availability audit ────────────────────────
  const startAudit = await auditEndpoint(supa, startDate)
  const endAudit   = await auditEndpoint(supa, endDate)

  if (startAudit.rowCount < MIN_ROWS_PER_ENDPOINT) {
    warnings.push({
      id: 'endpoint-start-thin',
      severity: 'critical',
      message: `Only ${startAudit.rowCount} rows in daily_prices on ${startDate}; expected a full ~60k-row snapshot. Article cannot honestly claim a ${monthLabel} start baseline.`,
    })
  }
  if (endAudit.rowCount < MIN_ROWS_PER_ENDPOINT) {
    warnings.push({
      id: 'endpoint-end-thin',
      severity: 'critical',
      message: `Only ${endAudit.rowCount} rows in daily_prices on ${endDate}; expected a full ~60k-row snapshot.`,
    })
  }

  // ── Step 2: fetch both endpoints (paged, raw + PSA 10 only) ────
  const [startRes, endRes] = await Promise.all([
    fetchAllPages<any>(
      () => supa.from('daily_prices').select('card_slug, raw_usd, psa10_usd, psa9_usd').eq('date', startDate),
      { hardMaxRows: 200_000 },
    ),
    fetchAllPages<any>(
      () => supa.from('daily_prices').select('card_slug, raw_usd, psa10_usd, psa9_usd').eq('date', endDate),
      { hardMaxRows: 200_000 },
    ),
  ])
  if (startRes.truncated) warnings.push({ id: 'start-truncated', severity: 'major', message: `start-endpoint fetch truncated at ${startRes.rows.length} rows.` })
  if (endRes.truncated)   warnings.push({ id: 'end-truncated',   severity: 'major', message: `end-endpoint fetch truncated at ${endRes.rows.length} rows.` })

  const startBySlug = new Map<string, any>()
  for (const r of startRes.rows) startBySlug.set(String(r.card_slug), r)
  const endBySlug = new Map<string, any>()
  for (const r of endRes.rows)   endBySlug.set(String(r.card_slug), r)

  // ── Step 3: per-card monthly deltas ────────────────────────────
  type MonthlyDelta = {
    cardSlug:      string
    startRawCents: number | null
    endRawCents:   number | null
    rawPct:        number | null
    startPsa10:    number | null
    endPsa10:      number | null
    psa10Pct:      number | null
  }
  const deltas: MonthlyDelta[] = []
  const startOnly: string[] = []
  const endOnly:   string[] = []
  for (const slug of Array.from(new Set([...Array.from(startBySlug.keys()), ...Array.from(endBySlug.keys())]))) {
    const s = startBySlug.get(slug)
    const e = endBySlug.get(slug)
    if (s && !e) { startOnly.push(slug); continue }
    if (e && !s) { endOnly.push(slug);   continue }
    const sr = toPos(s.raw_usd); const er = toPos(e.raw_usd)
    const sp = toPos(s.psa10_usd); const ep = toPos(e.psa10_usd)
    deltas.push({
      cardSlug:      slug,
      startRawCents: sr,
      endRawCents:   er,
      rawPct:        (sr != null && er != null && sr > 0) ? round2(100 * (er - sr) / sr) : null,
      startPsa10:    sp,
      endPsa10:      ep,
      psa10Pct:      (sp != null && ep != null && sp > 0) ? round2(100 * (ep - sp) / sp) : null,
    })
  }

  const bothPricedRaw   = deltas.filter(d => d.rawPct   != null)
  const bothPricedPsa10 = deltas.filter(d => d.psa10Pct != null)

  if (bothPricedRaw.length < MIN_INTERSECTION) {
    warnings.push({
      id: 'intersection-thin',
      severity: 'critical',
      message: `Only ${bothPricedRaw.length} cards have raw prices on BOTH ${startDate} and ${endDate}. Below the ${MIN_INTERSECTION}-card bar for a market-wide claim.`,
    })
  }

  if (startOnly.length > 0 || endOnly.length > 0) {
    warnings.push({
      id: 'survivorship',
      severity: startOnly.length + endOnly.length > 2000 ? 'major' : 'minor',
      message: `${startOnly.length} cards priced on start date but not end date, ${endOnly.length} priced on end but not start. Sample restricted to intersection to avoid survivorship bias.`,
    })
  }

  // ── Step 4: aggregate stats ────────────────────────────────────
  const rawPcts = bothPricedRaw.map(d => d.rawPct!)
  const median  = medianOf(rawPcts)
  const q1      = percentile(rawPcts, 0.25)
  const q3      = percentile(rawPcts, 0.75)
  const rising  = rawPcts.filter(p => p >   1).length
  const falling = rawPcts.filter(p => p <  -1).length
  const flat    = rawPcts.length - rising - falling

  // Top movers (need meaningful start price)
  const meaningfulRaw = bothPricedRaw.filter(d => (d.startRawCents ?? 0) >= TOP_MOVER_MIN_START_CENTS)

  // Block 6B — split meaningful movers into publishable + quarantined
  // BEFORE ranking, so implausible artifacts do not sit at the top of
  // the "biggest riser" list masquerading as real market moves.
  const isExtremeMove = (d: MonthlyDelta): boolean => {
    if (d.rawPct == null || d.startRawCents == null || d.endRawCents == null) return false
    const absPct = Math.abs(d.rawPct)
    const absChange = Math.abs(d.endRawCents - d.startRawCents)
    if (absPct >= QUARANTINE_ABS_PCT) return true
    if (absPct >= QUARANTINE_BIG_PCT && absChange >= QUARANTINE_BIG_ABS_CHANGE_CENTS) return true
    return false
  }
  const quarantinedMovers = meaningfulRaw.filter(isExtremeMove)
  const publishableMovers = meaningfulRaw.filter(d => !isExtremeMove(d))

  const topRisers  = [...publishableMovers].sort((a, b) => (b.rawPct! - a.rawPct!)).slice(0, TOP_MOVER_LIMIT)
  const topFallers = [...publishableMovers].sort((a, b) => (a.rawPct! - b.rawPct!)).slice(0, TOP_MOVER_LIMIT)

  // Join top movers + quarantined movers to cards for names + slugs.
  // daily_prices.card_slug uses "pc-<numeric>"; cards.card_slug is bare
  // (see CLAUDE.md). Strip the prefix for the cards lookup.
  const moverSlugs    = Array.from(new Set([...topRisers, ...topFallers, ...quarantinedMovers].map(m => m.cardSlug)))
  const moverSlugsBare = moverSlugs.map(s => String(s).replace(/^pc-/, ''))
  const moverCards = moverSlugsBare.length === 0
    ? { rows: [] as any[], pagesFetched: 0, truncated: false }
    : await fetchAllPages<any>(
        () => supa.from('cards').select('card_slug, card_name, set_name, card_number, url_slug').in('card_slug', moverSlugsBare),
        { hardMaxRows: 20_000 },
      )
  const cardBySlug = new Map<string, any>()
  for (const c of moverCards.rows) {
    // Store under BOTH the bare key and the pc- prefixed key so the
    // enrichment map lookup works regardless of which side is asking.
    cardBySlug.set(String(c.card_slug), c)
    cardBySlug.set(`pc-${c.card_slug}`, c)
  }

  const enrichMover = (d: MonthlyDelta) => {
    const c = cardBySlug.get(d.cardSlug) ?? {}
    return {
      cardSlug:    d.cardSlug,
      cardName:    trimName(String(c.card_name ?? '')),
      cardNumber:  String(c.card_number ?? ''),
      setName:     String(c.set_name ?? ''),
      urlSlug:     c.url_slug ?? '',
      startUsd:    d.startRawCents != null ? round2(d.startRawCents / CENTS_PER_USD) : null,
      endUsd:      d.endRawCents   != null ? round2(d.endRawCents   / CENTS_PER_USD) : null,
      pct:         d.rawPct,
    }
  }
  const topRisersRows  = topRisers.map(enrichMover)
  const topFallersRows = topFallers.map(enrichMover)

  // Block 6B — quarantine entries for the extreme movers.
  const quarantinedRows: QuarantineEntry[] = quarantinedMovers.map(d => {
    const en = enrichMover(d)
    const startCents = d.startRawCents ?? 0
    const endCents   = d.endRawCents ?? 0
    const absChangeUsd = Math.abs(endCents - startCents) / CENTS_PER_USD
    return {
      id: `q-mover-${d.cardSlug}`,
      wouldHaveJoined: `mover-risers-${year}-${String(month).padStart(2,'0')} or fallers`,
      reason: 'extreme_monthly_move',
      severity: 'major',
      message: `${en.cardName || d.cardSlug} moved ${fmtSignedPct(d.rawPct!)} in ${monthLabel} ($${en.startUsd} to $${en.endUsd}, absolute change $${absChangeUsd.toFixed(2)}). Above the |${QUARANTINE_ABS_PCT}%| quarantine threshold. Excluded from the publishable mover ranking.`,
      rowSnapshot: {
        cardSlug:   d.cardSlug,
        cardName:   en.cardName,
        cardNumber: en.cardNumber,
        setName:    en.setName,
        startUsd:   en.startUsd,
        endUsd:     en.endUsd,
        pct:        d.rawPct,
        absChangeUsd: Number(absChangeUsd.toFixed(2)),
      },
      // Passive contaminant. The monthly-report claim ("market moved
      // X%") is aggregate over 62k cards; a handful of quarantined
      // outliers don't change that. Reviewer can still ship.
      contaminatesPublishable: false,
    }
  })

  // ── Step 5: sources + tables ───────────────────────────────────
  const internalSources: InternalSource[] = [
    {
      id: 'src-daily-prices-start', kind: 'internal',
      label: `daily_prices — ${startDate} snapshot`,
      table: 'daily_prices', filters: `date = '${startDate}'`,
      asOf: startDate, rowCount: startRes.rows.length,
    },
    {
      id: 'src-daily-prices-end', kind: 'internal',
      label: `daily_prices — ${endDate} snapshot`,
      table: 'daily_prices', filters: `date = '${endDate}'`,
      asOf: endDate, rowCount: endRes.rows.length,
    },
    {
      id: 'src-cards-movers', kind: 'internal',
      label: 'cards — mover metadata',
      table: 'cards', filters: `card_slug IN (${moverSlugs.length} slugs)`,
      asOf: today, rowCount: moverCards.rows.length,
    },
  ]

  const dataTables: DataTable[] = [
    {
      id: `mover-risers-${year}-${String(month).padStart(2,'0')}`,
      title: `Top ${topRisersRows.length} raw-price risers, ${monthLabel}`,
      source: 'daily_prices + cards',
      asOf: endDate,
      columns: [
        { key: 'cardName',   label: 'Card' },
        { key: 'cardNumber', label: '#',        align: 'right' },
        { key: 'setName',    label: 'Set' },
        { key: 'startUsd',   label: `Start $ (${startDate})`, align: 'right' },
        { key: 'endUsd',     label: `End $ (${endDate})`,     align: 'right' },
        { key: 'pct',        label: '% change', align: 'right' },
      ],
      rows: topRisersRows,
    },
    {
      id: `mover-fallers-${year}-${String(month).padStart(2,'0')}`,
      title: `Top ${topFallersRows.length} raw-price fallers, ${monthLabel}`,
      source: 'daily_prices + cards',
      asOf: endDate,
      columns: [
        { key: 'cardName',   label: 'Card' },
        { key: 'cardNumber', label: '#',        align: 'right' },
        { key: 'setName',    label: 'Set' },
        { key: 'startUsd',   label: `Start $ (${startDate})`, align: 'right' },
        { key: 'endUsd',     label: `End $ (${endDate})`,     align: 'right' },
        { key: 'pct',        label: '% change', align: 'right' },
      ],
      rows: topFallersRows,
    },
  ]

  const verifiedFacts: VerifiedFact[] = [
    { id: 'fact-window',           type: 'verified_fact', statement: `Report window: ${startDate} to ${endDate} (${monthLabel}).`, evidenceRefs: [], asOf: endDate },
    { id: 'fact-sample-start',     type: 'verified_fact', statement: `${startRes.rows.length} rows in daily_prices on ${startDate}.`, evidenceRefs: ['src-daily-prices-start'], asOf: startDate },
    { id: 'fact-sample-end',       type: 'verified_fact', statement: `${endRes.rows.length} rows in daily_prices on ${endDate}.`,   evidenceRefs: ['src-daily-prices-end'],   asOf: endDate },
    { id: 'fact-both-raw',         type: 'verified_fact', statement: `${bothPricedRaw.length} cards have a raw price on both dates.`, evidenceRefs: ['src-daily-prices-start','src-daily-prices-end'], asOf: endDate },
    { id: 'fact-both-psa10',       type: 'verified_fact', statement: `${bothPricedPsa10.length} cards have a PSA 10 price on both dates.`, evidenceRefs: ['src-daily-prices-start','src-daily-prices-end'], asOf: endDate },
  ]

  const derivedFindings: DerivedFinding[] = [
    { id: 'finding-median-raw', type: 'derived_finding',
      statement: `Median raw-price change across the ${bothPricedRaw.length}-card sample was ${fmtSignedPct(median)}.`,
      formula:   `median(rawPct) over cards priced on both ${startDate} and ${endDate}`,
      evidenceRefs: ['fact-both-raw'], asOf: endDate },
    { id: 'finding-iqr', type: 'derived_finding',
      statement: `Interquartile range of monthly raw-price change was ${fmtSignedPct(q1)} to ${fmtSignedPct(q3)}.`,
      formula:   `p25(rawPct), p75(rawPct)`,
      evidenceRefs: ['fact-both-raw'], asOf: endDate },
    { id: 'finding-direction', type: 'derived_finding',
      statement: `${rising} cards rose more than 1%, ${falling} fell more than 1%, ${flat} were flat.`,
      formula:   `count where rawPct > 1; count where rawPct < -1; remainder`,
      evidenceRefs: ['fact-both-raw'], asOf: endDate },
  ]

  const gaps: string[] = []
  if (bothPricedRaw.length < MIN_INTERSECTION) {
    gaps.push(`Insufficient intersection (${bothPricedRaw.length} < ${MIN_INTERSECTION}). Extend daily_prices coverage before publishing a market-wide claim.`)
  }
  if (bothPricedPsa10.length < 5_000) {
    gaps.push(`PSA 10 coverage across both endpoints is ${bothPricedPsa10.length} cards — enough for anecdotal callouts but not for a graded-market claim.`)
  }
  if (quarantinedRows.length > 0) {
    gaps.push(`${quarantinedRows.length} extreme monthly movers quarantined (|pct| >= ${QUARANTINE_ABS_PCT}% or |pct| >= ${QUARANTINE_BIG_PCT}% with $${QUARANTINE_BIG_ABS_CHANGE_CENTS/CENTS_PER_USD}+ absolute change). See Quarantined rows. Investigate before restoring any into the published lists.`)
  }

  const quality = computeQuality({
    intersection:      bothPricedRaw.length,
    warnings,
    dataAsOf:          endDate,
    today,
    minIntersection:   MIN_INTERSECTION,
  })

  return {
    version:     1,
    recipe:      'monthly_market_report',
    project,
    generatedAt,
    dataAsOf:    endDate,
    methodology: {
      summary:
        `Market report constructed from daily_prices at the ${monthLabel} month boundaries (${startDate} and ${endDate}). Per-card raw-price % change computed for cards priced on both dates; the same for PSA 10 where both endpoints exist. Aggregate median, IQR, direction counts, and top-10 mover lists all derived from this intersection. No substitution of "last 30 days from today" if the requested month is not fully covered.`,
      filters: [
        { label: 'Start date',            value: startDate },
        { label: 'End date',              value: endDate },
        { label: 'Sample',                value: 'cards priced on BOTH dates (intersection)' },
        { label: 'Top-mover start-price gate', value: `>= $${TOP_MOVER_MIN_START_CENTS / CENTS_PER_USD}` },
      ],
      excludedGroups: [
        { label: 'start-only cards',   reason: `${startOnly.length} cards priced on ${startDate} but not on ${endDate}` },
        { label: 'end-only cards',     reason: `${endOnly.length} cards priced on ${endDate} but not on ${startDate}` },
        { label: 'penny start prices', reason: `top-mover ranking excludes cards with raw start < $${TOP_MOVER_MIN_START_CENTS / CENTS_PER_USD}` },
      ],
      dedupKey: 'card_slug (one row per card per date is enforced upstream by the pricing pipeline)',
    },
    verifiedFacts,
    derivedFindings,
    dataTables,
    internalSources,
    externalSources: [],
    internalLinks: [
      ...topRisersRows.slice(0, 5).filter(m => m.urlSlug).map(m => ({
        label: `${m.cardName} ${m.cardNumber ? '#' + m.cardNumber : ''} (${fmtSignedPct(m.pct!)})`,
        slug: m.urlSlug!, url: `https://www.pokeprices.io/set/${slugifySet(m.setName)}/card/${m.urlSlug}`,
      })),
    ],
    visualOpportunities: [
      'Histogram of monthly raw-price % change across the intersection sample',
      'Ranked table of the top 10 risers and top 10 fallers',
      'Set-level heatmap (would need set-level aggregation — currently a research gap)',
    ],
    warnings,
    researchGaps: gaps,
    rejectedClaims: [
      { claim: `The Pokémon market moved X% in ${monthLabel}.`,   reason: 'The sample is our tracked catalogue on daily_prices, not the entire Pokémon TCG market. Attribute movement to "cards tracked by PokePrices".' },
      { claim: `PSA 10 prices moved X% in ${monthLabel}.`,        reason: `Only ${bothPricedPsa10.length} cards have PSA 10 prices on both endpoints — not the full sample. Keep PSA 10 callouts anecdotal unless coverage grows.` },
      { claim: `Card X gained N,NNN% in ${monthLabel}.`,          reason: `Any card with a monthly move of >= ${QUARANTINE_ABS_PCT}% is quarantined for review. If the reviewer restores such a row it must ship with a data-provenance note explaining why the observation is trustworthy.` },
    ],
    notes: [],
    quarantinedRows,
    quality,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function auditEndpoint(supa: ReturnType<typeof getSupabaseServiceClient>, date: string): Promise<{ date: string; rowCount: number }> {
  const { count, error } = await supa.from('daily_prices')
    .select('card_slug', { count: 'exact', head: true })
    .eq('date', date)
  if (error) throw new Error(`monthly report: endpoint audit ${date} — ${error.message}`)
  return { date, rowCount: Number(count ?? 0) }
}

export function inferTargetMonth(title: string, today: string): { year: number; month: number } {
  // Look for "<Month> YYYY" in the title.
  const lower = title.toLowerCase()
  const now = new Date(today + 'T00:00:00Z')
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth()   // 0..11 — will be turned into prev month below by default
  const yearMatch = title.match(/(20\d{2})/)
  if (yearMatch) year = Number(yearMatch[1])
  for (let i = 0; i < 12; i++) {
    if (lower.includes(MONTH_NAMES[i].toLowerCase())) {
      month = i
      return { year, month: i + 1 }
    }
  }
  // Fall back to previous calendar month.
  const prev = new Date(Date.UTC(year, now.getUTCMonth() - 1, 1))
  return { year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 }
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function lastDayOfMonthIso(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0))
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}
function toPos(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
function round2(n: number): number { return Math.round(n * 100) / 100 }
function trimName(s: string): string { return s.replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim() }
function slugifySet(s: string): string { return String(s ?? '').trim().replace(/^Pokemon\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }
function fmtSignedPct(n: number | null): string {
  if (n == null) return 'n/a'
  const s = n.toFixed(1); return `${n >= 0 ? '+' : ''}${s}%`
}
function medianOf(xs: number[]): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a,b)=>a-b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2 }
function percentile(xs: number[], p: number): number { if (xs.length === 0) return 0; const s = xs.slice().sort((a,b)=>a-b); const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length))); return s[i] }

function computeQuality(inp: {
  intersection:    number
  warnings:        Warning[]
  dataAsOf:        string
  today:           string
  minIntersection: number
}): PackQuality {
  const daysOld = daysBetween(inp.dataAsOf, inp.today)
  const isStale = daysOld > 45   // report is stale if the target month ended > 45 days before today
  const critical = inp.warnings.some(w => w.severity === 'critical')
  const publishable = !critical && inp.intersection >= inp.minIntersection
  const reasons: string[] = []
  if (critical)                             reasons.push('One or more critical endpoint-coverage warnings must be resolved.')
  if (inp.intersection < inp.minIntersection) reasons.push(`Intersection of ${inp.intersection} cards is below the ${inp.minIntersection}-card publishability bar.`)
  if (isStale)                              reasons.push(`Target month ended ${daysOld} days ago — publish freshness is degraded.`)
  if (reasons.length === 0)                 reasons.push('All gates cleared.')
  const status: PackQuality['status'] =
      critical                                ? 'blocked'
    : inp.intersection < inp.minIntersection  ? 'blocked'
    : isStale                                 ? 'needs_review'
    : 'ok'
  const dataStrength: PackQuality['dataStrength'] =
      inp.intersection >= 40_000 ? 'strong'
    : inp.intersection >= 15_000 ? 'medium'
    : 'weak'
  return {
    status, dataStrength,
    sampleSize: inp.intersection,
    freshness: { asOf: inp.dataAsOf, daysOld, isStale },
    publishable, reasons,
  }
}
