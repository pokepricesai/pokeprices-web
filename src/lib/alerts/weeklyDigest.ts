// src/lib/alerts/weeklyDigest.ts
// Block 5A-W-14 — pure data builder for the weekly portfolio/watchlist
// digest. Reads the user's prefs, watchlist, portfolio_items, recent
// daily_prices, recent_sales and undelivered alert_events to produce a
// structured object an email-render block can later turn into HTML/text.
//
// SCOPE
//   * READ-ONLY. Never writes alert_events, never sends email, never
//     mutates anything in the database.
//   * Respects user_alert_preferences: a disabled master / disabled
//     weekly returns an early-out shape; per-section preferences omit
//     individual sections from the result.
//   * No new schema. Uses the same slug-resolution path as the
//     evaluator/delivery orchestrators:
//       watchlist.card_slug, portfolio_items.card_slug = URL slug
//       cards.card_url_slug                            = URL slug
//       cards.card_slug                                = bare numeric
//       daily_prices.card_slug                         = 'pc-' + bare
//       recent_sales.internal_card_slug                = bare
//
// CALLERS
//   None yet. A later block wires this into the admin preview surface
//   and (eventually) into an admin-triggered weekly send.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rowToPreferences,
  type UserAlertPreferences,
} from './preferences'
import type { AlertRule } from './preferences'
import {
  valuePortfolio,
  type ValuationPriceSource,
} from '../portfolioValuation'

// ─────────────────────────────────────────────────────────────────────
// Defaults + bounds
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_LOOKBACK_DAYS       = 7
const DEFAULT_MAX_PORTFOLIO_ITEMS = 5
const DEFAULT_MAX_WATCHLIST_ITEMS = 5
const DEFAULT_MAX_ALERT_ITEMS     = 5
// Daily-prices pull window — wider than the lookback so we still find a
// baseline row when scraping skipped the exact pre-lookback date.
const PRICE_FETCH_DAYS            = 14

// Block 5A-W-15B — minimum signed pct change for a card to be reported
// as a "Biggest riser" or "Biggest faller". Tiny moves (<1%) get
// rounded down to 0.0% in the email and produced misleading "Biggest
// riser · +0.0%" rows in the first real preview. Cards below this
// threshold can still surface IF they have meaningful recent sales —
// but they never claim a directional reason they don't deserve.
export const MIN_MEANINGFUL_PCT   = 1

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type WeeklyDigestStatus =
  | 'ok'
  | 'disabled_master'    // user_alert_preferences.enabled = false
  | 'disabled_weekly'    // weekly_digest_enabled = false

export type WeeklyDigestItemReason =
  | 'biggest_riser'
  | 'biggest_faller'
  | 'most_active'
  | 'new_sales_activity'

/** A single card line for the portfolio or watchlist section. All
 *  monetary values are CENTS; convert at the render layer. */
export type WeeklyDigestItem = {
  cardSlug:         string | null   // bare numeric — null when slug resolution failed
  cardName:         string | null
  setName:          string | null
  cardUrl:          string | null   // public PokePrices URL when resolvable
  currentCents:     number | null
  previousCents:    number | null
  pctChange:        number | null   // signed percent
  absChangeCents:   number | null   // signed
  recentSalesCount: number          // 0 when no sales in the window
  reason:           WeeklyDigestItemReason
}

export type WeeklyDigestPortfolioSection = {
  itemCount:          number         // total portfolio_items rows considered
  currentTotalCents:  number | null  // sum across items where price exists
  previousTotalCents: number | null
  absChangeCents:     number | null
  pctChange:          number | null
  topItems:           WeeklyDigestItem[]
}

export type WeeklyDigestWatchlistSection = {
  itemCount: number
  topItems:  WeeklyDigestItem[]
}

export type WeeklyDigestAlertCardBlock = {
  cardSlug:   string | null
  cardName:   string
  setName:    string
  cardUrl:    string | null
  eventCount: number
  severities: { high: number; normal: number; low: number }
  rules:      AlertRule[]
}

export type WeeklyDigestAlertSummary = {
  totalEvents: number
  cardBlocks:  WeeklyDigestAlertCardBlock[]
}

/** Block 5A-W-15B — how many portfolio_items rows resolved to each
 *  daily_prices column. `unknown_fallback` counts rows whose
 *  holding_type was missing / unrecognised — these all default to
 *  `raw_usd` (documented in priceColumnForHoldingType). Surfaced so an
 *  admin can spot a population that's silently relying on the fallback. */
export type PortfolioPriceBasisCounts = {
  raw_usd:          number
  psa9_usd:         number
  psa10_usd:        number
  unknown_fallback: number
}

