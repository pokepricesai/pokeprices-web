// Block 5A-W-47F — tests for the persistent dashboard sidebar.
//
// The component uses supabase.auth on mount, which is heavy for the
// vitest 'node' environment. We split coverage into:
//   * pure unit tests over the exported active-state resolver + the
//     nav config;
//   * source-invariant assertions for the JSX / a11y attributes.
//
// The route inventory here MUST match the real customer-dashboard
// pages found in the W47F audit — no invented routes, no admin.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DASHBOARD_NAV,
  isNavItemActive,
} from '../dashboardNav'

const SIDEBAR_SRC = readFileSync(
  join(__dirname, '..', 'DashboardSidebar.tsx'), 'utf8',
)

// The set of real customer-dashboard pages that exist on disk.
const REAL_PAGES: readonly { href: string; file: string }[] = [
  { href: '/dashboard',                file: '../page.tsx' },
  { href: '/dashboard/portfolio',      file: '../portfolio/page.tsx' },
  { href: '/dashboard/watchlist-alerts', file: '../watchlist-alerts/page.tsx' },
  { href: '/dashboard/sets',           file: '../sets/page.tsx' },
  { href: '/dashboard/grading',        file: '../grading/page.tsx' },
  { href: '/dashboard/quick-price',    file: '../quick-price/page.tsx' },
  { href: '/dashboard/card-shows',     file: '../card-shows/page.tsx' },
  { href: '/dashboard/settings',       file: '../settings/page.tsx' },
]

// ── Route inventory (Part 12) ─────────────────

describe('DashboardSidebar — route inventory', () => {
  it('every listed route corresponds to a real customer-dashboard page', () => {
    for (const p of REAL_PAGES) {
      const path = join(__dirname, '..', p.file.replace('../', ''))
      expect(existsSync(path), `missing page file for ${p.href}`).toBe(true)
    }
  })

  it('every real customer-dashboard page appears in the sidebar exactly once', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items.map(i => i.href))
    for (const p of REAL_PAGES) {
      const count = flat.filter(h => h === p.href).length
      expect(count, `${p.href} should appear exactly once — got ${count}`).toBe(1)
    }
  })

  it('no nonexistent routes are added to the sidebar', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items.map(i => i.href))
    const realSet = new Set(REAL_PAGES.map(p => p.href))
    for (const href of flat) {
      expect(realSet.has(href), `${href} is not a real customer-dashboard page`).toBe(true)
    }
  })

  it('no admin routes appear in the customer sidebar', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items.map(i => i.href))
    for (const href of flat) {
      expect(href.startsWith('/admin'),
        `admin route ${href} leaked into the customer sidebar`).toBe(false)
    }
  })

  it('does not invent Settings, Billing or Account routes beyond the real /dashboard/settings', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items.map(i => i.href))
    expect(flat).not.toContain('/dashboard/billing')
    expect(flat).not.toContain('/dashboard/account')
    // /dashboard/settings IS a real route (see REAL_PAGES above).
    expect(flat).toContain('/dashboard/settings')
  })

  it('the Overview item is /dashboard exactly (not a partial match target)', () => {
    const overview = DASHBOARD_NAV[0].items[0]
    expect(overview.href).toBe('/dashboard')
    expect(overview.label).toBe('Overview')
  })

  it('legacy /dashboard/watchlist and /dashboard/alerts are threaded as aliases of Watchlist & Alerts', () => {
    const watchlistAlerts = DASHBOARD_NAV
      .flatMap(g => g.items)
      .find(i => i.href === '/dashboard/watchlist-alerts')!
    expect(watchlistAlerts.aliases).toContain('/dashboard/watchlist')
    expect(watchlistAlerts.aliases).toContain('/dashboard/alerts')
  })

  it('uses professional labels (no emoji glyphs in any label)', () => {
    // Part 8 of the brief — no emoji in the sidebar labels.
    const flat = DASHBOARD_NAV.flatMap(g => g.items)
    for (const item of flat) {
      for (const glyph of ['📒', '🎯', '📈', '📕', '📖', '🎮', '🎲', '👀', '❓', '💼', '👁', '🧩', '⚡', '📍', '⚙️', '🃏']) {
        expect(item.label, `emoji leaked into label "${item.label}"`).not.toContain(glyph)
      }
    }
  })
})

// ── Active-state resolver (pure) ──────────────

