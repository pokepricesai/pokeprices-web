// src/lib/account/portfolioSummary.ts
//
// Block 5A-W-42A-FIX4 — shared portfolio summary loader.
//
// SINGLE SOURCE OF TRUTH for anything that needs to render the same
// "Collection Value / Total Cards / Unique Cards / display currency"
// numbers that /dashboard/portfolio shows. The dashboard hub now
// calls into here; /dashboard/portfolio itself still has its own
// slightly larger version wired to its React state (edit tools,
// scanner, manual-override editor, sales volume flags, etc.) —
// porting that in-place is a substantial refactor and is tracked as
// TODO on this file. The compute pipeline below IS the same shape
// the portfolio page runs (verified against PortfolioDashboard.tsx
// on 2026-07-03), so their totals now agree.
//
// PIPELINE (mirrors PortfolioDashboard.tsx::loadPortfolio):
//   1. Resolve primary portfolio_id  — is_default=true, .limit(1). Legacy
//      fallback picks a single any-owned portfolio (read-only; we do
//      NOT insert like the portfolio page does).
//   2. Load display_currency preference from user_email_preferences.
//   3. Call get_portfolio_summary(p_portfolio_id) RPC.
//   4. Dedupe RPC items by id (cartesian LEFT JOIN to card_trends
//      produces same-id duplicates).
//   5. Recompute pricing pass 1 — raw / psa9 / psa10 tiers via
//      card_trends by (card_name, set_name). For all other tiers we
//      NULL the position value so pass 2 can fill it (raw fallback
//      would silently disguise a slab as ungraded).
//   6. Recompute pricing pass 2 — extra tiers (PSA 1-8, BGS, CGC,
//      SGC, TAG, ACE) via daily_prices, using cards.card_slug ↔
//      cards.card_url_slug translation with (card_name, set_name)
//      fallback for slug-drift edge cases.
//   7. Recompute headline aggregates from deduped items:
//        totalCents  = sum(position_value_cents)     across deduped
//        itemCount   = sum(quantity)                 across deduped
//        uniqueCards = count(distinct card_slug)     across deduped
//
// Currency conversion for display is deliberately identical to the
// portfolio page's fmtBig helper (USD uses /100, GBP uses /127; the
// column is stored as USD cents everywhere).
//
// TODO(w42a-fix5+) — refactor PortfolioDashboard.loadPortfolio to
// consume this helper. Blockers: it depends on live React state
// (manualOverrides map, volume flags, sealed detection) that we do
// not need for the hub summary card.

import type { SupabaseClient } from '@supabase/supabase-js'
import { HOLDING_TYPE_TO_PRICE_COLUMN } from '@/lib/portfolioGrades'

// ── Types ────────────────────────────────────────────────────────────

export type PortfolioSummaryCurrency = 'GBP' | 'USD'

export type PortfolioSummaryItem = {
  id:                   string
  card_slug:            string
  card_name:            string | null
  set_name:             string | null
  card_url_slug:        string | null
  quantity:             number
  holding_type:         string | null
  position_value_cents: number | null
  current_value_cents:  number | null
  manual_value_cents:   number | null
  pct_7d:               number | null
  pct_30d:              number | null
}

export type PortfolioSummaryResult = {
  totalCents:      number
  itemCount:       number
  uniqueCards:     number
  pct30dWeighted:  number | null
  items:           PortfolioSummaryItem[]
  currency:        PortfolioSummaryCurrency
  /** True when the loader picked a portfolio row via the fallback
   *  branch (legacy user with no is_default flag). Purely diagnostic. */
  usedLegacyFallback: boolean
}

// ── Currency formatter (matches PortfolioDashboard.fmtBig) ─────────

/** Format a USD-cents value into the display currency's headline
 *  string. Matches PortfolioDashboard.tsx::fmtBig exactly (USD uses
 *  cents/100, GBP uses cents/127). Empty-value renders "—". */
export function formatPortfolioValue(
  cents: number | null | undefined,
  currency: PortfolioSummaryCurrency,
): string {
  if (!cents || cents <= 0) return '—'
  if (currency === 'USD') {
    const v = cents / 100
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
    if (v >= 1000)      return `$${(v / 1000).toFixed(1)}k`
    return `$${v.toFixed(2)}`
  }
  const v = cents / 127
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000)      return `£${(v / 1000).toFixed(1)}k`
  return `£${v.toFixed(2)}`
}

// ── Main loader ─────────────────────────────────────────────────────

const EMPTY: PortfolioSummaryResult = {
  totalCents: 0, itemCount: 0, uniqueCards: 0, pct30dWeighted: null,
  items: [], currency: 'GBP', usedLegacyFallback: false,
}

