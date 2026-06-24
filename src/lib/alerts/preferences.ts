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

  // ─── Block 5A-W-13 additions ──────────────────────────────────────

  /** Weekly overview email — master switch for the digest. */
  weeklyDigestEnabled:           boolean
  /** Include the portfolio half of the weekly overview. */
  weeklyOverviewPortfolioEnabled: boolean
  /** Include the watchlist half of the weekly overview. */
  weeklyOverviewWatchlistEnabled: boolean
  /** ISO weekday for the weekly send (1=Mon … 7=Sun). */
  weeklyDigestDayOfWeek:         number

  /** Per-event ("instant") alert cadence. Separate from `enabled`
   *  (the master switch) so a user can keep the weekly overview
   *  while silencing per-event alerts. */
  instantAlertsEnabled:          boolean

  /** Threshold for price moves on cards the user OWNS. Tighter than
   *  the watchlist threshold by default — collectors care more about
   *  meaningful moves on owned cards. */
  rulePriceMovePortfolioPct:     number
  /** Threshold for price moves on cards the user merely watches. */
  rulePriceMoveWatchlistPct:     number

  /** Minimum count of fresh verified sales for the recent_sales
   *  rule to fire (within the rule's window). */
  ruleRecentSalesMinCount:       number
  /** Minimum count for the market_activity rule to fire. */
  ruleMarketActivityMinCount:    number

  /** Per-user override of the system-wide per-recipient digest
   *  cooldown (ALERT_DELIVERY_USER_COOLDOWN_HOURS). The orchestrator
   *  will eventually pick `max(env, user)` so the env value remains
   *  the operator-side floor. */
  digestCooldownHours:           number
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

  // Block 5A-W-13 — must mirror the column DEFAULTs in
  // migrations/2026-06-24-alert-preferences-v2.sql.
  weeklyDigestEnabled:             true,
  weeklyOverviewPortfolioEnabled:  true,
  weeklyOverviewWatchlistEnabled:  true,
  weeklyDigestDayOfWeek:           1,   // Monday

  instantAlertsEnabled:            true,

  rulePriceMovePortfolioPct:       10,
  rulePriceMoveWatchlistPct:       15,

  ruleRecentSalesMinCount:         3,
  ruleMarketActivityMinCount:      5,

  digestCooldownHours:             24,
}

// ─────────────────────────────────────────────────────────────────────
// Block 5A-W-13B — sensitivity presets.
//
// The Smart Alerts settings UI exposes a single 3-way "sensitivity"
// chooser (Conservative / Balanced / Active) that maps to the seven
// underlying threshold fields. Power users can still fine-tune each
// field via the Advanced settings disclosure; presets are a shortcut
// for the common case.
//
// Detection rule: a saved-pref row is reported as matching a preset
// only when ALL seven threshold fields match that preset exactly.
// One off-by-one and we fall back to 'custom' so the UI doesn't lie
// about what's stored.
// ─────────────────────────────────────────────────────────────────────

export const SENSITIVITY_PRESETS = ['conservative', 'balanced', 'active'] as const
export type SensitivityPreset = (typeof SENSITIVITY_PRESETS)[number]

/** Subset of UserAlertPreferences touched by a preset. The preset
 *  never flips enabled / scope / weekly / instant toggles — those
 *  stay where the user left them. */
type SensitivityThresholds = Pick<
  UserAlertPreferences,
  | 'rulePriceMovePortfolioPct'
  | 'rulePriceMoveWatchlistPct'
  | 'ruleRawChangePct'
  | 'ruleMyPSA10ChangePct'
  | 'ruleSpreadChangePct'
  | 'ruleRecentSalesMinCount'
  | 'ruleMarketActivityMinCount'
>

/** The threshold values each preset writes when chosen. Balanced is
 *  the system default — exposed as a separate constant so the test
 *  that pins these numbers also pins them against the migration
 *  defaults. Conservative widens the bands (fewer alerts). Active
 *  tightens them (more alerts). */
export const SENSITIVITY_PRESET_THRESHOLDS: Record<SensitivityPreset, SensitivityThresholds> = {
  conservative: {
    rulePriceMovePortfolioPct:  20,
    rulePriceMoveWatchlistPct:  25,
    ruleRawChangePct:           20,
    ruleMyPSA10ChangePct:       20,
    ruleSpreadChangePct:        25,
    ruleRecentSalesMinCount:    5,
    ruleMarketActivityMinCount: 10,
  },
  balanced: {
    rulePriceMovePortfolioPct:  10,
    rulePriceMoveWatchlistPct:  15,
    ruleRawChangePct:           10,
    ruleMyPSA10ChangePct:       10,
    ruleSpreadChangePct:        15,
    ruleRecentSalesMinCount:    3,
    ruleMarketActivityMinCount: 5,
  },
  active: {
    rulePriceMovePortfolioPct:  5,
    rulePriceMoveWatchlistPct:  7,
    ruleRawChangePct:           5,
    ruleMyPSA10ChangePct:       5,
    ruleSpreadChangePct:        10,
    ruleRecentSalesMinCount:    2,
    ruleMarketActivityMinCount: 3,
  },
}

