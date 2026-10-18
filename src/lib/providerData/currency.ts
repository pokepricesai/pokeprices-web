import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// PP-TCG-MIGRATE-04 §6: display-currency helper.
//
// The source currency is NEVER changed in the database (TCGplayer
// stays USD, Cardmarket stays EUR). The helper converts for DISPLAY
// only, using the daily FX snapshot in pokemon_tcg_fx_rates.
//
// The user's preferred display currency comes from a cookie
// (`pp_display_ccy`, 'USD' or 'EUR'; defaults to USD). Public pages
// MUST stay cacheable, so the cookie is read server-side via Next
// cookies() and injected into the render tree. No cross-currency
// variants of the same URL are indexed — the canonical renders in
// USD; any EUR variant is operator-only + `noindex`.

export type DisplayCurrency = 'USD' | 'EUR'

export const DISPLAY_CCY_COOKIE = 'pp_display_ccy'

export function parseDisplayCcy(raw: string | null | undefined): DisplayCurrency {
  if (raw === 'EUR') return 'EUR'
  return 'USD'
}

export interface FxTable {
  as_of: string
  rates: Partial<Record<`${DisplayCurrency}_${DisplayCurrency}`, number>>
}

/** Load the latest FX snapshot. One row per direction × identity
 *  pairs is kept, so we can look up directly without computing an
 *  inverse at display time. */
export async function loadLatestFxTable(sb: SupabaseClient): Promise<FxTable | null> {
  const { data, error } = await sb.from('pokemon_tcg_fx_rates')
    .select('as_of, base, quote, rate')
    .order('as_of', { ascending: false })
    .limit(10)
  if (error || !data || data.length === 0) return null
  const asOf = (data[0] as any).as_of
  const sameDay = data.filter((r: any) => r.as_of === asOf)
  const rates: FxTable['rates'] = {}
  for (const r of sameDay as any[]) {
    const k = `${r.base}_${r.quote}` as const
    rates[k as keyof FxTable['rates']] = Number(r.rate)
  }
  return { as_of: asOf, rates }
}

/** Convert `value` from `sourceCurrency` into the user's `displayCcy`.
 *  Returns a tuple (converted, methodologyNote). Methodology note is
 *  non-empty whenever a non-identity conversion happened — the
 *  renderer MUST display it so a converted €-to-$ amount is never
 *  confused with a native USD quote. */
export function convertForDisplay(
  value: number | null | undefined,
  sourceCurrency: DisplayCurrency,
  displayCcy: DisplayCurrency,
  fx: FxTable | null,
): { converted: number | null; isConverted: boolean; note: string | null; asOf: string | null } {
  if (value == null || !Number.isFinite(Number(value))) {
    return { converted: null, isConverted: false, note: null, asOf: null }
  }
  if (sourceCurrency === displayCcy) {
    return { converted: Number(value), isConverted: false, note: null, asOf: fx?.as_of ?? null }
  }
  if (!fx) {
    return { converted: null, isConverted: false, note: 'FX unavailable; shown in source currency only.', asOf: null }
  }
  const key = `${sourceCurrency}_${displayCcy}` as const
  const rate = fx.rates[key]
  if (rate == null || !Number.isFinite(rate)) {
    return { converted: null, isConverted: false, note: `No ${sourceCurrency}→${displayCcy} rate for ${fx.as_of}.`, asOf: fx.as_of }
  }
  const converted = Number(value) * rate
  const note = `Converted from ${sourceCurrency} using ${rate.toFixed(4)} as of ${fx.as_of}.`
  return { converted, isConverted: true, note, asOf: fx.as_of }
}

export function formatPrice(value: number | null | undefined, ccy: DisplayCurrency): string {
  if (value == null) return '—'
  const sym = ccy === 'USD' ? '$' : '€'
  const v = Number(value)
  if (v >= 1000) return `${sym}${Math.round(v).toLocaleString('en-US')}`
  return `${sym}${v.toFixed(2)}`
}
