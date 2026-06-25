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

export type WeeklyDigestDiagnostics = {
  portfolioCardsConsidered:     number
  watchlistCardsConsidered:     number
  cardsWithNoSlugResolution:    number
  cardsWithNoPriceData:         number
  cardsWithNoRecentSales:       number
  sectionsOmittedByPreferences: Array<'portfolio' | 'watchlist'>
  generatedAt:                  string
}

export type WeeklyDigestData = {
  status:       WeeklyDigestStatus
  asOf:         string
  lookbackDays: number
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
  const ht = (holdingType ?? '').toLowerCase()
  if (ht === 'psa10' || ht === 'cgc10' || ht === 'bgs10' || ht === 'sgc10') return 'psa10_usd'
  if (ht === 'psa9'  || ht === 'cgc9'  || ht === 'bgs9'  || ht === 'sgc9' ) return 'psa9_usd'
  return 'raw_usd'   // raw, manual, sealed, unknown — all fall through here
}

/** Convert a USD price (whatever scale daily_prices uses) to cents.
 *  daily_prices columns are stored as numeric DOLLARS, so multiplying
 *  by 100 yields cents. */
export function usdToCents(usd: number | null | undefined): number | null {
  if (usd == null || !Number.isFinite(usd)) return null
  return Math.round(Number(usd) * 100)
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

/** Pick the top N items for a section, applying the documented
 *  ranking rule:
 *    1. biggest riser (pctChange > 0, by max pct)
 *    2. biggest faller (pctChange < 0, by min pct)
 *    3. most active (recentSalesCount > 0, by max count)
 *    4. fill remaining slots with the largest |pctChange| not yet
 *       picked; ties broken by recentSalesCount desc.
 *  Each survivor is tagged with the reason it was picked, so the
 *  renderer can show "Biggest riser" etc. next to the card.
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

  // 1. Biggest riser
  const risers = cards.filter(c => c.pctChange != null && c.pctChange > 0)
    .sort((a, b) => (b.pctChange ?? 0) - (a.pctChange ?? 0))
  take(risers[0], 'biggest_riser')

  // 2. Biggest faller
  const fallers = cards.filter(c => c.pctChange != null && c.pctChange < 0)
    .sort((a, b) => (a.pctChange ?? 0) - (b.pctChange ?? 0))
  take(fallers[0], 'biggest_faller')

  // 3. Most active
  const active = cards.filter(c => c.recentSalesCount > 0)
    .sort((a, b) =>
      (b.recentSalesCount - a.recentSalesCount) ||
      Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0)
    )
  take(active[0], 'most_active')

  // 4. Fill — start with |pct| then activity
  if (picks.length < max) {
    const byMagnitude = cards
      .filter(c => c.pctChange != null)
      .sort((a, b) =>
        Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0) ||
        (b.recentSalesCount - a.recentSalesCount)
      )
    for (const c of byMagnitude) {
      if (picks.length >= max) break
      // Reuse "most_active" reason when this card has sales; otherwise
      // fall back to a directional label so the email row label is
      // never empty.
      const reason: WeeklyDigestItemReason =
        c.recentSalesCount > 0 ? 'most_active'
        : (c.pctChange ?? 0) >= 0 ? 'biggest_riser' : 'biggest_faller'
      take(c, reason)
    }
  }

  // 5. Still under-filled? Try cards with sales but no pct data.
  if (picks.length < max) {
    const salesOnly = cards
      .filter(c => c.pctChange == null && c.recentSalesCount > 0)
      .sort((a, b) => b.recentSalesCount - a.recentSalesCount)
    for (const c of salesOnly) {
      if (picks.length >= max) break
      take(c, 'new_sales_activity')
    }
  }

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

  // 1. Load + decode preferences. Disabled = early-out, no DB reads.
  const prefs = await loadPrefs(supa, userId)
  if (!prefs.enabled) {
    return {
      status:       'disabled_master',
      asOf:         generatedAt,
      lookbackDays,
      alertSummary: emptyAlerts,
      diagnostics:  emptyDiagnostics(generatedAt),
    }
  }
  if (!prefs.weeklyDigestEnabled) {
    return {
      status:       'disabled_weekly',
      asOf:         generatedAt,
      lookbackDays,
      alertSummary: emptyAlerts,
      diagnostics:  emptyDiagnostics(generatedAt),
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
  const [portfolioRaw, watchlistRaw] = await Promise.all([
    wantPortfolio ? loadPortfolioItems(supa, userId) : Promise.resolve([] as PortRow[]),
    wantWatchlist ? loadWatchlist(supa, userId)      : Promise.resolve([] as WatchRow[]),
  ])

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

  // 6. Score portfolio cards. portfolio_items.holding_type drives the
  //    price-column choice; quantity scales the position value.
  let portfolioSection: WeeklyDigestPortfolioSection | undefined
  if (wantPortfolio) {
    const scored: ScoredCard[] = []
    let currentTotal:  number | null = null
    let previousTotal: number | null = null

    for (const row of portfolioRaw) {
      const card = urlToCard.get(row.card_slug)
      const bare = card?.cardSlug ?? null
      const display = {
        cardSlug: bare,
        cardName: card?.cardName ?? null,
        setName:  card?.setName  ?? null,
        cardUrl:  card?.cardName && card?.setName
          ? `https://www.pokeprices.io/set/${encodeURIComponent(card.setName)}/card/${card.cardUrlSlug}`
          : null,
      }
      const column = priceColumnForHoldingType(row.holding_type)
      const pair   = bare ? findPricePair(priceIndex.get(bare) ?? [], asOf, lookbackDays) : null
      const curCts = pair ? usdToCents(pair.latest[column]   ?? null) : null
      const prvCts = pair ? usdToCents(pair.baseline[column] ?? null) : null
      const qty    = Math.max(1, Math.floor(row.quantity ?? 1))
      const posCurrent  = curCts != null ? curCts * qty : null
      const posPrevious = prvCts != null ? prvCts * qty : null
      if (posCurrent  != null) currentTotal  = (currentTotal  ?? 0) + posCurrent
      if (posPrevious != null) previousTotal = (previousTotal ?? 0) + posPrevious

      scored.push({
        source:           'portfolio',
        urlSlug:          row.card_slug,
        cardSlug:         display.cardSlug,
        cardName:         display.cardName,
        setName:          display.setName,
        cardUrl:          display.cardUrl,
        currentCents:     posCurrent,
        previousCents:    posPrevious,
        pctChange:        pctChange(prvCts, curCts),    // per-card pct, not position
        absChangeCents:   (posCurrent != null && posPrevious != null) ? (posCurrent - posPrevious) : null,
        recentSalesCount: bare ? (salesIndex.get(bare) ?? 0) : 0,
        quantity:         qty,
      })
    }

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
      const curCts = pair ? usdToCents(pair.latest.raw_usd   ?? null) : null
      const prvCts = pair ? usdToCents(pair.baseline.raw_usd ?? null) : null
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
    diagnostics: {
      portfolioCardsConsidered,
      watchlistCardsConsidered,
      cardsWithNoSlugResolution,
      cardsWithNoPriceData,
      cardsWithNoRecentSales,
      sectionsOmittedByPreferences,
      generatedAt,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing
// ─────────────────────────────────────────────────────────────────────

type PortRow  = {
  user_id:      string
  card_slug:    string
  holding_type: string | null
  quantity:     number | null
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

async function loadPortfolioItems(supa: SupabaseClient, userId: string): Promise<PortRow[]> {
  // Mirror the evaluator's two-step lookup: user → portfolios → items.
  const { data: portfolios, error: pErr } = await supa
    .from('portfolios')
    .select('id, user_id')
    .eq('user_id', userId)
  if (pErr || !Array.isArray(portfolios) || portfolios.length === 0) return []
  const portfolioIds = portfolios.map(r => String((r as Record<string, unknown>).id))
  const idToUser     = new Map<string, string>()
  for (const r of portfolios as Array<Record<string, unknown>>) idToUser.set(String(r.id), String(r.user_id))

  const { data: items, error: iErr } = await supa
    .from('portfolio_items')
    .select('portfolio_id, card_slug, holding_type, quantity')
    .in('portfolio_id', portfolioIds)
  if (iErr || !Array.isArray(items)) return []
  return (items as Array<Record<string, unknown>>).map(r => ({
    user_id:      idToUser.get(String(r.portfolio_id)) ?? userId,
    card_slug:    String(r.card_slug ?? ''),
    holding_type: r.holding_type == null ? null : String(r.holding_type),
    quantity:     r.quantity     == null ? 1    : Math.max(1, Math.floor(Number(r.quantity) || 1)),
  })).filter(r => r.card_slug)
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

function emptyDiagnostics(generatedAt: string): WeeklyDigestDiagnostics {
  return {
    portfolioCardsConsidered:    0,
    watchlistCardsConsidered:    0,
    cardsWithNoSlugResolution:   0,
    cardsWithNoPriceData:        0,
    cardsWithNoRecentSales:      0,
    sectionsOmittedByPreferences: [],
    generatedAt,
  }
}
