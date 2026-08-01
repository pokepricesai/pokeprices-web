// Block 5A-W-50B — bulk membership loader for the set page.
//
// A set page can render 100+ card tiles. Issuing per-tile watchlist
// and portfolio SELECTs would be an obvious N+1. Instead we make TWO
// queries per set-load, both keyed on (user_id, set_name), and
// return sets of card_slug strings for fast .has() checks in each
// tile.
//
// Every write path already keys on (user_id, card_slug, set_name)
// for watchlist and (portfolio_id, card_slug, set_name_snapshot,
// holding_type) for portfolio_items — so scoping the SELECT by
// set_name is safe and does not include cards from other sets.
//
// Anonymous users must not make either query. Callers check
// `user?.id` before invoking.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SetMembership = {
  watched:     Set<string>   // card_slug values (bare, no pc- prefix)
  inPortfolio: Set<string>   // card_slug values
}

export const EMPTY_MEMBERSHIP: SetMembership = {
  watched: new Set(),
  inPortfolio: new Set(),
}

/** Normalise a card_slug to the bare form used by watchlist /
 *  portfolio_items. Everything else on the site uses bare too; this
 *  guard exists so a caller who accidentally hands us a `pc-` slug
 *  still gets a correct match. */
export function normaliseSlug(s: string | null | undefined): string {
  if (!s) return ''
  const str = String(s)
  return str.startsWith('pc-') ? str.slice(3) : str
}

export async function loadSetMembership(
  supabase: SupabaseClient,
  userId:   string,
  setName:  string,
): Promise<SetMembership> {
  const [wl, pf] = await Promise.all([
    supabase
      .from('watchlist')
      .select('card_slug')
      .eq('user_id', userId)
      .eq('set_name', setName),
    supabase
      .from('portfolio_items')
      .select('card_slug')
      .eq('user_id', userId)
      .eq('set_name_snapshot', setName),
  ])
  const watched     = new Set<string>((wl.data ?? []).map((r: any) => normaliseSlug(r.card_slug)))
  const inPortfolio = new Set<string>((pf.data ?? []).map((r: any) => normaliseSlug(r.card_slug)))
  return { watched, inPortfolio }
}
