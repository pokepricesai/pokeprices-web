// src/lib/email/onboardingLinks.ts
// Absolute production URLs for every link an onboarding email emits.
//
// Rules (Block 3B §13):
//   * absolute HTTPS only
//   * internal paths only
//   * no auth tokens in the URL
//   * no open-redirect parameters

const DEFAULT_ORIGIN = 'https://www.pokeprices.io'

export type OnboardingLinkKey =
  | 'dashboard'
  | 'browse'
  | 'portfolio'
  | 'watchlist'
  | 'ai_assistant'
  | 'card_shows'
  | 'settings'
  | 'roadmap'

const PATHS: Record<OnboardingLinkKey, string> = {
  dashboard:    '/dashboard',
  browse:       '/browse',
  portfolio:    '/dashboard/portfolio',
  watchlist:    '/dashboard/watchlist-alerts',
  ai_assistant: '/ai-assistant',
  card_shows:   '/card-shows',
  settings:     '/dashboard/settings',
  roadmap:      '/roadmap',
}

function origin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim()
  if (!raw) return DEFAULT_ORIGIN
  // Force https:// in production. We never emit http:// links in mail.
  try {
    const u = new URL(raw)
    u.protocol = 'https:'
    // Drop any path / query the env var might carry — only origin allowed.
    return `${u.protocol}//${u.host}`
  } catch { return DEFAULT_ORIGIN }
}

export function emailLink(key: OnboardingLinkKey): string {
  return origin() + PATHS[key]
}

/** Bare /api/unsubscribe URL. Tokens are NOT appended in this block. */
export function unsubscribePreferencesLink(): string {
  return origin() + '/dashboard/settings'
}
