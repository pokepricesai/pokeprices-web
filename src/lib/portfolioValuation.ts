// src/lib/portfolioValuation.ts
// Block 5A-W-16C — shared server-safe portfolio valuation helper.
//
// PURPOSE
//   Produce per-card and total portfolio values using the EXACT same
//   precedence as the portfolio dashboard (PortfolioDashboard.tsx).
//   The dashboard does the work client-side; the weekly digest needs
//   the same numbers server-side. Rather than duplicate the logic
//   inline in weeklyDigest.ts, this helper mirrors the dashboard's
//   passes so both surfaces produce reconcilable totals.
//
// PRECEDENCE (per holding row, matches dashboard)
//   1. raw / psa9 / psa10  → card_trends.{current_raw, current_psa9,
//                            current_psa10} matched on (card_name, set_name)
//   2. Extra-tier holdings (psa1-8, cgc95/10/10pristine, bgs10/10black,
//      sgc10, tag10, ace10) → daily_prices.{column} matched on the
//      bare numeric card_slug derived from cards.card_url_slug
//   3. Manual-grade holdings (bgs8/9/9.5, cgc8/9, sgc8/9/9.5, ace9/9.5,
//      tag9/9.5, "other") → manual_value_cents from portfolio_items
//                            when present; otherwise no market value
//   4. Everything else → null (missing). Matches the dashboard's
//      "wipe the RPC's stale raw fallback" behaviour.
//
// HEADLINE TOTAL
//   sum of (positionValueCents) across all items, where
//   positionValueCents = MARKET-derived per-card value × quantity.
//   Manual overrides are EXCLUDED from the headline total — same
//   choice the dashboard makes (its `recomputedTotal` sums
//   `position_value_cents`, which is only set by the market passes).
//   `effectiveValueCents` per item DOES include manual override so
//   the per-card display can show the user's own value.
//
// READ-ONLY. The helper only `.select(...)`s; no writes.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HOLDING_TYPE_TO_PRICE_COLUMN } from './portfolioGrades'

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type ValuationPriceSource =
  | 'card_trends'        // raw / psa9 / psa10 from card_trends
  | 'daily_prices'       // extra tier via daily_prices column lookup
  | 'manual'             // user-entered manual_value_cents
  | 'missing'            // no source resolved this card

export type ValuationHolding = {
  id?:                  string | null
  card_slug:            string                 // URL slug, e.g. "charizard-base-set-4-102"
  card_name:            string | null
  set_name:             string | null
  holding_type:         string | null
  quantity:             number | null
  manual_value_cents?:  number | null
}

export type ValuedItem = {
  holding:               ValuationHolding
  /** Per-card value in USD-cents. Uses manual_value_cents when set,
   *  else the market-derived value. Use this for what the renderer
   *  displays NEXT TO a card. */
  effectiveValueCents:   number | null
  /** Per-card MARKET value in USD-cents (manual override NOT applied).
   *  Use this for week-over-week pct + the headline total. */
  marketValueCents:      number | null
  /** quantity × marketValueCents. Null when no market value found —
   *  matches the dashboard's null semantics for manual-only holdings. */
  positionValueCents:    number | null
  /** Which pipeline resolved this card's market value. 'manual' means
   *  no market value but a manual override exists. 'missing' means
   *  neither market nor manual exists for this card. */
  source:                ValuationPriceSource
  /** Block 5A-W-16E — 30-day percent change for the card, sourced
   *  from card_trends.raw_pct_30d (same field the portfolio dashboard
   *  displays). Null when no card_trends row exists for this card OR
   *  when raw_pct_30d is null. Signed percent (e.g. -15.6, +19.8) —
   *  same scale the dashboard's fmtPct expects. */
  pct30d:                number | null
}

