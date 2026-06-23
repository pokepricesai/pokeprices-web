// src/lib/alerts/preferences.ts
// Block 5A-W-1 — typed helpers for the rule-based alert preference
// model. Pure shape + small DB wrappers; no email send, no cron, no
// evaluation logic.
//
// The defaults here are the SAME values declared in
// migrations/2026-06-23-user-alert-preferences.sql so that a row read
// before any save and a row read after the SQL DEFAULTs kick in are
// identical.
//
// Imported by both the user-facing settings UI (camelCase typed
// helpers) and any future server-side evaluator (snake_case row
// adapter). NO 'server-only' guard — the same default object is safe
// in either bundle.

import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────
// Rule taxonomy — keep in lockstep with the CHECK constraint on
// alert_events.rule in the migration.
// ─────────────────────────────────────────────────────────────────────
export const ALERT_RULES = [
  'price_move',
  'recent_sales',
  'psa10_change',
  'raw_change',
  'spread_change',
  'market_activity',
] as const

export type AlertRule = (typeof ALERT_RULES)[number]

export const ALERT_RULE_LABELS: Record<AlertRule, string> = {
  price_move:      'Price moved up or down',
  recent_sales:    'New recent sales available',
  psa10_change:    'PSA 10 price changed',
  raw_change:      'Raw price changed',
  spread_change:   'Raw → PSA 10 spread widened or narrowed',
  market_activity: 'Card has meaningful market activity',
}

// ─────────────────────────────────────────────────────────────────────
// Preference shape — TypeScript view of user_alert_preferences.
// ─────────────────────────────────────────────────────────────────────
export type UserAlertPreferences = {
  enabled:                       boolean
  scopeWatchlist:                boolean
  scopePortfolio:                boolean

  rulePriceMoveEnabled:          boolean
  rulePriceMovePct:              number

  ruleRecentSalesEnabled:        boolean

  ruleMyPSA10ChangeEnabled:      boolean
  ruleMyPSA10ChangePct:          number

  ruleRawChangeEnabled:          boolean
  ruleRawChangePct:              number

  ruleSpreadChangeEnabled:       boolean
  ruleSpreadChangePct:           number

  ruleMarketActivityEnabled:     boolean

  minHoursBetweenAlerts:         number
}

export const ALERT_PREFERENCE_DEFAULTS: UserAlertPreferences = {
  enabled:                   true,
  scopeWatchlist:            true,
  scopePortfolio:            true,

  rulePriceMoveEnabled:      true,
  rulePriceMovePct:          10,

  ruleRecentSalesEnabled:    true,

  ruleMyPSA10ChangeEnabled:  true,
  ruleMyPSA10ChangePct:      10,

  ruleRawChangeEnabled:      true,
  ruleRawChangePct:          10,

  ruleSpreadChangeEnabled:   false,
  ruleSpreadChangePct:       15,

  ruleMarketActivityEnabled: true,

  minHoursBetweenAlerts:     24,
}

// ─────────────────────────────────────────────────────────────────────
// Bounds — used for validation in the UI and on the wire. Anything
// outside these bounds is clamped at save time so the DB CHECK
// constraint cannot reject the row.
// ─────────────────────────────────────────────────────────────────────
export const ALERT_PREFERENCE_BOUNDS = {
  rulePriceMovePct:       { min: 1, max: 100 },
  ruleMyPSA10ChangePct:   { min: 1, max: 100 },
  ruleRawChangePct:       { min: 1, max: 100 },
  ruleSpreadChangePct:    { min: 1, max: 100 },
  minHoursBetweenAlerts:  { min: 0, max: 168 },
} as const

function clamp(n: number, min: number, max: number): number {
  const i = Math.floor(Number.isFinite(n) ? n : 0)
  if (i < min) return min
  if (i > max) return max
  return i
}

/**
 * Coerce + clamp a partial patch into a fully-typed UserAlertPreferences.
 * The base is the existing preferences (or defaults). Unknown keys are
 * dropped; out-of-bounds numbers are clamped to the CHECK constraint.
 */
