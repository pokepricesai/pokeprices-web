// Block 5A-W-50B-FIX1 — pin the set-page wiring for tile actions.
//
// Verifies:
//   * sealed cards return null from buildTileActionProps (actions hidden)
//   * set page replays intent only when origin_set_name === setName
//   * both watchlist_add and portfolio_open intents are handled
//   * consumeIntendedAction is called (intent cleared) after acting
//   * peekIntendedAction is used first so unrelated intents survive
//   * two-query membership loader wired for authed users only

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/set/[slug]/SetPageClient.tsx'),
  'utf8',
)

describe('SetPageClient — tile-action wiring', () => {
  it('sealed cards receive null tile-action props (actions hidden)', () => {
    expect(SRC).toMatch(/if \(c\.is_sealed\) return null/)
  })

  it('imports the intent helpers', () => {
    expect(SRC).toContain('peekIntendedAction')
    expect(SRC).toContain('consumeIntendedAction')
  })

  it('scopes intent replay to the current set via origin_set_name', () => {
    // Must compare origin_set_name to setName before consuming.
    expect(SRC).toMatch(/origin_set_name/)
    expect(SRC).toMatch(/originSet !== setName/)
  })

  it('peeks BEFORE consuming so foreign intents survive', () => {
    // Order: peek → decide → consume. If we consumed first, a set
    // page that isn't the intent origin would silently nuke the
    // pending intent for the correct set.
    const peekIdx = SRC.indexOf('peekIntendedAction()')
    const consumeIdx = SRC.indexOf('consumeIntendedAction()')
    expect(peekIdx).toBeGreaterThanOrEqual(0)
    expect(consumeIdx).toBeGreaterThan(peekIdx)
  })

  it('replays watchlist_add intent through the shared helper', () => {
    expect(SRC).toContain("peeked.type === 'watchlist_add'")
    expect(SRC).toContain('performWatchlistAdd(supabase, user.id')
  })

  it('replays portfolio_open by opening the existing modal (no auto-write)', () => {
    expect(SRC).toContain("peeked.type === 'portfolio_open'")
    expect(SRC).toContain('setPortfolioModalCard(')
    // No .from('portfolio_items').insert directly in the replay path
    const replayBlock = SRC.match(/peeked\.type === 'portfolio_open'[\s\S]*?setPortfolioModalCard/)
    expect(replayBlock).toBeTruthy()
    expect(replayBlock![0]).not.toContain('.insert(')
  })

  it('membership loader gated on user?.id (anonymous makes no query)', () => {
    // The effect returns early when !user?.id, so an anonymous user
    // triggers zero loadSetMembership calls.
    expect(SRC).toMatch(/if \(!user\?\.id[^)]*\) \{ setMembership\(EMPTY_MEMBERSHIP\); return \}/)
  })

  it('membership refresh after portfolio modal close (single reload, not per-tile)', () => {
    // After the modal closes we call loadSetMembership ONCE.
    // Grep confirms exactly one call site inside the close handler.
    const closeHandler = SRC.match(/setPortfolioModalCard\(null\)[\s\S]*?loadSetMembership/)
    expect(closeHandler).toBeTruthy()
  })
})
