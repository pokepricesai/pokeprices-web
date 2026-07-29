// Block 5A-W-47F — invariants for the persistent dashboard shell +
// its wiring into the /dashboard route layout. Also includes
// regression pins that the old DashboardNav mounts are gone from
// every customer-dashboard sub-page client.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SHELL_SRC = readFileSync(
  join(__dirname, '..', 'DashboardShell.tsx'), 'utf8',
)
const LAYOUT_SRC = readFileSync(
  join(__dirname, '..', 'layout.tsx'), 'utf8',
)

// ── Layout wiring ─────────────────────────

describe('dashboard layout — shell wiring', () => {
  it('imports and mounts DashboardShell around every /dashboard route', () => {
    expect(LAYOUT_SRC).toContain("import DashboardShell from './DashboardShell'")
    expect(LAYOUT_SRC).toMatch(/<DashboardShell>\{children\}<\/DashboardShell>/)
  })

  it('preserves the existing noindex robots metadata', () => {
    expect(LAYOUT_SRC).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/)
  })

  it('does not create duplicate public navigation (no Navbar import)', () => {
    // The public Navbar lives in the ROOT layout — not the dashboard
    // layout. The shell must not double-mount it.
    expect(LAYOUT_SRC).not.toContain("from '@/components/Navbar'")
    expect(SHELL_SRC).not.toContain("from '@/components/Navbar'")
  })
})

// ── Shell — desktop + mobile structure ──

describe('DashboardShell — structure', () => {
  it('renders the shared DashboardSidebar (single implementation, not duplicated)', () => {
    expect(SHELL_SRC).toContain("import DashboardSidebar from './DashboardSidebar'")
    const mounts = SHELL_SRC.match(/<DashboardSidebar\b/g) ?? []
    // One mount for the desktop sidebar, one for the mobile drawer —
    // both feed the same component, no duplicated nav config.
    expect(mounts.length).toBe(2)
  })

  it('the desktop sidebar is inside a semantic <aside> with an accessible label', () => {
    expect(SHELL_SRC).toMatch(/<aside\b[\s\S]*?aria-label="Dashboard sidebar"/)
  })

  it('the desktop sidebar is sticky beneath the public Navbar (top: 60px)', () => {
    // The public Navbar is 60px tall — the sidebar sticks below it.
    expect(SHELL_SRC).toMatch(/position:\s*sticky/)
    expect(SHELL_SRC).toContain('NAVBAR_HEIGHT = 60')
  })

  it('gates its own render on /dashboard/login so the login page has no sidebar', () => {
    expect(SHELL_SRC).toMatch(/pathname === '\/dashboard\/login'/)
    expect(SHELL_SRC).toMatch(/return\s*<>\{children\}<\/>/)
  })
})

// ── Shell — mobile menu (Part 7) ─────