describe('isNavItemActive', () => {
  const overview  = DASHBOARD_NAV[0].items[0]                     // /dashboard
  const portfolio = DASHBOARD_NAV[1].items[0]                     // /dashboard/portfolio
  const wla       = DASHBOARD_NAV[1].items[1]                     // /dashboard/watchlist-alerts
  const sets      = DASHBOARD_NAV[1].items[2]                     // /dashboard/sets
  const grading   = DASHBOARD_NAV[2].items[0]                     // /dashboard/grading
  const settings  = DASHBOARD_NAV[3].items[0]                     // /dashboard/settings

  it('returns false for a null pathname', () => {
    expect(isNavItemActive(overview, null)).toBe(false)
  })

  it('the exact dashboard route highlights Overview only', () => {
    expect(isNavItemActive(overview,  '/dashboard')).toBe(true)
    expect(isNavItemActive(portfolio, '/dashboard')).toBe(false)
    expect(isNavItemActive(settings,  '/dashboard')).toBe(false)
  })

  it('the portfolio route highlights Portfolio only', () => {
    expect(isNavItemActive(portfolio, '/dashboard/portfolio')).toBe(true)
    expect(isNavItemActive(overview,  '/dashboard/portfolio')).toBe(false)
    expect(isNavItemActive(wla,       '/dashboard/portfolio')).toBe(false)
  })

  it('the watchlist-alerts route highlights Watchlist & Alerts only', () => {
    expect(isNavItemActive(wla,       '/dashboard/watchlist-alerts')).toBe(true)
    expect(isNavItemActive(overview,  '/dashboard/watchlist-alerts')).toBe(false)
    expect(isNavItemActive(portfolio, '/dashboard/watchlist-alerts')).toBe(false)
  })

  it('the legacy /dashboard/watchlist alias also highlights Watchlist & Alerts', () => {
    expect(isNavItemActive(wla, '/dashboard/watchlist')).toBe(true)
  })

  it('the legacy /dashboard/alerts alias also highlights Watchlist & Alerts', () => {
    expect(isNavItemActive(wla, '/dashboard/alerts')).toBe(true)
  })

  it('nested routes highlight the parent item', () => {
    expect(isNavItemActive(portfolio, '/dashboard/portfolio/xyz')).toBe(true)
    expect(isNavItemActive(sets,      '/dashboard/sets/abc-123')).toBe(true)
    expect(isNavItemActive(grading,   '/dashboard/grading/scenario/1')).toBe(true)
    // Overview must NOT light up on /dashboard/portfolio (it would if the
    // startsWith rule was applied to /dashboard).
    expect(isNavItemActive(overview,  '/dashboard/portfolio')).toBe(false)
    expect(isNavItemActive(overview,  '/dashboard/settings')).toBe(false)
  })

  it('only one primary item is highlighted at a time for any real customer route', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items)
    for (const p of REAL_PAGES) {
      const activeCount = flat.filter(item => isNavItemActive(item, p.href)).length
      expect(activeCount, `${p.href}: expected 1 active item, got ${activeCount}`).toBe(1)
    }
  })

  it('does not highlight items on the login page or unrelated site routes', () => {
    const flat = DASHBOARD_NAV.flatMap(g => g.items)
    for (const path of ['/dashboard/login', '/', '/browse', '/games']) {
      const active = flat.filter(item => isNavItemActive(item, path))
      expect(active.length, `${path} highlighted ${active.length} items`).toBe(0)
    }
  })
})

// ── Source invariants (a11y + structure) ──

describe('DashboardSidebar — source invariants', () => {
  it('uses a semantic <nav> with an accessible label', () => {
    expect(SIDEBAR_SRC).toMatch(/<nav\b[\s\S]*?aria-label="Dashboard navigation"/)
  })

  it('applies aria-current="page" on the active link', () => {
    expect(SIDEBAR_SRC).toMatch(/aria-current=\{active \? 'page' : undefined\}/)
  })

  it('provides a non-colour affordance for the active state (left border + weight)', () => {
    // Both a solid left rail and bolder text weight — active state
    // must not rely on colour alone.
    expect(SIDEBAR_SRC).toMatch(/borderLeft:[\s\S]{0,80}active[\s\S]{0,80}var\(--primary\)/)
    expect(SIDEBAR_SRC).toMatch(/fontWeight:\s*active\s*\?\s*800/)
  })

  it('includes a "Back to PokePrices" link pointing to the site root', () => {
    expect(SIDEBAR_SRC).toContain('Back to PokePrices')
    expect(SIDEBAR_SRC).toMatch(/href="\/"/)
  })

  it('exposes a Log out button that calls supabase.auth.signOut', () => {
    expect(SIDEBAR_SRC).toContain('Log out')
    expect(SIDEBAR_SRC).toContain('supabase.auth.signOut()')
  })

  it('never uses browser alert()', () => {
    expect(SIDEBAR_SRC).not.toMatch(/\balert\s*\(/)
  })

  it('does not import a new icon library (no lucide, no react-icons)', () => {
    expect(SIDEBAR_SRC).not.toMatch(/from ['"]lucide-react['"]/)
    expect(SIDEBAR_SRC).not.toMatch(/from ['"]react-icons/)
  })
})