export type WeeklyDigestDiagnostics = {
  portfolioCardsConsidered:     number
  watchlistCardsConsidered:     number
  cardsWithNoSlugResolution:    number
  cardsWithNoPriceData:         number
  cardsWithNoRecentSales:       number
  /** Per Block 5A-W-15B — count of which price column was used for
   *  each portfolio_items row. Empty zeroed object when the portfolio
   *  section was omitted by preferences or scope. */
  portfolioPriceBasisCounts:    PortfolioPriceBasisCounts
  /** Block 5A-W-16B — the currency the digest renderer will use.
   *  Mirrors `WeeklyDigestData.currency` and is echoed here so a
   *  diagnostics-only consumer (admin preview's JSON pane) sees the
   *  same value the email body will display. */
  displayCurrency:              DigestDisplayCurrency
  /** Block 5A-W-16C — money source for the portfolio total. Mirrors
   *  the dashboard's pipeline now: card_trends precedence for
   *  raw/psa9/psa10, daily_prices enrichment for extra tiers, manual
   *  override for manual-grade holdings. The previous-value baseline
   *  used for week-over-week pct still comes from daily_prices only —
   *  see `portfolioPreviousValueSource` for that. */
  portfolioValueSource:         'shared_valuation_helper'
  /** Block 5A-W-16C — money source for the WEEK-AGO baseline used in
   *  week-over-week pct. Always 'daily_prices_baseline' today because
   *  card_trends only stores current prices, not history. Surfaced so
   *  an admin can see the per-card pct may not exactly reconcile with
   *  the dashboard's pct_7d (which comes from card_trends). */
  portfolioPreviousValueSource: 'daily_prices_baseline'
  /** Block 5A-W-16C — per-source count of how each portfolio_items row
   *  resolved its market value. */
  portfolioValueSourceCounts:   Record<ValuationPriceSource, number>
  /** Block 5A-W-16D — observability for the regression where the
   *  portfolio section silently showed "No portfolio items yet" because
   *  loadPortfolioItems was selecting columns that don't exist on the
   *  table. Surfaces the row counts at each stage so an admin can spot
   *  any future drift without reading code. */
  portfolioPortfoliosLoaded:        number
  portfolioItemsLoaded:             number
  portfolioItemsMissingCardName:    number
  portfolioItemsValuedAsMissing:    number
  sectionsOmittedByPreferences: Array<'portfolio' | 'watchlist'>
  generatedAt:                  string
}

/** Block 5A-W-16B — user's preferred display currency. Mirrors
 *  user_email_preferences.display_currency (the column the portfolio
 *  dashboard reads at PortfolioDashboard.tsx). Default 'GBP' to match
 *  the dashboard's initial useState. */
export type DigestDisplayCurrency = 'GBP' | 'USD'

export type WeeklyDigestData = {
  status:       WeeklyDigestStatus
  asOf:         string
  lookbackDays: number
  /** Block 5A-W-16B — currency used to render ALL monetary fields in
   *  this digest. The data layer keeps values as USD-cents (matching
   *  what daily_prices.*_usd actually stores — those columns are
   *  CENTS despite the suffix); the renderer divides by 100 (USD) or
   *  ~127 (GBP at 1 USD ≈ 0.79 GBP) — same approximation the dashboard
   *  uses today at PortfolioDashboard.tsx:fmtBig. */
  currency:     DigestDisplayCurrency
  portfolio?:   WeeklyDigestPortfolioSection
  watchlist?:   WeeklyDigestWatchlistSection
  alertSummary: WeeklyDigestAlertSummary
  diagnostics:  WeeklyDigestDiagnostics
}

