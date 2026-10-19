import 'server-only';
import { isProviderFlagEnabled } from './flags';
import { getPilotFeatures } from './pilotCohort';

// Server-side resolver for a single PP card's TCGGraph provider
// snapshot. Returns null unless the matching feature flag is ON.
//
// Reads only from:
//   • pokemon_tcg_mappings           (identity, review_status, pricing_eligibility)
//   • pokemon_tcg_provider_cards      (per-printing identity + images)
//   • pokemon_tcg_prices_market       (per source × finish × currency)
//   • pokemon_tcg_prices_graded       (per grader × grade)
//
// Does NOT touch public.cards or public.card_trends. Does NOT
// publish anything. Pure data read.
//
// Guard rails baked in:
//   • Only returns a snapshot when the mapping is `approved`.
//   • Only returns bulk_safe prices when the row is marked bulk_safe.
//     For market_only mappings, graded prices are suppressed and
//     only per-finish market quotes are returned.
//   • Never substitutes a different printing's prices.
//   • Pooled grade is labelled "any:{grade}" — never psa-9.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ProviderPricingEligibility =
  | 'bulk_safe' | 'market_only' | 'identity_only' | 'not_eligible' | 'uncertain';

export interface ProviderMarketPrice {
  source: 'tcgplayer' | 'cardmarket' | 'cardkingdom' | 'manapool';
  finish: string | null;
  list_type: 'retail' | 'buylist';
  currency: string;
  market: number | null;
  low: number | null;
  trend: number | null;
  source_updated_at: string | null;
}

export interface ProviderGradedPrice {
  grader: 'raw' | 'any' | 'psa' | 'bgs' | 'cgc' | 'sgc';
  grade: 'ungraded' | '7' | '8' | '9' | '9.5' | '10';
  currency: string;
  price: number | null;
  sales_volume: number | null;
  source_updated_at: string | null;
}

export interface ProviderSnapshot {
  pp_card_slug: string;
  tcg_card_id: string;
  tcg_printing_key: string;
  tcg_set_code: string;
  tcg_language: string;
  tcg_name: string | null;
  pricing_eligibility: ProviderPricingEligibility;
  image_normal: string | null;
  image_large: string | null;
  image_source: string | null;
  market_prices: ProviderMarketPrice[];
  graded_prices: ProviderGradedPrice[];
}

export interface GetSnapshotOptions {
  /** Admin preview mode: skip the "mapping must be approved" gate so
   *  the operator can see what each card would look like after
   *  approval + flag flip. The pricing_eligibility gate still applies
   *  — variants still never leak aggregate graded. Defaults to false. */
  previewMode?: boolean;
  /** In preview mode, ignore the global feature flags (the operator
   *  is explicitly looking at this). Defaults to true when previewMode
   *  is true, false otherwise. */
  ignoreFlags?: boolean;
  /** In preview mode, bypass the pilot allowlist. Defaults to true
   *  when previewMode is true, false otherwise. Public callers MUST
   *  not pass this. */
  ignorePilotCohort?: boolean;
}

