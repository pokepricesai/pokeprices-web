// src/lib/admin/engagementQueries.ts
// Block 5A-W-1 — admin-only read aggregates for the engagement panel.
//
// Privacy: nothing here exposes a user_id or an email. The top-watched
// cards list reads the denormalised card_name + set_name that the
// watchlist UI itself stored at add-time, so no join back to the
// scraper-owned cards table is needed and no user identifier appears
// in the response.
//
// Designed to fail closed: when a table is missing (e.g. a brand-new
// install before migrations are applied) the function returns zeros
// rather than throwing, so the admin page stays renderable.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AlertEventLatestRow = {
  detectedAt:  string
  cardSlug:    string
  cardName:    string | null
  setName:     string | null
  rule:        string
  severity:    string
  delivered:   boolean
}

export type EngagementSnapshot = {
  watchlist: {
    rows:           number
    distinctUsers:  number
    topCards: Array<{
      cardSlug:  string
      cardName:  string | null
      setName:   string | null
      watchers:  number
    }>
  }
  portfolio: {
    distinctUsers:  number
    items:          number
  }
  alerts: {
    legacyUserAlertsActive: number   // existing threshold-based user_alerts.is_active = TRUE
    alertPreferenceRows:    number   // new user_alert_preferences rows
    alertEventsAllTime:     number   // new alert_events total
    alertEvents7d:          number   // new alert_events in the last 7d
    alertEventsUndelivered: number   // delivered_at IS NULL
    latest:                 AlertEventLatestRow[]   // newest 10, no user_id
  }
}

async function safeCountAll(supa: SupabaseClient, table: string): Promise<number> {
  try {
    const { count, error } = await supa.from(table).select('*', { count: 'exact', head: true })
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function safeCountWhereEq(
  supa: SupabaseClient, table: string, column: string, value: unknown,
): Promise<number> {
  try {
    const { count, error } = await supa.from(table).select('*', { count: 'exact', head: true }).eq(column, value)
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

async function safeCountWhereGte(
  supa: SupabaseClient, table: string, column: string, value: unknown,
): Promise<number> {
  try {
    const { count, error } = await supa.from(table).select('*', { count: 'exact', head: true }).gte(column, value)
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

export async function getEngagementSnapshot(supa: SupabaseClient): Promise<EngagementSnapshot> {
  // ── Watchlist counts ──────────────────────────────────────────────
  let watchRows = 0
  const watchersByCard = new Map<string, { cardName: string | null; setName: string | null; watchers: number }>()
  const usersSeen = new Set<string>()
  try {
    const { data, error } = await supa
      .from('watchlist')
      .select('user_id, card_slug, card_name, set_name')
    if (!error && Array.isArray(data)) {
      watchRows = data.length
      for (const r of data as Array<Record<string, unknown>>) {
        usersSeen.add(String(r.user_id))
        const slug = String(r.card_slug)
        const existing = watchersByCard.get(slug)
        if (existing) {
          existing.watchers++
        } else {
          watchersByCard.set(slug, {
            cardName: r.card_name == null ? null : String(r.card_name),
            setName:  r.set_name  == null ? null : String(r.set_name),
            watchers: 1,
          })
        }
      }
    }
  } catch { /* fail closed */ }
  const topCards = Array.from(watchersByCard.entries())
    .map(([cardSlug, v]) => ({ cardSlug, cardName: v.cardName, setName: v.setName, watchers: v.watchers }))
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, 20)

  // ── Portfolio counts ──────────────────────────────────────────────
  const portfolioUsers = new Set<string>()
  let portfolioItemRows = 0
  try {
    // portfolio_items lives behind portfolios for the user_id; the
    // simplest fail-closed read is to count items then count distinct
    // portfolio owners.
    const items = await supa.from('portfolio_items').select('id', { count: 'exact', head: true })
    portfolioItemRows = items.count ?? 0
    const portfolios = await supa.from('portfolios').select('user_id')
    if (!portfolios.error && Array.isArray(portfolios.data)) {
      for (const r of portfolios.data as Array<Record<string, unknown>>) {
        portfolioUsers.add(String(r.user_id))
      }
    }
  } catch { /* fail closed */ }

  // ── Alert-related counts ─────────────────────────────────────────
  const legacyUserAlertsActive = await safeCountWhereEq(supa, 'user_alerts', 'is_active', true)
  const alertPreferenceRows    = await safeCountAll(supa, 'user_alert_preferences')
  const alertEventsAllTime     = await safeCountAll(supa, 'alert_events')
  const since7                 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const alertEvents7d          = await safeCountWhereGte(supa, 'alert_events', 'detected_at', since7)

  // Undelivered count + a small "latest events" sample. user_id is
  // deliberately excluded from the sample to keep this panel free of
  // PII — the admin only needs to see which cards/rules are firing.
  let alertEventsUndelivered = 0
  try {
    const { count, error } = await supa.from('alert_events').select('*', { count: 'exact', head: true }).is('delivered_at', null)
    if (!error) alertEventsUndelivered = count ?? 0
  } catch { /* fail closed */ }

  const latest: AlertEventLatestRow[] = []
  try {
    const { data, error } = await supa
      .from('alert_events')
      .select('detected_at, card_slug, card_name, set_name, rule, severity, delivered_at')
      .order('detected_at', { ascending: false })
      .limit(10)
    if (!error && Array.isArray(data)) {
      for (const r of data as Array<Record<string, unknown>>) {
        latest.push({
          detectedAt: String(r.detected_at),
          cardSlug:   String(r.card_slug),
          cardName:   r.card_name == null ? null : String(r.card_name),
          setName:    r.set_name  == null ? null : String(r.set_name),
          rule:       String(r.rule),
          severity:   String(r.severity),
          delivered:  r.delivered_at != null,
        })
      }
    }
  } catch { /* fail closed */ }

  return {
    watchlist: {
      rows:          watchRows,
      distinctUsers: usersSeen.size,
      topCards,
    },
    portfolio: {
      distinctUsers: portfolioUsers.size,
      items:         portfolioItemRows,
    },
    alerts: {
      legacyUserAlertsActive,
      alertPreferenceRows,
      alertEventsAllTime,
      alertEvents7d,
      alertEventsUndelivered,
      latest,
    },
  }
}