export type BuildWeeklyDigestOptions = {
  asOf?:              Date
  lookbackDays?:      number
  maxPortfolioItems?: number
  maxWatchlistItems?: number
  maxAlertItems?:     number
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────

/** Map portfolio_items.holding_type to the daily_prices column to read.
 *  Anything we don't recognise falls back to raw — documented choice
 *  because raw is the most universally populated field on scraped
 *  cards. */
export function priceColumnForHoldingType(holdingType: string | null | undefined): 'raw_usd' | 'psa9_usd' | 'psa10_usd' {
  return classifyPortfolioPriceBasis(holdingType).column
}

/** Block 5A-W-15B — like `priceColumnForHoldingType` but also reports
 *  WHY the column was chosen so we can populate the diagnostic
 *  bucket. Three explicit grade families resolve to dedicated
 *  columns; everything else (raw, manual, sealed, missing) collapses
 *  to `raw_usd` AND is tagged `unknown_fallback` so the admin can
 *  spot a population that's silently relying on the fallback. */
export function classifyPortfolioPriceBasis(
  holdingType: string | null | undefined,
): { column: 'raw_usd' | 'psa9_usd' | 'psa10_usd'; basis: keyof PortfolioPriceBasisCounts } {
  const ht = (holdingType ?? '').toLowerCase().trim()
  if (ht === 'psa10' || ht === 'cgc10' || ht === 'bgs10' || ht === 'sgc10') return { column: 'psa10_usd', basis: 'psa10_usd' }
  if (ht === 'psa9'  || ht === 'cgc9'  || ht === 'bgs9'  || ht === 'sgc9' ) return { column: 'psa9_usd',  basis: 'psa9_usd'  }
  if (ht === 'raw') return { column: 'raw_usd', basis: 'raw_usd' }
  // raw / sealed / manual / missing — same column, but DIFFERENT basis
  // so we can tell explicit-raw from fallback in diagnostics.
  return { column: 'raw_usd', basis: 'unknown_fallback' }
}

/** LEGACY (pre-5A-W-16B) helper retained only because its tests pin
 *  the conversion semantics. NEVER call this on a daily_prices column
 *  value — those columns are already minor units (USD-cents), so
 *  multiplying by 100 is the bug 5A-W-16B fixed. Kept exported so any
 *  external consumer relying on dollar→cent conversion stays working. */
export function usdToCents(usd: number | null | undefined): number | null {
  if (usd == null || !Number.isFinite(usd)) return null
  return Math.round(Number(usd) * 100)
}

/** Block 5A-W-16B — pull a USD-cents value from a daily_prices row
 *  column. The columns named `*_usd` actually store CENTS (see
 *  PortfolioDashboard.tsx fmtBig + every other reader in the
 *  codebase). This helper just normalises the value and returns it
 *  as-is so the rest of the digest math operates on cents. */
export function dailyPriceCentsFromColumn(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(Number(value))
}

/** Compute signed percent change from prev to current. Returns null
 *  when either is missing or the base is non-positive. */
export function pctChange(prev: number | null, current: number | null): number | null {
  if (prev == null || current == null) return null
  if (!Number.isFinite(prev) || !Number.isFinite(current)) return null
  if (prev <= 0) return null
  return ((current - prev) / prev) * 100
}

function isoDateMinusDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function clampPositiveInt(n: number | undefined, def: number, hardMax: number): number {
  if (n == null || !Number.isFinite(n)) return def
  const i = Math.floor(n)
  if (i <= 0) return def
  return Math.min(i, hardMax)
}

/** Internal: per-card aggregate built from the raw data — fed to the
 *  scoring + selection step. Exported only for tests. */
export type ScoredCard = {
  source:           'portfolio' | 'watchlist'
  urlSlug:          string
  cardSlug:         string | null
  cardName:         string | null
  setName:          string | null
  cardUrl:          string | null
  currentCents:     number | null
  previousCents:    number | null
  pctChange:        number | null
  absChangeCents:   number | null
  recentSalesCount: number
  quantity:         number      // 1 for watchlist; portfolio items use real quantity
}

/** Pick the top N items for a section. Updated in Block 5A-W-15B to
 *  stop labelling weak/no-change items as "Biggest riser/faller".
 *
 *  Ranking:
 *    1. Biggest riser  — pctChange ≥ +MIN_MEANINGFUL_PCT, by max pct
 *    2. Biggest faller — pctChange ≤ -MIN_MEANINGFUL_PCT, by min pct
 *    3. Most active    — recentSalesCount > 0, by max count, |pct|
 *    4. Fill remaining slots with meaningful movers by |pct|, tagged
 *       directionally (riser/faller) — only when the card is BOTH a
 *       meaningful mover AND not yet picked. No padding with weak
 *       items: cards below the threshold that also have no sales are
 *       EXCLUDED, even if that means the section shows fewer than max.
 *    5. Final pass: sales-only / sales-with-tiny-move cards get the
 *       'new_sales_activity' label.
 *
 *  Pure — exported for tests. */
export function selectTopItems(cards: ScoredCard[], max: number): WeeklyDigestItem[] {
  const picks: Array<{ card: ScoredCard; reason: WeeklyDigestItemReason }> = []
  const taken = new Set<string>()
  function take(card: ScoredCard | null | undefined, reason: WeeklyDigestItemReason) {
    if (!card || picks.length >= max) return
    if (taken.has(card.urlSlug)) return
    taken.add(card.urlSlug)
    picks.push({ card, reason })
  }

  const isPositiveMover = (c: ScoredCard) => c.pctChange != null && c.pctChange >=  MIN_MEANINGFUL_PCT
  const isNegativeMover = (c: ScoredCard) => c.pctChange != null && c.pctChange <= -MIN_MEANINGFUL_PCT
  const isMeaningfulMover = (c: ScoredCard) => isPositiveMover(c) || isNegativeMover(c)
  const hasSales        = (c: ScoredCard) => c.recentSalesCount > 0

  // 1. Biggest riser
  const risers = cards.filter(isPositiveMover)
    .sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))
  take(risers[0], 'biggest_riser')

  // 2. Biggest faller
  const fallers = cards.filter(isNegativeMover)
    .sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0))
  take(fallers[0], 'biggest_faller')

  // 3. Most active
  const active = cards.filter(hasSales)
    .sort((a, b) =>
      (b.recentSalesCount - a.recentSalesCount) ||
      Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0)
    )
  take(active[0], 'most_active')

  // 4. Fill — meaningful movers by |pct|. Each survivor keeps its
  //    DIRECTIONAL label; no card with |pct| < MIN_MEANINGFUL_PCT
  //    ever lands here, so "Biggest riser · +0.0%" cannot happen.
  if (picks.length < max) {
    const byMagnitude = cards
      .filter(isMeaningfulMover)
      .sort((a, b) =>
        Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0) ||
        (b.recentSalesCount - a.recentSalesCount)
      )
    for (const c of byMagnitude) {
      if (picks.length >= max) break
      const reason: WeeklyDigestItemReason =
        hasSales(c)              ? 'most_active'
        : (c.pctChange ?? 0) > 0 ? 'biggest_riser'
        :                          'biggest_faller'
      take(c, reason)
    }
  }

  // 5. Final pass — sales-only cards (no pct OR sub-threshold pct).
  //    These cards have NO meaningful directional move, so they get
  //    the activity label. Sorted by sales count desc.
  if (picks.length < max) {
    const salesOnly = cards
      .filter(c => hasSales(c) && !isMeaningfulMover(c))
      .sort((a, b) => b.recentSalesCount - a.recentSalesCount)
    for (const c of salesOnly) {
      if (picks.length >= max) break
      take(c, 'new_sales_activity')
    }
  }

  // NOTE: deliberately no "directional fallback" pass any more.
  // A 0.0% card with no sales is NOT a key change of the week and
  // we'd rather show 4 items than 5 with a misleading row.

  return picks.map(({ card, reason }) => ({
    cardSlug:         card.cardSlug,
    cardName:         card.cardName,
    setName:          card.setName,
    cardUrl:          card.cardUrl,
    currentCents:     card.currentCents,
    previousCents:    card.previousCents,
    pctChange:        card.pctChange,
    absChangeCents:   card.absChangeCents,
    recentSalesCount: card.recentSalesCount,
    reason,
  }))
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

