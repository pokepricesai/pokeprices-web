// Block 5A-W-40A — Footer now hosts the demoted Community + Games
// items that were removed from the top-level nav. Pin the presence of
// the three-column structure and the exact links.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FOOTER_SRC = readFileSync(
  join(__dirname, '..', 'Footer.tsx'),
  'utf8',
)

describe('Footer — Block 5A-W-40A restructure', () => {
  it('has an Explore column with the primary browse targets', () => {
    expect(FOOTER_SRC).toMatch(/const exploreLinks\s*=\s*\[[\s\S]*?\]/)
    for (const [label, href] of [
      ['Cards',    '/browse'],
      ['Sets',     '/browse#sets'],
      ['Pokémon',  '/pokemon'],
      ['Insights', '/insights'],
      ['Tools',    '/tools'],
      ['Ask AI',   '/ai-assistant'],
    ]) {
      expect(FOOTER_SRC).toContain(`label: '${label}'`)
      expect(FOOTER_SRC).toContain(`href: '${href}'`)
    }
  })

  it('has a Community column with the 5 demoted items', () => {
    expect(FOOTER_SRC).toMatch(/const communityLinks\s*=\s*\[[\s\S]*?\]/)
    for (const [label, href] of [
      ['Content Creators',    '/creators'],
      ['Vendors & Dealers',   '/vendors'],
      ['Upcoming Card Shows', '/card-shows'],
      ['Submit a Listing',    '/creators/submit'],
      ['Games',               '/games'],
    ]) {
      expect(FOOTER_SRC).toContain(`label: '${label}'`)
      expect(FOOTER_SRC).toContain(`href: '${href}'`)
    }
  })

  it('keeps the Company column unchanged', () => {
    for (const label of ['Features & Roadmap', 'Contact', 'Privacy', 'Terms']) {
      expect(FOOTER_SRC).toContain(`label: '${label}'`)
    }
  })

  it('renders three FooterColumn instances (Explore + Community + Company)', () => {
    const matches = FOOTER_SRC.match(/<FooterColumn\b/g) ?? []
    expect(matches.length).toBe(3)
    expect(FOOTER_SRC).toMatch(/title="Explore"/)
    expect(FOOTER_SRC).toMatch(/title="Community"/)
    expect(FOOTER_SRC).toMatch(/title="Company"/)
  })

  it('no longer references the pre-W40A "Product" column', () => {
    expect(FOOTER_SRC).not.toMatch(/title="Product"/)
    // The old "Prices" label is likewise gone (was in productLinks).
    expect(FOOTER_SRC).not.toMatch(/label:\s*'Prices'/)
  })
})
