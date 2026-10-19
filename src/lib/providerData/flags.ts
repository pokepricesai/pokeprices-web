import 'server-only';

// Feature-flag reader for the PP-TCG-MIGRATE-01 provider cut-over.
//
// All three flags default to FALSE. The flags gate the public read
// path from PokePrices to the TCGGraph provider tables introduced
// in migration 20261018020000. Until an operator explicitly enables
// a flag in production env, PokePrices continues to read
// PriceCharting-derived data from card_trends as it does today.
//
// Enabling any flag MUST follow the staged activation protocol in
// docs/pp-tcg-migrate-01/CUTOVER.md. Do not flip these in CI, in a
// deploy preview, or at build time.

type FlagKey =
  | 'tcggraph_prices'       // use provider market/graded prices on card pages
  | 'tcggraph_images'       // use provider images on card pages
  | 'tcggraph_history'      // use provider history for chart
  | 'currency_selector';    // render the USD/EUR header selector on public pages

const ENV_KEYS: Record<FlagKey, string> = {
  tcggraph_prices:   'PP_USE_TCGGRAPH_PRICES',
  tcggraph_images:   'PP_USE_TCGGRAPH_IMAGES',
  tcggraph_history:  'PP_USE_TCGGRAPH_HISTORY',
  currency_selector: 'PP_USE_CURRENCY_SELECTOR',
};

export function isProviderFlagEnabled(key: FlagKey): boolean {
  const envKey = ENV_KEYS[key];
  const raw = process.env[envKey];
  return raw === '1' || raw === 'true' || raw === 'TRUE';
}

export function listProviderFlags(): Record<FlagKey, boolean> {
  return {
    tcggraph_prices:   isProviderFlagEnabled('tcggraph_prices'),
    tcggraph_images:   isProviderFlagEnabled('tcggraph_images'),
    tcggraph_history:  isProviderFlagEnabled('tcggraph_history'),
    currency_selector: isProviderFlagEnabled('currency_selector'),
  };
}