export async function buildWeeklyDigestForUser(
  supa:   SupabaseClient,
  userId: string,
  opts:   BuildWeeklyDigestOptions = {},
): Promise<WeeklyDigestData> {
  const asOf              = opts.asOf ?? new Date()
  const lookbackDays      = clampPositiveInt(opts.lookbackDays,      DEFAULT_LOOKBACK_DAYS,       90)
  const maxPortfolioItems = clampPositiveInt(opts.maxPortfolioItems, DEFAULT_MAX_PORTFOLIO_ITEMS, 50)
  const maxWatchlistItems = clampPositiveInt(opts.maxWatchlistItems, DEFAULT_MAX_WATCHLIST_ITEMS, 50)
  const maxAlertItems     = clampPositiveInt(opts.maxAlertItems,     DEFAULT_MAX_ALERT_ITEMS,     50)
  const generatedAt       = asOf.toISOString()

  const emptyAlerts: WeeklyDigestAlertSummary = { totalEvents: 0, cardBlocks: [] }

  // 1. Load + decode preferences. Disabled = early-out, no DB reads
  //    beyond the prefs + display currency lookup.
  const prefs    = await loadPrefs(supa, userId)
  const currency = await loadDisplayCurrency(supa, userId)
  if (!prefs.enabled) {
    return {
      status:       'disabled_master',
      asOf:         generatedAt,
      lookbackDays,
      currency,
      alertSummary: emptyAlerts,
      diagnostics:  emptyDiagnostics(generatedAt, currency),
    }
  }
  if (!prefs.weeklyDigestEnabled) {
    return {
      status:       'disabled_weekly',
      asOf:         generatedAt,
      lookbackDays,
      currency,
      alertSummary: emptyAlerts,
      diagnostics:  emptyDiagnostics(generatedAt, currency),
    }
  }

  // 2. Decide which sections to build. Honour per-section toggles AND
  //    scope toggles. The brief asks the section to be OMITTED when
  //    weekly_overview_*_enabled is false; scope toggles still gate
  //    what cards we evaluate.
  const wantPortfolio = prefs.weeklyOverviewPortfolioEnabled && prefs.scopePortfolio
  const wantWatchlist = prefs.weeklyOverviewWatchlistEnabled && prefs.scopeWatchlist
  const sectionsOmittedByPreferences: Array<'portfolio' | 'watchlist'> = []
  if (!prefs.weeklyOverviewPortfolioEnabled) sectionsOmittedByPreferences.push('portfolio')
  if (!prefs.weeklyOverviewWatchlistEnabled) sectionsOmittedByPreferences.push('watchlist')

  // 3. Load source lists in parallel.
  const [portfolioResult, watchlistRaw] = await Promise.all([
    wantPortfolio
      ? loadPortfolioItems(supa, userId)
      : Promise.resolve({ rows: [] as PortRow[], portfoliosLoaded: 0 }),
    wantWatchlist ? loadWatchlist(supa, userId)      : Promise.resolve([] as WatchRow[]),
  ])
  const portfolioRaw     = portfolioResult.rows
  const portfoliosLoaded = portfolioResult.portfoliosLoaded

  // 4. Resolve URL slugs → bare numeric + display fields via cards.
  const urlSlugs = uniq([
    ...portfolioRaw.map(r => r.card_slug),
    ...watchlistRaw.map(r => r.card_slug),
  ])
  const urlToCard = await loadCardDetailsByUrlSlug(supa, urlSlugs)

  // Track resolution failures by unique URL slug.
  let cardsWithNoSlugResolution = 0
  for (const u of urlSlugs) {
    if (!urlToCard.has(u)) cardsWithNoSlugResolution++
  }

  // 5. Pull daily_prices + recent_sales counts for ALL resolved bare slugs.
  const bareSlugs = Array.from(new Set(Array.from(urlToCard.values()).map(c => c.cardSlug)))
  const [priceIndex, salesIndex] = await Promise.all([
    loadPriceIndex(supa, bareSlugs, asOf),
    loadRecentSalesCounts(supa, bareSlugs, asOf, lookbackDays),
  ])

  // Track price / sales gaps.
  let cardsWithNoPriceData   = 0
  let cardsWithNoRecentSales = 0
  for (const bare of bareSlugs) {
    if (!priceIndex.has(bare)) cardsWithNoPriceData++
    if (!salesIndex.has(bare)) cardsWithNoRecentSales++
  }

  // 6. Score portfolio cards.
  //    Block 5A-W-16C: current values + headline total now come from
  //    the SHARED valuePortfolio() helper, which mirrors the dashboard
  //    pipeline (card_trends → daily_prices enrichment → manual).
  //    Previous values for the week-over-week pct still come from
  //    daily_prices baseline reads — card_trends only stores current
  //    prices, so we can't compute a full dashboard-style previous.
  //    The two source-mismatches are surfaced in diagnostics
  //    (portfolioValueSource vs portfolioPreviousValueSource).
  let portfolioSection: WeeklyDigestPortfolioSection | undefined
  const portfolioPriceBasisCounts: PortfolioPriceBasisCounts = {
    raw_usd: 0, psa9_usd: 0, psa10_usd: 0, unknown_fallback: 0,
  }
  let portfolioValueSourceCounts = { card_trends: 0, daily_prices: 0, manual: 0, missing: 0 }
  if (wantPortfolio) {
    // (a) shared valuation — produces dashboard-aligned per-card +
    //     headline market value. Map keyed by row.card_slug (URL slug)
    //     so each portfolio_items row lines up to its valued item.
    const valuation = await valuePortfolio(supa, portfolioRaw.map(r => ({
      id:                 r.user_id + '|' + r.card_slug + '|' + (r.holding_type ?? ''),
      card_slug:          r.card_slug,
      card_name:          r.card_name,
      set_name:           r.set_name,
      holding_type:       r.holding_type,
      quantity:           r.quantity,
      manual_value_cents: r.manual_value_cents,
    })))
    portfolioValueSourceCounts = valuation.sourceCounts

    const scored: ScoredCard[] = []
    let previousTotal: number | null = null

    for (let i = 0; i < portfolioRaw.length; i++) {
      const row    = portfolioRaw[i]
      const valued = valuation.items[i]
      const card = urlToCard.get(row.card_slug)
      const bare = card?.cardSlug ?? null
      // Block 5A-W-16B — portfolio_items.card_name wins over cards-row
      // lookup so a slug-collision can't relabel the user's holding.
      const display = {
        cardSlug: bare,
        cardName: row.card_name ?? card?.cardName ?? null,
        setName:  row.set_name  ?? card?.setName  ?? null,
        cardUrl:  card?.setName && card?.cardUrlSlug
          ? `https://www.pokeprices.io/set/${encodeURIComponent(card.setName)}/card/${card.cardUrlSlug}`
          : null,
      }

      // Baseline (week-ago) value — still from daily_prices because
      // card_trends doesn't carry history. Same column the dashboard's
      // enrichment would have used.
      const basis  = classifyPortfolioPriceBasis(row.holding_type)
      portfolioPriceBasisCounts[basis.basis] += 1
      const pair   = bare ? findPricePair(priceIndex.get(bare) ?? [], asOf, lookbackDays) : null
      const prvCts = pair ? dailyPriceCentsFromColumn(pair.baseline[basis.column] ?? null) : null
      const qty    = Math.max(1, Math.floor(row.quantity ?? 1))

      // Use the shared helper's per-card EFFECTIVE value (manual
      // override applied) for the displayed top-item amount. Use its
      // position value for the headline total.
      const curCts      = valued.effectiveValueCents
      const posCurrent  = valued.positionValueCents
      const posPrevious = prvCts != null ? prvCts * qty : null
      if (posPrevious != null) previousTotal = (previousTotal ?? 0) + posPrevious

      scored.push({
        source:           'portfolio',
        urlSlug:          row.card_slug,
        cardSlug:         display.cardSlug,
        cardName:         display.cardName,
        setName:          display.setName,
        cardUrl:          display.cardUrl,
        // For the displayed top-card amount we want per-card cents
        // (NOT position), so the user sees the same per-card value as
        // their dashboard row. Sample-data renderer treats currentCents
        // as per-position; keep parity with renderer expectations by
        // putting POSITION value on currentCents (since this is the
        // sum of all the user's copies of this card).
        currentCents:     posCurrent,
        previousCents:    posPrevious,
        // Per-card pct: compare per-unit current vs per-unit previous.
        // Using EFFECTIVE per-card value (manual override applied) for
        // current; baseline daily_prices per-unit for previous.
        pctChange:        pctChange(prvCts, curCts),
        absChangeCents:   (posCurrent != null && posPrevious != null) ? (posCurrent - posPrevious) : null,
        recentSalesCount: bare ? (salesIndex.get(bare) ?? 0) : 0,
        quantity:         qty,
      })
    }

    // Headline total comes from the helper (mirrors dashboard's
    // recomputedTotal which uses position_value_cents — manual-only
    // holdings contribute 0). Treat 0 as null when EVERY holding is
    // missing market data, otherwise expose the real sum.
    const currentTotal = valuation.marketTotalCents > 0 || valuation.sourceCounts.card_trends + valuation.sourceCounts.daily_prices > 0
      ? valuation.marketTotalCents
      : null
    const absChange = (currentTotal != null && previousTotal != null) ? (currentTotal - previousTotal) : null
    portfolioSection = {
      itemCount:          portfolioRaw.length,
      currentTotalCents:  currentTotal,
      previousTotalCents: previousTotal,
      absChangeCents:     absChange,
      pctChange:          pctChange(previousTotal, currentTotal),
      topItems:           selectTopItems(scored, maxPortfolioItems),
    }
  }

  // 7. Score watchlist cards. No quantity; price comparison uses raw.
  let watchlistSection: WeeklyDigestWatchlistSection | undefined
  if (wantWatchlist) {
    const scored: ScoredCard[] = []
    for (const row of watchlistRaw) {
      const card = urlToCard.get(row.card_slug)
      const bare = card?.cardSlug ?? null
      const display = {
        cardSlug: bare,
        cardName: card?.cardName ?? row.card_name ?? null,
        setName:  card?.setName  ?? row.set_name  ?? null,
        cardUrl:  (card?.setName && card?.cardUrlSlug)
          ? `https://www.pokeprices.io/set/${encodeURIComponent(card.setName)}/card/${card.cardUrlSlug}`
          : null,
      }
      const pair   = bare ? findPricePair(priceIndex.get(bare) ?? [], asOf, lookbackDays) : null
      // Block 5A-W-16B — see note in portfolio loop. raw_usd is CENTS.
      const curCts = pair ? dailyPriceCentsFromColumn(pair.latest.raw_usd   ?? null) : null
      const prvCts = pair ? dailyPriceCentsFromColumn(pair.baseline.raw_usd ?? null) : null
      scored.push({
        source:           'watchlist',
        urlSlug:          row.card_slug,
        cardSlug:         display.cardSlug,
        cardName:         display.cardName,
        setName:          display.setName,
        cardUrl:          display.cardUrl,
        currentCents:     curCts,
        previousCents:    prvCts,
        pctChange:        pctChange(prvCts, curCts),
        absChangeCents:   (curCts != null && prvCts != null) ? (curCts - prvCts) : null,
        recentSalesCount: bare ? (salesIndex.get(bare) ?? 0) : 0,
        quantity:         1,
      })
    }
    watchlistSection = {
      itemCount: watchlistRaw.length,
      topItems:  selectTopItems(scored, maxWatchlistItems),
    }
  }

  // 8. Alert summary — events for the user in the lookback window.
  //    READ-ONLY. We do NOT mutate alert_events.delivered_at.
  const alertSummary = await buildAlertSummary(supa, userId, asOf, lookbackDays, maxAlertItems, urlToCard)

  // 9. Diagnostics — counts are over the union of considered cards.
  const portfolioCardsConsidered = portfolioRaw.length
  const watchlistCardsConsidered = watchlistRaw.length

  return {
    status:       'ok',
    asOf:         generatedAt,
    lookbackDays,
    ...(portfolioSection ? { portfolio: portfolioSection } : {}),
    ...(watchlistSection ? { watchlist: watchlistSection } : {}),
    alertSummary,
    currency,
    diagnostics: {
      portfolioCardsConsidered,
      watchlistCardsConsidered,
      cardsWithNoSlugResolution,
      cardsWithNoPriceData,
      cardsWithNoRecentSales,
      portfolioPriceBasisCounts,
      displayCurrency:              currency,
      portfolioValueSource:         'shared_valuation_helper',
      portfolioPreviousValueSource: 'daily_prices_baseline',
      portfolioValueSourceCounts,
      // Block 5A-W-16D observability
      portfolioPortfoliosLoaded:        portfoliosLoaded,
      portfolioItemsLoaded:             portfolioRaw.length,
      portfolioItemsMissingCardName:    portfolioRaw.filter(r => !r.card_name || !r.set_name).length,
      portfolioItemsValuedAsMissing:    portfolioValueSourceCounts.missing,
      sectionsOmittedByPreferences,
      generatedAt,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing
// ─────────────────────────────────────────────────────────────────────

type PortRow  = {
  user_id:            string
  card_slug:          string
  holding_type:       string | null
  quantity:           number | null
  card_name:          string | null
  set_name:           string | null
  /** Block 5A-W-16C — per-holding manual value override (USD-cents).
   *  Used by the shared valuation helper for manual-grade holdings. */
  manual_value_cents: number | null
}

type WatchRow = {
  user_id:    string
  card_slug:  string
  card_name:  string | null
  set_name:   string | null
}

type PriceRow = {
  date:       string
  raw_usd:    number | null
  psa9_usd:   number | null
  psa10_usd:  number | null
}

type CardDetails = {
  cardSlug:    string   // bare numeric
  cardName:    string | null
  setName:     string | null
  cardUrlSlug: string   // == the URL slug we looked up by
}

async function loadPrefs(supa: SupabaseClient, userId: string): Promise<UserAlertPreferences> {
  try {
    const { data, error } = await supa
      .from('user_alert_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) {
      // Empty row → defaults (consistent with loadUserAlertPreferences
      // in preferences.ts: a new user has the digest enabled).
      return rowToPreferences(null)
    }
    return rowToPreferences(data as Record<string, unknown>)
  } catch {
    return rowToPreferences(null)
  }
}

type PortfolioLoadResult = {
  rows:               PortRow[]
  portfoliosLoaded:   number
}

async function loadPortfolioItems(supa: SupabaseClient, userId: string): Promise<PortfolioLoadResult> {
  // Mirror the evaluator's two-step lookup: user → portfolios → items.
  const { data: portfolios, error: pErr } = await supa
    .from('portfolios')
    .select('id, user_id')
    .eq('user_id', userId)
  if (pErr || !Array.isArray(portfolios) || portfolios.length === 0) {
    return { rows: [], portfoliosLoaded: 0 }
  }
  const portfolioIds = portfolios.map(r => String((r as Record<string, unknown>).id))
  const idToUser     = new Map<string, string>()
  for (const r of portfolios as Array<Record<string, unknown>>) idToUser.set(String(r.id), String(r.user_id))

  // Block 5A-W-16D — the production portfolio_items schema uses the
  // `*_snapshot` suffix for denormalised card display fields (see the
  // upsert payload in PortfolioDashboard.tsx::handleAddCard, where
  // card_name_snapshot / set_name_snapshot / image_url_snapshot are
  // the column names written). My Block 5A-W-16B/16C selects on
  // `card_name` / `set_name` were targeting columns that simply
  // do not exist on this table — PostgREST 400s the whole query and
  // we returned an empty array, which the renderer mistook for a
  // user with no portfolio at all.
  //
  // This loader now SELECTS the snapshot columns AND defensively
  // falls back through two narrower queries so a future schema
  // change can't silently disable the digest again.
  let items: Array<Record<string, unknown>> = []
  type Attempt = { name: string; columns: string }
  const attempts: Attempt[] = [
    { name: 'snapshot+manual', columns: 'portfolio_id, card_slug, holding_type, quantity, manual_value_cents, card_name_snapshot, set_name_snapshot' },
    { name: 'snapshot',        columns: 'portfolio_id, card_slug, holding_type, quantity, card_name_snapshot, set_name_snapshot' },
    { name: 'core+manual',     columns: 'portfolio_id, card_slug, holding_type, quantity, manual_value_cents' },
    { name: 'core',            columns: 'portfolio_id, card_slug, holding_type, quantity' },
  ]
  for (const a of attempts) {
    const { data, error } = await supa
      .from('portfolio_items')
      .select(a.columns)
      .in('portfolio_id', portfolioIds)
    if (!error && Array.isArray(data)) {
      items = data as unknown as Array<Record<string, unknown>>
      break
    }
  }

  const rows = items.map(r => {
    // Prefer the snapshot columns the dashboard's upsert actually
    // writes. Anything else from the row stays as-is so a future
    // migration that adds a non-snapshot column doesn't need a code
    // change to be picked up.
    const snapshotName = r.card_name_snapshot
    const snapshotSet  = r.set_name_snapshot
    const fallbackName = (r as Record<string, unknown>).card_name
    const fallbackSet  = (r as Record<string, unknown>).set_name
    const cardName = snapshotName ?? fallbackName ?? null
    const setName  = snapshotSet  ?? fallbackSet  ?? null
    return {
      user_id:            idToUser.get(String(r.portfolio_id)) ?? userId,
      card_slug:          String(r.card_slug ?? ''),
      holding_type:       r.holding_type == null ? null : String(r.holding_type),
      quantity:           r.quantity     == null ? 1    : Math.max(1, Math.floor(Number(r.quantity) || 1)),
      card_name:          cardName == null ? null : String(cardName),
      set_name:           setName  == null ? null : String(setName),
      manual_value_cents: r.manual_value_cents == null || !Number.isFinite(Number(r.manual_value_cents))
                            ? null
                            : Math.round(Number(r.manual_value_cents)),
    }
  }).filter(r => r.card_slug)
  return { rows, portfoliosLoaded: portfolios.length }
}

/** Block 5A-W-16B — read the user's preferred display currency from
 *  user_email_preferences. Defaults to GBP (matches the portfolio
 *  dashboard's initial useState). Defensive: if the table or column
 *  doesn't exist on this environment, falls back to GBP rather than
 *  throwing — the digest must always render. */
async function loadDisplayCurrency(supa: SupabaseClient, userId: string): Promise<DigestDisplayCurrency> {
  try {
    const { data, error } = await supa
      .from('user_email_preferences')
      .select('display_currency')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return 'GBP'
    const raw = (data as Record<string, unknown>).display_currency
    if (raw === 'USD' || raw === 'GBP') return raw
    return 'GBP'
  } catch {
    return 'GBP'
  }
}

async function loadWatchlist(supa: SupabaseClient, userId: string): Promise<WatchRow[]> {
  const { data, error } = await supa
    .from('watchlist')
    .select('user_id, card_slug, card_name, set_name')
    .eq('user_id', userId)
  if (error || !Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map(r => ({
    user_id:   String(r.user_id ?? userId),
    card_slug: String(r.card_slug ?? ''),
    card_name: r.card_name == null ? null : String(r.card_name),
    set_name:  r.set_name  == null ? null : String(r.set_name),
  })).filter(r => r.card_slug)
}

async function loadCardDetailsByUrlSlug(
  supa:     SupabaseClient,
  urlSlugs: string[],
): Promise<Map<string, CardDetails>> {
  const out = new Map<string, CardDetails>()
  if (urlSlugs.length === 0) return out
  const { data, error } = await supa
    .from('cards')
    .select('card_url_slug, card_slug, card_name, set_name')
    .in('card_url_slug', urlSlugs)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const url  = r.card_url_slug == null ? '' : String(r.card_url_slug)
    const bare = r.card_slug     == null ? '' : String(r.card_slug)
    if (url && bare) {
      out.set(url, {
        cardSlug:    bare,
        cardName:    r.card_name == null ? null : String(r.card_name),
        setName:     r.set_name  == null ? null : String(r.set_name),
        cardUrlSlug: url,
      })
    }
  }
  return out
}

async function loadPriceIndex(
  supa:      SupabaseClient,
  bareSlugs: string[],
  asOf:      Date,
): Promise<Map<string, PriceRow[]>> {
  const out = new Map<string, PriceRow[]>()
  if (bareSlugs.length === 0) return out
  const prefixed = bareSlugs.map(s => 'pc-' + s)
  const sinceIso = isoDateMinusDays(asOf.toISOString().slice(0, 10), PRICE_FETCH_DAYS)
  const { data, error } = await supa
    .from('daily_prices')
    .select('card_slug, date, raw_usd, psa9_usd, psa10_usd')
    .in('card_slug', prefixed)
    .gte('date', sinceIso)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const prefixedSlug = String(r.card_slug ?? '')
    const bare         = prefixedSlug.replace(/^pc-/, '')
    if (!bare) continue
    let list = out.get(bare)
    if (!list) { list = []; out.set(bare, list) }
    list.push({
      date:       String(r.date),
      raw_usd:    r.raw_usd   == null ? null : Number(r.raw_usd),
      psa9_usd:   r.psa9_usd  == null ? null : Number(r.psa9_usd),
      psa10_usd:  r.psa10_usd == null ? null : Number(r.psa10_usd),
    })
  }
  return out
}

async function loadRecentSalesCounts(
  supa:       SupabaseClient,
  bareSlugs:  string[],
  asOf:       Date,
  windowDays: number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (bareSlugs.length === 0) return out
  const sinceIso = isoDateMinusDays(asOf.toISOString().slice(0, 10), windowDays)
  const { data, error } = await supa
    .from('recent_sales')
    .select('internal_card_slug, sale_date')
    .eq('parse_status',  'ok')
    .eq('review_status', 'active')
    .in('internal_card_slug', bareSlugs)
    .gte('sale_date', sinceIso)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const slug = String(r.internal_card_slug ?? '')
    if (!slug) continue
    out.set(slug, (out.get(slug) ?? 0) + 1)
  }
  return out
}

async function buildAlertSummary(
  supa:          SupabaseClient,
  userId:        string,
  asOf:          Date,
  lookbackDays:  number,
  maxAlertItems: number,
  urlToCard:     Map<string, CardDetails>,
): Promise<WeeklyDigestAlertSummary> {
  const sinceIso = new Date(asOf.getTime() - lookbackDays * 86_400_000).toISOString()
  const { data, error } = await supa
    .from('alert_events')
    .select('id, card_slug, card_name, set_name, rule, severity, detected_at')
    .eq('user_id', userId)
    .gte('detected_at', sinceIso)
    .order('detected_at', { ascending: false })
  if (error || !Array.isArray(data) || data.length === 0) {
    return { totalEvents: 0, cardBlocks: [] }
  }

  type AlertRow = {
    id: string; card_slug: string; card_name: string | null; set_name: string | null
    rule: AlertRule; severity: 'low'|'normal'|'high'; detected_at: string
  }
  const rows: AlertRow[] = (data as Array<Record<string, unknown>>).map(r => ({
    id:          String(r.id ?? ''),
    card_slug:   String(r.card_slug ?? ''),
    card_name:   r.card_name == null ? null : String(r.card_name),
    set_name:    r.set_name  == null ? null : String(r.set_name),
    rule:        String(r.rule) as AlertRule,
    severity:   (String(r.severity) as 'low'|'normal'|'high') || 'normal',
    detected_at: String(r.detected_at),
  }))

  // Reverse-lookup cards.card_url_slug from the bare card_slug stored
  // on alert_events. Built from the urlToCard map we already loaded
  // for the portfolio/watchlist sections.
  const bareToUrlCard = new Map<string, CardDetails>()
  for (const c of Array.from(urlToCard.values())) bareToUrlCard.set(c.cardSlug, c)

  // Group by card_slug (bare). Falls back to a name|set key when slug
  // is missing — same fallback as emailDigest.groupEventsByCard.
  const blocks = new Map<string, WeeklyDigestAlertCardBlock & { _score: number }>()
  for (const r of rows) {
    const key = r.card_slug ? `slug:${r.card_slug}` : `name:${r.card_name ?? ''}|${r.set_name ?? ''}`
    const lookup = r.card_slug ? bareToUrlCard.get(r.card_slug) : undefined
    const cardUrl = (lookup?.setName && lookup?.cardUrlSlug)
      ? `https://www.pokeprices.io/set/${encodeURIComponent(lookup.setName)}/card/${lookup.cardUrlSlug}`
      : null
    let block = blocks.get(key)
    if (!block) {
      block = {
        cardSlug:   r.card_slug || null,
        cardName:   r.card_name ?? lookup?.cardName ?? '(unknown)',
        setName:    r.set_name  ?? lookup?.setName  ?? '',
        cardUrl,
        eventCount: 0,
        severities: { high: 0, normal: 0, low: 0 },
        rules:      [],
        _score:     0,
      }
      blocks.set(key, block)
    }
    block.eventCount += 1
    block.severities[r.severity] = (block.severities[r.severity] ?? 0) + 1
    if (!block.rules.includes(r.rule)) block.rules.push(r.rule)
    block._score += r.severity === 'high' ? 3 : r.severity === 'normal' ? 2 : 1
  }

  const sorted = Array.from(blocks.values()).sort((a, b) => b._score - a._score)
  const cardBlocks = sorted.slice(0, maxAlertItems).map(({ _score, ...rest }) => {
    void _score
    return rest
  })
  return { totalEvents: rows.length, cardBlocks }
}

// ─────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)))
}

