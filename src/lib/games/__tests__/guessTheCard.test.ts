// Block 5A-W-47E-B — pure tests for the Guess the Card helpers.

import { describe, it, expect } from 'vitest'
import {
  isPlayableGuessCard,
  normalizeAnswer,
  acceptedAnswersFor,
  isCorrectGuess,
  isDuplicateGuess,
  REVEAL_TRANSFORMS,
  revealLevel,
  clueForLevel,
  firstAcceptedDisplayName,
  pickNextCard,
  readBestStreak,
  writeBestStreak,
  MAX_ATTEMPTS,
  BEST_STREAK_STORAGE_KEY,
  type GuessCard,
} from '../guessTheCard'

function card(over: Partial<GuessCard> = {}): GuessCard {
  return {
    card_name:            'Pikachu #58',
    set_name:             'Base Set',
    card_url_slug:        'pikachu-58',
    card_number:          '58',
    card_number_display:  '58/102',
    set_printed_total:    '102',
    image_url:            'https://example.com/pikachu.png',
    sales_30d:            10,
    is_sealed:            false,
    ...over,
  }
}

// ── Constants ──────────────────────────

describe('constants', () => {
  it('MAX_ATTEMPTS is 4', () => {
    expect(MAX_ATTEMPTS).toBe(4)
  })
  it('has one reveal transform per level, plus the final revealed level', () => {
    // 0 initial + 3 mid-game misses + 1 revealed = 5 entries
    expect(REVEAL_TRANSFORMS.length).toBe(5)
  })
  it('reveal transforms de-obscure monotonically (blur decreases, scale decreases)', () => {
    for (let i = 1; i < REVEAL_TRANSFORMS.length; i++) {
      expect(REVEAL_TRANSFORMS[i].blurPx).toBeLessThan(REVEAL_TRANSFORMS[i - 1].blurPx)
      expect(REVEAL_TRANSFORMS[i].scale).toBeLessThan(REVEAL_TRANSFORMS[i - 1].scale + 0.001)
    }
    // The final state is fully un-obscured.
    expect(REVEAL_TRANSFORMS[REVEAL_TRANSFORMS.length - 1].blurPx).toBe(0)
    expect(REVEAL_TRANSFORMS[REVEAL_TRANSFORMS.length - 1].scale).toBe(1)
  })
})

// ── isPlayableGuessCard ─────────────

describe('isPlayableGuessCard', () => {
  it('accepts a normal card', () => {
    expect(isPlayableGuessCard(card())).toBe(true)
  })
  it('rejects null / undefined', () => {
    expect(isPlayableGuessCard(null)).toBe(false)
    expect(isPlayableGuessCard(undefined)).toBe(false)
  })
  it('rejects sealed products', () => {
    expect(isPlayableGuessCard(card({ is_sealed: true }))).toBe(false)
  })
  it('rejects missing image', () => {
    expect(isPlayableGuessCard(card({ image_url: null }))).toBe(false)
  })
  it('rejects missing slug', () => {
    expect(isPlayableGuessCard(card({ card_url_slug: null }))).toBe(false)
  })
  it('rejects product-name patterns', () => {
    for (const name of [
      'Zekrom Box',
      'Champion Path Tin',
      'Booster Bundle',
      'Elite Trainer Box',
      'Journey Together Booster Pack',
      'Sword & Shield Deck',
      'Legends Of Johto GX Collection',
      'Charizard Binder',
      'Blaziken Blister',
      '3-Pack Booster',
    ]) {
      expect(isPlayableGuessCard(card({ card_name: name }))).toBe(false)
    }
  })
  it('does NOT reject a name whose word contains a substring token', () => {
    // "Deoxys" contains "eo" not "deck"; "Boxxie" would be a false
    // positive but no real card is named that. The \bbox\b token
    // guarantees this. Just prove the common cases stay in.
    expect(isPlayableGuessCard(card({ card_name: 'Deoxys #16' }))).toBe(true)
    expect(isPlayableGuessCard(card({ card_name: 'Snorunt #24' }))).toBe(true)
  })
})

// ── normalizeAnswer ─────────────────