export const SENSITIVITY_PRESET_LABELS: Record<SensitivityPreset, string> = {
  conservative: 'Conservative',
  balanced:     'Balanced',
  active:       'Active',
}

/** Returns the matching preset name, or 'custom' if any one threshold
 *  diverges. Useful for highlighting the current selection in the UI
 *  and for detecting when the user has fine-tuned in Advanced. */
export function detectSensitivityPreset(p: UserAlertPreferences): SensitivityPreset | 'custom' {
  for (const name of SENSITIVITY_PRESETS) {
    const t = SENSITIVITY_PRESET_THRESHOLDS[name]
    if (
      p.rulePriceMovePortfolioPct  === t.rulePriceMovePortfolioPct  &&
      p.rulePriceMoveWatchlistPct  === t.rulePriceMoveWatchlistPct  &&
      p.ruleRawChangePct           === t.ruleRawChangePct           &&
      p.ruleMyPSA10ChangePct       === t.ruleMyPSA10ChangePct       &&
      p.ruleSpreadChangePct        === t.ruleSpreadChangePct        &&
      p.ruleRecentSalesMinCount    === t.ruleRecentSalesMinCount    &&
      p.ruleMarketActivityMinCount === t.ruleMarketActivityMinCount
    ) return name
  }
  return 'custom'
}

/** Returns a NEW preferences object with the seven threshold fields
 *  overwritten by the given preset. Non-threshold fields (enabled,
 *  scope, weekly, instant, cooldowns) are preserved. */
export function applySensitivityPreset(
  base:   UserAlertPreferences,
  preset: SensitivityPreset,
): UserAlertPreferences {
  return applyPatch(base, SENSITIVITY_PRESET_THRESHOLDS[preset])
}