export type PortfolioValuation = {
  items:               ValuedItem[]
  /** Sum of positionValueCents across items (null → 0). Mirrors the
   *  dashboard's `recomputedTotal`. */
  marketTotalCents:    number
  /** Sum of quantities across all rows. */
  itemCount:           number
  /** Bucketed count of items by which source resolved them. */
  sourceCounts:        Record<ValuationPriceSource, number>
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

export async function valuePortfolio(
  supa: SupabaseClient,
  rows: ValuationHolding[],
): Promise<PortfolioValuation> {
  if (rows.length === 0) {
    return {
      items:            [],
      marketTotalCents: 0,
      itemCount:        0,
      sourceCounts:     { card_trends: 0, daily_prices: 0, manual: 0, missing: 0 },
    }
  }

  // Distinct (card_name, set_name) pairs — used to batch the card_trends
  // lookup the same way the dashboard does at PortfolioDashboard.tsx.
  const names = uniq(rows.map(r => r.card_name ?? '').filter(Boolean))
  const sets  = uniq(rows.map(r => r.set_name  ?? '').filter(Boolean))

  // Distinct URL slugs — used to resolve into the cards table for the
  // bare numeric slug needed by daily_prices.
  const urlSlugs = uniq(rows.map(r => r.card_slug ?? '').filter(Boolean))

  // Pass 1 — card_trends rows for raw / psa9 / psa10 holdings.
  // Keyed by `${card_name}::${set_name}` to match the dashboard.
  const trendMap = await loadCardTrends(supa, names, sets)

  // Pass 2 — cards-table lookups for extra-tier holdings.
  //   (a) cards by url_slug → numeric slug candidates (may be multiple)
  //   (b) cards by (name, set) → numeric slug fallback for slug drift
  const { urlToNumerics, nameSetToNumerics } = await loadCardsLookup(supa, urlSlugs, names, sets)

  // Pass 3 — daily_prices latest row for every candidate numeric slug,
  // pulling every grade column the dashboard's enrichment cares about.
  const allNumerics = new Set<string>()
  for (const arr of Array.from(urlToNumerics.values())) for (const n of arr) allNumerics.add(n)
  for (const arr of Array.from(nameSetToNumerics.values())) for (const n of arr) allNumerics.add(n)
  const dailySlugs = Array.from(allNumerics).map(n => 'pc-' + n)
  const latestPriceRow = await loadLatestDailyPrices(supa, dailySlugs)

  const sourceCounts: Record<ValuationPriceSource, number> = {
    card_trends: 0, daily_prices: 0, manual: 0, missing: 0,
  }
  let itemCount = 0

  const items: ValuedItem[] = rows.map(holding => {
    const qty = Math.max(1, Math.floor(Number(holding.quantity) || 1))
    itemCount += qty
    const ht  = (holding.holding_type ?? '').toLowerCase()

    // Block 5A-W-16E — look up the 30d trend ONCE per row. Used by
    // every source path so the digest can show dashboard-equivalent
    // 30d movement regardless of which price source priced the card.
    const trendKey = `${holding.card_name ?? ''}::${holding.set_name ?? ''}`
    const trend    = trendMap.get(trendKey)
    const pct30d   = trend?.raw_pct_30d ?? null

    // --- Pass 1: card_trends precedence for raw / psa9 / psa10
    if (ht === 'raw' || ht === 'psa9' || ht === 'psa10') {
      const col: 'current_raw' | 'current_psa9' | 'current_psa10' =
        ht === 'raw' ? 'current_raw' : ht === 'psa9' ? 'current_psa9' : 'current_psa10'
      const market = trend?.[col] ?? null
      if (market != null && Number.isFinite(market)) {
        sourceCounts.card_trends += 1
        return makeItem(holding, market, qty, 'card_trends', pct30d)
      }
      // No card_trends row for this card → still try a daily_prices
      // fallback before giving up. This mirrors the dashboard's
      // fallthrough when the card_trends join misses.
    }

    // --- Pass 2: daily_prices column lookup for extra tier holdings
    const dpCol = HOLDING_TYPE_TO_PRICE_COLUMN[ht]
    if (dpCol) {
      const candidates = [
        ...(urlToNumerics.get(holding.card_slug) || []),
        ...(nameSetToNumerics.get(`${holding.card_name ?? ''}::${holding.set_name ?? ''}`) || []),
      ]
      for (const num of candidates) {
        const dp = latestPriceRow.get('pc-' + num)
        if (!dp) continue
        const v = dp[dpCol]
        if (v != null && Number.isFinite(v)) {
          sourceCounts.daily_prices += 1
          return makeItem(holding, Number(v), qty, 'daily_prices', pct30d)
        }
      }
    }

    // --- Pass 3: manual override
    const manual = holding.manual_value_cents
    if (manual != null && Number.isFinite(manual) && manual > 0) {
      sourceCounts.manual += 1
      // Manual value applies to effective only — NOT to market total.
      // Mirrors the dashboard, which sums position_value_cents (market
      // only) for the headline Collection Value.
      return {
        holding,
        effectiveValueCents:  Math.round(Number(manual)),
        marketValueCents:     null,
        positionValueCents:   null,
        source:               'manual',
        pct30d,
      }
    }

    // --- Pass 4: nothing resolved
    sourceCounts.missing += 1
    return {
      holding,
      effectiveValueCents:  null,
      marketValueCents:     null,
      positionValueCents:   null,
      source:               'missing',
      pct30d,
    }
  })

  const marketTotalCents = items.reduce(
    (sum, it) => sum + (it.positionValueCents ?? 0),
    0,
  )

  return { items, marketTotalCents, itemCount, sourceCounts }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function makeItem(
  holding: ValuationHolding,
  marketCents: number,
  qty: number,
  source: ValuationPriceSource,
  pct30d: number | null,
): ValuedItem {
  const market = Math.round(marketCents)
  const manualRaw = holding.manual_value_cents
  const manual = manualRaw != null && Number.isFinite(manualRaw) && manualRaw > 0
    ? Math.round(Number(manualRaw))
    : null
  return {
    holding,
    effectiveValueCents:  manual ?? market,
    marketValueCents:     market,
    positionValueCents:   market * qty,
    source,
    pct30d,
  }
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean)))
}

