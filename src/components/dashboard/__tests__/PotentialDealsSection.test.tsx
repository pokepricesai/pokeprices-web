// Block 5A-W-43A — invariants for the dashboard's Potential eBay
// Deals section. Source-read tests pin the cautious copy, forbidden
// language regressions, affiliate wrapping path, and empty-state
// handling. Two direct utility tests cover the pure marketplace
// helpers.
//
// The component transitively imports @/lib/supabase which builds a
// browser client at module load time. Stub it before the top-level
// import so the vitest node env can evaluate the module.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq:  () => ({ gte: () => ({ gte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }),
      }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession:        async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))

import { marketplaceLabel, marketplaceMode } from '../PotentialDealsSection'

const SRC = readFileSync(join(__dirname, '..', 'PotentialDealsSection.tsx'), 'utf8')

describe('PotentialDealsSection — cautious copy', () => {
  it('renders the required heading, sub-copy and disclaimer verbatim', () => {
    expect(SRC).toContain('Potential eBay deals')
    expect(SRC).toContain('Cards listed below recent market price. Check condition and seller before buying.')
    expect(SRC).toContain('Prices and availability can change quickly. Always check the listing before buying. Updated daily.')
  })

  it('shows the required empty-state copy', () => {
    expect(SRC).toContain('No potential deals found today.')
  })

  it('CTA label is "Check on eBay"', () => {
    expect(SRC).toContain('Check on eBay')
  })

  it('never uses forbidden marketing language', () => {
    for (const banned of [
      'guaranteed', 'guarantee',
      'profit',
      'easy money',
      'sure thing', 'sure-thing',
      // "flip" catches "flip that card" style copy but not React's flip
      // animation etc. Ensure no whole-word matches at least.
      'to flip', 'quick flip', 'flip for',
      'arbitrage',
    ]) {
      expect(SRC.toLowerCase()).not.toContain(banned)
    }
  })
})

describe('PotentialDealsSection — affiliate wrapping', () => {
  it('imports affiliateWrapEbayUrl from the central engine (never builds URLs locally)', () => {
    expect(SRC).toContain("import { affiliateWrapEbayUrl } from '@/lib/ebayAffiliate'")
    expect(SRC).toContain('affiliateWrapEbayUrl(deal.item_web_url')
  })

  it('never assigns deal.item_web_url directly to an href', () => {
    // If item_web_url leaks straight into an href attribute, the audit
    // script would still catch it — but pin the invariant here so a
    // reviewer can see the intent.
    expect(SRC).not.toMatch(/href=\{deal\.item_web_url\}/)
    expect(SRC).not.toMatch(/href=\{`\$\{deal\.item_web_url\}/)
  })

  it('threads a placement + source component into the wrapper for analytics', () => {
    expect(SRC).toContain("placement:       'dashboard_potential_deals'")
    expect(SRC).toContain("sourceComponent: 'PotentialDealsSection'")
  })

  it('fails closed when the affiliate wrapper returns null (renders no CTA anchor)', () => {
    // The `!affiliateUrl` branch renders the fallback text instead of
    // a broken/unhrefed link.
    expect(SRC).toMatch(/affiliateUrl \? \(/)
    expect(SRC).toContain('eBay listing')
  })

  it('external links carry the safe rel set (noopener sponsored nofollow) and target=_blank', () => {
    expect(SRC).toContain('target="_blank"')
    expect(SRC).toContain('rel="noopener sponsored nofollow"')
  })
})

describe('PotentialDealsSection — data source + gating', () => {
  it('reads deals via the shared loader (no direct daily_deals SELECT here)', () => {
    expect(SRC).toContain("import {\n  loadPotentialDeals,")
    expect(SRC).toContain('loadPotentialDeals(supabase, { limit: 5 })')
    expect(SRC).not.toContain("from('daily_deals')")
  })

  it('is not gated on Pro (no plan / entitlement imports)', () => {
    expect(SRC).not.toContain('useUserPlan')
    expect(SRC).not.toContain('entitlements')
    expect(SRC).not.toContain('canAddPortfolioItem')
  })

  it('handles loading, empty and populated states without a hollow section', () => {
    // Loading: skeleton.
    expect(SRC).toContain('className="skeleton"')
    // Empty branch renders the "No potential deals" copy.
    expect(SRC).toMatch(/deals\.length === 0/)
    // Populated branch renders a <ul> with DealRow children.
    expect(SRC).toContain('<DealRow')
  })
})

describe('PotentialDealsSection — utility helpers', () => {
  it('maps eBay marketplace codes to friendly labels', () => {
    expect(marketplaceLabel('EBAY_GB')).toBe('ebay.co.uk')
    expect(marketplaceLabel('EBAY_US')).toBe('ebay.com')
    expect(marketplaceLabel('unknown')).toBe('eBay')
    expect(marketplaceLabel(null)).toBe('eBay')
  })

  it('maps eBay marketplace codes to the ebayAffiliate marketplace type', () => {
    expect(marketplaceMode('EBAY_GB')).toBe('uk')
    expect(marketplaceMode('EBAY_US')).toBe('us')
    expect(marketplaceMode('unknown')).toBe(null)
  })
})
