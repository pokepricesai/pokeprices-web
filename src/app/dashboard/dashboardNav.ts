// src/app/dashboard/dashboardNav.ts
// Block 5A-W-47F — pure config + resolver for the customer dashboard
// sidebar. Kept in its own module so tests can import it without
// dragging in the supabase client (which needs env vars at module
// load time).
//
// The routes here MUST match the real customer-dashboard pages found
// in the W47F audit. Adding an item that has no page.tsx behind it
// would surface a dead link in the sidebar; the sidebar test suite
// walks the disk to prevent that.

export type NavItem = {
  href:      string
  label:     string
  /** Extra pathnames whose descendants should also highlight this
   *  item — used for the two legacy watchlist / alerts redirects so
   *  the visited link stays selected during the redirect. */
  aliases?: readonly string[]
}
export type NavGroup = { label: string | null; items: readonly NavItem[] }

export const DASHBOARD_NAV: readonly NavGroup[] = [
  {
    label: null, // Overview sits above the first group header
    items: [
      { href: '/dashboard', label: 'Overview' },
    ],
  },
  {
    label: 'Track',
    items: [
      { href: '/dashboard/portfolio',         label: 'Portfolio' },
      { href: '/dashboard/watchlist-alerts',  label: 'Watchlist & Alerts',
        aliases: ['/dashboard/watchlist', '/dashboard/alerts'] },
      { href: '/dashboard/sets',              label: 'Set Completion' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/dashboard/grading',      label: 'Grading Calculator' },
      { href: '/dashboard/quick-price',  label: 'Quick Price' },
      { href: '/dashboard/card-shows',   label: 'Card Shows' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard/settings',     label: 'Settings' },
    ],
  },
]

/** Return true when this nav item is the active one for the given
 *  pathname. `/dashboard` matches exactly; every other item matches
 *  when the pathname equals it OR starts with `${href}/` (nested
 *  routes highlight the parent). Aliases are treated the same way. */
export function isNavItemActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false
  const candidates: readonly string[] = [item.href, ...(item.aliases ?? [])]
  for (const c of candidates) {
    if (c === '/dashboard') {
      // The Overview link must be exact-only, otherwise every dashboard
      // sub-page would also light it up.
      if (pathname === '/dashboard') return true
    } else {
      if (pathname === c) return true
      if (pathname.startsWith(c + '/')) return true
    }
  }
  return false
}
