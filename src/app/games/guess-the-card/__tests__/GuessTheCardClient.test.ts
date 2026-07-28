// Block 5A-W-47E-B — source-invariant tests for the Guess the Card
// client + games-index registration. Follows the same pattern the
// Build a Binder FIX1 tests use: the client has a Supabase import
// chain and heavy client state, so we read the file as text and pin
// the specific bytes that implement each brief requirement.

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
    // Spot-check that no common emojis leaked into the entry.
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

// ── Client — game loop wiring ───────

describe('client (Part 4) — game loop wiring', () => {
  it('maximum 4 guesses per round (MAX_ATTEMPTS constant used)', () => {
    // The client imports and uses MAX_ATTEMPTS from the pure module.
    expect(CLIENT_SRC).toContain("MAX_ATTEMPTS")
    expect(CLIENT_SRC).toMatch(/nextGuesses\.length\s*>=\s*MAX_ATTEMPTS/)
  })
  it('tracks a current streak in React state', () => {
    expect(CLIENT_SRC).toMatch(/const \[streak, setStreak\]\s*=\s*useState\(0\)/)
  })
  it('tracks best streak with a localStorage-backed helper', () => {
    expect(CLIENT_SRC).toContain('readBestStreak')
    expect(CLIENT_SRC).toContain('writeBestStreak')
  })
  it('bumps and persists best streak on a correct guess', () => {
    // The bump path calls writeBestStreak with the new value.
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
    // Prohibited: canvas or a third-party image processor.
    expect(CLIENT_SRC).not.toContain('canvas')
    expect(CLIENT_SRC).not.toContain('imgproxy')
    expect(CLIENT_SRC).not.toContain('cloudinary')
  })
  it('reads the transform for the current level from the pure REVEAL_TRANSFORMS table', () => {
    expect(CLIENT_SRC).toContain('REVEAL_TRANSFORMS')
    expect(CLIENT_SRC).toContain('revealLevel')
  })
  it('uses neutral alt text before reveal (no card name leak)', () => {
    // The neutral alt is used whenever phase === guessing.
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

// ── Client — guess input UX (Part 8) ─

describe('client (Part 8) — input UX', () => {
  it('submits via <form onSubmit=…> (Enter works natively)', () => {
    expect(CLIENT_SRC).toMatch(/onSubmit=\{onSubmitGuess\}/)
  })
  it('empty guess shows a validation message but does not consume an attempt', () => {
    expect(CLIENT_SRC).toContain("'Type a card name first.'")
    expect(CLIENT_SRC).toMatch(/if \(!raw\) \{[\s\S]*setValidationMsg[\s\S]*return\s*\}/)
  })
  it('input clears after an incorrect guess', () => {
    expect(CLIENT_SRC).toMatch(/setGuesses\(nextGuesses\)[\s\S]*setGuess\(''\)/)
  })
  it('duplicate guesses do NOT consume another attempt', () => {
    expect(CLIENT_SRC).toContain('isDuplicateGuess')
    expect(CLIENT_SRC).toContain("'You already tried that guess.'")
  })
  it('is disabled (form not rendered) once the round is over', () => {
    // The form only mounts while phase === 'guessing'; after the
    // round it's replaced by the Next-card / View-card row.
    expect(CLIENT_SRC).toMatch(/phase === 'guessing' \?[\s\S]{0,20}<form/)
  })
  it('never uses browser alert() for feedback', () => {
    expect(CLIENT_SRC).not.toMatch(/\balert\s*\(/)
  })
  it('re-focuses the input after Next card (keyboard-friendly)', () => {
    expect(CLIENT_SRC).toMatch(/inputRef\.current\?\.focus\(\)/)
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
    // The catch path emits a human message, not error.message.
    expect(CLIENT_SRC).not.toMatch(/setError\(.*error\.message/)
  })
})
