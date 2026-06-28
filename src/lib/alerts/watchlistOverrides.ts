// src/lib/alerts/watchlistOverrides.ts
// Block 5A-W-19 — per-card watchlist alert thresholds. Pure resolver
// + DB loader. The evaluator owns "when do we fire?"; this module
// owns "what thresholds should apply for THIS user + THIS card?".
//
// Override surface only affects WATCHLIST cards. For source='portfolio'
// (or 'both' — owned-and-watched), the global thresholds remain in
// charge so the per-card override cannot accidentally weaken portfolio
// alerting. Brief 5A-W-19 §3: "preserve portfolio alert behaviour
// unchanged."

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserAlertPreferences } from './preferences'

// ─────────────────────────────────────────────────────────────────────
// Row + key shapes
// ─────────────────────────────────────────────────────────────────────

export type WatchlistAlertOverrideRow = {
  user_id:                 string
  card_slug:               string    // URL slug, matches watchlist.card_slug
  enabled:                 boolean
  use_global_defaults:     boolean
  rise_pct:                number | null
  drop_pct:                number | null
  recent_sales_enabled:    boolean
  market_activity_enabled: boolean
}

/** Key the per-user override map by URL slug (the same key the
 *  watchlist + UI work with). The evaluator's per-card loop holds
 *  the URL slug as `card.urlSlug`. */
function overrideKey(userId: string, urlSlug: string): string {
  return `${userId}|${urlSlug}`
}

// ─────────────────────────────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────────────────────────────

/** Effective settings for one (user, card) tuple after resolving the
 *  per-card override against the global preferences. The evaluator
 *  consults this instead of reading `prefs.rule*Pct` directly so the
 *  signed rise/drop logic is the only path that needs to know about
 *  asymmetric thresholds. */
export type EffectiveCardAlertSettings = {
  /** Whether the watchlist card should be evaluated at all. False
   *  short-circuits ALL rules (price + sales + market activity). */
  enabled:                 boolean
  /** Where the thresholds came from. Echoed into alert_events.payload_json
   *  so an operator (or future renderer) can show "this fired against
   *  your custom 20% threshold" vs. "your Balanced default". */
  thresholdSource:         'global' | 'override'
  /** Percent the card must rise (signed pct > 0) for a price-move
   *  rule to fire. Symmetric with the global watchlist threshold when
   *  no override is in effect. */
  risePct:                 number
  /** Percent the card must drop (signed pct < 0, compared by
   *  abs value) for a price-move rule to fire. */
  dropPct:                 number
  recentSalesEnabled:      boolean
  marketActivityEnabled:   boolean
}

/** Pure resolver. The evaluator looks up the override row for a
 *  (user, urlSlug) and passes BOTH `prefs` and the override (or null)
 *  in here. We never read process.env or hit the network — strictly
 *  data-in/data-out so the unit tests can assert every branch.
 *
 *  Source gate: overrides ONLY apply to source='watchlist'. For
 *  'portfolio' OR 'both', the override is ignored and we fall back
 *  to the global thresholds — protecting portfolio alert behaviour
 *  (a watch-and-own card cannot be silenced via the watchlist
 *  override). The brief: "preserve portfolio alert behaviour
 *  unchanged." */
export function resolveCardAlertSettings(
  prefs:    UserAlertPreferences,
  override: WatchlistAlertOverrideRow | null,
  source:   'watchlist' | 'portfolio' | 'both',
): EffectiveCardAlertSettings {
  // Global watchlist defaults — symmetric (one threshold both
  // directions) and inherited from user_alert_preferences. The
  // existing evaluator uses `rulePriceMovePct` as its single move
  // threshold; we mirror that so users without an override see no
  // behaviour change.
  const globalThreshold = prefs.rulePriceMoveWatchlistPct ?? prefs.rulePriceMovePct
  const globalSettings: EffectiveCardAlertSettings = {
    enabled:               true,
    thresholdSource:       'global',
    risePct:               globalThreshold,
    dropPct:               globalThreshold,
    recentSalesEnabled:    prefs.ruleRecentSalesEnabled,
    marketActivityEnabled: prefs.ruleMarketActivityEnabled,
  }

  // Only watchlist-pure cards get override treatment. 'portfolio' and
  // 'both' use globals unconditionally.
  if (source !== 'watchlist' || !override) return globalSettings

  // Master per-card switch trumps everything else.
  if (!override.enabled) {
    return { ...globalSettings, enabled: false }
  }

  // Inheriting global thresholds for this card — only the enabled
  // bit was customised (which is "true" here, so functionally a no-op).
  if (override.use_global_defaults) return globalSettings

  // Asymmetric override. NULL on a side means "fall back to global
  // for that direction" — lets the user customise one side only.
  return {
    enabled:               true,
    thresholdSource:       'override',
    risePct:               override.rise_pct ?? globalThreshold,
    dropPct:               override.drop_pct ?? globalThreshold,
    recentSalesEnabled:    override.recent_sales_enabled,
    marketActivityEnabled: override.market_activity_enabled,
  }
}

/** Returns the threshold for a SIGNED percent change. pct>0 → rise,
 *  pct<0 → drop, pct===0 → rise (arbitrary; never triggers anyway). */
export function thresholdForSignedPct(settings: EffectiveCardAlertSettings, pct: number): number {
  return pct >= 0 ? settings.risePct : settings.dropPct
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing — keep terse, fail-closed.
// ─────────────────────────────────────────────────────────────────────

/** Batched override loader for the evaluator. Returns a Map keyed
 *  by `${user_id}|${url_slug}`. Service-role client bypasses RLS, so
 *  this returns every row for the supplied user set. */
export async function loadWatchlistAlertOverrides(
  supa:    SupabaseClient,
  userIds: string[],
): Promise<Map<string, WatchlistAlertOverrideRow>> {
  const out = new Map<string, WatchlistAlertOverrideRow>()
  if (userIds.length === 0) return out
  const { data, error } = await supa
    .from('watchlist_alert_overrides')
    .select('user_id, card_slug, enabled, use_global_defaults, rise_pct, drop_pct, recent_sales_enabled, market_activity_enabled')
    .in('user_id', userIds)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const uid  = r.user_id   == null ? '' : String(r.user_id)
    const slug = r.card_slug == null ? '' : String(r.card_slug)
    if (!uid || !slug) continue
    out.set(overrideKey(uid, slug), {
      user_id:                 uid,
      card_slug:               slug,
      enabled:                 Boolean(r.enabled),
      use_global_defaults:     Boolean(r.use_global_defaults),
      rise_pct:                typeof r.rise_pct === 'number' ? r.rise_pct : null,
      drop_pct:                typeof r.drop_pct === 'number' ? r.drop_pct : null,
      recent_sales_enabled:    Boolean(r.recent_sales_enabled),
      market_activity_enabled: Boolean(r.market_activity_enabled),
    })
  }
  return out
}

/** Lookup helper. The evaluator holds the URL slug as `card.urlSlug`. */
export function lookupOverride(
  index:    Map<string, WatchlistAlertOverrideRow>,
  userId:   string,
  urlSlug:  string,
): WatchlistAlertOverrideRow | null {
  return index.get(overrideKey(userId, urlSlug)) ?? null
}
