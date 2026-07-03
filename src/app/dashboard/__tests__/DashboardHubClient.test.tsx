// Block 5A-W-42A — invariants for the "My PokePrices" personal
// summary hub. The hub does live Supabase reads on mount and a heavy
// render tree with a client-side auth subscription, so we pin the
// structural invariants by reading the source directly rather than
// mounting the component.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'DashboardHubClient.tsx'), 'utf8')

describe('DashboardHubClient — W42A page framing', () => {
  it('renders the "My PokePrices" H1 and strapline', () => {
    expect(SRC).toMatch(/<h1[\s\S]*?My PokePrices[\s\S]*?<\/h1>/)
    expect(SRC).toContain('Track your portfolio, watchlist, alerts and market movement.')
  })

  it('keeps AccountPlanBadge and DashboardOnboardingChecklist imported and mounted', () => {
    expect(SRC).toContain("import AccountPlanBadge from '@/components/account/AccountPlanBadge'")
    expect(SRC).toContain("import DashboardOnboardingChecklist from '@/components/dashboard/DashboardOnboardingChecklist'")
    expect(SRC).toMatch(/<AccountPlanBadge\b/)
    expect(SRC).toMatch(/<DashboardOnboardingChecklist\b/)
  })

  it('keeps DashboardNav and the avatar picker on the page', () => {
    expect(SRC).toContain("import DashboardNav from './DashboardNav'")
    expect(SRC).toMatch(/<DashboardNav\b/)
    expect(SRC).toContain("import AvatarPicker from '@/components/AvatarPicker'")
    expect(SRC).toMatch(/<AvatarPicker\b/)
  })
})