type DailyPriceRow = Record<string, number | null | undefined> & { card_slug: string; date: string }

type CardTrendRow = {
  current_raw:   number | null
  current_psa9:  number | null
  current_psa10: number | null
  raw_pct_30d:   number | null
}

async function loadCardTrends(
  supa: SupabaseClient,
  names: string[],
  sets:  string[],
): Promise<Map<string, CardTrendRow>> {
  const out = new Map<string, CardTrendRow>()
  if (names.length === 0 || sets.length === 0) return out
  // Block 5A-W-16E — also pull raw_pct_30d so the digest can show
  // dashboard-equivalent 30d movement per card instead of inventing
  // a 7d move by comparing card_trends-current to daily_prices-7d-ago.
  const { data, error } = await supa
    .from('card_trends')
    .select('card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d')
    .in('card_name', names)
    .in('set_name',  sets)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const cardName = String(r.card_name ?? '')
    const setName  = String(r.set_name  ?? '')
    if (!cardName || !setName) continue
    out.set(`${cardName}::${setName}`, {
      current_raw:   r.current_raw   == null ? null : Number(r.current_raw),
      current_psa9:  r.current_psa9  == null ? null : Number(r.current_psa9),
      current_psa10: r.current_psa10 == null ? null : Number(r.current_psa10),
      raw_pct_30d:   r.raw_pct_30d   == null ? null : Number(r.raw_pct_30d),
    })
  }
  return out
}

async function loadCardsLookup(
  supa:     SupabaseClient,
  urlSlugs: string[],
  names:    string[],
  sets:     string[],
): Promise<{ urlToNumerics: Map<string, string[]>; nameSetToNumerics: Map<string, string[]> }> {
  const urlToNumerics      = new Map<string, string[]>()
  const nameSetToNumerics  = new Map<string, string[]>()
  if (urlSlugs.length > 0) {
    const { data } = await supa
      .from('cards')
      .select('card_url_slug, card_slug, card_name, set_name')
      .in('card_url_slug', urlSlugs)
    for (const c of ((data ?? []) as Array<Record<string, unknown>>)) {
      const url  = String(c.card_url_slug ?? '')
      const num  = String(c.card_slug     ?? '')
      if (!url || !num) continue
      const arr = urlToNumerics.get(url) || []
      arr.push(num)
      urlToNumerics.set(url, arr)
    }
  }
  if (names.length > 0 && sets.length > 0) {
    const { data } = await supa
      .from('cards')
      .select('card_name, set_name, card_slug')
      .in('card_name', names)
      .in('set_name',  sets)
    for (const c of ((data ?? []) as Array<Record<string, unknown>>)) {
      const cardName = String(c.card_name ?? '')
      const setName  = String(c.set_name  ?? '')
      const num      = String(c.card_slug ?? '')
      if (!cardName || !setName || !num) continue
      const key = `${cardName}::${setName}`
      const arr = nameSetToNumerics.get(key) || []
      arr.push(num)
      nameSetToNumerics.set(key, arr)
    }
  }
  return { urlToNumerics, nameSetToNumerics }
}

async function loadLatestDailyPrices(
  supa:        SupabaseClient,
  dailySlugs:  string[],
): Promise<Map<string, DailyPriceRow>> {
  const out = new Map<string, DailyPriceRow>()
  if (dailySlugs.length === 0) return out
  const { data } = await supa
    .from('daily_prices')
    .select(
      'card_slug, date, ' +
      'raw_usd, psa9_usd, psa10_usd, ' +
      'grade1_usd, grade2_usd, grade3_usd, grade4_usd, grade5_usd, grade6_usd, ' +
      'psa7_usd, psa8_usd, ' +
      'cgc95_usd, cgc10_usd, cgc10pristine_usd, ' +
      'bgs10_usd, bgs10black_usd, ' +
      'sgc10_usd, tag10_usd, ace10_usd'
    )
    .in('card_slug', dailySlugs)
    .order('date', { ascending: false })
  for (const r of ((data ?? []) as unknown as DailyPriceRow[])) {
    if (!out.has(r.card_slug)) out.set(r.card_slug, r)
  }
  return out
}
