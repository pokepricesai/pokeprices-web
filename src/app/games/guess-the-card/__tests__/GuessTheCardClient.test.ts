// Block 5A-W-47E-B (with FIX1) — source-invariant tests for the
// Guess the Card client + games-index registration.
//
// FIX1 changes:
//   * the input form is gone; we now pin the presence of 3 option
//     buttons and the absence of any typed-guess machinery.
//   * the client uses MAX_WRONG_PICKS / generateOptions / GuessOption.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CLIENT_SRC = readFileSync(
  join(__dirname, '..', 'GuessTheCardClient.tsx'),
  'utf8',
)
const PAGE_SRC = readFileSync(
  join(__dirname, '..', 'page.tsx'),
  'utf8',
)
const INDEX_SRC = readFileSync(
  join(__dirname, '..', '..', 'page.tsx'),
  'utf8',
)

// ── Route + metadata ─────────────────

describe('route + metadata (Part 2)', () => {
  it('page.tsx sets the block-specified title', () => {
    expect(PAGE_SRC).toContain("title: 'Guess the Pokémon Card | PokePrices'")
  })
  it('page.tsx sets the block-specified description', () => {
    expect(PAGE_SRC).toContain('Identify Pokémon cards from obscured artwork')
    expect(PAGE_SRC).toContain('build your streak')
  })
  it('page.tsx sets the exact canonical URL', () => {
    expect(PAGE_SRC).toContain("canonical: 'https://www.pokeprices.io/games/guess-the-card'")
  })
  it('page.tsx does NOT set robots.noindex — the game is indexable like the siblings', () => {
    expect(PAGE_SRC).not.toContain('index: false')
    expect(PAGE_SRC).not.toContain('noindex')
  })
})

// ── Games index registration ────────

