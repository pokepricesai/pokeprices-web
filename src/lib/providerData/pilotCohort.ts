import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// PP-TCG-CUTOVER-PREP-01 §3 — pilot cohort allowlist resolver.
//
// Second gate after the PP_USE_TCGGRAPH_* env flags. Even with an
// env flag ON globally, the public adapter must serve TCGGraph data
// only for pp_card_slugs explicitly enabled in pokemon_tcg_pilot_cohort
// for the specific feature.
//
// Returning `{ prices: false, images: false, history: false }` is the
// default for any slug not in the pilot. The adapter MUST treat that
// as "do not use TCGGraph" — i.e. fall back to legacy card_trends.

export interface PilotFeatures {
  prices: boolean;
  images: boolean;
  history: boolean;
}

const DEFAULT_OFF: PilotFeatures = {
  prices: false,
  images: false,
  history: false,
};

export async function getPilotFeatures(
  sb: SupabaseClient,
  pp_card_slug: string,
): Promise<PilotFeatures> {
  const { data, error } = await sb
    .from('v_pokemon_tcg_pilot_active')
    .select('prices_enabled,images_enabled,history_enabled')
    .eq('pp_card_slug', pp_card_slug)
    .maybeSingle();
  // Fail closed: any error or missing row → not in pilot.
  if (error) return DEFAULT_OFF;
  if (!data) return DEFAULT_OFF;
  return {
    prices: !!data.prices_enabled,
    images: !!data.images_enabled,
    history: !!data.history_enabled,
  };
}
