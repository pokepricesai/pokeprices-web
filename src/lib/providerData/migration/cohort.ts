// PP-TCG migration — idempotent cohort row flip + URL resolver.
// Preserves existing cohort notes field (does not overwrite). Migration
// ownership is tracked separately in pp_tcg_migration_run_item.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Resolve the public card URL for a slug using the SAME encoding the
 *  Next.js route expects (encodeURIComponent on set_name + url_slug). */
export async function urlForSlug(sb: SupabaseClient, pp_card_slug: string): Promise<string | null> {
  const { data, error } = await sb.from('cards')
    .select('set_name,card_url_slug,card_slug')
    .eq('card_slug', pp_card_slug).maybeSingle()
  if (error || !data?.set_name) return null
  const urlSlug = (data as { card_url_slug?: string | null; card_slug?: string }).card_url_slug
             ?? (data as { card_slug?: string }).card_slug
             ?? pp_card_slug
  return `https://www.pokeprices.io/set/${encodeURIComponent(String(data.set_name))}/card/${encodeURIComponent(String(urlSlug))}`
}

/** Idempotent cohort flip. If already in the requested state, no-op.
 *  Only mutates prices_enabled, activated_at, deactivated_at, updated_at.
 *  Does NOT touch images_enabled, history_enabled, notes. */
export async function flipCohortIdempotent(
  sb: SupabaseClient,
  pp_card_slug: string,
  target_prices_enabled: boolean,
): Promise<{ changed: boolean; before: boolean | null; error?: string }> {
  const { data: before, error: readErr } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('prices_enabled').eq('pp_card_slug', pp_card_slug).maybeSingle()
  if (readErr) return { changed: false, before: null, error: `cohort read: ${readErr.message}` }
  if (!before) return { changed: false, before: null, error: 'no cohort row — enrollment should run first' }
  if (before.prices_enabled === target_prices_enabled) {
    return { changed: false, before: before.prices_enabled }
  }
  const now = new Date().toISOString()
  const patch = target_prices_enabled
    ? { prices_enabled: true,  deactivated_at: null, activated_at: now, updated_at: now }
    : { prices_enabled: false, deactivated_at: now,                      updated_at: now }
  const { error: upErr } = await sb.from('pokemon_tcg_pilot_cohort')
    .update(patch).eq('pp_card_slug', pp_card_slug)
  if (upErr) return { changed: false, before: before.prices_enabled, error: `cohort update: ${upErr.message}` }
  return { changed: true, before: before.prices_enabled }
}