// ─────────────────────────────────────────────────────────────────────
// Bounds — used for validation in the UI and on the wire. Anything
// outside these bounds is clamped at save time so the DB CHECK
// constraint cannot reject the row.
// ─────────────────────────────────────────────────────────────────────
export const ALERT_PREFERENCE_BOUNDS = {
  rulePriceMovePct:           { min: 1, max: 100 },
  ruleMyPSA10ChangePct:       { min: 1, max: 100 },
  ruleRawChangePct:           { min: 1, max: 100 },
  ruleSpreadChangePct:        { min: 1, max: 100 },
  minHoursBetweenAlerts:      { min: 0, max: 168 },

  // Block 5A-W-13 — mirror the SQL CHECK constraints exactly.
  weeklyDigestDayOfWeek:      { min: 1, max: 7   },
  rulePriceMovePortfolioPct:  { min: 1, max: 100 },
  rulePriceMoveWatchlistPct:  { min: 1, max: 100 },
  ruleRecentSalesMinCount:    { min: 1, max: 50  },
  ruleMarketActivityMinCount: { min: 1, max: 100 },
  digestCooldownHours:        { min: 1, max: 168 },
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

  // ─── Block 5A-W-13 fields ───────────────────────────────────────
  if (typeof patch.weeklyDigestEnabled            === 'boolean') out.weeklyDigestEnabled            = patch.weeklyDigestEnabled
  if (typeof patch.weeklyOverviewPortfolioEnabled === 'boolean') out.weeklyOverviewPortfolioEnabled = patch.weeklyOverviewPortfolioEnabled
  if (typeof patch.weeklyOverviewWatchlistEnabled === 'boolean') out.weeklyOverviewWatchlistEnabled = patch.weeklyOverviewWatchlistEnabled
  if (typeof patch.weeklyDigestDayOfWeek          === 'number')  out.weeklyDigestDayOfWeek          = clamp(patch.weeklyDigestDayOfWeek,        ALERT_PREFERENCE_BOUNDS.weeklyDigestDayOfWeek.min,      ALERT_PREFERENCE_BOUNDS.weeklyDigestDayOfWeek.max)

  if (typeof patch.instantAlertsEnabled           === 'boolean') out.instantAlertsEnabled           = patch.instantAlertsEnabled

  if (typeof patch.rulePriceMovePortfolioPct      === 'number')  out.rulePriceMovePortfolioPct      = clamp(patch.rulePriceMovePortfolioPct,    ALERT_PREFERENCE_BOUNDS.rulePriceMovePortfolioPct.min,  ALERT_PREFERENCE_BOUNDS.rulePriceMovePortfolioPct.max)
  if (typeof patch.rulePriceMoveWatchlistPct      === 'number')  out.rulePriceMoveWatchlistPct      = clamp(patch.rulePriceMoveWatchlistPct,    ALERT_PREFERENCE_BOUNDS.rulePriceMoveWatchlistPct.min,  ALERT_PREFERENCE_BOUNDS.rulePriceMoveWatchlistPct.max)

  if (typeof patch.ruleRecentSalesMinCount        === 'number')  out.ruleRecentSalesMinCount        = clamp(patch.ruleRecentSalesMinCount,      ALERT_PREFERENCE_BOUNDS.ruleRecentSalesMinCount.min,    ALERT_PREFERENCE_BOUNDS.ruleRecentSalesMinCount.max)
  if (typeof patch.ruleMarketActivityMinCount     === 'number')  out.ruleMarketActivityMinCount     = clamp(patch.ruleMarketActivityMinCount,   ALERT_PREFERENCE_BOUNDS.ruleMarketActivityMinCount.min, ALERT_PREFERENCE_BOUNDS.ruleMarketActivityMinCount.max)

  if (typeof patch.digestCooldownHours            === 'number')  out.digestCooldownHours            = clamp(patch.digestCooldownHours,          ALERT_PREFERENCE_BOUNDS.digestCooldownHours.min,        ALERT_PREFERENCE_BOUNDS.digestCooldownHours.max)

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
    enabled:                   b('enabled',                          d.enabled),
    scopeWatchlist:            b('scope_watchlist',                  d.scopeWatchlist),
    scopePortfolio:            b('scope_portfolio',                  d.scopePortfolio),
    rulePriceMoveEnabled:      b('rule_price_move_enabled',          d.rulePriceMoveEnabled),
    rulePriceMovePct:          n('rule_price_move_pct',              d.rulePriceMovePct),
    ruleRecentSalesEnabled:    b('rule_recent_sales_enabled',        d.ruleRecentSalesEnabled),
    ruleMyPSA10ChangeEnabled:  b('rule_psa10_change_enabled',        d.ruleMyPSA10ChangeEnabled),
    ruleMyPSA10ChangePct:      n('rule_psa10_change_pct',            d.ruleMyPSA10ChangePct),
    ruleRawChangeEnabled:      b('rule_raw_change_enabled',          d.ruleRawChangeEnabled),
    ruleRawChangePct:          n('rule_raw_change_pct',              d.ruleRawChangePct),
    ruleSpreadChangeEnabled:   b('rule_spread_change_enabled',       d.ruleSpreadChangeEnabled),
    ruleSpreadChangePct:       n('rule_spread_change_pct',           d.ruleSpreadChangePct),
    ruleMarketActivityEnabled: b('rule_market_activity_enabled',     d.ruleMarketActivityEnabled),
    minHoursBetweenAlerts:     n('min_hours_between_alerts',         d.minHoursBetweenAlerts),

    // Block 5A-W-13 additions. Defaults make this safe to read on
    // a pre-migration row (existing tests that seed only the v1
    // columns continue to work).
    weeklyDigestEnabled:             b('weekly_digest_enabled',             d.weeklyDigestEnabled),
    weeklyOverviewPortfolioEnabled:  b('weekly_overview_portfolio_enabled', d.weeklyOverviewPortfolioEnabled),
    weeklyOverviewWatchlistEnabled:  b('weekly_overview_watchlist_enabled', d.weeklyOverviewWatchlistEnabled),
    weeklyDigestDayOfWeek:           n('weekly_digest_day_of_week',         d.weeklyDigestDayOfWeek),
    instantAlertsEnabled:            b('instant_alerts_enabled',            d.instantAlertsEnabled),
    rulePriceMovePortfolioPct:       n('rule_price_move_portfolio_pct',     d.rulePriceMovePortfolioPct),
    rulePriceMoveWatchlistPct:       n('rule_price_move_watchlist_pct',     d.rulePriceMoveWatchlistPct),
    ruleRecentSalesMinCount:         n('rule_recent_sales_min_count',       d.ruleRecentSalesMinCount),
    ruleMarketActivityMinCount:      n('rule_market_activity_min_count',    d.ruleMarketActivityMinCount),
    digestCooldownHours:             n('digest_cooldown_hours',             d.digestCooldownHours),
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

    // Block 5A-W-13
    weekly_digest_enabled:             p.weeklyDigestEnabled,
    weekly_overview_portfolio_enabled: p.weeklyOverviewPortfolioEnabled,
    weekly_overview_watchlist_enabled: p.weeklyOverviewWatchlistEnabled,
    weekly_digest_day_of_week:         p.weeklyDigestDayOfWeek,
    instant_alerts_enabled:            p.instantAlertsEnabled,
    rule_price_move_portfolio_pct:     p.rulePriceMovePortfolioPct,
    rule_price_move_watchlist_pct:     p.rulePriceMoveWatchlistPct,
    rule_recent_sales_min_count:       p.ruleRecentSalesMinCount,
    rule_market_activity_min_count:    p.ruleMarketActivityMinCount,
    digest_cooldown_hours:             p.digestCooldownHours,
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
