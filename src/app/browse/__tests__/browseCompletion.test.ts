// Block 5A-W-50C — pin the browse-page wiring for portfolio
// completion + the auth-gated "Most complete" sort.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/browse/BrowsePageClient.tsx'),
  'utf8',
)

describe('BrowsePageClient — Block 5A-W-50C wiring', () => {
  it('imports the shared loader + progress component', () => {
    expect(SRC).toContain('loadPortfolioOwnedBySet')
    expect(SRC).toContain('buildCompletionMap')
    expect(SRC).toContain("import SetCompletionProgress from '@/components/SetCompletionProgress'")
  })

  it('adds completion_desc to the SortOption union', () => {
    expect(SRC).toContain("'completion_desc'")
  })

  it('completion effect is gated on userId (anonymous makes 0 queries)', () => {
    // The completion-loading effect must early-return when userId is
    // null so anonymous users make zero portfolio requests.
    expect(SRC).toMatch(/if \(!userId[^)]*\) \{ setCompletion\(\{\}\); return \}/)
  })

  it('reuses get_set_list_v2.card_count as the denominator (no extra query)', () => {
    // The totals map is built from the existing sets array (from
    // get_set_list_v2). No new RPC / no extra network round-trip.
    expect(SRC).toContain('totals[s.set_name] = s.card_count ?? 0')
  })

  it('"Most Complete" chip only rendered for authenticated users', () => {
    // The sort chip list splices the completion sort in ONLY when
    // userId is present. Anonymous visitors never see the option.
    expect(SRC).toContain(`...(userId ? [['completion_desc', 'Most Complete']]`)
  })

  it('sort switch handles completion_desc (percentage → owned → release)', () => {
    expect(SRC).toContain("case 'completion_desc'")
    // Primary: percentage desc. Secondary: owned desc. Tertiary:
    // release date desc as a stable tie-break.
    expect(SRC).toMatch(/if \(pa !== pb\) return pb - pa/)
    expect(SRC).toMatch(/if \(oa !== ob\) return ob - oa/)
  })

  it('sort resets to the default when a signed-in user signs out', () => {
    // Defensive: if the user was on "Most complete" and their session
    // expires, we fall back to the default so the sort chip does not
    // silently disappear while the ordering stays stuck.
    expect(SRC).toMatch(/if \(!userId && sort === ['"]completion_desc['"]\) setSort\(['"]release_desc['"]\)/)
  })

  it('progress renders inside the tile only when userId AND completion entry exist', () => {
    // Anonymous users MUST NOT see the progress. Users with zero
    // owned cards from a set must NOT see it either — buildCompletion
    // omits those entries, so the {completion[s.set_name] && ...}
    // guard doubles as the "no placeholder" rule.
    expect(SRC).toContain('userId && completion[s.set_name] &&')
    expect(SRC).toContain('<SetCompletionProgress')
    expect(SRC).toContain('variant="compact"')
  })
})
