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
import {
  resolveCardAlertSettings,
  thresholdForSignedPct,
  loadWatchlistAlertOverrides,
  lookupOverride,
  type EffectiveCardAlertSettings,
} from './watchlistOverrides'
import { isInstantAlertEntitled } from '@/lib/account/serverEntitlements'

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
  /** Of the unique URL slugs pulled from watchlist + portfolio_items,
   *  how many could NOT be resolved to a bare-numeric cards.card_slug
   *  via cards.card_url_slug. These cards are skipped from every
   *  market-data lookup. Usually zero on a healthy cards table — a
   *  non-zero count means a watch/portfolio row references a slug the
   *  scraper-owned `cards` table does not know about (renamed slug,
   *  removed card, etc.). */
  cardsWithNoSlugResolution:         number
  /** Of the unique cards that DID resolve (have a bare-numeric
   *  cardSlug), how many ended up without a usable cardName OR
   *  setName even after the cards-table fallback. Block 5A-W-10 —
   *  surface so the operator notices stale watchlist denorms or
   *  cards rows missing display columns. Does not overlap with
   *  cardsWithNoSlugResolution. */
  cardsWithMissingDisplayFields:     number
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
  /** Block 5A-W-27 — count of users whose `user_alert_preferences.enabled`
   *  is true but who are NOT entitled to instant alerts (free plan).
   *  These users have their watchlist/portfolio loaded but the
   *  per-card rule evaluation is SKIPPED — no events are inserted.
   *  Surfaced so the admin preview can show "X free users blocked
   *  by plan" alongside the existing diagnostics. */
  usersBlockedByEntitlement:         number
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

/**
 * Operator-safe shape of a proposed event for the admin response.
 * Omits userId; adds an opaque per-batch userIndex so the operator
 * can SEE which events belong to the same user without seeing the
 * actual user_id. Block 5A-W-10.
 */
export type PublicProposedAlertEvent = Omit<ProposedAlertEvent, 'userId'> & {
  userIndex: number
}

export type PublicEvaluationResult = Omit<EvaluationResult, 'proposedEvents'> & {
  proposedEvents: PublicProposedAlertEvent[]
}

/**
 * Strip user identifiers from the evaluator result before returning
 * it to the admin browser. Internal callers (the insert path inside
 * evaluateAlerts) run BEFORE this — alert_events still receives the
 * real user_id. This is a presentation-layer scrub.
 */
