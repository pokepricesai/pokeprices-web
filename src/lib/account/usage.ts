// src/lib/account/usage.ts
// Block 5A-W-24 — small client-side count loaders used by the
// entitlement guards on every add path. Each function is RLS-scoped
// to the supplied user_id, so callers don't need to think about
// permission boundaries.
//
// All three loaders return 0 on error (rather than throwing) so an
// add path's gate check fails OPEN: if we can't load the count we
// don't accidentally block a legitimate add. The real failure path
// is the insert itself, which still surfaces its own error.

import type { SupabaseClient } from '@supabase/supabase-js'

/** Block 5A-W-42A-FIX2 — resolve every portfolio_id this user owns.
 *
 *  Two-tier lookup that MIRRORS the working dashboard scope used by
 *  PortfolioDashboard.tsx::loadPortfolio and src/lib/alerts/weeklyDigest.ts::loadPortfolioItems:
 *
 *    1. Prefer `is_default = true` — this is the flag PortfolioDashboard
 *       sets when a default portfolio is created ("My Collection"). It's
 *       the scope every logged-in user sees on /dashboard/portfolio.
 *    2. Fall back to ANY portfolios the user owns when no row carries
 *       `is_default = true`. Legacy users predating the flag (Block
 *       5A-W-16G comment in weeklyDigest.ts calls them "legacy users")
 *       don't have the boolean set on their existing portfolio row.
 *
 *  Returns an empty array on any error / missing rows — never throws. */
export async function loadUserPortfolioIds(supa: SupabaseClient, userId: string): Promise<string[]> {
  if (!userId) return []
  try {
    // Preferred: is_default = true (dashboard-parity scope)
    const { data: defaultRows } = await supa
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
    if (Array.isArray(defaultRows) && defaultRows.length > 0) {
      return (defaultRows as Array<{ id: string }>).map(r => r.id).filter(Boolean)
    }
    // Legacy fallback: any portfolios this user owns
    const { data: anyRows } = await supa
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
    if (Array.isArray(anyRows) && anyRows.length > 0) {
      return (anyRows as Array<{ id: string }>).map(r => r.id).filter(Boolean)
    }
    return []
  } catch {
    return []
  }
}

/** Count rows in `watchlist` for this user. */
export async function loadWatchlistCount(supa: SupabaseClient, userId: string): Promise<number> {
  if (!userId) return 0
  const { count, error } = await supa
    .from('watchlist')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error || typeof count !== 'number') return 0
  return count
}

/** Count `portfolio_items` rows across ALL of this user's portfolios.
 *  Two-step (portfolios → items) instead of a join because PostgREST's
 *  count-with-join shape is finicky; two cheap queries are safer.
 *
 *  Block 5A-W-42A-FIX2 — now delegates to loadUserPortfolioIds so the
 *  is_default→all-portfolios fallback stays consistent across every
 *  caller (dashboard hub, onboarding checklist, entitlement guards). */
export async function loadPortfolioItemCount(supa: SupabaseClient, userId: string): Promise<number> {
  if (!userId) return 0
  const ids = await loadUserPortfolioIds(supa, userId)
  if (ids.length === 0) return 0
  const { count, error } = await supa
    .from('portfolio_items')
    .select('id', { count: 'exact', head: true })
    .in('portfolio_id', ids)
  if (error || typeof count !== 'number') return 0
  return count
}

/** Count cards with an ACTIVE custom alert override — i.e. rows in
 *  watchlist_alert_overrides where enabled=true AND use_global_defaults=false.
 *  Rows with enabled=false (silenced cards) and rows that inherit
 *  global defaults are NOT counted; the limit is on "actually
 *  customised". */
export async function loadCustomAlertOverrideCount(supa: SupabaseClient, userId: string): Promise<number> {
  if (!userId) return 0
  const { count, error } = await supa
    .from('watchlist_alert_overrides')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('enabled', true)
    .eq('use_global_defaults', false)
  if (error || typeof count !== 'number') return 0
  return count
}
