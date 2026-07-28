// Block 5A-W-47E-B (with FIX1) — unit tests for the Guess the Card
// pure helpers. Text-input matching is gone (game is now 3-option
// multiple choice), so this file covers:
//   - the playable-card filter (sealed / product / missing data)
//   - the display-name cleaner (strips trailing #NN)
//   - the reveal transform + level clamping
//   - the clue-per-level table
//   - option generation (3 shuffled options, distinct labels, no
//     leak of the correct card into distractors)
//   - card selection without repeats
//   - best-streak storage (safe wrapper + malformed handling)

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BEST_STREAK_STORAGE_KEY,
  MAX_WRONG_PICKS,
  OPTIONS_PER_ROUND,
  REVEAL_TRANSFORMS,
  clueForLevel,
  firstAcceptedDisplayName,
  generateOptions,
  isPlayableGuessCard,
  pickNextCard,
  readBestStreak,
  revealLevel,
  writeBestStreak,
  type GuessCard,
} from '../guessTheCard'

function mk(overrides: Partial<GuessCard> = {}): GuessCard {
  return {
    card_name:            'Pikachu #58',
    set_name:             'Base Set',
    card_url_slug:        'pikachu-58',
    card_number:          '58',
    card_number_display:  '58/102',
    set_printed_total:    '102',
    image_url:            'https://example.com/pikachu.jpg',
    is_sealed:            false,
    sales_30d:            42,
    ...overrides,
  }
}

// ── Constants ─────────────────────────────────────

describe('constants', () => {
  it('MAX_WRONG_PICKS = 2 (so a 3-option round auto-reveals after 2 misses)', () => {
    expect(MAX_WRONG_PICKS).toBe(2)
  })
  it('OPTIONS_PER_ROUND = 3', () => {
    expect(OPTIONS_PER_ROUND).toBe(3)
  })
  it('REVEAL_TRANSFORMS has one level per (miss, reveal) state and de-obscures monotonically', () => {
    expect(REVEAL_TRANSFORMS.length).toBe(3) // 0: initial, 1: 1 miss, 2: revealed
    for (let i = 1; i < REVEAL_TRANSFORMS.length; i++) {
      expect(REVEAL_TRANSFORMS[i].blurPx).toBeLessThan(REVEAL_TRANSFORMS[i - 1].blurPx)
      expect(REVEAL_TRANSFORMS[i].scale).toBeLessThanOrEqual(REVEAL_TRANSFORMS[i - 1].scale)
    }
    expect(REVEAL_TRANSFORMS[REVEAL_TRANSFORMS.length - 1].blurPx).toBe(0)
    expect(REVEAL_TRANSFORMS[REVEAL_TRANSFORMS.length - 1].scale).toBe(1)
  })
  it('FIX1 — initial blur is much lighter than the original 18px (fixed complaint: "way too blurred")', () => {
    expect(REVEAL_TRANSFORMS[0].blurPx).toBeLessThanOrEqual(10)
  })
})

// ── isPlayableGuessCard ───────────────────────

describe('isPlayableGuessCard', () => {
  it('accepts a normal card', () => {
    expect(isPlayableGuessCard(mk())).toBe(true)
  })
  it('rejects null / undefined', () => {
    expect(isPlayableGuessCard(null)).toBe(false)
    expect(isPlayableGuessCard(undefined)).toBe(false)
  })
  it('rejects sealed products', () => {
    expect(isPlayableGuessCard(mk({ is_sealed: true }))).toBe(false)
  })
  it('rejects rows with no image_url or slug', () => {
    expect(isPlayableGuessCard(mk({ image_url: null }))).toBe(false)
    expect(isPlayableGuessCard(mk({ card_url_slug: null }))).toBe(false)
  })
  it('rejects rows with no name or set_name', () => {
    expect(isPlayableGuessCard(mk({ card_name: '' }))).toBe(false)
    expect(isPlayableGuessCard(mk({ set_name: '' }))).toBe(false)
  })
  it('rejects sealed products by name pattern', () => {
    for (const name of [
      'Charizard Booster Bundle',
      'Elite Trainer Box',
      'Pikachu Tin',
      'Blister 3-Pack',
      'Champion Path Binder Collection',
      'Battle Deck',
    ]) {
      expect(isPlayableGuessCard(mk({ card_name: name })), name).toBe(false)
    }
  })
  it('does NOT reject a card whose set has a matching word (only card_name is checked)', () => {
    expect(isPlayableGuessCard(mk({ card_name: 'Umbreon #22', set_name: 'Elite Trainer Box' }))).toBe(true)
  })
})

