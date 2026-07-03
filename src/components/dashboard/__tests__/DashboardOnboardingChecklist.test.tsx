// Block 5A-W-42A-FIX — invariants for the compact "account status"
// strip that replaces the old large all-set card, plus the portfolio
// count bug fix.
//
// The checklist component runs Supabase queries on mount and depends
// on the useUserPlan hook + a heavy render tree, so we pin the
// structural invariants by reading the source directly rather than
// mounting.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', 'DashboardOnboardingChecklist.tsx'), 'utf8')

describe('DashboardOnboardingChecklist — W42A-FIX compact account strip', () => {
  it('renders the all-set state as a compact aria-labelled strip, not a large card', () => {
    expect(SRC).toContain('aria-label="Account status"')
    // The strip uses this style key. Guard against a regression to the
    // large card layout.
    expect(SRC).toContain('stripCardStyle')
    expect(SRC).toContain('stripLeftStyle')
    expect(SRC).toContain('stripHeadingStyle')
  })

  it('drops the old large-card success block (planBlock, bulletList, upgrade sub-panel)', () => {
    // These style keys belonged to the previous large "all set" card.
    // Their removal is the visible design change.
    expect(SRC).not.toContain('planBlockStyle')
    expect(SRC).not.toContain('bulletListStyle')
    expect(SRC).not.toContain('bulletStyle')
    expect(SRC).not.toContain('upgradeStyle')
    expect(SRC).not.toContain('upgradeHeadingStyle')
    expect(SRC).not.toContain('upgradeDescStyle')
    expect(SRC).not.toContain('upgradeCtaStyle')
    expect(SRC).not.toContain('planCheckStyle')
  })

  it('still shows the Pro entitlements copy (planBullets joined into the strip)', () => {
    // The strip must still render state.planBullets so Pro users see
    // what they've unlocked without a bulleted grid.
    expect(SRC).toContain('state.planBullets.join')
  })

  it('shows an inline upgrade link only for free users (Pro users get no big CTA panel)', () => {
    // The upgrade CTA is inside a `!isPro && state.upgrade &&` gate.
    // Pro users must NOT see any upgrade block.
    expect(SRC).toMatch(/!isPro\s*&&\s*state\.upgrade\s*&&/)
    // …and the upgrade CTA renders as a compact inline link with the
    // strip style, not the old upgradeStyle sub-panel.
    expect(SRC).toContain('stripUpgradeCtaStyle')
  })

  it('keeps the Pro / Free chips visible on the strip', () => {
    expect(SRC).toContain('<ProAccountChip />')
    expect(SRC).toContain('<FreeAccountChip />')
  })
})

describe('DashboardOnboardingChecklist — W42A-FIX portfolio count bug fix', () => {
  it('uses the two-step loadPortfolioItemCount helper (portfolios → portfolio_items)', () => {
    expect(SRC).toContain("import { loadPortfolioItemCount } from '@/lib/account/usage'")
    expect(SRC).toContain('loadPortfolioItemCount(supabase, userId)')
  })

  it('no longer counts portfolio_items via the single-step countRows(portfolio_items, ...)', () => {
    // Guard against a regression to the direct .eq('user_id', ...)
    // pattern on portfolio_items, which missed older rows.
    expect(SRC).not.toContain("countRows('portfolio_items'")
  })

  it('still uses countRows for the watchlist count (that table has user_id first-class)', () => {
    expect(SRC).toContain("countRows('watchlist'")
  })
})
