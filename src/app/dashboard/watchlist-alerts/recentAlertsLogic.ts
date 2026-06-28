// src/app/dashboard/watchlist-alerts/recentAlertsLogic.ts
// Block 5A-W-23 — pure sorting helpers for the Recent alerts panel.
//
// Two responsibilities, both pure:
//   1. Reorder a card's reason chips so PRICE rules render before
//      sales/activity rules (raw_change · psa10_change · price_move ·
//      spread_change before recent_sales · market_activity).
//   2. Sort the card list so cards with at least one PRICE-rule
//      reason rank above sales-only cards; ties break on latest
//      detected_at. Brief 5A-W-23: "do not let sales-only pending
//      alerts dominate over price movement if both exist."
//
// The component imports these so the visible ordering is testable in
// the node vitest env without rendering React.

import type { AlertRule } from '@/lib/alerts/preferences'

export type AlertReason = {
  rule:     AlertRule
  severity: 'low' | 'normal' | 'high'
}

export type RecentAlertCard = {
  cardSlug:  string
  latestAt:  string
  reasons:   AlertReason[]
}

const PRICE_RULES: ReadonlySet<AlertRule> = new Set<AlertRule>([
  'raw_change',
  'psa10_change',
  'price_move',
  'spread_change',
])

/** True when a rule belongs to the "price/value moved" category. */
export function isPriceRule(rule: AlertRule): boolean {
  return PRICE_RULES.has(rule)
}

/** True when a card has at least one price-rule reason among its
 *  reasons. Used to bucket cards in the list-level sort. */
export function cardHasPriceReason(card: { reasons: ReadonlyArray<AlertReason> }): boolean {
  for (const r of card.reasons) if (isPriceRule(r.rule)) return true
  return false
}

/** Pure: stable sort that puts price-rule reasons first, sales-only
 *  reasons second. Severity order within each category is preserved
 *  from the input (caller decides). Returns a NEW array. */
export function sortReasonsPriceFirst(reasons: ReadonlyArray<AlertReason>): AlertReason[] {
  // Bucket-then-concat keeps the sort stable inside each bucket
  // without relying on JS's sort stability for cross-version safety.
  const price: AlertReason[] = []
  const sales: AlertReason[] = []
  for (const r of reasons) {
    if (isPriceRule(r.rule)) price.push(r)
    else                     sales.push(r)
  }
  return [...price, ...sales]
}

/** Pure: sorts the card list so price-rule cards come first, then
 *  by latest detected_at (newest first). Returns a NEW array; does
 *  NOT mutate the input or the per-card `reasons` arrays. */
export function sortCardsPriceFirst<T extends { latestAt: string; reasons: ReadonlyArray<AlertReason> }>(cards: ReadonlyArray<T>): T[] {
  return [...cards].sort((a, b) => {
    const ap = cardHasPriceReason(a) ? 1 : 0
    const bp = cardHasPriceReason(b) ? 1 : 0
    if (ap !== bp) return bp - ap
    const at = Date.parse(a.latestAt) || 0
    const bt = Date.parse(b.latestAt) || 0
    return bt - at
  })
}