export function toPublicEvaluationResult(r: EvaluationResult): PublicEvaluationResult {
  const userIndexById = new Map<string, number>()
  let nextIdx = 1
  for (const e of r.proposedEvents) {
    if (!userIndexById.has(e.userId)) {
      userIndexById.set(e.userId, nextIdx++)
    }
  }
  return {
    ...r,
    proposedEvents: r.proposedEvents.map(e => {
      // Strip userId; assign a stable per-batch index.
      const { userId, ...rest } = e
      void userId   // explicit: we intentionally drop it
      return { ...rest, userIndex: userIndexById.get(e.userId)! }
    }),
  }
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
  //
  // SLUG-FORMAT NOTE (Block 5A-W-9): watchlist.card_slug and
  // portfolio_items.card_slug both store URL slugs (e.g. "charizard-4"
  // — the same string as cards.card_url_slug). The market-data tables
  // are keyed by the BARE NUMERIC cards.card_slug (e.g. "630417"),
  // with daily_prices using a "pc-" prefix on top of that. We keep
  // the URL slug as the per-user key and later resolve it to the bare
  // numeric for market lookups. The resolved bare numeric ends up on
  // ProposedAlertEvent.cardSlug so alert_events.card_slug stays
  // consistent with cards.card_slug and the existing digest URL
  // builder in delivery.ts / preview-email keeps working unchanged.
  type CardOnUserList = {
    urlSlug:  string         // raw watchlist/portfolio_items.card_slug (= cards.card_url_slug)
    cardSlug: string | null  // resolved bare numeric (cards.card_slug); null = unresolved
    cardName: string | null
    setName:  string | null
    source:   EvalSource
  }
  const userCards = new Map<string, Map<string, CardOnUserList>>()
  function add(userId: string, urlSlug: string, src: 'watchlist'|'portfolio', cardName: string | null, setName: string | null) {
    if (!urlSlug) return
    let perUser = userCards.get(userId)
    if (!perUser) { perUser = new Map(); userCards.set(userId, perUser) }
    const existing = perUser.get(urlSlug)
    if (existing) {
      if (existing.source !== src) existing.source = 'both'
      if (!existing.cardName && cardName) existing.cardName = cardName
      if (!existing.setName  && setName)  existing.setName  = setName
    } else {
      perUser.set(urlSlug, { urlSlug, cardSlug: null, cardName, setName, source: src })
    }
  }
  for (const r of wlRows) add(r.user_id, r.card_slug, 'watchlist', r.card_name, r.set_name)
  for (const r of piRows) add(r.user_id, r.card_slug, 'portfolio', null, null)

  // Resolve URL → bare numeric + backfill display fields in one batch.
  // Cards without a row here get cardSlug=null and are skipped from
  // market evaluation. portfolio_items rows store no card_name /
  // set_name; the cards-table fallback fills them. Watchlist rows
  // already carry denormalised display fields captured at add-time,
  // and those WIN over the cards fallback so the user sees the same
  // wording in the email as in their watchlist UI.
  const urlSlugSet = new Set<string>()
  for (const perUser of Array.from(userCards.values())) {
    for (const url of Array.from(perUser.keys())) urlSlugSet.add(url)
  }
  const urlSlugList   = Array.from(urlSlugSet)
  const urlToDetails  = await loadCardDetailsByUrlSlug(supa, urlSlugList)
  let cardsConsidered = 0
  let cardsWithNoSlugResolution = 0
  const allMarketIds = new Set<string>()
  for (const perUser of Array.from(userCards.values())) {
    for (const card of Array.from(perUser.values())) {
      cardsConsidered++
      const details = urlToDetails.get(card.urlSlug)
      if (details) {
        card.cardSlug = details.cardSlug
        // Fill missing display fields from cards as fallback. Do not
        // overwrite values the watchlist already provided.
        if (!card.cardName && details.cardName) card.cardName = details.cardName
        if (!card.setName  && details.setName)  card.setName  = details.setName
        allMarketIds.add(details.cardSlug)
      }
    }
  }
  // Count UNIQUE url slugs that failed to resolve (card-level, not tuple).
  for (const url of urlSlugList) {
    if (!urlToDetails.has(url)) cardsWithNoSlugResolution++
  }

  // Diagnostic: cards that resolved (have a cardSlug) but still
  // ended up without a usable card_name OR set_name even after the
  // cards-table fallback. Rare in practice — usually a sign of a
  // missing cards row column rather than a logic bug. Unique by
  // bare-numeric cardSlug so a card on N users counts once.
  const missingDisplaySet = new Set<string>()
  for (const perUser of Array.from(userCards.values())) {
    for (const card of Array.from(perUser.values())) {
      if (!card.cardSlug) continue
      if (!card.cardName || !card.setName) missingDisplaySet.add(card.cardSlug)
    }
  }
  const cardsWithMissingDisplayFields = missingDisplaySet.size

  // Diagnostic: users in usersConsidered who ended up with zero cards.
  const usersWithNoCards = Array.from(prefsByUser.keys()).filter(uid => !userCards.has(uid)).length

  // 4. Load price history + recent-sales activity for the resolved
  //    market IDs ONLY. Cards without a resolved bare numeric are
  //    impossible to look up in either table (the keys would not
  //    match), so we exclude them here and skip them inside the
  //    per-card loop below.
  const marketIdList = Array.from(allMarketIds)
  const [priceIndex, recentSales7d, recentSales14d] = await Promise.all([
    loadPriceIndex(supa, marketIdList, asOfDate),
    loadRecentSalesCounts(supa, marketIdList, asOfDate, RECENT_SALES_WINDOW_DAYS),
    loadRecentSalesCounts(supa, marketIdList, asOfDate, MARKET_ACTIVITY_WINDOW_DAYS),
  ])

  // Diagnostic: per-card counts at the unique-card level (unique by
  // resolved bare numeric). Cards without a resolution are reported
  // via cardsWithNoSlugResolution instead — counting them here would
  // double-attribute the same problem.
  let cardsWithInsufficientPriceHistory = 0
  let cardsWithNoRecentSales            = 0
  for (const id of marketIdList) {
    if (!findPriceComparisonPair(priceIndex.get(id) ?? [])) cardsWithInsufficientPriceHistory++
    if ((recentSales14d.get(id) ?? 0) === 0)                cardsWithNoRecentSales++
  }

  // 5. Load recent alert_events for cooldown.
  const cooldownIndex = await loadCooldownIndex(supa, Array.from(userCards.keys()), asOfDate)

  // 5b. Block 5A-W-19 — load per-card watchlist overrides for every
  //     considered user. Index by `${userId}|${urlSlug}`; lookups in
  //     the per-card loop are O(1). Overrides only affect pure
  //     watchlist cards — see resolveCardAlertSettings for the source
  //     gate that protects portfolio + 'both' alerts.
  const overrideIndex = await loadWatchlistAlertOverrides(supa, Array.from(userCards.keys()))

  // 6. Evaluate.
  const proposed: ProposedAlertEvent[] = []
  let suppressed = 0
  let usersBlockedByEntitlement = 0
  const triggersByRule: Record<AlertRule, number> = {
    price_move: 0, recent_sales: 0, psa10_change: 0,
    raw_change: 0, spread_change: 0, market_activity: 0,
  }
  for (const [userId, perUser] of Array.from(userCards.entries())) {
    const prefs = prefsByUser.get(userId)!
    // Block 5A-W-27 — instant alerts are a paid feature placeholder.
    // Free users (anyone not in ACCOUNT_PRO_USER_IDS today) skip the
    // entire per-card rule loop so no alert_events get inserted on
    // their behalf. Weekly digest portfolio + watchlist sections
    // still render for them — those read card_trends + watchlist
    // directly, not alert_events; only the digest's alert highlights
    // section is empty for free users, which matches the brief's
    // "instant alerts are paid".
    //
    // Legacy free users with `user_alert_preferences.instantAlertsEnabled=true`
    // from before the UI gate are caught here: the prefs row says
    // they want instant alerts, but the server refuses to create
    // new events for them. We deliberately do NOT mutate the prefs
    // row so the user's stored intent stays intact — if they later
    // upgrade to pro, instant alerts resume.
    if (!isInstantAlertEntitled(userId)) {
      usersBlockedByEntitlement++
      continue
    }
    for (const card of Array.from(perUser.values())) {
      // Skip cards with no resolved bare numeric — they cannot fire
      // any market-based rule. They are already counted in
      // cardsWithNoSlugResolution above.
      if (!card.cardSlug) continue

      const marketId  = card.cardSlug
      const priceRows = priceIndex.get(marketId) ?? []
      // Block 5A-W-19 — resolve effective per-card thresholds. The
      // override is keyed by URL slug (the same key the watchlist UI
      // saves under). For source≠'watchlist' the resolver short-
      // circuits to global thresholds so portfolio + both stay on
      // the pre-19 behaviour.
      const override = lookupOverride(overrideIndex, userId, card.urlSlug)
      const effective = resolveCardAlertSettings(prefs, override, card.source)
      const events    = effective.enabled ? evaluateCardForUser({
        userId,
        // ProposedAlertEvent.cardSlug carries the BARE NUMERIC so
        // alert_events.card_slug aligns with cards.card_slug — the
        // existing digest URL builder in delivery.ts / preview-email
        // does `.in('card_slug', bareSlugs)` and keys its result map
        // by bare numeric. cardName + setName now come from
        // watchlist if present, else the cards-table fallback
        // populated in the resolution loop above.
        card: { cardSlug: marketId, cardName: card.cardName, setName: card.setName, source: card.source },
        prefs,
        effective,
        priceRows,
        recentCount7d:  recentSales7d.get(marketId)  ?? 0,
        recentCount14d: recentSales14d.get(marketId) ?? 0,
      }) : []
      for (const ev of events) {
        triggersByRule[ev.rule]++   // count every generated trigger, pre-cooldown
        if (isOnCooldown(cooldownIndex, userId, marketId, ev.rule, prefs.minHoursBetweenAlerts, asOfDate)) {
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
      cardsWithNoSlugResolution,
      cardsWithMissingDisplayFields,
      cardsWithInsufficientPriceHistory,
      cardsWithNoRecentSales,
      triggersByRule,
      usersBlockedByEntitlement,
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
  /** Block 5A-W-19 — resolved per-card thresholds. Optional so
   *  pre-19 callers (and the existing test suite) keep working: when
   *  omitted we synthesise a "global" settings object from `prefs`,
   *  giving the symmetric pre-19 behaviour. */
  effective?:      EffectiveCardAlertSettings
  priceRows:       PriceRow[]
  recentCount7d:   number
  recentCount14d:  number
}): ProposedAlertEvent[] {
  const { userId, card, prefs, priceRows, recentCount7d, recentCount14d } = args
  const out: ProposedAlertEvent[] = []
  if (!prefs.enabled) return out
  // Synthesise global settings when the caller didn't supply one —
  // matches the pre-5A-W-19 symmetric behaviour exactly (one
  // threshold both directions, sourced from rulePriceMovePct).
  const eff: EffectiveCardAlertSettings = args.effective ?? {
    enabled:               true,
    thresholdSource:       'global',
    risePct:               prefs.rulePriceMovePct,
    dropPct:               prefs.rulePriceMovePct,
    recentSalesEnabled:    prefs.ruleRecentSalesEnabled,
    marketActivityEnabled: prefs.ruleMarketActivityEnabled,
  }
  if (!eff.enabled) return out

  const pair = findPriceComparisonPair(priceRows)
  const rawPct    = pair ? pctChange(pair.baseline.raw_usd,   pair.latest.raw_usd)   : null
  const psa10Pct  = pair ? pctChange(pair.baseline.psa10_usd, pair.latest.psa10_usd) : null
  const isOverride = eff.thresholdSource === 'override'

  // Block 5A-W-19 — when a per-card OVERRIDE is in effect the
  // collapsed threshold (rise or drop, whichever matches the sign
  // of the move) replaces both the outer move gate AND the per-rule
  // raw/psa10 gates. Otherwise we use the pre-19 layered behaviour
  // EXACTLY: rulePriceMovePct as the outer gate, the per-rule
  // threshold as the inner gate — so a user without an override
  // sees zero behaviour change.
  function gates(pct: number): { outer: number; inner: { raw: number; psa10: number } } {
    if (isOverride) {
      const t = thresholdForSignedPct(eff, pct)
      return { outer: t, inner: { raw: t, psa10: t } }
    }
    return {
      outer: prefs.rulePriceMovePct,
      inner: { raw: prefs.ruleRawChangePct, psa10: prefs.ruleMyPSA10ChangePct },
    }
  }

  // ── Raw price change ──
  if (rawPct != null) {
    const g = gates(rawPct)
    if (Math.abs(rawPct) >= g.outer) {
      // Most-specific first: raw_change beats price_move when both are enabled.
      if (prefs.ruleRawChangeEnabled && Math.abs(rawPct) >= g.inner.raw) {
        out.push(makeEvent(userId, card, 'raw_change', severityForPct(rawPct), {
          old: pair!.baseline.raw_usd, new: pair!.latest.raw_usd, pct: round1(rawPct), source: card.source,
          threshold_source: eff.thresholdSource,
          threshold_pct:    g.inner.raw,
          direction:        rawPct >= 0 ? 'rise' : 'drop',
        }))
      } else if (prefs.rulePriceMoveEnabled) {
        out.push(makeEvent(userId, card, 'price_move', severityForPct(rawPct), {
          price_field: 'raw_usd', old: pair!.baseline.raw_usd, new: pair!.latest.raw_usd, pct: round1(rawPct), source: card.source,
          threshold_source: eff.thresholdSource,
          threshold_pct:    g.outer,
          direction:        rawPct >= 0 ? 'rise' : 'drop',
        }))
      }
    }
  }

  // ── PSA10 price change ──
  if (psa10Pct != null) {
    const g = gates(psa10Pct)
    if (Math.abs(psa10Pct) >= g.outer) {
      if (prefs.ruleMyPSA10ChangeEnabled && Math.abs(psa10Pct) >= g.inner.psa10) {
        out.push(makeEvent(userId, card, 'psa10_change', severityForPct(psa10Pct), {
          old: pair!.baseline.psa10_usd, new: pair!.latest.psa10_usd, pct: round1(psa10Pct), source: card.source,
          threshold_source: eff.thresholdSource,
          threshold_pct:    g.inner.psa10,
          direction:        psa10Pct >= 0 ? 'rise' : 'drop',
        }))
      } else if (prefs.rulePriceMoveEnabled) {
        out.push(makeEvent(userId, card, 'price_move', severityForPct(psa10Pct), {
          price_field: 'psa10_usd', old: pair!.baseline.psa10_usd, new: pair!.latest.psa10_usd, pct: round1(psa10Pct), source: card.source,
          threshold_source: eff.thresholdSource,
          threshold_pct:    g.outer,
          direction:        psa10Pct >= 0 ? 'rise' : 'drop',
        }))
      }
    }
  }

  // ── Spread (raw → PSA10) change ──
  // Block 5A-W-19 — no per-card override for spread thresholds; the
  // override surface is intentionally smaller than every per-rule
  // toggle. Keeps the UI to one rise + one drop field.
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
  // Block 5A-W-19 — honour the per-card override toggle when present;
  // override.recent_sales_enabled=false silences the rule even when
  // the global toggle is on.
  if (eff.recentSalesEnabled && recentCount7d >= 1) {
    out.push(makeEvent(userId, card, 'recent_sales', 'normal', {
      recent_active_count: recentCount7d,
      window_days:         RECENT_SALES_WINDOW_DAYS,
      source:              card.source,
      threshold_source:    eff.thresholdSource,
    }))
  }

  // ── Meaningful market activity ──
  if (eff.marketActivityEnabled && recentCount14d >= MARKET_ACTIVITY_MIN_SALES) {
    out.push(makeEvent(userId, card, 'market_activity', 'normal', {
      active_count:     recentCount14d,
      window_days:      MARKET_ACTIVITY_WINDOW_DAYS,
      source:           card.source,
      threshold_source: eff.thresholdSource,
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

type CardDetails = {
  cardSlug: string       // bare numeric (cards.card_slug)
  cardName: string | null
  setName:  string | null
}

async function loadCardDetailsByUrlSlug(supa: SupabaseClient, urlSlugs: string[]): Promise<Map<string, CardDetails>> {
  // Resolve cards.card_url_slug → cards.card_slug + display fields
  // for the supplied URL slugs in ONE batched query. Replaces the
  // narrower loadUrlSlugToBareMap so portfolio_items rows (which
  // store no card_name / set_name themselves) can have their display
  // fields backfilled from the cards table — Block 5A-W-10.
  //
  // The market-data tables (daily_prices / recent_sales) are keyed
  // off the bare-numeric card_slug, not the URL slug; this map is
  // the bridge.
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
        cardSlug: bare,
        cardName: r.card_name == null ? null : String(r.card_name),
        setName:  r.set_name  == null ? null : String(r.set_name),
      })
    }
  }
  return out
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
      cardsWithNoSlugResolution:         0,
      cardsWithMissingDisplayFields:     0,
      cardsWithInsufficientPriceHistory: 0,
      cardsWithNoRecentSales:            0,
      triggersByRule: {
        price_move: 0, recent_sales: 0, psa10_change: 0,
        raw_change: 0, spread_change: 0, market_activity: 0,
      },
      usersBlockedByEntitlement:         0,
    },
  }
}
