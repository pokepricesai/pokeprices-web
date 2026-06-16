// src/lib/email/onboardingActivation.ts
// Server-only aggregate-count resolver for the Email 2 activation
// branch. Reads only the three counts and returns 'A' | 'B' | 'C' | 'D'.
//
// Privacy:
//   * we never read card names, prices, purchase notes or anything
//     identifying — aggregate counts only.
//   * the result is passed to the OnboardingActivation template by
//     branch letter so the template cannot accidentally render a
//     specific card.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export type ActivationBranch = 'A' | 'B' | 'C' | 'D'

export type ActivationCounts = {
  watchlist: number
  portfolio: number
  shows:     number
}

async function safeCount(table: string, column: string, value: string): Promise<number> {
  const supa = getSupabaseServiceClient()
  try {
    const r = await supa.from(table).select(column, { count: 'exact', head: true }).eq(column, value)
    return ((r as { count?: number | null }).count) ?? 0
  } catch {
    return 0
  }
}

/**
 * Counts owned-collection items via the portfolios → portfolio_items
 * relationship. We do not assume a single global "portfolio" table;
 * the user can have multiple portfolios.
 *
 * Fail-safe: any error returns 0 (treats user as "no portfolio"). The
 * worst case is we send the basic "save your first card" prompt; we
 * never expose any portfolio content.
 */
async function portfolioItemCount(userId: string): Promise<number> {
  const supa = getSupabaseServiceClient()
  try {
    const portfolios = await supa
      .from('portfolios')
      .select('id')
      .eq('user_id', userId)
    if (portfolios.error || !portfolios.data) return 0
    const ids = (portfolios.data as Array<{ id: string }>).map(r => r.id)
    if (ids.length === 0) return 0
    const items = await supa
      .from('portfolio_items')
      .select('id', { count: 'exact', head: true })
      .in('portfolio_id', ids)
    return ((items as { count?: number | null }).count) ?? 0
  } catch {
    return 0
  }
}

export async function readActivationCounts(userId: string): Promise<ActivationCounts> {
  const [watchlist, portfolio, shows] = await Promise.all([
    safeCount('watchlist', 'user_id', userId),
    portfolioItemCount(userId),
    safeCount('card_show_stars', 'user_id', userId),
  ])
  return { watchlist, portfolio, shows }
}

/**
 * Block 3B §6 decision table:
 *   A. no portfolio AND no watchlist → "save your first card"
 *   B. watchlist > 0 AND portfolio == 0 → "add owned cards"
 *   C. portfolio > 0 AND watchlist == 0 → "track cards you are considering"
 *   D. both portfolio > 0 AND watchlist > 0 → "discover AI / grading / shows"
 */
export function pickActivationBranch(counts: ActivationCounts): ActivationBranch {
  const hasPortfolio = counts.portfolio > 0
  const hasWatchlist = counts.watchlist > 0
  if (!hasPortfolio && !hasWatchlist) return 'A'
  if (hasWatchlist && !hasPortfolio)  return 'B'
  if (hasPortfolio && !hasWatchlist)  return 'C'
  return 'D'
}
