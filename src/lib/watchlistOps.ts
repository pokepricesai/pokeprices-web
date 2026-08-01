// Block 5A-W-50B-FIX1 — shared watchlist add helper.
//
// Extracted from SetCardTileActions.tsx (which mirrors the pattern
// used by CardQuickActions on individual card pages) so the set-page
// replay path can reuse the exact same upsert / dedup contract.
//
// Identity: (user_id, card_slug, set_name). Never card_slug alone.

import type { SupabaseClient } from '@supabase/supabase-js'

export type WatchlistAddCard = {
  card_slug:    string    // bare numeric (no pc- prefix)
  card_name:    string
  set_name:     string
  image_url:    string | null
  card_number:  string | null
  raw_usd:      number | null
  psa10_usd:    number | null
}

/** Inserts a watchlist row if not already present. Returns the row id
 *  on success or null on failure. Never inserts a duplicate for the
 *  same (user_id, card_slug, set_name). */
export async function performWatchlistAdd(
  supabase: SupabaseClient,
  userId:   string,
  card:     WatchlistAddCard,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('watchlist')
    .select('id')
    .eq('user_id', userId)
    .eq('card_slug', card.card_slug)
    .eq('set_name', card.set_name)
    .maybeSingle()
  if (existing?.id) return existing.id
  const { data: row, error } = await supabase.from('watchlist').insert([{
    user_id:       userId,
    card_slug:     card.card_slug,
    card_name:     card.card_name,
    set_name:      card.set_name,
    card_url_slug: card.card_slug,
    image_url:     card.image_url,
    card_number:   card.card_number,
    raw_at_add:    card.raw_usd,
    psa10_at_add:  card.psa10_usd,
  }]).select('id').single()
  if (error) return null
  return row?.id ?? null
}