describe('Games index registration (Part 10)', () => {
  it('lists Guess the Card exactly once', () => {
    const hrefs = INDEX_SRC.match(/href:\s*'\/games\/guess-the-card'/g) ?? []
    expect(hrefs.length).toBe(1)
  })
  it('title matches the block-specified label', () => {
    expect(INDEX_SRC).toContain("title: 'Guess the Card'")
  })
  it('description matches the block-specified blurb', () => {
    expect(INDEX_SRC).toContain("Identify a Pokémon card as the artwork becomes clearer with every clue.")
  })
  it('does NOT set an emoji on the Guess the Card entry (matches Build a Binder treatment)', () => {
    const entry = INDEX_SRC.match(
      /\{[^{}]*href:\s*'\/games\/guess-the-card'[\s\S]*?\}/,
    )
    expect(entry, 'Guess the Card entry not found').toBeTruthy()
    expect(entry![0]).not.toMatch(/emoji:\s*'/)
    for (const glyph of ['📒', '🎯', '📈', '📕', '📖', '🎮', '🎲', '👀', '❓']) {
      expect(entry![0]).not.toContain(glyph)
    }
  })
  it('preserves the two sibling emoji games (regression pin)', () => {
    expect(INDEX_SRC).toContain("emoji: '🎯'")   // Guess the Price
    expect(INDEX_SRC).toContain("emoji: '📈'")   // Higher or Lower
  })
  it('Build a Binder entry is still emoji-free (unchanged by W47E-B)', () => {
    const bab = INDEX_SRC.match(/\{[^{}]*href:\s*'\/games\/build-a-binder'[\s\S]*?\}/)!
    expect(bab[0]).not.toMatch(/emoji:\s*'/)
  })
})

// ── Client — game loop wiring (FIX1: multiple choice) ──

describe('client (Part 4 FIX1) — game loop wiring', () => {
  it('uses MAX_WRONG_PICKS (2) as the reveal cap — 3 options × 1 correct = 2 misses max', () => {
    expect(CLIENT_SRC).toContain('MAX_WRONG_PICKS')
    expect(CLIENT_SRC).toMatch(/nextWrong\.length\s*>=\s*MAX_WRONG_PICKS/)
  })
  it('tracks a current streak in React state', () => {
    expect(CLIENT_SRC).toMatch(/const \[streak, setStreak\]\s*=\s*useState\(0\)/)
  })
  it('tracks best streak with a localStorage-backed helper', () => {
    expect(CLIENT_SRC).toContain('readBestStreak')
    expect(CLIENT_SRC).toContain('writeBestStreak')
  })
  it('bumps and persists best streak on a correct pick', () => {
    expect(CLIENT_SRC).toMatch(/writeBestStreak\(nextStreak\)/)
  })
  it('resets current streak on a lost round (miss cap or reveal)', () => {
    expect(CLIENT_SRC).toContain('function resetStreak')
    expect(CLIENT_SRC).toMatch(/resetStreak\(\)/)
  })
})

// ── Client — reveal method (Part 5) ─

describe('client (Part 5) — image reveal method', () => {
  it('uses CSS filter + transform (no canvas, no remote image service)', () => {
    expect(CLIENT_SRC).toMatch(/filter:\s*`?blur\(/)
    expect(CLIENT_SRC).toMatch(/transform:\s*`?scale\(/)
    expect(CLIENT_SRC).not.toContain('canvas')
    expect(CLIENT_SRC).not.toContain('imgproxy')
    expect(CLIENT_SRC).not.toContain('cloudinary')
  })
  it('reads the transform for the current level from the pure REVEAL_TRANSFORMS table', () => {
    expect(CLIENT_SRC).toContain('REVEAL_TRANSFORMS')
    expect(CLIENT_SRC).toContain('revealLevel')
  })
  it('uses neutral alt text before reveal (no card name leak)', () => {
    expect(CLIENT_SRC).toContain("'Obscured Pokémon card'")
    expect(CLIENT_SRC).toMatch(/phase === 'guessing'[\s\S]*?'Obscured Pokémon card'/)
  })
  it('after reveal, the alt text carries the real card name', () => {
    expect(CLIENT_SRC).toMatch(/cardDisplayName[\s\S]*card\?\.set_name/)
  })
  it('honours the reduced-motion preference on the CSS transition', () => {
    expect(CLIENT_SRC).toContain('prefers-reduced-motion: reduce')
  })
})

// ── Client — multiple-choice UX (FIX1 replaces old input UX) ──

describe('client (Part 8 FIX1) — multiple-choice UX', () => {
  it('renders option buttons by mapping over the generated options list', () => {
    // The client should iterate `options.map` inside JSX.
    expect(CLIENT_SRC).toMatch(/options\.map\(/)
  })
  it('uses the pure generateOptions helper to build the choices', () => {
    expect(CLIENT_SRC).toContain('generateOptions')
  })
  it('has NO text input for the guess (the FIX1 regression pin)', () => {
    // No <input type="text" ...>, no guess-input id, no isDuplicateGuess.
    expect(CLIENT_SRC).not.toMatch(/<input[^>]*type=["']text["']/)
    expect(CLIENT_SRC).not.toContain('isDuplicateGuess')
    expect(CLIENT_SRC).not.toContain('isCorrectGuess')
    expect(CLIENT_SRC).not.toContain('acceptedAnswersFor')
    expect(CLIENT_SRC).not.toContain('normalizeAnswer')
  })
  it('has NO submit form for guesses (regression pin)', () => {
    expect(CLIENT_SRC).not.toMatch(/onSubmit=/)
  })
  it('wrong picks are eliminated (disabled + strikethrough)', () => {
    // The client tracks eliminated slugs in `wrongPicks` and marks
    // buttons `disabled` / `line-through` accordingly.
    expect(CLIENT_SRC).toContain('wrongPicks')
    expect(CLIENT_SRC).toMatch(/wrongPicks\.includes\(opt\.key\)/)
    expect(CLIENT_SRC).toMatch(/line-through/)
  })
  it('option list only mounts while phase === "guessing"', () => {
    expect(CLIENT_SRC).toMatch(/phase === 'guessing' \?[\s\S]{0,60}(<div|options\.map)/)
  })
  it('never uses browser alert() for feedback', () => {
    expect(CLIENT_SRC).not.toMatch(/\balert\s*\(/)
  })
  it('re-focuses the first option after Next card (keyboard-friendly)', () => {
    expect(CLIENT_SRC).toMatch(/firstOptionRef\.current\?\.focus\(\)/)
  })
  it('provides a Reveal answer escape hatch', () => {
    expect(CLIENT_SRC).toContain('function revealAnswer')
    expect(CLIENT_SRC).toMatch(/Reveal answer/)
  })
})

// ── Client — data source + View card (Part 3, 7) ─

describe('client — card pool + View card destination', () => {
  it('reads from the existing popular_card_trends table (no schema change)', () => {
    expect(CLIENT_SRC).toContain("supabase.from('popular_card_trends')")
  })
  it('excludes cards with a null image_url or null card_url_slug at the query level', () => {
    expect(CLIENT_SRC).toContain("not('image_url', 'is', null)")
    expect(CLIENT_SRC).toContain("not('card_url_slug', 'is', null)")
  })
  it('filters the fetched pool through the pure isPlayableGuessCard helper', () => {
    expect(CLIENT_SRC).toContain('isPlayableGuessCard')
  })
  it('View card link uses the canonical /set/{set}/card/{slug} route', () => {
    expect(CLIENT_SRC).toContain('/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}')
  })
})

// ── Client — error and empty states (Part 11) ─

describe('client (Part 11) — error and empty states', () => {
  it('renders a loading placeholder while the pool is being fetched', () => {
    expect(CLIENT_SRC).toContain('Loading a card…')
  })
  it('shows a useful empty-pool message', () => {
    expect(CLIENT_SRC).toContain('No cards available right now')
  })
  it('image error handler skips the round instead of crashing', () => {
    expect(CLIENT_SRC).toContain('function onImageError')
    expect(CLIENT_SRC).toMatch(/nextCard\(\)/)
  })
  it('bounds image-error retries so no infinite skip loop is possible', () => {
    expect(CLIENT_SRC).toContain('MAX_IMAGE_FAILURES')
    expect(CLIENT_SRC).toContain('The card pool is currently returning broken images')
  })
  it('never exposes raw Supabase error messages to the user', () => {
    expect(CLIENT_SRC).not.toMatch(/setError\(.*error\.message/)
  })
})