describe('DashboardShell — mobile menu', () => {
  it('renders a "Dashboard menu" button with aria-expanded and aria-controls', () => {
    expect(SHELL_SRC).toContain('Dashboard menu')
    expect(SHELL_SRC).toMatch(/aria-expanded=\{drawerOpen\}/)
    expect(SHELL_SRC).toMatch(/aria-controls="pp-dashboard-drawer"/)
  })

  it('the drawer is a role="dialog" with aria-modal', () => {
    expect(SHELL_SRC).toMatch(/id="pp-dashboard-drawer"/)
    expect(SHELL_SRC).toMatch(/role="dialog"/)
    expect(SHELL_SRC).toMatch(/aria-modal="true"/)
    expect(SHELL_SRC).toMatch(/aria-label="Dashboard menu"/)
  })

  it('has an accessible close button on the drawer', () => {
    expect(SHELL_SRC).toMatch(/aria-label="Close dashboard menu"/)
  })

  it('Escape closes the drawer', () => {
    expect(SHELL_SRC).toMatch(/e\.key === 'Escape'/)
    expect(SHELL_SRC).toMatch(/closeDrawer\(\)/)
  })

  it('clicking the backdrop closes the drawer', () => {
    expect(SHELL_SRC).toMatch(/onClick=\{closeDrawer\}\s*\n?\s*aria-hidden="true"/)
  })

  it('selecting a nav route inside the drawer closes it (onNavigate wiring)', () => {
    // The mobile mount passes onNavigate={closeDrawer} to the sidebar
    // so link clicks fire the close callback.
    expect(SHELL_SRC).toMatch(/<DashboardSidebar onNavigate=\{closeDrawer\}/)
  })

  it('body scrolling is locked while the drawer is open', () => {
    expect(SHELL_SRC).toMatch(/document\.body\.style\.overflow\s*=\s*'hidden'/)
    // Cleanup restores the previous value.
    expect(SHELL_SRC).toMatch(/document\.body\.style\.overflow\s*=\s*prev/)
  })

  it('conditionally unmounts the drawer + backdrop when closed (a11y-safe)', () => {
    // Deployment-day fix — when the drawer is closed the dialog and
    // its close button must NOT remain keyboard-focusable or in the
    // accessibility tree. Conditionally unmounting the whole block is
    // the belt-and-braces pattern that removes them from the DOM
    // entirely, not just hides them with `display: none`.
    expect(SHELL_SRC).toMatch(/\{drawerOpen && \(/)
    // No stale toggle class from the previous CSS-only hide strategy.
    expect(SHELL_SRC).not.toContain('is-open')
    // The role="dialog" element and its close button must live inside
    // the conditional block, not outside it.
    const conditionalBlock = SHELL_SRC.split('{drawerOpen && (')[1] ?? ''
    expect(conditionalBlock).toContain('role="dialog"')
    expect(conditionalBlock).toContain('aria-label="Close dashboard menu"')
  })

  it('does not introduce a new dependency or animation library', () => {
    for (const dep of [
      'framer-motion',
      'react-spring',
      'lucide-react',
      'react-icons',
      '@headlessui',
      '@radix-ui',
      'react-modal',
    ]) {
      expect(SHELL_SRC).not.toContain(dep)
    }
  })
})

// ── Regression — old DashboardNav is gone ──

describe('W47F regression — old DashboardNav removed', () => {
  it('src/app/dashboard/DashboardNav.tsx no longer exists', () => {
    const path = join(__dirname, '..', 'DashboardNav.tsx')
    expect(existsSync(path)).toBe(false)
  })

  it('src/app/dashboard/__tests__/DashboardNav.test.tsx no longer exists', () => {
    const path = join(__dirname, 'DashboardNav.test.tsx')
    expect(existsSync(path)).toBe(false)
  })

  // Every customer-dashboard sub-page client used to mount DashboardNav
  // at the top of its render. The persistent shell now supplies nav
  // once for the whole area, so each client must not double-render it.
  const CLIENTS: readonly { path: string; label: string }[] = [
    { path: '../DashboardHubClient.tsx',                            label: 'Overview hub' },
    { path: '../portfolio/PortfolioDashboard.tsx',                  label: 'Portfolio' },
    { path: '../watchlist-alerts/WatchlistAlertsClient.tsx',        label: 'Watchlist & Alerts' },
    { path: '../watchlist/WatchlistClient.tsx',                     label: 'Watchlist (embedded)' },
    { path: '../sets/SetTrackerClient.tsx',                         label: 'Set Completion' },
    { path: '../grading/GradingCalculatorClient.tsx',               label: 'Grading Calculator' },
    { path: '../quick-price/QuickPriceClient.tsx',                  label: 'Quick Price' },
    { path: '../card-shows/CardShowsPlannerClient.tsx',             label: 'Card Shows' },
    { path: '../settings/SettingsClient.tsx',                       label: 'Settings' },
  ]

  for (const c of CLIENTS) {
    it(`${c.label}: no import of the removed DashboardNav`, () => {
      const src = readFileSync(join(__dirname, c.path), 'utf8')
      expect(src, `${c.label} still imports DashboardNav`).not.toContain('DashboardNav')
    })
  }
})

// ── Regression — public site nav is untouched (Part 11) ──

describe('W47F regression — public site nav preserved', () => {
  it('the public Navbar file is unchanged in shape (still exports default Navbar)', () => {
    const navbar = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'Navbar.tsx'), 'utf8',
    )
    expect(navbar).toMatch(/export default function Navbar/)
  })

  it('the root layout still mounts the public Navbar', () => {
    const rootLayout = readFileSync(
      join(__dirname, '..', '..', 'layout.tsx'), 'utf8',
    )
    expect(rootLayout).toContain("import Navbar from '@/components/Navbar'")
    expect(rootLayout).toMatch(/<Navbar\s*\/>/)
  })

  it('the homepage retains its links into /dashboard, /dashboard/portfolio and /dashboard/watchlist-alerts', () => {
    // HomeClient uses both quote styles for these hrefs — accept either.
    const home = readFileSync(
      join(__dirname, '..', '..', 'HomeClient.tsx'), 'utf8',
    )
    expect(home).toMatch(/href=["']\/dashboard["']/)
    expect(home).toMatch(/["']\/dashboard\/portfolio["']/)
    expect(home).toMatch(/["']\/dashboard\/watchlist-alerts["']/)
  })
})