// ── firstAcceptedDisplayName ─────────────────

describe('firstAcceptedDisplayName', () => {
  it('strips the trailing #NN', () => {
    expect(firstAcceptedDisplayName(mk({ card_name: 'Pikachu #58' }))).toBe('Pikachu')
  })
  it('strips a #NN with a letter suffix (e.g. secret rares)', () => {
    expect(firstAcceptedDisplayName(mk({ card_name: 'Charizard #201a' }))).toBe('Charizard')
  })
  it('returns empty string when name is missing', () => {
    expect(firstAcceptedDisplayName(mk({ card_name: '' as any }))).toBe('')
    expect(firstAcceptedDisplayName(null)).toBe('')
  })
})

// ── revealLevel ───────────────────────────

describe('revealLevel', () => {
  it('returns 0 when no wrong picks and not revealed', () => {
    expect(revealLevel(0, false)).toBe(0)
  })
  it('returns 1 after one wrong pick', () => {
    expect(revealLevel(1, false)).toBe(1)
  })
  it('clamps unrevealed misses below the last (revealed) level', () => {
    expect(revealLevel(2, false)).toBe(REVEAL_TRANSFORMS.length - 2)
    expect(revealLevel(999, false)).toBe(REVEAL_TRANSFORMS.length - 2)
  })
  it('returns the revealed level when the reveal flag is set', () => {
    expect(revealLevel(0, true)).toBe(REVEAL_TRANSFORMS.length - 1)
  })
  it('treats NaN / negative wrong-pick counts as 0', () => {
    expect(revealLevel(NaN as any, false)).toBe(0)
    expect(revealLevel(-3, false)).toBe(0)
  })
})

// ── clueForLevel ───────────────────────────

describe('clueForLevel', () => {
  const card = mk({ card_name: 'Charizard #4', set_name: 'Base Set' })
  it('level 0 → no clue (options themselves are the game)', () => {
    expect(clueForLevel(0, card)).toBeNull()
  })
  it('level 1 → the full set name', () => {
    expect(clueForLevel(1, card)).toEqual({ kind: 'set-name', text: 'From Base Set.' })
  })
  it('level 2 → the answer (cleaned card name)', () => {
    expect(clueForLevel(2, card)).toEqual({ kind: 'answer', text: 'Charizard' })
  })
  it('returns null for null card', () => {
    expect(clueForLevel(1, null)).toBeNull()
  })
  it('level 1 returns null if the set name is empty', () => {
    expect(clueForLevel(1, mk({ set_name: '   ' as any }))).toBeNull()
  })
})

// ── generateOptions ───────────────────────────

const POOL: GuessCard[] = [
  mk({ card_name: 'Pikachu #58',   card_url_slug: 'pikachu-58',   set_name: 'Base Set' }),
  mk({ card_name: 'Charizard #4',  card_url_slug: 'charizard-4',  set_name: 'Base Set' }),
  mk({ card_name: 'Blastoise #2',  card_url_slug: 'blastoise-2',  set_name: 'Base Set' }),
  mk({ card_name: 'Venusaur #15',  card_url_slug: 'venusaur-15',  set_name: 'Base Set' }),
  mk({ card_name: 'Mewtwo #10',    card_url_slug: 'mewtwo-10',    set_name: 'Base Set' }),
]

