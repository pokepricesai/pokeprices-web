// src/lib/games/guessTheCard.ts
// Block 5A-W-47E-B (with FIX1) — pure helpers for the Guess the Card
// game.
//
// FIX1 changes:
//   * blur is much lighter — the previous 18px was unreadable, and
//     the game had almost no visible signal at level 0. New scale
//     starts at 8px so the shape / colour of the card is discernible
//     from the outset.
//   * text-input matching is replaced by a 3-option multiple choice.
//     The old normalizeAnswer / acceptedAnswersFor / isCorrectGuess /
//     isDuplicateGuess helpers are gone — comparison is now
//     card_url_slug equality, which is the source of truth for a
//     card's identity.
//
// Everything is fetch-free; the client passes cards in.

// ── Types ──────────────────────────────────────────────────────

export type GuessCard = {
  card_name:            string
  set_name:             string
  card_url_slug:        string | null
  card_number:          string | null
  card_number_display:  string | null
  set_printed_total:    string | null
  image_url:            string | null
  sales_30d?:           number | null
  is_sealed?:           boolean | null
}

/** Maximum wrong picks a player can make before the answer auto-
 *  reveals. With 3 options and 1 correct, this is 2. */
export const MAX_WRONG_PICKS = 2

/** Number of choices shown per round (1 correct + N-1 distractors). */
export const OPTIONS_PER_ROUND = 3

// ── Playable-card filter ─────────────────────────────────────

/** Reject cards that can't play: no image, no slug, no name, or
 *  clearly a sealed / product entry (box, tin, pack, deck, etc.). */
export function isPlayableGuessCard(card: GuessCard | null | undefined): card is GuessCard {
  if (!card) return false
  if (card.is_sealed === true) return false
  if (!card.image_url) return false
  if (!card.card_url_slug) return false
  if (!card.card_name) return false
  if (!card.set_name) return false
  if (/booster|elite trainer|\btin\b|blister|bundle|\bbinder\b|collection\b|\bdeck\b|\bbox\b|2\s*-?\s*pack|3\s*-?\s*pack/i.test(card.card_name)) return false
  return true
}

// ── Display name (used for option labels + reveal text) ───────

/** Return a display name for the card: strips the trailing "#NN"
 *  collector-number token so the reveal shows what a player would
 *  actually say out loud. */
