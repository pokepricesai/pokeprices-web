// Block 5A-W-50C — pin the set-page header wiring for portfolio
// completion. Shared component + same formula as the browse tile.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'),
  'utf8',
)

describe('SetPageClient — Block 5A-W-50C wiring', () => {
  it('imports the shared SetCompletionProgress component', () => {
    expect(SRC).toContain("import SetCompletionProgress from '@/components/SetCompletionProgress'")
  })

  it('completion appears only when authenticated AND owns >= 1 card', () => {
    // Must gate on user AND membership.inPortfolio.size > 0. No
    // placeholder when logged out or zero owned.
    expect(SRC).toMatch(/user && membership\.inPortfolio\.size > 0/)
  })

  it('denominator is the loaded non-sealed cards length (regularCards.length)', () => {
    // Same rule as the browse tile: exclude sealed products from the
    // denominator so the two surfaces match.
    expect(SRC).toContain('totalEligible={regularCards.length}')
  })

  it('numerator is the pre-loaded portfolio membership (no extra query)', () => {
    // membership.inPortfolio is populated by the W50B loadSetMembership
    // helper — we do NOT issue any additional completion query on
    // this page.
    expect(SRC).toContain('ownedDistinct={membership.inPortfolio.size}')
  })

  it('uses the full variant in the set-page header', () => {
    expect(SRC).toContain('variant="full"')
  })

  it('does not render the header progress while loading (avoids flash)', () => {
    // The completion block guards on !loading so it does not render
    // a stale bar mid-fetch before regularCards populates.
    expect(SRC).toMatch(/membership\.inPortfolio\.size > 0 && !loading/)
  })
})
