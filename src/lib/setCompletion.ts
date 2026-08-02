// Block 5A-W-50C — set-completion loader.
//
// Numerator: distinct card_slug values in the authenticated user's
// portfolio_items table, aggregated by set_name_snapshot. Multiple
// quantities, multiple holdings and multiple grades of the same card
// all count once.
//
// Denominator: eligible non-sealed card count per set. Sourced from
// `get_set_list_v2.card_count` on the browse page — the RPC already
// excludes sealed rows (verified against a representative sample of
// English, Japanese, Promo and pilot sets — every RPC card_count
// matched the live COUNT(*) FROM cards WHERE set_name = ? AND
// is_sealed = false). On the individual set page the denominator is
// `regularCards.length` — the same non-sealed filter applied to the
// per-set RPC.
//
// Identity: `set_name_snapshot` on portfolio_items is written from
// the internal `cards.set_name` (with the "Japanese " prefix for JP
// sets) by the existing add flow, so English and Japanese printings
// stay in separate buckets.
//
// Query budget:
//   * Anonymous users: 0 queries.
//   * Authenticated browse page: 1 paginated query (portfolio_items
//     rows for the user, bulk). Denominators come from the browse
//     page's existing get_set_list_v2 RPC — no additional request.
//   * Individual set page: 0 additional queries — reuses the
//     `SetMembership.inPortfolio` set already loaded by
//     loadSetMembership().

import type { SupabaseClient } from '@supabase/supabase-js'

export type SetCompletionEntry = {
  ownedDistinct: number
  totalEligible: number
  percentage:    number   // 0..100 inclusive, integer
}

export type SetCompletionMap = Record<string, SetCompletionEntry>

/** Pure helper — clamps + rounds a percentage. Exported for tests. */
export function computePercentage(owned: number, total: number): number {
  if (!Number.isFinite(owned) || !Number.isFinite(total)) return 0
  if (total <= 0 || owned <= 0) return 0
  const raw = (owned / total) * 100
  const clamped = Math.max(0, Math.min(100, raw))
  return Math.round(clamped)
}

/**
 * Aggregate a raw portfolio-items row list into distinct-slug counts
 * per set. Pure function so tests can pin the (user_id + set_name +
 * holding_type + quantity) → distinct-card behaviour without a live
 * database.
 */
export function aggregateOwned(
  rows: Array<{ card_slug: string | null; set_name_snapshot: string | null }>,
): Record<string, Set<string>> {
  const bySet: Record<string, Set<string>> = {}
  for (const r of rows) {
    const setName = r.set_name_snapshot
    const slug    = r.card_slug
    if (!setName || !slug) continue
    if (!bySet[setName]) bySet[setName] = new Set<string>()
    bySet[setName].add(slug)
  }
  return bySet
}

/**
 * Bulk-load owned-slug sets for one user, paginated. Returns
 * { setName: Set<card_slug> }. Every set the user has any
 * portfolio_items row for is present; empty sets are absent.
 */
export async function loadPortfolioOwnedBySet(
  supabase: SupabaseClient,
  userId:   string,
  pageSize: number = 1000,
): Promise<Record<string, Set<string>>> {
  const all: Array<{ card_slug: string | null; set_name_snapshot: string | null }> = []
  let offset = 0
  // Paginate defensively — PostgREST's default row cap is 1000, so a
  // user with a large portfolio would silently lose rows without
  // this loop.
  for (;;) {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('card_slug,set_name_snapshot')
      .eq('user_id', userId)
      .range(offset, offset + pageSize - 1)
    if (error) break
    if (!data || data.length === 0) break
    all.push(...(data as any))
    if (data.length < pageSize) break
    offset += pageSize
  }
  return aggregateOwned(all)
}

/**
 * Compose the full completion map for the browse page.
 *
 * @param owned  map from loadPortfolioOwnedBySet
 * @param totals map { setName: totalEligible } — on the browse page
 *               this comes from the existing get_set_list_v2 RPC
 *               response (each set's `card_count`), so no additional
 *               DB query is needed.
 */
export function buildCompletionMap(
  owned:  Record<string, Set<string>>,
  totals: Record<string, number>,
): SetCompletionMap {
  const out: SetCompletionMap = {}
  for (const setName of Object.keys(owned)) {
    const ownedDistinct = owned[setName].size
    const totalEligible = totals[setName] ?? 0
    // Only include a set the user actually has at least one card in.
    // Sets with ownedDistinct = 0 must NOT appear (per brief: "if
    // the user owns zero cards, show no percentage").
    if (ownedDistinct <= 0) continue
    out[setName] = {
      ownedDistinct,
      totalEligible,
      percentage: computePercentage(ownedDistinct, totalEligible),
    }
  }
  return out
}