export async function getProviderSnapshot(
  sb: SupabaseClient,
  pp_card_slug: string,
  opts: GetSnapshotOptions = {},
): Promise<ProviderSnapshot | null> {
  const previewMode = !!opts.previewMode;
  const ignoreFlags = opts.ignoreFlags ?? previewMode;
  const ignorePilot = opts.ignorePilotCohort ?? previewMode;

  const { data: mapping, error: mErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('tcg_card_id, tcg_printing_key, tcg_set_code, tcg_language, tcg_name, review_status, pricing_eligibility')
    .eq('provider', 'tcggraph')
    .eq('pp_card_slug', pp_card_slug)
    .maybeSingle();
  if (mErr || !mapping) return null;
  if (!previewMode && mapping.review_status !== 'approved') return null;
  if (!mapping.tcg_card_id || !mapping.tcg_printing_key) return null;

  // PP-TCG-QA-FINAL §3 — FAIL CLOSED on missing QA.
  //
  // Read eligibility from the effective view, which returns the MORE
  // RESTRICTIVE of (mapping.pricing_eligibility, qa.recommended). If
  // the view errors, returns no row, or returns null — the mapping is
  // treated as not_eligible for public display. We NEVER fall back to
  // the raw bulk_safe label on the mapping, because that would silently
  // activate pricing/images for a card whose QA has not been run or
  // has recommended a stricter eligibility that failed to apply.
  const { data: effective, error: effErr } = await sb
    .from('v_pokemon_tcg_effective_eligibility')
    .select('effective_eligibility')
    .eq('pp_card_slug', pp_card_slug)
    .eq('provider', 'tcggraph')
    .maybeSingle();
  if (effErr) return null;             // DB error → fail closed
  if (!effective) return null;         // no QA row at all → fail closed
  if (!effective.effective_eligibility) return null;  // null effective → fail closed
  const effectiveEligibility = effective.effective_eligibility as ProviderPricingEligibility;

  // PP-TCG-PRINTING-RECLASS-FIX §3 — exclude superseded provider_cards
  // rows from public reads. A row flagged provider_status='superseded'
  // represents a printing_key the TCGGraph provider has since
  // reclassified — serving its stale image/price would be wrong. The
  // underlying row + historical prices remain in the database for
  // audit; this filter keeps them out of the public read path.
  const [cardRes, marketRes, gradedRes] = await Promise.all([
    sb.from('pokemon_tcg_provider_cards')
      .select('image_small, image_normal, image_large, image_source')
      .eq('provider', 'tcggraph')
      .eq('tcg_card_id', mapping.tcg_card_id)
      .eq('tcg_printing_key', mapping.tcg_printing_key)
      .eq('provider_status', 'active')
      .maybeSingle(),
    sb.from('pokemon_tcg_prices_market')
      .select('source, finish, list_type, currency, market, low, trend, source_updated_at')
      .eq('provider', 'tcggraph')
      .eq('tcg_card_id', mapping.tcg_card_id)
      .eq('tcg_printing_key', mapping.tcg_printing_key),
    sb.from('pokemon_tcg_prices_graded')
      .select('grader, grade, currency, price, sales_volume, source_updated_at')
      .eq('provider', 'tcggraph')
      .eq('tcg_card_id', mapping.tcg_card_id),
  ]);

  const eligibility = effectiveEligibility;

  // Price-eligibility gate — never leak aggregate graded onto a
  // variant printing, never leak anything from identity_only /
  // not_eligible / uncertain rows. Applies in BOTH preview and
  // public modes; only the mapping-approved + pilot gates differ.
  const priceFlagOn = ignoreFlags ? true : isProviderFlagEnabled('tcggraph_prices');
  const imageFlagOn = ignoreFlags ? true : isProviderFlagEnabled('tcggraph_images');

  // PP-TCG-CUTOVER-PREP-01 §3 — pilot allowlist, per-feature.
  // Any slug NOT in the allowlist defaults to all-features-off, which
  // means the public adapter returns an "identity-only or null" snapshot
  // — i.e. legacy card_trends keeps serving. This is the gate that
  // prevents a flipped env flag from accidentally activating all
  // 37,224 approved mappings.
  const pilot = ignorePilot
    ? { prices: true, images: true, history: true }
    : await getPilotFeatures(sb, pp_card_slug);

  // PP-TCG-PRINTING-RECLASS-CLOSEOUT §4 — if the provider_cards lookup
  // returned no row (the (card_id, printing_key) is NOT active — either
  // superseded or absent), the printing is reclassified or missing.
  // Suppress market + graded on this printing too, not just the image.
  // The prices_market/prices_graded rows for the OLD printing_key are
  // "incompatible" with the current provider truth and must not surface.
  const providerCardActive = !!cardRes.data;

  const canReturnMarket = providerCardActive && priceFlagOn && pilot.prices &&
    (eligibility === 'bulk_safe' || eligibility === 'market_only');
  // Graded is pooled per card_id — not per printing. We still gate on
  // providerCardActive so a card with every printing superseded (no
  // active row at all) stops serving graded. If the SAME card_id has
  // an active row for a DIFFERENT printing_key, the current mapping's
  // provider_card is still null and graded is suppressed — that's the
  // safe choice until the mapping is remapped to the active printing.
  const canReturnGraded = providerCardActive && priceFlagOn && pilot.prices &&
    eligibility === 'bulk_safe';
  const canReturnImages = providerCardActive && imageFlagOn && pilot.images &&
    (eligibility === 'bulk_safe' || eligibility === 'market_only' || eligibility === 'identity_only');

  return {
    pp_card_slug,
    tcg_card_id: mapping.tcg_card_id,
    tcg_printing_key: mapping.tcg_printing_key,
    tcg_set_code: mapping.tcg_set_code ?? '',
    tcg_language: mapping.tcg_language ?? '',
    tcg_name: mapping.tcg_name,
    pricing_eligibility: eligibility,
    image_normal: canReturnImages ? (cardRes.data?.image_normal ?? null) : null,
    image_large: canReturnImages ? (cardRes.data?.image_large ?? null) : null,
    image_source: canReturnImages ? (cardRes.data?.image_source ?? null) : null,
    market_prices: canReturnMarket ? ((marketRes.data as ProviderMarketPrice[]) || []) : [],
    graded_prices: canReturnGraded ? ((gradedRes.data as ProviderGradedPrice[]) || []) : [],
  };
}
