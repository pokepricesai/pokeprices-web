// src/lib/alerts/evaluator.ts
// Block 5A-W-2 — server-side alert evaluator. Detects events for
// price moves, recent sales activity and spread shifts across every
// user's watchlist + portfolio, respects per-user cooldowns, and
// either returns a dry-run report or inserts into alert_events.
//
// Does NOT send emails. Does NOT call Resend. Does NOT schedule
// itself. The admin route in src/app/api/admin/alerts/evaluate is the
// only entry point; cron / digest emails arrive in later blocks.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  rowToPreferences,
  type AlertRule,
  type UserAlertPreferences,
} from './preferences'

// ─────────────────────────────────────────────────────────────────────
// Tunables (constants for now; future block surfaces in admin UI)
// ─────────────────────────────────────────────────────────────────────

/** Compare latest price to the row whose date is closest to (latest - N days). */
const PRICE_LOOKBACK_DAYS                = 7
/** Recent_sales rule window: a card with >=1 active sale this fresh counts. */
const RECENT_SALES_WINDOW_DAYS           = 7
/** Market_activity rule: card has at least this many active sales… */
const MARKET_ACTIVITY_MIN_SALES          = 5
/** …within this many days. */
const MARKET_ACTIVITY_WINDOW_DAYS        = 14
/** Cap the proposed-events list returned in dryRun so a giant snapshot
 *  doesn't blow the response size. Insert mode is unaffected. */
const DRYRUN_SAMPLE_CAP                  = 200
/** Hard ceiling on the user set in one evaluator pass. Protects the
 *  service-role client from accidentally pulling everyone in one go. */
const DEFAULT_USER_LIMIT                 = 1000
/** Cooldown lookup window: cooldowns can be at most 168h per the
 *  user_alert_preferences CHECK, so pulling 192h of history is enough. */
const COOLDOWN_LOOKUP_HOURS              = 192

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type EvalSource = 'watchlist' | 'portfolio' | 'both'

export type ProposedAlertEvent = {
  userId:    string
  cardSlug:  string
  cardName:  string | null
  setName:   string | null
  rule:      AlertRule
  severity:  'low' | 'normal' | 'high'
  source:    EvalSource
  payload:   Record<string, unknown>
}

export type EvaluationOptions = {
  /** When true (default), no rows are inserted. */
  dryRun?:      boolean
  /** Hard ceiling on the user set evaluated in one pass. */
  limitUsers?:  number
  /** Override "now" for deterministic tests. */
  asOf?:        Date
}

export type EvaluationDiagnostics = {
  /** Global count of user_alert_preferences rows with enabled=FALSE.
   *  Useful awareness signal — independent of the current batch.
   *  Disabled users are already filtered out at the SQL layer, so
   *  they never contribute to `usersConsidered`. */
  usersWithDisabledPrefs:            number
  /** Of the users in `usersConsidered`, how many ended up with zero
   *  cards on either watchlist OR portfolio (so nothing to evaluate). */
  usersWithNoCards:                  number
  /** Of the unique cards across all users in this batch, how many
   *  had fewer than two price points covering the ~7d lookback —
   *  i.e. `findPriceComparisonPair` returned null. These cards can
   *  never fire raw/psa10/spread rules. */
  cardsWithInsufficientPriceHistory: number
  /** Of the unique cards across all users in this batch, how many
   *  had zero active recent_sales rows in the last 14 days — i.e.
   *  the market_activity / recent_sales rules will never fire. */
  cardsWithNoRecentSales:            number
  /** Breakdown of every trigger generated this pass (matches
   *  triggersFound — counted BEFORE the cooldown filter so an operator
   *  can see which rules are firing at all). */
  triggersByRule:                    Record<AlertRule, number>
}

