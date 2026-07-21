// src/app/dashboard/watchlist-alerts/summaryStats.ts
// Block 5A-W-23 — pure helper for the Watchlist & Alerts summary
// panel. Takes the three data sources the page already loads
// (watchlist rows, watchlist_alert_overrides rows, recent alert_events)
// and produces the five counters shown at the top of the page.
//
// Pure (no React, no supabase) so the logic can be unit-tested in the
// project's node vitest env without touching the wire.

export type WatchlistOverrideRowLite = {
  /** URL slug; matches watchlist.card_slug + cards.card_url_slug. */
  card_slug:           string
  enabled:             boolean
  use_global_defaults: boolean
}

export type AlertEventLite = {
  detected_at: string
}

export type WatchlistAlertsSummary = {
  /** Total watched cards. */
  watchedCount:    number
  /** Cards inheriting global thresholds (either no override row at
   *  all OR an override row with use_global_defaults=true AND
   *  enabled=true). */
  globalDefault:   number
  /** Cards with a real per-card override active (override row with
   *  use_global_defaults=false AND enabled=true). */
  customThreshold: number
  /** Cards silenced via the per-card master switch (override row
   *  with enabled=false; use_global_defaults is irrelevant here). */
  alertsOff:       number
  /** Count of alert_events received in the last 7 days. Note this
   *  is the WHOLE-USER count from the input, not scoped to
   *  watchlist cards — alerts can fire on portfolio cards too. */
  recent7dCount:   number
  /** Echoed back so the caller can show an "Alerts are currently
   *  off" empty-state CTA when the user has disabled the master
   *  switch entirely. */
  masterEnabled:   boolean
}

// Block 5A-W-44B — biggest-mover surface for the summary panel.
// Pure so the pick logic can be unit-tested; the panel does the
// Supabase read separately and passes the rows into this helper.

/** Minimal shape needed to pick a top mover — a subset of the
 *  `get_watchlist_with_prices` RPC's row shape. */
export type WatchlistPricedRowLite = {
  card_slug:      string
  card_name:      string
  set_name:       string
  card_url_slug:  string | null
  pct_7d:         number | null
  pct_30d:        number | null
}

/** What the summary panel renders for the biggest-mover chip. */
export type BiggestMover = {
  card_name:      string
  set_name:       string
  card_slug:      string
  card_url_slug:  string | null
  /** Signed percentage — direction preserved so callers can render
   *  the colour + arrow. Prefer 30d when both are present. */
  pct:            number
  /** Which window the pct came from — for the "30d" / "7d" suffix. */
  window:         '30d' | '7d'
}

/** Pure: pick the biggest absolute mover across the watchlist rows.
 *  Prefer pct_30d; fall back to pct_7d row-by-row. Ties are broken
 *  by index (first row wins). Returns null when no row has a usable
 *  pct in either window. */
export function pickBiggestMover(
  rows: ReadonlyArray<WatchlistPricedRowLite> | null | undefined,
): BiggestMover | null {
  if (!rows || rows.length === 0) return null
  let best: BiggestMover | null = null
  let bestAbs = -1
  for (const r of rows) {
    let pct: number | null = null
    let window: '30d' | '7d' = '30d'
    if (r.pct_30d != null && !Number.isNaN(Number(r.pct_30d))) {
      pct = Number(r.pct_30d)
    } else if (r.pct_7d != null && !Number.isNaN(Number(r.pct_7d))) {
      pct = Number(r.pct_7d)
      window = '7d'
    }
    if (pct == null) continue
    const abs = Math.abs(pct)
    if (abs > bestAbs) {
      bestAbs = abs
      best = {
        card_name:     r.card_name,
        set_name:      r.set_name,
        card_slug:     r.card_slug,
        card_url_slug: r.card_url_slug,
        pct,
        window,
      }
    }
  }
  return best
}

/** Pure: given the page's loaded data, return the five visible
 *  counters. Bucket logic per card:
 *    * override row exists AND enabled=false → alertsOff
 *    * override row exists AND use_global_defaults=true (+enabled=true) → globalDefault
 *    * override row exists AND use_global_defaults=false (+enabled=true) → customThreshold
 *    * no override row → globalDefault (the implicit default state)
 *
 *  Buckets are mutually exclusive, so
 *  `globalDefault + customThreshold + alertsOff === watchedCount`.
 *  Overrides for cards NOT on the watchlist are ignored (stale rows
 *  from a card the user has since un-watched). */
export function summariseWatchlistAlerts(input: {
  watchlistSlugs: ReadonlyArray<string>
  overrides:      ReadonlyArray<WatchlistOverrideRowLite>
  recentEvents7d: ReadonlyArray<AlertEventLite>
  masterEnabled:  boolean
}): WatchlistAlertsSummary {
  const watched = new Set(input.watchlistSlugs)
  // Index overrides by card_slug. Keep only those for currently
  // watched cards — orphaned overrides (card un-watched) shouldn't
  // count toward any bucket because the user can't see them.
  const byCard = new Map<string, WatchlistOverrideRowLite>()
  for (const o of input.overrides) {
    if (!watched.has(o.card_slug)) continue
    byCard.set(o.card_slug, o)
  }
  let globalDefault = 0
  let custom        = 0
  let off           = 0
  for (const slug of input.watchlistSlugs) {
    const o = byCard.get(slug)
    if (!o) {
      globalDefault++
    } else if (!o.enabled) {
      off++
    } else if (o.use_global_defaults) {
      globalDefault++
    } else {
      custom++
    }
  }
  return {
    watchedCount:    input.watchlistSlugs.length,
    globalDefault,
    customThreshold: custom,
    alertsOff:       off,
    recent7dCount:   input.recentEvents7d.length,
    masterEnabled:   input.masterEnabled,
  }
}
