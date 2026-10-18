import 'server-only';
import { isProviderFlagEnabled } from './flags';

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
}

export async function getProviderSnapshot(
  sb: SupabaseClient,
  pp_card_slug: string,
  opts: GetSnapshotOptions = {},
): Promise<ProviderSnapshot | null> {
  const previewMode = !!opts.previewMode;
  const ignoreFlags = opts.ignoreFlags ?? previewMode;

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

  const [cardRes, marketRes, gradedRes] = await Promise.all([
    sb.from('pokemon_tcg_provider_cards')
      .select('image_small, image_normal, image_large, image_source')
      .eq('provider', 'tcggraph')
      .eq('tcg_card_id', mapping.tcg_card_id)
      .eq('tcg_printing_key', mapping.tcg_printing_key)
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
  // public modes; only the mapping-approved gate differs.
  const priceFlagOn = ignoreFlags ? true : isProviderFlagEnabled('tcggraph_prices');
  const imageFlagOn = ignoreFlags ? true : isProviderFlagEnabled('tcggraph_images');
  const canReturnMarket = priceFlagOn &&
    (eligibility === 'bulk_safe' || eligibility === 'market_only');
  const canReturnGraded = priceFlagOn &&
    eligibility === 'bulk_safe';
  const canReturnImages = imageFlagOn &&
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