export type EvaluationResult = {
  dryRun:                       boolean
  asOf:                         string         // ISO timestamp used for cooldown / windowing
  usersConsidered:              number
  cardsConsidered:              number
  triggersFound:                number
  triggersSuppressedByCooldown: number
  triggersInserted:             number         // 0 in dryRun
  proposedEvents:               ProposedAlertEvent[]   // capped sample
  diagnostics:                  EvaluationDiagnostics
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────

/** Returns the signed percent change from `oldCents` to `newCents`, or
 *  null when the comparison is not meaningful (missing data, zero base). */
export function pctChange(oldCents: number | null | undefined, newCents: number | null | undefined): number | null {
  if (oldCents == null || newCents == null) return null
  if (!Number.isFinite(oldCents) || !Number.isFinite(newCents)) return null
  if (oldCents <= 0) return null
  return ((newCents - oldCents) / oldCents) * 100
}

/** Given a card's recent daily_prices rows (any column subset),
 *  return the latest row and the baseline row (closest <= latest - N days).
 *  Returns null when fewer than 2 rows exist or no row is older than the lookback. */
export function findPriceComparisonPair<T extends { date: string }>(
  rows:         T[],
  lookbackDays: number = PRICE_LOOKBACK_DAYS,
): { latest: T; baseline: T } | null {
  if (!Array.isArray(rows) || rows.length < 2) return null
  // Defensive sort ASC by date so we know rows[last] is the freshest.
  const asc = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  const latest = asc[asc.length - 1]
  const cutoff = isoDateMinusDays(latest.date, lookbackDays)
  // Walk back from latest-1; first row whose date <= cutoff is the baseline.
  for (let i = asc.length - 2; i >= 0; i--) {
    if (asc[i].date <= cutoff) return { latest, baseline: asc[i] }
  }
  // No row old enough to compare against.
  return null
}

function isoDateMinusDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Promote a normal severity to high when the move is unusually large. */
export function severityForPct(pct: number): 'normal' | 'high' {
  return Math.abs(pct) >= 25 ? 'high' : 'normal'
}

/** Compute the raw → PSA10 spread multiple. Returns null when either
 *  leg is missing or zero. */
export function spreadMultiple(rawCents: number | null | undefined, psa10Cents: number | null | undefined): number | null {
  if (rawCents == null || psa10Cents == null) return null
  if (rawCents <= 0 || psa10Cents <= 0) return null
  return psa10Cents / rawCents
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

type PriceRow = { card_slug: string; date: string; raw_usd: number | null; psa10_usd: number | null }
type SaleRow  = { internal_card_slug: string; sale_date: string }
type WLRow    = { user_id: string; card_slug: string; card_name: string | null; set_name: string | null }
type PortRow  = { user_id: string; card_slug: string }
type EvtRow   = { user_id: string; card_slug: string; rule: string; detected_at: string }

export async function evaluateAlerts(
  supa: SupabaseClient,
  opts: EvaluationOptions = {},
): Promise<EvaluationResult> {
  const dryRun     = opts.dryRun !== false  // default TRUE
  const limitUsers = Math.max(1, Math.min(opts.limitUsers ?? DEFAULT_USER_LIMIT, DEFAULT_USER_LIMIT))
  const asOfDate   = opts.asOf ?? new Date()
  const asOfIso    = asOfDate.toISOString()

  // 0. Diagnostic: global count of disabled prefs rows. Cheap one-off
  //    count for ops awareness — disabled users are filtered out by
  //    the SQL in loadEnabledPrefs, so they never enter usersConsidered.
  const usersWithDisabledPrefs = await countDisabledPrefs(supa)

  // 1. Load enabled user prefs.
  const prefsRows = await loadEnabledPrefs(supa, limitUsers)
  if (prefsRows.length === 0) {
    return emptyResult(dryRun, asOfIso, usersWithDisabledPrefs)
  }
  const prefsByUser = new Map<string, UserAlertPreferences>()
  for (const r of prefsRows) prefsByUser.set(String(r.user_id), rowToPreferences(r))

  const watchlistUserIds = prefsRows.filter(r => prefsByUser.get(String(r.user_id))!.scopeWatchlist).map(r => String(r.user_id))
  const portfolioUserIds = prefsRows.filter(r => prefsByUser.get(String(r.user_id))!.scopePortfolio).map(r => String(r.user_id))

  // 2. Load watchlist + portfolio.
  const [wlRows, piRows] = await Promise.all([
    loadWatchlist(supa, watchlistUserIds),
    loadPortfolioItems(supa, portfolioUserIds),
  ])

  // 3. Build user → card map with source attribution.
  type CardOnUserList = {
    cardSlug: string
    cardName: string | null
    setName:  string | null
    source:   EvalSource
  }
  const userCards = new Map<string, Map<string, CardOnUserList>>()
  function add(userId: string, cardSlug: string, src: 'watchlist'|'portfolio', cardName: string | null, setName: string | null) {
    if (!cardSlug) return
    let perUser = userCards.get(userId)
    if (!perUser) { perUser = new Map(); userCards.set(userId, perUser) }
    const existing = perUser.get(cardSlug)
    if (existing) {
      if (existing.source !== src) existing.source = 'both'
      if (!existing.cardName && cardName) existing.cardName = cardName
      if (!existing.setName  && setName)  existing.setName  = setName
    } else {
      perUser.set(cardSlug, { cardSlug, cardName, setName, source: src })
    }
  }
  for (const r of wlRows) add(r.user_id, r.card_slug, 'watchlist', r.card_name, r.set_name)
  for (const r of piRows) add(r.user_id, r.card_slug, 'portfolio', null, null)

  const allCardSlugs = new Set<string>()
  let cardsConsidered = 0
  for (const perUser of Array.from(userCards.values())) {
    cardsConsidered += perUser.size
    for (const s of Array.from(perUser.keys())) allCardSlugs.add(s)
  }

  // Diagnostic: users in usersConsidered who ended up with zero cards.
  const usersWithNoCards = Array.from(prefsByUser.keys()).filter(uid => !userCards.has(uid)).length

  // 4. Load price history + recent-sales activity for the union of cards.
  const slugList = Array.from(allCardSlugs)
  const [priceIndex, recentSales7d, recentSales14d] = await Promise.all([
    loadPriceIndex(supa, slugList, asOfDate),
    loadRecentSalesCounts(supa, slugList, asOfDate, RECENT_SALES_WINDOW_DAYS),
    loadRecentSalesCounts(supa, slugList, asOfDate, MARKET_ACTIVITY_WINDOW_DAYS),
  ])

  // Diagnostic: per-card counts at the unique-card level. A card is
  // counted once regardless of how many users list it.
  let cardsWithInsufficientPriceHistory = 0
  let cardsWithNoRecentSales            = 0
  for (const slug of slugList) {
    if (!findPriceComparisonPair(priceIndex.get(slug) ?? [])) cardsWithInsufficientPriceHistory++
    if ((recentSales14d.get(slug) ?? 0) === 0)                cardsWithNoRecentSales++
  }

  // 5. Load recent alert_events for cooldown.
  const cooldownIndex = await loadCooldownIndex(supa, Array.from(userCards.keys()), asOfDate)

  // 6. Evaluate.
  const proposed: ProposedAlertEvent[] = []
  let suppressed = 0
  const triggersByRule: Record<AlertRule, number> = {
    price_move: 0, recent_sales: 0, psa10_change: 0,
    raw_change: 0, spread_change: 0, market_activity: 0,
  }
  for (const [userId, perUser] of Array.from(userCards.entries())) {
    const prefs = prefsByUser.get(userId)!
    for (const card of Array.from(perUser.values())) {
      const priceRows = priceIndex.get(card.cardSlug) ?? []
      const events    = evaluateCardForUser({
        userId, card, prefs, priceRows,
        recentCount7d:  recentSales7d.get(card.cardSlug)  ?? 0,
        recentCount14d: recentSales14d.get(card.cardSlug) ?? 0,
      })
      for (const ev of events) {
        triggersByRule[ev.rule]++   // count every generated trigger, pre-cooldown
        if (isOnCooldown(cooldownIndex, userId, card.cardSlug, ev.rule, prefs.minHoursBetweenAlerts, asOfDate)) {
          suppressed++
          continue
        }
        proposed.push(ev)
      }
    }
  }

  // 7. Insert (or not).
  let inserted = 0
  if (!dryRun && proposed.length > 0) {
    inserted = await insertEvents(supa, proposed, asOfIso)
  }

  return {
    dryRun,
    asOf:                         asOfIso,
    usersConsidered:              prefsRows.length,
    cardsConsidered,
    triggersFound:                proposed.length + suppressed,
    triggersSuppressedByCooldown: suppressed,
    triggersInserted:             inserted,
    proposedEvents:               proposed.slice(0, DRYRUN_SAMPLE_CAP),
    diagnostics: {
      usersWithDisabledPrefs,
      usersWithNoCards,
      cardsWithInsufficientPriceHistory,
      cardsWithNoRecentSales,
      triggersByRule,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-card evaluation — pure, exported for unit tests
// ─────────────────────────────────────────────────────────────────────

export function evaluateCardForUser(args: {
  userId:          string
  card:            { cardSlug: string; cardName: string | null; setName: string | null; source: EvalSource }
  prefs:           UserAlertPreferences
  priceRows:       PriceRow[]
  recentCount7d:   number
  recentCount14d:  number
}): ProposedAlertEvent[] {
  const { userId, card, prefs, priceRows, recentCount7d, recentCount14d } = args
  const out: ProposedAlertEvent[] = []
  if (!prefs.enabled) return out

  const pair = findPriceComparisonPair(priceRows)
  const rawPct    = pair ? pctChange(pair.baseline.raw_usd,   pair.latest.raw_usd)   : null
  const psa10Pct  = pair ? pctChange(pair.baseline.psa10_usd, pair.latest.psa10_usd) : null

  // ── Raw price change ──
  if (rawPct != null && Math.abs(rawPct) >= prefs.rulePriceMovePct) {
    // Most-specific first: raw_change beats price_move when both are enabled.
    if (prefs.ruleRawChangeEnabled && Math.abs(rawPct) >= prefs.ruleRawChangePct) {
      out.push(makeEvent(userId, card, 'raw_change', severityForPct(rawPct), {
        old: pair!.baseline.raw_usd, new: pair!.latest.raw_usd, pct: round1(rawPct), source: card.source,
      }))
    } else if (prefs.rulePriceMoveEnabled) {
      out.push(makeEvent(userId, card, 'price_move', severityForPct(rawPct), {
        price_field: 'raw_usd', old: pair!.baseline.raw_usd, new: pair!.latest.raw_usd, pct: round1(rawPct), source: card.source,
      }))
    }
  }

  // ── PSA10 price change ──
  if (psa10Pct != null && Math.abs(psa10Pct) >= prefs.rulePriceMovePct) {
    if (prefs.ruleMyPSA10ChangeEnabled && Math.abs(psa10Pct) >= prefs.ruleMyPSA10ChangePct) {
      out.push(makeEvent(userId, card, 'psa10_change', severityForPct(psa10Pct), {
        old: pair!.baseline.psa10_usd, new: pair!.latest.psa10_usd, pct: round1(psa10Pct), source: card.source,
      }))
    } else if (prefs.rulePriceMoveEnabled) {
      out.push(makeEvent(userId, card, 'price_move', severityForPct(psa10Pct), {
        price_field: 'psa10_usd', old: pair!.baseline.psa10_usd, new: pair!.latest.psa10_usd, pct: round1(psa10Pct), source: card.source,
      }))
    }
  }

  // ── Spread (raw → PSA10) change ──
  if (prefs.ruleSpreadChangeEnabled && pair) {
    const oldSpread = spreadMultiple(pair.baseline.raw_usd, pair.baseline.psa10_usd)
    const newSpread = spreadMultiple(pair.latest.raw_usd,   pair.latest.psa10_usd)
    if (oldSpread != null && newSpread != null) {
      const spreadPct = ((newSpread - oldSpread) / oldSpread) * 100
      if (Math.abs(spreadPct) >= prefs.ruleSpreadChangePct) {
        out.push(makeEvent(userId, card, 'spread_change', severityForPct(spreadPct), {
          old_spread: round1(oldSpread),
          new_spread: round1(newSpread),
          pct:        round1(spreadPct),
          raw:        pair.latest.raw_usd,
          psa10:      pair.latest.psa10_usd,
          source:     card.source,
        }))
      }
    }
  }

  // ── New recent_sales available ──
  if (prefs.ruleRecentSalesEnabled && recentCount7d >= 1) {
    out.push(makeEvent(userId, card, 'recent_sales', 'normal', {
      recent_active_count: recentCount7d,
      window_days:         RECENT_SALES_WINDOW_DAYS,
      source:              card.source,
    }))
  }

  // ── Meaningful market activity ──
  if (prefs.ruleMarketActivityEnabled && recentCount14d >= MARKET_ACTIVITY_MIN_SALES) {
    out.push(makeEvent(userId, card, 'market_activity', 'normal', {
      active_count: recentCount14d,
      window_days:  MARKET_ACTIVITY_WINDOW_DAYS,
      source:       card.source,
    }))
  }

  return out
}

function makeEvent(
  userId:   string,
  card:     { cardSlug: string; cardName: string | null; setName: string | null; source: EvalSource },
  rule:     AlertRule,
  severity: 'low'|'normal'|'high',
  payload:  Record<string, unknown>,
): ProposedAlertEvent {
  return {
    userId,
    cardSlug: card.cardSlug,
    cardName: card.cardName,
    setName:  card.setName,
    rule,
    severity,
    source:   card.source,
    payload,
  }
}

function round1(n: number): number { return Math.round(n * 10) / 10 }

// ─────────────────────────────────────────────────────────────────────
// Cooldown
// ─────────────────────────────────────────────────────────────────────

type CooldownIndex = Map<string, string>   // key = `${userId}|${cardSlug}|${rule}`, value = latest ISO detected_at

function cooldownKey(userId: string, cardSlug: string, rule: string): string {
  return `${userId}|${cardSlug}|${rule}`
}

export function isOnCooldown(
  index:        CooldownIndex,
  userId:       string,
  cardSlug:     string,
  rule:         string,
  minHours:     number,
  asOf:         Date,
): boolean {
  if (minHours <= 0) return false
  const latest = index.get(cooldownKey(userId, cardSlug, rule))
  if (!latest) return false
  const detected = Date.parse(latest)
  if (!Number.isFinite(detected)) return false
  const ageMs = asOf.getTime() - detected
  return ageMs < minHours * 3_600_000
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing (kept terse; fail-closed on any error)
// ─────────────────────────────────────────────────────────────────────

async function loadEnabledPrefs(supa: SupabaseClient, limit: number): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supa
    .from('user_alert_preferences')
    .select('*')
    .eq('enabled', true)
    .limit(limit)
  if (error) return []
  return (data ?? []) as Array<Record<string, unknown>>
}

async function countDisabledPrefs(supa: SupabaseClient): Promise<number> {
  try {
    const { count, error } = await supa
      .from('user_alert_preferences')
      .select('*', { count: 'exact', head: true })
      .eq('enabled', false)
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function loadWatchlist(supa: SupabaseClient, userIds: string[]): Promise<WLRow[]> {
  if (userIds.length === 0) return []
  const { data, error } = await supa
    .from('watchlist')
    .select('user_id, card_slug, card_name, set_name')
    .in('user_id', userIds)
  if (error) return []
  return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    user_id:   String(r.user_id),
    card_slug: String(r.card_slug),
    card_name: r.card_name == null ? null : String(r.card_name),
    set_name:  r.set_name  == null ? null : String(r.set_name),
  }))
}

async function loadPortfolioItems(supa: SupabaseClient, userIds: string[]): Promise<PortRow[]> {
  if (userIds.length === 0) return []
  // portfolios links users → portfolios; portfolio_items has card_slug.
  const { data: portfolios } = await supa
    .from('portfolios')
    .select('id, user_id')
    .in('user_id', userIds)
  const portfolioRows = (portfolios ?? []) as Array<Record<string, unknown>>
  if (portfolioRows.length === 0) return []
  const idsByUser = new Map<string, string>()  // portfolio_id → user_id
  for (const p of portfolioRows) idsByUser.set(String(p.id), String(p.user_id))
  const portfolioIds = Array.from(idsByUser.keys())

  const { data: items, error } = await supa
    .from('portfolio_items')
    .select('portfolio_id, card_slug')
    .in('portfolio_id', portfolioIds)
  if (error) return []
  return ((items ?? []) as Array<Record<string, unknown>>).map(r => ({
    user_id:   idsByUser.get(String(r.portfolio_id)) ?? '',
    card_slug: String(r.card_slug ?? ''),
  })).filter(r => r.user_id && r.card_slug)
}

async function loadPriceIndex(supa: SupabaseClient, bareSlugs: string[], asOf: Date): Promise<Map<string, PriceRow[]>> {
  const out = new Map<string, PriceRow[]>()
  if (bareSlugs.length === 0) return out
  // daily_prices.card_slug uses 'pc-' prefix; build the prefixed list.
  const prefixed = bareSlugs.map(s => 'pc-' + s)
  const sinceIso = isoDateMinusDays(asOf.toISOString().slice(0, 10), 30)
  const { data, error } = await supa
    .from('daily_prices')
    .select('card_slug, date, raw_usd, psa10_usd')
    .in('card_slug', prefixed)
    .gte('date', sinceIso)
  if (error) return out
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const prefixedSlug = String(r.card_slug)
    const bare         = prefixedSlug.replace(/^pc-/, '')
    let list = out.get(bare)
    if (!list) { list = []; out.set(bare, list) }
    list.push({
      card_slug: bare,
      date:      String(r.date),
      raw_usd:   r.raw_usd   == null ? null : Number(r.raw_usd),
      psa10_usd: r.psa10_usd == null ? null : Number(r.psa10_usd),
    })
  }
  return out
}

async function loadRecentSalesCounts(
  supa:        SupabaseClient,
  bareSlugs:   string[],
  asOf:        Date,
  windowDays:  number,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (bareSlugs.length === 0) return out
  const sinceIso = isoDateMinusDays(asOf.toISOString().slice(0, 10), windowDays)
  const { data, error } = await supa
    .from('recent_sales')
    .select('internal_card_slug, sale_date')
    .eq('parse_status', 'ok')
    .eq('review_status', 'active')
    .in('internal_card_slug', bareSlugs)
    .gte('sale_date', sinceIso)
  if (error) return out
  for (const r of (data ?? []) as Array<SaleRow>) {
    const slug = String(r.internal_card_slug)
    out.set(slug, (out.get(slug) ?? 0) + 1)
  }
  return out
}

async function loadCooldownIndex(supa: SupabaseClient, userIds: string[], asOf: Date): Promise<CooldownIndex> {
  const out: CooldownIndex = new Map()
  if (userIds.length === 0) return out
  const sinceIso = new Date(asOf.getTime() - COOLDOWN_LOOKUP_HOURS * 3_600_000).toISOString()
  const { data, error } = await supa
    .from('alert_events')
    .select('user_id, card_slug, rule, detected_at')
    .in('user_id', userIds)
    .gte('detected_at', sinceIso)
  if (error) return out
  for (const r of (data ?? []) as Array<EvtRow>) {
    const k = cooldownKey(String(r.user_id), String(r.card_slug), String(r.rule))
    const cur = out.get(k)
    const ts  = String(r.detected_at)
    if (!cur || ts > cur) out.set(k, ts)
  }
  return out
}

async function insertEvents(supa: SupabaseClient, events: ProposedAlertEvent[], asOfIso: string): Promise<number> {
  if (events.length === 0) return 0
  const rows = events.map(e => ({
    user_id:           e.userId,
    card_slug:         e.cardSlug,
    card_name:         e.cardName,
    set_name:          e.setName,
    rule:              e.rule,
    severity:          e.severity,
    payload_json:      e.payload,
    detected_at:       asOfIso,
  }))
  const { error } = await supa.from('alert_events').insert(rows)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[alerts-evaluator] insert failed:', error.message)
    return 0
  }
  return rows.length
}

function emptyResult(dryRun: boolean, asOfIso: string, usersWithDisabledPrefs = 0): EvaluationResult {
  return {
    dryRun,
    asOf:                         asOfIso,
    usersConsidered:              0,
    cardsConsidered:              0,
    triggersFound:                0,
    triggersSuppressedByCooldown: 0,
    triggersInserted:             0,
    proposedEvents:               [],
    diagnostics: {
      usersWithDisabledPrefs,
      usersWithNoCards:                  0,
      cardsWithInsufficientPriceHistory: 0,
      cardsWithNoRecentSales:            0,
      triggersByRule: {
        price_move: 0, recent_sales: 0, psa10_change: 0,
        raw_change: 0, spread_change: 0, market_activity: 0,
      },
    },
  }
}