describe('generateOptions', () => {
  it('returns exactly OPTIONS_PER_ROUND (=3) options by default', () => {
    const opts = generateOptions(POOL[0], POOL)
    expect(opts.length).toBe(3)
  })
  it('exactly one option is marked isCorrect', () => {
    const opts = generateOptions(POOL[0], POOL)
    expect(opts.filter(o => o.isCorrect).length).toBe(1)
  })
  it('the correct option references the source card', () => {
    const opts = generateOptions(POOL[0], POOL)
    const correct = opts.find(o => o.isCorrect)!
    expect(correct.card).toBe(POOL[0])
    expect(correct.key).toBe(POOL[0].card_url_slug)
    expect(correct.label).toBe('Pikachu')
  })
  it('no duplicate labels within the option list (no two "Pikachu" buttons)', () => {
    const withDupe: GuessCard[] = [
      POOL[0],
      mk({ card_name: 'Pikachu #99', card_url_slug: 'pikachu-99', set_name: 'Jungle' }),
      POOL[1], POOL[2], POOL[3], POOL[4],
    ]
    const opts = generateOptions(withDupe[0], withDupe)
    const labels = opts.map(o => o.label.toLowerCase())
    expect(new Set(labels).size).toBe(labels.length)
  })
  it('no duplicate slugs within the option list (distractors are not the correct card)', () => {
    const opts = generateOptions(POOL[0], POOL)
    const slugs = opts.map(o => o.key)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(slugs.filter(s => s === POOL[0].card_url_slug).length).toBe(1)
  })
  it('does not mutate the pool array', () => {
    const before = POOL.map(c => c.card_url_slug)
    generateOptions(POOL[0], POOL)
    expect(POOL.map(c => c.card_url_slug)).toEqual(before)
  })
  it('degrades gracefully when the pool is too small (fewer than count distractors)', () => {
    const tiny = [POOL[0], POOL[1]]
    const opts = generateOptions(POOL[0], tiny)
    // Should still contain the correct card, and up to 1 distractor.
    expect(opts.filter(o => o.isCorrect).length).toBe(1)
    expect(opts.length).toBeGreaterThanOrEqual(1)
    expect(opts.length).toBeLessThanOrEqual(2)
  })
  it('returns an empty list when the correct card is missing a slug or name', () => {
    expect(generateOptions(mk({ card_url_slug: null }), POOL)).toEqual([])
    expect(generateOptions(mk({ card_name: '' }), POOL)).toEqual([])
  })
})

// ── pickNextCard ──────────────────────────

describe('pickNextCard', () => {
  it('returns null on an empty pool', () => {
    expect(pickNextCard([], new Set())).toBeNull()
  })
  it('prefers unseen cards when they exist', () => {
    const seen = new Set([POOL[0].card_url_slug!, POOL[1].card_url_slug!, POOL[2].card_url_slug!])
    const picked = pickNextCard(POOL, seen)!
    expect([POOL[3].card_url_slug, POOL[4].card_url_slug]).toContain(picked.card_url_slug)
  })
  it('falls back to the full pool when every card has been seen', () => {
    const seen = new Set(POOL.map(c => c.card_url_slug!))
    const picked = pickNextCard(POOL, seen)!
    expect(POOL).toContain(picked)
  })
  it('does not mutate the seen set', () => {
    const seen = new Set([POOL[0].card_url_slug!])
    const snap = new Set(seen)
    pickNextCard(POOL, seen)
    expect(seen).toEqual(snap)
  })
})

// ── Best-streak storage ────────────────

class MemStore implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

class HostileStore implements Storage {
  get length(): number { throw new Error('nope') }
  clear() { throw new Error('nope') }
  key(): string | null { throw new Error('nope') }
  getItem(): string | null { throw new Error('nope') }
  setItem() { throw new Error('nope') }
  removeItem() { throw new Error('nope') }
}

describe('best-streak storage', () => {
  let store: MemStore
  beforeEach(() => { store = new MemStore() })

  it('reads 0 when the key is missing', () => {
    expect(readBestStreak(store)).toBe(0)
  })
  it('round-trips a value', () => {
    writeBestStreak(7, store)
    expect(readBestStreak(store)).toBe(7)
  })
  it('reads 0 when the value is not a valid non-negative integer', () => {
    store.setItem(BEST_STREAK_STORAGE_KEY, 'garbage')
    expect(readBestStreak(store)).toBe(0)
    store.setItem(BEST_STREAK_STORAGE_KEY, '-3')
    expect(readBestStreak(store)).toBe(0)
    store.setItem(BEST_STREAK_STORAGE_KEY, '999999999')
    expect(readBestStreak(store)).toBe(0) // above the 100k cap
  })
  it('write ignores NaN / negative values', () => {
    writeBestStreak(NaN as any, store)
    writeBestStreak(-1, store)
    expect(readBestStreak(store)).toBe(0)
  })
  it('write floors decimals', () => {
    writeBestStreak(3.9, store)
    expect(readBestStreak(store)).toBe(3)
  })
  it('read silently returns 0 when the store throws', () => {
    expect(readBestStreak(new HostileStore() as any)).toBe(0)
  })
  it('write silently no-ops when the store throws', () => {
    expect(() => writeBestStreak(4, new HostileStore() as any)).not.toThrow()
  })
  it('uses the versioned, namespaced key', () => {
    expect(BEST_STREAK_STORAGE_KEY).toBe('pp_game_guess_the_card_best_streak_v1')
  })
})