describe('normalizeAnswer', () => {
  it('lowercases', () => {
    expect(normalizeAnswer('Pikachu')).toBe('pikachu')
    expect(normalizeAnswer('CHARIZARD')).toBe('charizard')
  })
  it('collapses inner whitespace and trims', () => {
    expect(normalizeAnswer('  Mr   Mime  ')).toBe('mr mime')
  })
  it('strips periods, commas, colons, question marks', () => {
    expect(normalizeAnswer('Mr. Mime')).toBe('mr mime')
    expect(normalizeAnswer('Type: Null')).toBe('type null')
  })
  it('strips ASCII and typographic apostrophes', () => {
    expect(normalizeAnswer("Farfetch'd")).toBe('farfetchd')
    expect(normalizeAnswer('Farfetch’d')).toBe('farfetchd')
    expect(normalizeAnswer('Farfetch‘d')).toBe('farfetchd')
  })
  it('converts hyphens / dashes to spaces', () => {
    expect(normalizeAnswer('Ho-Oh')).toBe('ho oh')
    expect(normalizeAnswer('Porygon-Z')).toBe('porygon z')
    expect(normalizeAnswer('Nidoran—F')).toBe('nidoran f')  // em-dash
  })
  it('strips accents', () => {
    expect(normalizeAnswer('Pokémon')).toBe('pokemon')
    expect(normalizeAnswer('café')).toBe('cafe')
  })
  it('handles ampersand → "and"', () => {
    expect(normalizeAnswer('Team Rocket & Co.')).toBe('team rocket and co')
  })
  it('returns empty for null / undefined / non-string / punctuation-only', () => {
    expect(normalizeAnswer(null)).toBe('')
    expect(normalizeAnswer(undefined)).toBe('')
    expect(normalizeAnswer('' as string)).toBe('')
    expect(normalizeAnswer('   ')).toBe('')
    expect(normalizeAnswer("!!!'''")).toBe('')
  })
})

// ── acceptedAnswersFor ─────────────

describe('acceptedAnswersFor', () => {
  it('accepts the cleaned card name (without trailing #NN)', () => {
    const answers = acceptedAnswersFor(card({ card_name: 'Pikachu #58' }))
    expect(answers).toContain('pikachu')
  })
  it('accepts the name with the [variant] bracket stripped', () => {
    const answers = acceptedAnswersFor(card({ card_name: 'Zarude [Gamestop] #171' }))
    // Bracket-stripped form is accepted (block brief: bracketed
    // variants are optional so the player never has to type them).
    expect(answers).toContain('zarude')
    // The bracket-included form is also accepted for completeness.
    expect(answers).toContain('zarude gamestop')
  })
  it('accepts multiword names verbatim', () => {
    const answers = acceptedAnswersFor(card({ card_name: 'Mr. Mime #6' }))
    expect(answers).toContain('mr mime')
  })
  it('deduplicates identical normalised forms', () => {
    const answers = acceptedAnswersFor(card({ card_name: 'Zubat' }))
    // "Zubat" and cleaned "Zubat" and bracket-stripped "Zubat" all
    // normalise the same; the set should contain a single form.
    expect(answers.filter(a => a === 'zubat')).toHaveLength(1)
  })
  it('handles null / non-string card_name safely', () => {
    expect(acceptedAnswersFor(null)).toEqual([])
    expect(acceptedAnswersFor(undefined)).toEqual([])
    expect(acceptedAnswersFor({ card_name: null } as any)).toEqual([])
  })
})

// ── isCorrectGuess ─────────────────

describe('isCorrectGuess', () => {
  it('accepts exact name (case insensitive)', () => {
    const c = card({ card_name: 'Pikachu #58' })
    expect(isCorrectGuess('pikachu',   c)).toBe(true)
    expect(isCorrectGuess('Pikachu',   c)).toBe(true)
    expect(isCorrectGuess('PIKACHU',   c)).toBe(true)
    expect(isCorrectGuess('  pikachu ', c)).toBe(true)
  })
  it('accepts Mr Mime with or without period', () => {
    const c = card({ card_name: 'Mr. Mime #6' })
    expect(isCorrectGuess('Mr Mime',   c)).toBe(true)
    expect(isCorrectGuess('Mr. Mime',  c)).toBe(true)
    expect(isCorrectGuess('mr mime',   c)).toBe(true)
  })
  it("accepts Farfetch'd with straight or curly apostrophe or none", () => {
    const c = card({ card_name: 'Farfetch’d #83' })
    expect(isCorrectGuess("Farfetch'd",   c)).toBe(true)
    expect(isCorrectGuess('Farfetch’d',   c)).toBe(true)
    expect(isCorrectGuess('Farfetchd',    c)).toBe(true)
    expect(isCorrectGuess('farfetchd',    c)).toBe(true)
  })
  it('accepts Ho-Oh with or without the hyphen', () => {
    const c = card({ card_name: 'Ho-Oh #22' })
    expect(isCorrectGuess('Ho-Oh',  c)).toBe(true)
    expect(isCorrectGuess('Ho Oh',  c)).toBe(true)
    expect(isCorrectGuess('hooh',   c)).toBe(false)  // no space between; not a natural rendering
  })
  it('accepts Pokémon with or without the é', () => {
    const c = card({ card_name: 'Pokémon Center #001' })
    expect(isCorrectGuess('Pokémon Center', c)).toBe(true)
    expect(isCorrectGuess('Pokemon Center', c)).toBe(true)
  })
  it('accepts multi-word names like Mega Charizard Y', () => {
    const c = card({ card_name: 'Mega Charizard Y #14' })
    expect(isCorrectGuess('Mega Charizard Y', c)).toBe(true)
    expect(isCorrectGuess('mega charizard y', c)).toBe(true)
  })
  it('does not require the user to type the collector number', () => {
    const c = card({ card_name: 'Blastoise #2' })
    expect(isCorrectGuess('Blastoise', c)).toBe(true)
    // Full form still works if they insist.
    expect(isCorrectGuess('Blastoise #2', c)).toBe(true)
  })
  it('rejects unrelated partial substrings', () => {
    const c = card({ card_name: 'Blaziken #90' })
    expect(isCorrectGuess('bla',      c)).toBe(false)
    expect(isCorrectGuess('blazi',    c)).toBe(false)
    expect(isCorrectGuess('blaze',    c)).toBe(false)
    // But wrong-Pokémon guesses are also rejected.
    expect(isCorrectGuess('Charizard', c)).toBe(false)
  })
  it('rejects empty and null guesses', () => {
    const c = card({ card_name: 'Pikachu' })
    expect(isCorrectGuess('',    c)).toBe(false)
    expect(isCorrectGuess('   ', c)).toBe(false)
    expect(isCorrectGuess(null as any, c)).toBe(false)
  })
  it('accepts the bracket-stripped form for [Variant] cards (block brief rule)', () => {
    const c = card({ card_name: 'Zarude [Gamestop] #171' })
    // The block brief explicitly allows this — bracketed variants
    // are optional and matching them is a deliberate helper choice.
    expect(isCorrectGuess('Zarude', c)).toBe(true)
    expect(isCorrectGuess('zarude gamestop', c)).toBe(true)
  })
})

