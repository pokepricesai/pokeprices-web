// src/app/dashboard/watchlist-alerts/overrideStatus.ts
// Block 5A-W-19 bugfix — pure helpers extracted from
// WatchlistAlertOverrideControl so the visible-state logic can be
// unit-tested in the node test env without pulling React + the
// browser supabase client.
//
// The companion component renders these strings; the helper is the
// canonical source of truth for "what does this row mean to the user?".

/** Shape of a single row in `watchlist_alert_overrides`, plus the
 *  in-memory shape the component uses BEFORE a row exists in the DB. */
export type OverrideRow = {
  id?:                       string
  enabled:                   boolean
  use_global_defaults:       boolean
  rise_pct:                  number | null
  drop_pct:                  number | null
  recent_sales_enabled:      boolean
  market_activity_enabled:   boolean
}

/** Seed values shown in the panel when the user first toggles
 *  use_global_defaults off. Tunable in one place. */
export const SUGGESTED_RISE = 20
export const SUGGESTED_DROP = 10

/** What the component starts with when there's no row yet. */
export const DEFAULT_ROW: OverrideRow = {
  enabled:                  true,
  use_global_defaults:      true,
  rise_pct:                 null,
  drop_pct:                 null,
  recent_sales_enabled:     true,
  market_activity_enabled:  true,
}

/** State name shown in the chip + the explanatory subtitle copy.
 *  Three cases:
 *    * row.enabled === false           → "OFF" / "Alerts off for this card"
 *    * row.use_global_defaults === true → "ON" / "Using global defaults"
 *    * otherwise                       → "ON" / "Custom: rise X% · drop Y%"
 *
 *  When the user hasn't customised yet, rise/drop are null — we show
 *  the SUGGESTED defaults in the summary copy so the chip never
 *  reads "Custom: rise null%". */
export function describeOverrideState(row: OverrideRow): {
  stateLabel: 'ON' | 'OFF'
  summary:    string
  isCustom:   boolean
} {
  if (!row.enabled) {
    return { stateLabel: 'OFF', summary: 'Alerts off for this card', isCustom: false }
  }
  if (row.use_global_defaults) {
    return { stateLabel: 'ON', summary: 'Using global defaults', isCustom: false }
  }
  const rise = row.rise_pct ?? SUGGESTED_RISE
  const drop = row.drop_pct ?? SUGGESTED_DROP
  return {
    stateLabel: 'ON',
    summary:    `Custom: rise ${rise}% · drop ${drop}%`,
    isCustom:   true,
  }
}