/** Pick the newest in-window row as "latest" and the closest row at or
 *  before (latest.date - lookback) as "baseline". Robust to missing
 *  exact dates — walks back through the available rows. */
function findPricePair(rows: PriceRow[], asOf: Date, lookbackDays: number): { latest: PriceRow; baseline: PriceRow } | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const asOfDay = asOf.toISOString().slice(0, 10)
  // Latest = the freshest row at or before asOf.
  let latest: PriceRow | null = null
  for (let i = asc.length - 1; i >= 0; i--) {
    if (asc[i].date <= asOfDay) { latest = asc[i]; break }
  }
  if (!latest) return null
  const cutoff = isoDateMinusDays(latest.date, lookbackDays)
  // Baseline = freshest row at or before cutoff. If none, fall back to
  // the OLDEST row we have — better to compare against a 5-day-old
  // price than to report null when we have SOME baseline.
  for (let i = asc.length - 1; i >= 0; i--) {
    if (asc[i].date <= cutoff && asc[i] !== latest) return { latest, baseline: asc[i] }
  }
  if (asc[0] !== latest) return { latest, baseline: asc[0] }
  return null
}

function emptyDiagnostics(generatedAt: string, currency: DigestDisplayCurrency = 'GBP'): WeeklyDigestDiagnostics {
  return {
    portfolioCardsConsidered:    0,
    watchlistCardsConsidered:    0,
    cardsWithNoSlugResolution:   0,
    cardsWithNoPriceData:        0,
    cardsWithNoRecentSales:      0,
    portfolioPriceBasisCounts:   { raw_usd: 0, psa9_usd: 0, psa10_usd: 0, unknown_fallback: 0 },
    displayCurrency:             currency,
    portfolioValueSource:        'shared_valuation_helper',
    portfolioPreviousValueSource:'daily_prices_baseline',
    portfolioValueSourceCounts:  { card_trends: 0, daily_prices: 0, manual: 0, missing: 0 },
    portfolioPortfoliosLoaded:        0,
    portfolioItemsLoaded:             0,
    portfolioItemsMissingCardName:    0,
    portfolioItemsValuedAsMissing:    0,
    sectionsOmittedByPreferences: [],
    generatedAt,
  }
}