// ── isDuplicateGuess ────────────────

describe('isDuplicateGuess', () => {
  it('detects an exact duplicate', () => {
    expect(isDuplicateGuess('Pikachu', ['Pikachu'])).toBe(true)
  })
  it('detects a duplicate that only differs in case / whitespace', () => {
    expect(isDuplicateGuess('  PIKACHU ', ['pikachu'])).toBe(true)
  })
  it('detects a duplicate that differs in punctuation', () => {
    expect(isDuplicateGuess("Farfetchd", ["Farfetch'd"])).toBe(true)
  })
  it('does not flag distinct guesses', () => {
    expect(isDuplicateGuess('Charizard', ['Pikachu', 'Squirtle'])).toBe(false)
  })
  it('empty guess is not a duplicate', () => {
    expect(isDuplicateGuess('', ['Pikachu'])).toBe(false)
  })
})

// ── revealLevel + clueForLevel ─────

describe('revealLevel', () => {
  it('initial = 0 when no misses and not revealed', () => {
    expect(revealLevel(0, false)).toBe(0)
  })
  it('increases with each miss up to MAX_ATTEMPTS - 1', () => {
    expect(revealLevel(1, false)).toBe(1)
    expect(revealLevel(2, false)).toBe(2)
    expect(revealLevel(3, false)).toBe(3)
    // Should not exceed MAX_ATTEMPTS - 1 while not revealed.
    expect(revealLevel(4, false)).toBe(MAX_ATTEMPTS - 1)
    expect(revealLevel(99, false)).toBe(MAX_ATTEMPTS - 1)
  })
  it('reveal flag jumps straight to MAX_ATTEMPTS', () => {
    expect(revealLevel(0, true)).toBe(MAX_ATTEMPTS)
    expect(revealLevel(2, true)).toBe(MAX_ATTEMPTS)
  })
  it('handles negative / NaN misses safely', () => {
    expect(revealLevel(-3, false)).toBe(0)
    expect(revealLevel(NaN as any, false)).toBe(0)
  })
})

describe('clueForLevel', () => {
  const c = card({ card_name: 'Charizard #4', set_name: 'Base Set' })
  it('level 0: no clue', () => {
    expect(clueForLevel(0, c)).toBeNull()
  })
  it('level 1: set-initial', () => {
    const clue = clueForLevel(1, c)
    expect(clue?.kind).toBe('set-initial')
    expect(clue?.text).toBe('Set starts with "B".')
  })
  it('level 2: full set-name', () => {
    const clue = clueForLevel(2, c)
    expect(clue?.kind).toBe('set-name')
    expect(clue?.text).toContain('Base Set')
  })
  it('level 3: name-hint (first letter + word count)', () => {
    const clue = clueForLevel(3, c)
    expect(clue?.kind).toBe('name-hint')
    expect(clue?.text).toContain('"C"')
    expect(clue?.text).toContain('1 word')
  })
  it('level 3: multi-word name pluralises "words"', () => {
    const clue = clueForLevel(3, card({ card_name: 'Mega Charizard Y #14' }))
    expect(clue?.text).toContain('3 words')
  })
  it('level 4: answer (cleaned name)', () => {
    const clue = clueForLevel(4, c)
    expect(clue?.kind).toBe('answer')
    expect(clue?.text).toBe('Charizard')
  })
  it('handles missing card gracefully', () => {
    for (const lvl of [0, 1, 2, 3, 4]) expect(clueForLevel(lvl, null)).toBeNull()
  })
  it('handles missing set_name gracefully', () => {
    const c2 = card({ card_name: 'Zubat', set_name: '' })
    expect(clueForLevel(1, c2)).toBeNull()
    expect(clueForLevel(2, c2)).toBeNull()
  })
})