export function firstAcceptedDisplayName(card: GuessCard | null | undefined): string {
  if (!card || typeof card.card_name !== 'string') return ''
  return card.card_name.replace(/\s*#\d+\w*\s*$/, '').trim()
}

// ── Reveal progression ───────────────────────────────────

export type RevealTransform = {
  /** Blur radius in pixels. */
  blurPx: number
  /** CSS scale applied to the card image — > 1 crops in. */
  scale:  number
}

/** FIX1 — much lighter blur, less zoom. The initial state is now
 *  legibly obscured rather than a smudge. Because there are only
 *  three levels (initial, one wrong pick, revealed) instead of
 *  five, the middle level exists as a "getting warmer" hint after
 *  the first wrong pick. */
export const REVEAL_TRANSFORMS: readonly RevealTransform[] = [
  { blurPx: 8, scale: 1.06 },   // 0: initial (no picks yet)
  { blurPx: 3, scale: 1.02 },   // 1: after 1 wrong pick
  { blurPx: 0, scale: 1.00 },   // 2: revealed
] as const

export type RevealClue =
  | { kind: 'set-name'; text: string }   // full set name
  | { kind: 'answer';   text: string }   // full card name

/** Reveal level given `wrongPicks` and whether the answer is
 *  revealed. Values are clamped to the transform table so callers
 *  can't index out of range. */
export function revealLevel(wrongPicks: number, revealed: boolean): number {
  const lastLevel = REVEAL_TRANSFORMS.length - 1
  if (revealed) return lastLevel
  const w = Number.isFinite(wrongPicks) && wrongPicks >= 0 ? Math.floor(wrongPicks) : 0
  // Never reveal without the explicit flag — cap at lastLevel - 1.
  return Math.min(w, lastLevel - 1)
}

/** Deterministic clue for the given reveal level.
 *   * level 0 → no clue (options themselves are the game)
 *   * level 1 → `From {Set Name}.`
 *   * level 2 → cleaned card name (the answer) */
export function clueForLevel(level: number, card: GuessCard | null | undefined): RevealClue | null {
  if (!card) return null
  if (level === 1) {
    const setName = (card.set_name || '').trim()
    if (!setName) return null
    return { kind: 'set-name', text: `From ${setName}.` }
  }
  if (level >= 2) {
    const answer = firstAcceptedDisplayName(card)
    return answer ? { kind: 'answer', text: answer } : null
  }
  return null
}

// ── Option generation ────────────────────────────────────

export type GuessOption = {
  /** card_url_slug — used as the comparison key on click. */
  key:       string
  /** Display label on the button (cleaned card name). */
  label:     string
  /** Underlying card, so a correct pick can render `View card`. */
  card:      GuessCard
  isCorrect: boolean
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/** Generate the multiple-choice options for a round. Picks
 *  `OPTIONS_PER_ROUND - 1` distractors from the pool whose labels
 *  and slugs both differ from the correct card, and whose labels
 *  differ from each other (so the player never sees two "Pikachu"
 *  buttons). Returns options shuffled — the correct one is not in
 *  a predictable slot. */
export function generateOptions(
  correct: GuessCard,
  pool: readonly GuessCard[],
  count: number = OPTIONS_PER_ROUND,
): GuessOption[] {
  const target = Math.max(2, Math.min(count, 6))
  const correctLabel = firstAcceptedDisplayName(correct)
  const correctSlug  = correct.card_url_slug || ''
  if (!correctSlug || !correctLabel) return []

  const usedLabels = new Set<string>([correctLabel.toLowerCase()])
  const distractors: GuessCard[] = []
  // Shuffle a copy of the pool so distractors are randomised across
  // rounds even when the same card is the answer twice in a row.
  const shuffledPool = shuffleInPlace(pool.slice())
  for (const candidate of shuffledPool) {
    if (distractors.length >= target - 1) break
    if (!candidate.card_url_slug || candidate.card_url_slug === correctSlug) continue
    const label = firstAcceptedDisplayName(candidate)
    if (!label) continue
    const key = label.toLowerCase()
    if (usedLabels.has(key)) continue
    usedLabels.add(key)
    distractors.push(candidate)
  }
  if (distractors.length < target - 1) {
    // Not enough unique labels available — return what we have plus
    // the correct card. The caller renders whatever comes back; UI
    // uses `.length` so a smaller list still works.
  }

  const options: GuessOption[] = [
    { key: correctSlug, label: correctLabel, card: correct, isCorrect: true },
    ...distractors.map(d => ({
      key: d.card_url_slug || '',
      label: firstAcceptedDisplayName(d),
      card: d,
      isCorrect: false,
    })),
  ]
  return shuffleInPlace(options)
}

// ── Card selection without repeats ───────────────────────

/** Pick the next card from the pool, avoiding cards whose slug is
 *  in `seenSlugs`. When every card has been seen, returns a fresh
 *  random card (the caller can reset the seen set at that point). */
export function pickNextCard(pool: readonly GuessCard[], seenSlugs: ReadonlySet<string>): GuessCard | null {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const remaining = pool.filter(c => c.card_url_slug && !seenSlugs.has(c.card_url_slug))
  if (remaining.length > 0) {
    return remaining[Math.floor(Math.random() * remaining.length)]
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Best-streak persistence (safe wrapper) ─────────────────

export const BEST_STREAK_STORAGE_KEY = 'pp_game_guess_the_card_best_streak_v1'

export function readBestStreak(store?: Pick<Storage, 'getItem'>): number {
  const s = store ?? safeLocalStorage()
  if (!s) return 0
  try {
    const raw = s.getItem(BEST_STREAK_STORAGE_KEY)
    if (!raw) return 0
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0 || n > 100_000) return 0
    return n
  } catch { return 0 }
}

export function writeBestStreak(next: number, store?: Pick<Storage, 'setItem'>): void {
  const s = store ?? safeLocalStorage()
  if (!s) return
  if (!Number.isFinite(next) || next < 0) return
  try { s.setItem(BEST_STREAK_STORAGE_KEY, String(Math.floor(next))) } catch {}
}

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    const s = window.localStorage
    const probe = '__pp_ls_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch { return null }
}
