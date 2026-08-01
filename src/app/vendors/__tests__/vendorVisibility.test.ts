// Block 5A-W-50A — pins the vendor visibility rule.
//
// The /vendors listing and the /vendors/[slug] detail page must apply
// the SAME approval rule: `active=true` and no vendor_type exclusion.
// A prior version silently excluded vendor_type IN (online_shop,
// marketplace, private_seller), which left EvoMarket invisible after
// Luke approved it (active=true, verified=true, type=marketplace).
//
// These tests read the two source files directly and assert on the
// string form of the Supabase query. That is deliberately brittle:
// if someone reintroduces a hidden vendor_type filter or drops the
// active check, the test catches it.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()
const LISTING = readFileSync(join(REPO, 'src/app/vendors/VendorsPageClient.tsx'), 'utf8')
const DETAIL  = readFileSync(join(REPO, 'src/app/vendors/[slug]/page.tsx'), 'utf8')

describe('Block 5A-W-50A — vendor visibility rule', () => {
  it('the /vendors listing gates on active=true', () => {
    expect(LISTING).toMatch(/\.eq\(\s*['"]active['"]\s*,\s*true\s*\)/)
  })

  it('the /vendors listing does NOT exclude any vendor_type', () => {
    // Strip line comments so a historical mention in commentary does
    // not defeat the check. Filter chips still narrow by vendor_type
    // via .eq — allowed. Blanket exclusion is banned.
    const codeOnly = LISTING.replace(/\/\/.*$/gm, '')
    expect(codeOnly).not.toMatch(/\.not\(\s*['"]vendor_type['"]/)
    // Also pin the specific historical exclusion tuple never returns.
    expect(codeOnly).not.toContain('(online_shop,marketplace,private_seller)')
  })

  it('the /vendors listing offers every submittable vendor_type as a filter chip', () => {
    // The submission form accepts these types; the listing must not
    // silently hide any of them. FILTER_TYPES is the source of truth
    // for the chip row.
    for (const t of [
      'physical_shop', 'retailer', 'ebay_store', 'grading_service',
      'marketplace', 'online_shop', 'private_seller',
    ]) {
      expect(LISTING).toContain(`value: '${t}'`)
    }
  })

  it('the /vendors/[slug] detail page gates on active=true (same rule)', () => {
    expect(DETAIL).toMatch(/\.eq\(\s*['"]active['"]\s*,\s*true\s*\)/)
  })

  it('the /vendors/[slug] detail page does NOT filter on verified', () => {
    // verified is the BADGE signal, not the visibility rule. An
    // unverified but active vendor still opens on its detail page.
    expect(DETAIL).not.toMatch(/\.eq\(\s*['"]verified['"]/)
  })

  it('the /vendors listing does not filter on verified for inclusion (order-by only)', () => {
    // The listing may `.order('verified', ...)` to surface verified
    // vendors first, but must not `.eq('verified', true)` — that
    // would hide legitimate active-but-unverified vendors.
    expect(LISTING).not.toMatch(/\.eq\(\s*['"]verified['"]\s*,\s*true\s*\)/)
    // And the presence of the sort remains intact
    expect(LISTING).toMatch(/\.order\(\s*['"]verified['"]/)
  })
})