// ── firstAcceptedDisplayName ────────

describe('firstAcceptedDisplayName', () => {
  it('strips the collector-number suffix for the reveal display', () => {
    expect(firstAcceptedDisplayName(card({ card_name: 'Charizard #4' }))).toBe('Charizard')
    expect(firstAcceptedDisplayName(card({ card_name: 'Mr. Mime #6' }))).toBe('Mr. Mime')
  })
  it('handles no suffix', () => {
    expect(firstAcceptedDisplayName(card({ card_name: 'Pikachu' }))).toBe('Pikachu')
  })
  it('returns empty for null / bad input', () => {
    expect(firstAcceptedDisplayName(null)).toBe('')
    expect(firstAcceptedDisplayName({} as any)).toBe('')
  })
})

// ── pickNextCard ─────────────────

describe('pickNextCard', () => {
  const pool = [
    card({ card_name: 'A', card_url_slug: 'a' }),
    card({ card_name: 'B', card_url_slug: 'b' }),
    card({ card_name: 'C', card_url_slug: 'c' }),
  ]
  it('returns null on empty pool', () => {
    expect(pickNextCard([], new Set())).toBeNull()
  })
  it('avoids cards already seen', () => {
    for (let i = 0; i < 20; i++) {
      const picked = pickNextCard(pool, new Set(['a', 'b']))
      expect(picked?.card_url_slug).toBe('c')
    }
  })
  it('when all cards are seen, still returns one so the round can continue', () => {
    const picked = pickNextCard(pool, new Set(['a', 'b', 'c']))
    expect(picked).not.toBeNull()
    expect(['a', 'b', 'c']).toContain(picked!.card_url_slug)
  })
  it('does not mutate the source pool or the seen set', () => {
    const originalPool = pool.slice()
    const seen = new Set(['a'])
    const originalSeen = new Set(seen)
    pickNextCard(pool, seen)
    expect(pool).toEqual(originalPool)
    expect(seen).toEqual(originalSeen)
  })
})

// ── readBestStreak / writeBestStreak ────

describe('best-streak storage', () => {
  function memStorage(initial: Record<string, string> = {}): Storage {
    const map = new Map<string, string>(Object.entries(initial))
    return {
      length: 0,
      clear:      () => map.clear(),
      key:        () => null,
      getItem:    k => map.get(k) ?? null,
      setItem:    (k, v) => { map.set(k, v) },
      removeItem: k => { map.delete(k) },
    }
  }
  it('storage key is a stable string starting with the pp_game prefix (namespaced)', () => {
    expect(BEST_STREAK_STORAGE_KEY).toMatch(/^pp_game_/)
  })
  it('reads back what was written', () => {
    const store = memStorage()
    writeBestStreak(7, store)
    expect(readBestStreak(store)).toBe(7)
  })
  it('missing key returns 0', () => {
    expect(readBestStreak(memStorage())).toBe(0)
  })
  it('malformed value returns 0', () => {
    for (const bad of ['NaN', 'abc', '', '-3']) {
      const store = memStorage({ [BEST_STREAK_STORAGE_KEY]: bad })
      expect(readBestStreak(store)).toBe(0)
    }
  })
  it('write rejects invalid inputs silently', () => {
    const store = memStorage()
    writeBestStreak(NaN, store)
    writeBestStreak(-5, store)
    expect(readBestStreak(store)).toBe(0)
  })
  it('write floors decimals', () => {
    const store = memStorage()
    writeBestStreak(3.7, store)
    expect(readBestStreak(store)).toBe(3)
  })
  it('read tolerates a store that throws getItem (private-mode style)', () => {
    const hostile: Pick<Storage, 'getItem'> = { getItem: () => { throw new Error('nope') } }
    expect(readBestStreak(hostile as any)).toBe(0)
  })
  it('write tolerates a store that throws setItem', () => {
    const hostile: Pick<Storage, 'setItem'> = { setItem: () => { throw new Error('nope') } }
    // No throw — silent no-op.
    expect(() => writeBestStreak(5, hostile as any)).not.toThrow()
  })
})