export async function loadPortfolioSummary(
  supa: SupabaseClient, userId: string,
): Promise<PortfolioSummaryResult> {
  if (!userId) return EMPTY

  // 1. Resolve primary portfolio id — .limit(1) to match the portfolio
  //    page's exact scope. If two rows accidentally carry
  //    is_default=true, both pages pick the same "first" one.
  let primaryPid: string | null = null
  let usedLegacyFallback = false
  try {
    const { data: defaultRows } = await supa
      .from('portfolios').select('id')
      .eq('user_id', userId).eq('is_default', true).limit(1)
    if (Array.isArray(defaultRows) && defaultRows.length > 0) {
      primaryPid = (defaultRows[0] as { id: string }).id
    }
    if (!primaryPid) {
      // Legacy users (no is_default flag). Portfolio page would
      // INSERT a fresh empty is_default row here; we can't (read-only
      // helper) so we peek at whatever any-owned portfolio the user
      // has. The two paths therefore differ for THIS narrow legacy
      // case, and the difference is flagged via usedLegacyFallback.
      const { data: anyRows } = await supa
        .from('portfolios').select('id')
        .eq('user_id', userId).limit(1)
      if (Array.isArray(anyRows) && anyRows.length > 0) {
        primaryPid = (anyRows[0] as { id: string }).id
        usedLegacyFallback = true
      }
    }
  } catch {
    return EMPTY
  }
  if (!primaryPid) return EMPTY

  // 2. Currency preference — defensive maybeSingle(). Falls back to
  //    GBP (matches PortfolioDashboard's default state).
  let currency: PortfolioSummaryCurrency = 'GBP'
  try {
    const { data: prefs } = await supa
      .from('user_email_preferences')
      .select('display_currency')
      .eq('user_id', userId)
      .maybeSingle()
    const c = (prefs as { display_currency?: string } | null)?.display_currency
    if (c === 'USD' || c === 'GBP') currency = c
  } catch { /* keep default */ }

  // 3. Call the same RPC /dashboard/portfolio consumes.
  let rawItems: any[] = []
  try {
    const { data } = await supa.rpc('get_portfolio_summary', { p_portfolio_id: primaryPid })
    if (data && Array.isArray(data.items)) rawItems = data.items
  } catch { /* return partial with empty items */ }

  // 4. Dedupe by id (mirrors PortfolioDashboard.tsx:989-991).
  let dedupedById: any[] = Array.from(
    new Map(rawItems.map((i: any) => [i.id, i])).values()
  )

  // 5. Recompute pass 1 — raw / psa9 / psa10 via card_trends. Mirrors
  //    PortfolioDashboard.tsx:1002-1047.
  if (dedupedById.length > 0) {
    const names = Array.from(new Set(dedupedById.map(i => i.card_name).filter(Boolean)))
    const sets  = Array.from(new Set(dedupedById.map(i => i.set_name ).filter(Boolean)))
    if (names.length > 0 && sets.length > 0) {
      const { data: trendRows } = await supa
        .from('card_trends')
        .select('card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_7d, raw_pct_30d')
        .in('card_name', names).in('set_name', sets)
      const trendMap: Record<string, any> = {}
      for (const r of (trendRows || []) as any[]) {
        trendMap[`${r.card_name}::${r.set_name}`] = r
      }
      dedupedById = dedupedById.map((i: any) => {
        const trend = trendMap[`${i.card_name}::${i.set_name}`]
        if (!trend) return i
        const refreshed = {
          current_raw:   trend.current_raw   ?? i.current_raw,
          current_psa9:  trend.current_psa9  ?? i.current_psa9,
          current_psa10: trend.current_psa10 ?? i.current_psa10,
          pct_7d:        trend.raw_pct_7d    ?? i.pct_7d  ?? null,
          pct_30d:       trend.raw_pct_30d   ?? i.pct_30d ?? null,
        }
        const trendTier =
            i.holding_type === 'raw'   ? trend.current_raw
          : i.holding_type === 'psa9'  ? trend.current_psa9
          : i.holding_type === 'psa10' ? trend.current_psa10
          : null
        if (trendTier == null) {
          // Wipe stale raw fallback — pass 2 will fill for extra tiers.
          return { ...i, ...refreshed, current_value_cents: null, position_value_cents: null }
        }
        const qty = Math.max(1, i.quantity || 1)
        return { ...i, ...refreshed, current_value_cents: trendTier, position_value_cents: trendTier * qty }
      })
    }
  }

  // 6. Recompute pass 2 — extra tiers via daily_prices. Mirrors
  //    PortfolioDashboard.tsx:1049-1177.
  const extraTierItems = dedupedById.filter((i: any) =>
    HOLDING_TYPE_TO_PRICE_COLUMN[i.holding_type] &&
    !['raw', 'psa9', 'psa10'].includes(i.holding_type)
  )
  if (extraTierItems.length > 0) {
    const urlSlugs = Array.from(new Set(
      extraTierItems.map((i: any) => (i.card_slug || '').toString().replace(/^pc-/, ''))
    ))
    const { data: cardRowsBySlug } = await supa
      .from('cards')
      .select('card_url_slug, card_slug, card_name, set_name')
      .in('card_url_slug', urlSlugs)
    const urlToNumerics = new Map<string, string[]>()
    for (const c of (cardRowsBySlug || []) as any[]) {
      if (!c.card_url_slug || !c.card_slug) continue
      const arr = urlToNumerics.get(c.card_url_slug) || []
      arr.push(c.card_slug)
      urlToNumerics.set(c.card_url_slug, arr)
    }
    // Items whose slug didn't resolve — fall back to (name, set) lookup.
    const unresolved = extraTierItems.filter((i: any) => {
      const u = (i.card_slug || '').toString().replace(/^pc-/, '')
      return !urlToNumerics.has(u)
    })
    const nameSetToNumerics = new Map<string, string[]>()
    if (unresolved.length > 0) {
      const uNames = Array.from(new Set(unresolved.map((i: any) => i.card_name).filter(Boolean)))
      const uSets  = Array.from(new Set(unresolved.map((i: any) => i.set_name ).filter(Boolean)))
      if (uNames.length > 0 && uSets.length > 0) {
        const { data: cardRowsByName } = await supa
          .from('cards')
          .select('card_name, set_name, card_slug')
          .in('card_name', uNames).in('set_name', uSets)
        for (const c of (cardRowsByName || []) as any[]) {
          if (!c.card_slug) continue
          const key = `${c.card_name}::${c.set_name}`
          const arr = nameSetToNumerics.get(key) || []
          arr.push(c.card_slug)
          nameSetToNumerics.set(key, arr)
        }
      }
    }
    const allNumerics = new Set<string>()
    for (const arr of Array.from(urlToNumerics.values())) for (const n of arr) allNumerics.add(n)
    for (const arr of Array.from(nameSetToNumerics.values())) for (const n of arr) allNumerics.add(n)
    const dailySlugs = Array.from(allNumerics).map(n => `pc-${n}`)
    const { data: dpRows } = dailySlugs.length === 0
      ? { data: [] as any[] }
      : await supa
          .from('daily_prices')
          .select(
            'card_slug, date, ' +
            'grade1_usd, grade2_usd, grade3_usd, grade4_usd, grade5_usd, grade6_usd, ' +
            'psa7_usd, psa8_usd, ' +
            'cgc95_usd, cgc10_usd, cgc10pristine_usd, ' +
            'bgs10_usd, bgs10black_usd, ' +
            'sgc10_usd, tag10_usd, ace10_usd'
          )
          .in('card_slug', dailySlugs)
          .order('date', { ascending: false })
    const latestBySlug = new Map<string, any>()
    for (const r of ((dpRows || []) as any[])) {
      if (!latestBySlug.has(r.card_slug)) latestBySlug.set(r.card_slug, r)
    }
    const resolveValue = (item: any, col: string): number | null => {
      const urlSlug = (item.card_slug || '').toString().replace(/^pc-/, '')
      const candidates = [
        ...(urlToNumerics.get(urlSlug) || []),
        ...(nameSetToNumerics.get(`${item.card_name}::${item.set_name}`) || []),
      ]
      for (const num of candidates) {
        const dp = latestBySlug.get(`pc-${num}`)
        if (!dp) continue
        const v = dp[col]
        if (v != null) return v
      }
      return null
    }
    dedupedById = dedupedById.map((i: any) => {
      const col = HOLDING_TYPE_TO_PRICE_COLUMN[i.holding_type]
      if (!col || ['raw', 'psa9', 'psa10'].includes(i.holding_type)) return i
      const tier = resolveValue(i, col)
      if (tier == null) return i
      const qty = Math.max(1, i.quantity || 1)
      return { ...i, current_value_cents: tier, position_value_cents: tier * qty }
    })
  }

  // 7. Aggregate from deduped items (matches PortfolioDashboard.tsx:1187-1195).
  let totalCents = 0, wSum = 0, vSum = 0
  for (const it of dedupedById) {
    const v = it.position_value_cents ?? it.manual_value_cents ?? it.current_value_cents
    if (typeof v === 'number' && v > 0) {
      totalCents += v
      if (it.pct_30d != null) { wSum += Number(it.pct_30d) * v; vSum += v }
    }
  }
  const itemCount   = dedupedById.reduce((s: number, i: any) => s + (i.quantity || 0), 0)
  const uniqueCards = new Set(dedupedById.map((i: any) => i.card_slug).filter(Boolean)).size
  const pct30dWeighted = vSum > 0 ? wSum / vSum : null

  const items: PortfolioSummaryItem[] = dedupedById.map((i: any) => ({
    id:                   String(i.id ?? ''),
    card_slug:            String(i.card_slug ?? ''),
    card_name:            i.card_name ?? null,
    set_name:             i.set_name ?? null,
    card_url_slug:        i.card_url_slug ?? null,
    quantity:             typeof i.quantity === 'number' ? i.quantity : 1,
    holding_type:         i.holding_type ?? null,
    position_value_cents: i.position_value_cents ?? null,
    current_value_cents:  i.current_value_cents ?? null,
    manual_value_cents:   i.manual_value_cents ?? null,
    pct_7d:               i.pct_7d ?? null,
    pct_30d:              i.pct_30d ?? null,
  }))

  return { totalCents, itemCount, uniqueCards, pct30dWeighted, items, currency, usedLegacyFallback }
}
