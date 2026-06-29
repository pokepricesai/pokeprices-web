// src/lib/onboarding/dashboardChecklist.ts
// Block 5A-W-30 — pure helper for the dashboard onboarding checklist.
//
// Takes already-loaded counts/flags + the user's plan and returns the
// ordered list of checklist items the hub should render.
//
// Inputs are nullable so the caller can pass `null` for "query failed
// or table missing" and the helper treats it as "not complete" rather
// than "broken". This keeps the UI safe on an un-migrated env.

export type UserPlanLite = 'free' | 'pro'

export type DashboardChecklistInputs = {
  /** Current plan. Drives whether the last item is Pro early access
   *  (free) or Explore instant alerts (pro). */
  plan: UserPlanLite

  /** COUNT(portfolio_items) for this user. null = query failed. */
  portfolioCount: number | null

  /** COUNT(watchlist) for this user. null = query failed. */
  watchlistCount: number | null

  /** `user_alert_preferences.weekly_digest_enabled` if a row exists.
   *  null = no row OR query failed → treat as not yet engaged. */
  weeklyOverviewEnabled: boolean | null

  /** COUNT(watchlist_alert_overrides where use_global_defaults=false)
   *  for this user. null = query failed / table missing. */
  customAlertOverrideCount: number | null

  /** Whether the user has any pro_early_access_requests row.
   *  null = query failed / table missing — treat as incomplete. */
  proEarlyAccessSubmitted: boolean | null
}

export type ChecklistItemId =
  | 'portfolio'
  | 'watchlist'
  | 'weekly'
  | 'custom-alerts'
  | 'pro-early-access'
  | 'explore-instant-alerts'

export type DashboardChecklistItem = {
  id:          ChecklistItemId
  label:       string
  description: string
  href:        string
  complete:    boolean
}

export type DashboardChecklistResult = {
  items:           DashboardChecklistItem[]
  completedCount:  number
  totalCount:      number
  allComplete:     boolean
}

function isPositive(n: number | null): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Build the ordered checklist for the dashboard hub.
 *
 * Item set is always 5 long. The fifth item differs by plan:
 *   - free → "Join Pro early access"
 *   - pro  → "Explore instant alerts"
 *
 * Each item's `complete` flag is derived from existing data; a `null`
 * input is always treated as not complete so missing tables / failed
 * reads degrade to "needs attention" instead of "broken".
 */
export function buildDashboardChecklist(
  inputs: DashboardChecklistInputs,
): DashboardChecklistResult {
  const items: DashboardChecklistItem[] = [
    {
      id:          'portfolio',
      label:       'Add your first portfolio card',
      description: 'Start by tracking a few cards you own — collection value, P&L and grading insights light up once cards are in.',
      href:        '/dashboard/portfolio',
      complete:    isPositive(inputs.portfolioCount),
    },
    {
      id:          'watchlist',
      label:       'Add your first watched card',
      description: 'Start by watching a few cards you care about. Alerts and your weekly overview kick in once they’re on the list.',
      href:        '/dashboard/watchlist-alerts',
      complete:    isPositive(inputs.watchlistCount),
    },
    {
      id:          'weekly',
      label:       'Turn on weekly overview',
      description: 'Your weekly overview gets better as you add cards. One short email each week, never spammy.',
      href:        '/dashboard/watchlist-alerts',
      complete:    inputs.weeklyOverviewEnabled === true,
    },
    {
      id:          'custom-alerts',
      label:       'Customise alerts for a watched card',
      description: 'Set rise / drop thresholds for a card that matters to you, instead of relying on the global defaults.',
      href:        '/dashboard/watchlist-alerts',
      complete:    isPositive(inputs.customAlertOverrideCount),
    },
  ]

  if (inputs.plan === 'pro') {
    // Pro user: replace the early-access invite with an exploratory
    // CTA. We mark it complete once they've customised at least one
    // alert — a reasonable signal that they're actually engaging with
    // the instant-alert system that Pro unlocks.
    items.push({
      id:          'explore-instant-alerts',
      label:       'Explore instant alerts',
      description: 'Instant alerts fire as soon as a watched card moves past your threshold. Tune yours per-card under Watchlist & Alerts.',
      href:        '/dashboard/watchlist-alerts',
      complete:    isPositive(inputs.customAlertOverrideCount),
    })
  } else {
    items.push({
      id:          'pro-early-access',
      label:       'Join Pro early access',
      description: 'Tell us you’re keen on Pro features (instant alerts, unlimited portfolio + watchlist) so you’re first to know when they ship.',
      href:        '/dashboard/settings',
      complete:    inputs.proEarlyAccessSubmitted === true,
    })
  }

  const completedCount = items.reduce((acc, it) => acc + (it.complete ? 1 : 0), 0)
  return {
    items,
    completedCount,
    totalCount:  items.length,
    allComplete: completedCount === items.length,
  }
}
