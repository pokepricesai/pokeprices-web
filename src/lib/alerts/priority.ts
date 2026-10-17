// src/lib/alerts/priority.ts
// Block 5A-W-8 — JS-side mirror of the SQL priority score formula.
//
// The canonical implementation lives in
// migrations/2026-06-24-user-interest-priority.sql →
// refresh_user_interest_priorities(). This module exists so that:
//   * the formula is documented in TypeScript for any future JS caller
//     (e.g. a server-side trigger that wants to compute priorities
//     ahead of running the SQL function),
//   * a unit test pins the formula so a careless refactor of the SQL
//     immediately surfaces a JS-side discrepancy in code review,
//   * the constants here serve as a single source of truth for the
//     `priority_source` tag string and the minimum score.
//
// IMPORTANT: this module does not write to the database. It is a pure
// helper. The web layer never calls refresh_user_interest_priorities()
// automatically — the operator triggers a refresh manually from the
// Supabase SQL editor.

/** The exact string the refresh function stamps on `priority_source`. */
export const USER_INTEREST_SOURCE = 'user_interest'

/** Minimum score assigned to any user-interest card. Any positive
 *  score puts a card ahead of the implicit zero score that
 *  non-user-interest rows carry by default. */
export const MIN_USER_INTEREST_SCORE = 1

/**
 * Mirror of `1 + GREATEST(0, COALESCE(distinct_user_count, 0))` from
 * the SQL function. Always returns a positive integer.
 */
export function priorityScoreFromInterest(distinctUserCount: number | null | undefined): number {
  if (distinctUserCount == null) return MIN_USER_INTEREST_SCORE
  if (!Number.isFinite(distinctUserCount) || distinctUserCount < 0) return MIN_USER_INTEREST_SCORE
  return MIN_USER_INTEREST_SCORE + Math.floor(distinctUserCount)
}
