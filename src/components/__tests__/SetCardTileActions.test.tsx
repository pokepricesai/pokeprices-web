// Block 5A-W-50B — pin the tile-actions contract without React-render.
//
// The existing test convention in src/components/__tests__/ is to
// read the component source as text and assert on the invariants
// that matter. That style avoids a full React/hydration setup for
// components that transitively import the module-level Supabase
// browser client, and keeps the harness fast.
//
// The invariants here are the ones the review demands: no DB write
// before auth, exact-identity threading via set_name, click events
// stopped from bubbling to the tile <Link>, and the entitlement
// gate is applied before every add path.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/components/SetCardTileActions.tsx'),
  'utf8',
)

describe('SetCardTileActions — contract', () => {
  it('imports the shared setIntendedAction (auto-replay after auth)', () => {
    expect(SRC).toMatch(/from '@\/lib\/intendedAction'/)
    expect(SRC).toContain('setIntendedAction')
  })

  it('anonymous Watch stores an intent with card_slug AND set_name', () => {
    // Both identity fields must appear inside the intent payload so
    // English/JP printings never collide in the auto-replay path.
    expect(SRC).toMatch(/type:\s*['"]watchlist_add['"]/)
    expect(SRC).toMatch(/card_slug:\s*bareSlug/)
    expect(SRC).toMatch(/set_name:\s*card\.set_name/)
  })

  it('anonymous Watch calls onOpenAuthPrompt("watchlist") — no DB write', () => {
    expect(SRC).toMatch(/onOpenAuthPrompt\(['"]watchlist['"]\)/)
    // Before the anon return there must be no supabase.from(...) write
    // — the top of handleWatch reads: if (!user) { …intent + prompt; return }
    const anonBlock = SRC.match(/if \(!user\) \{[\s\S]*?onOpenAuthPrompt\(['"]watchlist['"]\)[\s\S]*?return[\s\S]*?\}/)
    expect(anonBlock).toBeTruthy()
    expect(anonBlock![0]).not.toContain('supabase.from')
    expect(anonBlock![0]).not.toContain('.insert(')
    expect(anonBlock![0]).not.toContain('.delete(')
  })

  it('anonymous Portfolio calls onOpenAuthPrompt("portfolio") — no DB write', () => {
    expect(SRC).toMatch(/onOpenAuthPrompt\(['"]portfolio['"]\)/)
    const anonBlock = SRC.match(/async function handlePortfolio[\s\S]*?if \(!user\) \{[\s\S]*?onOpenAuthPrompt\(['"]portfolio['"]\)[\s\S]*?return[\s\S]*?\}/)
    expect(anonBlock).toBeTruthy()
    expect(anonBlock![0]).not.toContain('supabase.from')
  })

  it('every click handler swallows propagation so the tile <Link> does not navigate', () => {
    // The swallow() helper calls both preventDefault and stopPropagation.
    expect(SRC).toContain('function swallow')
    expect(SRC).toContain('e.preventDefault()')
    expect(SRC).toContain('e.stopPropagation()')
    // Buttons wire swallow via onPointerDown so the parent Link never
    // fires — critical on mobile where click may fire faster than
    // synthetic React events.
    expect(SRC).toMatch(/onPointerDown=\{swallow\}/)
  })

  it('reuses shared performWatchlistAdd helper (identity-safe upsert)', () => {
    // FIX1 — the upsert logic lives in src/lib/watchlistOps.ts so
    // both the tile action and the set-page replay path share the
    // exact same (user_id, card_slug, set_name) dedup/insert rule.
    expect(SRC).toMatch(/from ['"]@\/lib\/watchlistOps['"]/)
    expect(SRC).toContain('performWatchlistAdd')
  })

  it('anonymous Portfolio stores a portfolio_open intent with origin_set_name', () => {
    // FIX1 — the auth prompt for Portfolio now saves an intent so the
    // set page can auto-open the modal after login.
    expect(SRC).toMatch(/type:\s*['"]portfolio_open['"]/)
    // origin_set_name appears in BOTH intent payloads (watchlist +
    // portfolio) so replay can scope to the current set.
    const originHits = (SRC.match(/origin_set_name:\s*card\.set_name/g) || []).length
    expect(originHits).toBeGreaterThanOrEqual(2)
  })

  it('entitlement gate runs BEFORE the insert path', () => {
    // canAddWatchlistItem must be called before performWatchlistAdd
    const watchAdd = SRC.match(/canAddWatchlistItem[\s\S]*?performWatchlistAdd/)
    expect(watchAdd).toBeTruthy()
    // Same for portfolio: canAddPortfolioItem before onOpenPortfolio
    const pfAdd = SRC.match(/canAddPortfolioItem[\s\S]*?onOpenPortfolio/)
    expect(pfAdd).toBeTruthy()
  })

  it('button labels include the card name for screen readers', () => {
    expect(SRC).toContain('aria-label={watchLabel}')
    expect(SRC).toContain('aria-label={pfLabel}')
    expect(SRC).toContain('aria-pressed={isWatched}')
  })

  it('touch-friendly: buttons have minHeight >= 32 and are always rendered (no hover gate)', () => {
    // No :hover / onMouseEnter conditional rendering of the row.
    expect(SRC).not.toMatch(/onMouseEnter[\s\S]*setShowActions/)
    expect(SRC).toMatch(/minHeight:\s*32/)
  })

  it('does not use emoji icons (uses inline SVG for eye + briefcase)', () => {
    // The block brief bans emoji in the button chrome. Assert SVG
    // presence and explicit-glyph absence via .toContain (avoids the
    // Unicode `u` regex flag that the tsc target rejects).
    expect(SRC).toContain('<svg')
    const EMOJI_CHARS = ['👁', '📊', '🔔', '⭐']  // eye, chart, bell, star
    for (const emoji of EMOJI_CHARS) {
      expect(SRC).not.toContain(emoji)
    }
  })

  it('remove path filters on set_name (never removes cross-set card)', () => {
    // FIX1 — after extracting performWatchlistAdd to watchlistOps,
    // only the delete branch remains here. At least one eq('set_name'
    // ...) call must appear so a remove for an English "Charizard"
    // never targets the Japanese row.
    const setNameFilters = (SRC.match(/\.eq\(['"]set_name['"]/g) || []).length
    expect(setNameFilters).toBeGreaterThanOrEqual(1)
  })
})