describe('DashboardHubClient — W42A alert count bug fix', () => {
  it('reads recent alerts and count from alert_events, not legacy user_alerts', () => {
    expect(SRC).toMatch(/from\(['"]alert_events['"]\)/)
    // The buggy hub used to hit `user_alerts` twice (active + triggered).
    // Guard against a regression.
    expect(SRC).not.toMatch(/from\(['"]user_alerts['"]\)/)
    expect(SRC).not.toContain('alertsTriggered')
  })

  it('filters alerts to the last 30 days by detected_at', () => {
    expect(SRC).toMatch(/detected_at/)
    expect(SRC).toMatch(/30 \* 24 \* 60 \* 60 \* 1000/)
  })
})

describe('DashboardHubClient — W42A personal snapshot cards', () => {
  it('renders a personal snapshot section aria-label', () => {
    expect(SRC).toContain('aria-label="Personal snapshot"')
  })

  it('carries the three snapshot kickers: Portfolio, Watchlist, Alerts', () => {
    expect(SRC).toContain('kicker="Portfolio"')
    expect(SRC).toContain('kicker="Watchlist"')
    expect(SRC).toContain('kicker="Alerts"')
  })

  it('reads the portfolio via get_portfolio_summary RPC + loadUserPortfolioIds (W42A-FIX2)', () => {
    // Load path must match /dashboard/portfolio exactly: resolve ids
    // via loadUserPortfolioIds (is_default → any-portfolio fallback),
    // then call get_portfolio_summary(p_portfolio_id: pid) — the same
    // RPC PortfolioDashboard consumes.
    expect(SRC).toContain("import { loadUserPortfolioIds } from '@/lib/account/usage'")
    expect(SRC).toContain('loadUserPortfolioIds(supabase, user.id)')
    expect(SRC).toContain("supabase.rpc('get_portfolio_summary', { p_portfolio_id: pid })")
    // Guard against a regression to the W42A-FIX direct SELECT on
    // portfolio_items — production writes card_name_snapshot /
    // set_name_snapshot, and selecting card_name / set_name 400s.
    expect(SRC).not.toContain("from('portfolio_items')")
  })

  it('reads the watchlist via the existing get_watchlist_with_prices RPC (no new RPC)', () => {
    expect(SRC).toMatch(/rpc\(['"]get_watchlist_with_prices['"]/)
  })

  it('exposes the required empty-state copy for each snapshot', () => {
    expect(SRC).toContain('Add cards to your portfolio to track value here.')
    expect(SRC).toContain('Watch a card to catch price moves.')
    expect(SRC).toContain('Set alert rules to be notified when prices move.')
  })

  it('degrades gracefully when items exist but total value is 0 (W42A-FIX)', () => {
    // A "Value updating…" branch must fire when totalCents is 0 but
    // itemCount > 0, rather than falling through to the empty-state copy
    // and telling a user with cards to "Add cards to your portfolio".
    expect(SRC).toContain('portfolioSnap.totalCents === 0')
    expect(SRC).toContain('Value updating…')
  })
})

describe('DashboardHubClient — W42A-FIX3 portfolio dedupe + recompute parity', () => {
  it('dedupes get_portfolio_summary items by id before summing (mirrors PortfolioDashboard.tsx:989-991)', () => {
    // Without dedupe the RPC's cartesian LEFT JOIN to card_trends
    // inflates both totalCents and itemCount. The portfolio page
    // dedupes; the hub must too or the two surfaces disagree.
    expect(SRC).toMatch(/new Map\(rawItems\.map\(i => \[i\.id, i\]\)\)/)
    expect(SRC).toContain('dedupedById')
  })

  it('recomputes totalCents, itemCount and uniqueCards from deduped items only', () => {
    // Same three aggregates the portfolio page computes at
    // PortfolioDashboard.tsx:1187-1195. sum(position_value_cents),
    // sum(quantity), count(distinct card_slug).
    expect(SRC).toContain('dedupedById.reduce')
    expect(SRC).toContain('i.quantity')
    expect(SRC).toMatch(/new Set\([\s\S]*?dedupedById\.map[\s\S]*?card_slug/)
  })

  it('threads itemCount and uniqueCards through the render (no raw items.length count)', () => {
    // Guard against a regression to `count: items.length` which is
    // exactly the mismatch that read 50 instead of 35.
    expect(SRC).toContain('itemCount:')
    expect(SRC).toContain('uniqueCards:')
    expect(SRC).not.toMatch(/items\.length,\s*pct30dWeighted/)
    // The rendered secondary line must show both counts.
    expect(SRC).toMatch(/portfolioSnap\.itemCount[\s\S]*?portfolioSnap\.uniqueCards[\s\S]*?unique/)
  })

  it('feeds the deduped items into the movers merge (no second inflated pass)', () => {
    // The outer-scoped portfolioItems array must be populated from the
    // deduped set, not the raw RPC output. Otherwise the movers section
    // still sees cartesian duplicates.
    expect(SRC).toContain('portfolioItems.push(...dedupedById)')
  })
})

describe('DashboardHubClient — W42A market movement for you', () => {
  it('adds the "Market movement for you" section with aria-label + heading', () => {
    expect(SRC).toContain('aria-label="Market movement for you"')
    expect(SRC).toMatch(/<h2[\s\S]*?Market movement for you[\s\S]*?<\/h2>/)
  })

  it('has an empty-state block with the three prompted CTAs', () => {
    expect(SRC).toContain('No cards tracked yet.')
    expect(SRC).toContain('Add a card to your portfolio')
    expect(SRC).toContain('Watch your first card')
    expect(SRC).toContain('Browse market movers')
  })

  it('the section sits ABOVE the tools tile grid', () => {
    const moversIdx = SRC.indexOf('aria-label="Market movement for you"')
    const toolsIdx  = SRC.indexOf('>Tools<')
    expect(moversIdx).toBeGreaterThan(-1)
    expect(toolsIdx).toBeGreaterThan(-1)
    expect(moversIdx).toBeLessThan(toolsIdx)
  })
})

describe('DashboardHubClient — W42A tools tile grid', () => {
  it('lists Portfolio first and Watchlist & Alerts second', () => {
    const pfIdx = SRC.indexOf("title: 'Portfolio'")
    const wlIdx = SRC.indexOf("title: 'Watchlist & Alerts'")
    const setsIdx = SRC.indexOf("title: 'Set Completion'")
    const gradeIdx = SRC.indexOf("title: 'Grading Calculator'")
    expect(pfIdx).toBeGreaterThan(-1)
    expect(wlIdx).toBeGreaterThan(-1)
    expect(pfIdx).toBeLessThan(wlIdx)
    expect(wlIdx).toBeLessThan(setsIdx)
    expect(setsIdx).toBeLessThan(gradeIdx)
  })

  it('does not carry per-tile emoji glyphs (the W42A cleanup)', () => {
    for (const glyph of ['📊', '👁', '🧩', '🏷️', '⚡', '📍', '🔁', '⚙️', '🃏', '📦', '📈', '🚀', '👾', '✨']) {
      expect(SRC).not.toContain(glyph)
    }
  })

  it('drops the icon field from the tile config in favour of a coloured accent bar', () => {
    // The old tile config carried `icon: '<emoji>'`. Grep for any
    // remaining `icon:` key — it should be gone.
    expect(SRC).not.toMatch(/icon:\s*'/)
  })
})

describe('DashboardHubClient — W42A safety', () => {
  it('only calls RPCs that /dashboard/portfolio and /dashboard/watchlist-alerts already use', () => {
    // W42A-FIX2 added get_portfolio_summary — the RPC PortfolioDashboard
    // consumes. Widen the allowlist to those two and guard against a
    // brand-new RPC being introduced by a future edit.
    const allowlist = new Set(['get_watchlist_with_prices', 'get_portfolio_summary'])
    const rpcMatches = SRC.match(/supabase\.rpc\(['"]([^'"]+)['"]/g) || []
    for (const m of rpcMatches) {
      const name = m.replace(/^supabase\.rpc\(['"]/, '').replace(/['"]$/, '')
      expect(allowlist.has(name), `unexpected supabase.rpc('${name}') — extend the allowlist deliberately`).toBe(true)
    }
  })

  it('never touches the legacy get_alerts_with_prices RPC', () => {
    expect(SRC).not.toContain('get_alerts_with_prices')
  })
})
