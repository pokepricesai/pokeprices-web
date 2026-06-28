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
 *  count-with-join shape is finicky; two cheap queries are safer. */
export async function loadPortfolioItemCount(supa: SupabaseClient, userId: string): Promise<number> {
  if (!userId) return 0
  const { data: portfolios, error: pfErr } = await supa
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
  if (pfErr || !Array.isArray(portfolios) || portfolios.length === 0) return 0
  const ids = (portfolios as Array<{ id: string }>).map(p => p.id).filter(Boolean)
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