export function applyPatch(
  base: UserAlertPreferences,
  patch: Partial<UserAlertPreferences>,
): UserAlertPreferences {
  const out: UserAlertPreferences = { ...base }
  if (typeof patch.enabled                  === 'boolean') out.enabled                  = patch.enabled
  if (typeof patch.scopeWatchlist           === 'boolean') out.scopeWatchlist           = patch.scopeWatchlist
  if (typeof patch.scopePortfolio           === 'boolean') out.scopePortfolio           = patch.scopePortfolio

  if (typeof patch.rulePriceMoveEnabled     === 'boolean') out.rulePriceMoveEnabled     = patch.rulePriceMoveEnabled
  if (typeof patch.rulePriceMovePct         === 'number')  out.rulePriceMovePct         = clamp(patch.rulePriceMovePct, ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.min,      ALERT_PREFERENCE_BOUNDS.rulePriceMovePct.max)

  if (typeof patch.ruleRecentSalesEnabled   === 'boolean') out.ruleRecentSalesEnabled   = patch.ruleRecentSalesEnabled

  if (typeof patch.ruleMyPSA10ChangeEnabled === 'boolean') out.ruleMyPSA10ChangeEnabled = patch.ruleMyPSA10ChangeEnabled
  if (typeof patch.ruleMyPSA10ChangePct     === 'number')  out.ruleMyPSA10ChangePct     = clamp(patch.ruleMyPSA10ChangePct, ALERT_PREFERENCE_BOUNDS.ruleMyPSA10ChangePct.min, ALERT_PREFERENCE_BOUNDS.ruleMyPSA10ChangePct.max)

  if (typeof patch.ruleRawChangeEnabled     === 'boolean') out.ruleRawChangeEnabled     = patch.ruleRawChangeEnabled
  if (typeof patch.ruleRawChangePct         === 'number')  out.ruleRawChangePct         = clamp(patch.ruleRawChangePct,    ALERT_PREFERENCE_BOUNDS.ruleRawChangePct.min,    ALERT_PREFERENCE_BOUNDS.ruleRawChangePct.max)

  if (typeof patch.ruleSpreadChangeEnabled  === 'boolean') out.ruleSpreadChangeEnabled  = patch.ruleSpreadChangeEnabled
  if (typeof patch.ruleSpreadChangePct      === 'number')  out.ruleSpreadChangePct      = clamp(patch.ruleSpreadChangePct, ALERT_PREFERENCE_BOUNDS.ruleSpreadChangePct.min, ALERT_PREFERENCE_BOUNDS.ruleSpreadChangePct.max)

  if (typeof patch.ruleMarketActivityEnabled === 'boolean') out.ruleMarketActivityEnabled = patch.ruleMarketActivityEnabled

  if (typeof patch.minHoursBetweenAlerts    === 'number')  out.minHoursBetweenAlerts    = clamp(patch.minHoursBetweenAlerts, ALERT_PREFERENCE_BOUNDS.minHoursBetweenAlerts.min, ALERT_PREFERENCE_BOUNDS.minHoursBetweenAlerts.max)

  return out
}

// ─────────────────────────────────────────────────────────────────────
// Row <-> camelCase shape conversion. Kept tight so a future evaluator
// can pull the row directly and feed it to evaluation logic.
// ─────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>

export function rowToPreferences(row: Row | null | undefined): UserAlertPreferences {
  if (!row) return { ...ALERT_PREFERENCE_DEFAULTS }
  const b = (k: string, def: boolean): boolean => typeof row[k] === 'boolean' ? row[k] as boolean : def
  const n = (k: string, def: number): number => {
    const v = row[k]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v)
    return def
  }
  const d = ALERT_PREFERENCE_DEFAULTS
  return {
    enabled:                   b('enabled',                       d.enabled),
    scopeWatchlist:            b('scope_watchlist',               d.scopeWatchlist),
    scopePortfolio:            b('scope_portfolio',               d.scopePortfolio),
    rulePriceMoveEnabled:      b('rule_price_move_enabled',       d.rulePriceMoveEnabled),
    rulePriceMovePct:          n('rule_price_move_pct',           d.rulePriceMovePct),
    ruleRecentSalesEnabled:    b('rule_recent_sales_enabled',     d.ruleRecentSalesEnabled),
    ruleMyPSA10ChangeEnabled:  b('rule_psa10_change_enabled',     d.ruleMyPSA10ChangeEnabled),
    ruleMyPSA10ChangePct:      n('rule_psa10_change_pct',         d.ruleMyPSA10ChangePct),
    ruleRawChangeEnabled:      b('rule_raw_change_enabled',       d.ruleRawChangeEnabled),
    ruleRawChangePct:          n('rule_raw_change_pct',           d.ruleRawChangePct),
    ruleSpreadChangeEnabled:   b('rule_spread_change_enabled',    d.ruleSpreadChangeEnabled),
    ruleSpreadChangePct:       n('rule_spread_change_pct',        d.ruleSpreadChangePct),
    ruleMarketActivityEnabled: b('rule_market_activity_enabled',  d.ruleMarketActivityEnabled),
    minHoursBetweenAlerts:     n('min_hours_between_alerts',      d.minHoursBetweenAlerts),
  }
}

export function preferencesToRow(p: UserAlertPreferences): Record<string, unknown> {
  return {
    enabled:                       p.enabled,
    scope_watchlist:               p.scopeWatchlist,
    scope_portfolio:               p.scopePortfolio,
    rule_price_move_enabled:       p.rulePriceMoveEnabled,
    rule_price_move_pct:           p.rulePriceMovePct,
    rule_recent_sales_enabled:     p.ruleRecentSalesEnabled,
    rule_psa10_change_enabled:     p.ruleMyPSA10ChangeEnabled,
    rule_psa10_change_pct:         p.ruleMyPSA10ChangePct,
    rule_raw_change_enabled:       p.ruleRawChangeEnabled,
    rule_raw_change_pct:           p.ruleRawChangePct,
    rule_spread_change_enabled:    p.ruleSpreadChangeEnabled,
    rule_spread_change_pct:        p.ruleSpreadChangePct,
    rule_market_activity_enabled:  p.ruleMarketActivityEnabled,
    min_hours_between_alerts:      p.minHoursBetweenAlerts,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Small DB wrappers — usable from any client (browser supabase client,
// service-role server client). The caller's auth context decides
// whether RLS lets the read/write through.
// ─────────────────────────────────────────────────────────────────────

/**
 * Load a user's alert preferences. Returns the defaults if no row
 * exists yet OR if the read fails (e.g. the migration has not been
 * applied yet). Never throws — the UI must always render.
 */
export async function loadUserAlertPreferences(
  supa:   SupabaseClient,
  userId: string,
): Promise<UserAlertPreferences> {
  try {
    const { data, error } = await supa
      .from('user_alert_preferences')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error || !data) return { ...ALERT_PREFERENCE_DEFAULTS }
    return rowToPreferences(data as Row)
  } catch {
    return { ...ALERT_PREFERENCE_DEFAULTS }
  }
}

/**
 * Upsert the user's preferences with a partial patch. Reads the
 * current row first (or defaults), applies the patch, and writes the
 * full normalised row. Returns the new effective preferences. Never
 * mutates the input patch.
 */
export async function saveUserAlertPreferences(
  supa:   SupabaseClient,
  userId: string,
  patch:  Partial<UserAlertPreferences>,
): Promise<UserAlertPreferences> {
  const current = await loadUserAlertPreferences(supa, userId)
  const next    = applyPatch(current, patch)
  await supa
    .from('user_alert_preferences')
    .upsert({ user_id: userId, ...preferencesToRow(next) }, { onConflict: 'user_id' })
  return next
}
