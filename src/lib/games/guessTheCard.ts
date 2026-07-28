// src/lib/games/guessTheCard.ts
// Block 5A-W-47E-B — pure helpers for the Guess the Card game.
//
// Everything here is fetch-free. The client component reads cards
// from Supabase and passes them into these pure functions, which the
// unit tests pin.

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

/** Max guesses per round. On the 4th miss the answer reveals. */
export const MAX_ATTEMPTS = 4

// ── Playable-card filter ─────────────────────────────────────

/** Reject cards that can't play: no image, no slug, no name, or
 *  clearly a sealed / product entry (box, tin, pack, deck, etc.).
 *  Mirrors the Build a Binder guard but is intentionally isolated so
 *  either game can tune its own rules without regressing the other. */
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

// ── Answer normalisation ─────────────────────────────────────

/** Strip diacritics — "Pokémon" → "Pokemon", "Farfetch’d" untouched
 *  (the curly apostrophe is a punctuation char, handled later). */
function stripAccents(input: string): string {
  // NFD splits an accented char into base + combining diacritic; we
  // then drop the combining marks (U+0300..U+036F).
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Normalise a raw guess string for comparison. Tolerates:
 *    * case
 *    * whitespace
 *    * apostrophes (straight and curly) — dropped
 *    * hyphens / em- / en-dashes — dropped
 *    * periods, commas, colons — dropped
 *    * accents — stripped
 *    * "&" → "and" (case: "Team Rocket & Co." vs "Team Rocket and Co.")
 *  Returns an empty string for null / non-string / all-punctuation
 *  inputs. Never throws. */
export function normalizeAnswer(input: string | null | undefined): string {
  if (typeof input !== 'string') return ''
  const stage1 = stripAccents(input)
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Drop apostrophes (both ASCII and typographic).
    .replace(/[’‘'`]/g, '')
    // Convert hyphens / dashes / em-dashes / en-dashes to a space.
    .replace(/[-–—_]/g, ' ')
    // Drop remaining common punctuation.
    .replace(/[.,;:!?/\\]/g, ' ')
    // Collapse everything that's not a letter or digit to a single space.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  return stage1
}

// ── Accepted-answer generation ───────────────────────────────

/** Strip the trailing " #NN" collector-number token from a stored
 *  card name. Kept separate from cleanCardName in gamesUtil so this
 *  file has no coupling to that module. */
function stripCollectorNumber(name: string): string {
  return (name || '').replace(/\s*#\d+\w*\s*$/, '').trim()
}

/** Return every accepted normalised answer for a card. Rules:
 *    * Always accept the cleaned card name (no trailing "#NN").
 *    * Always accept the version with any [bracketed variant]
 *      stripped — so "Zarude" matches "Zarude [Gamestop]" (per the
 *      block brief: bracketed variants are optional).
 *    * Always accept the raw stored card name too, in case a
 *      pedantic player types "#58".
 *  The output list is deduplicated on the normalised form. */
export function acceptedAnswersFor(card: GuessCard | null | undefined): string[] {
  if (!card || typeof card.card_name !== 'string') return []
  const raw     = card.card_name
  const noNum   = stripCollectorNumber(raw)
  const noBrack = noNum.replace(/\[[^\]]*\]/g, '').trim().replace(/\s+/g, ' ')
  const forms   = new Set<string>()
  for (const form of [raw, noNum, noBrack]) {
    const n = normalizeAnswer(form)
    if (n) forms.add(n)
  }
  return Array.from(forms)
}

/** True when the guess matches ANY of the accepted answers for the
 *  card. Both sides go through the same normaliser so callers never
 *  need to normalise first. */
export function isCorrectGuess(guess: string, card: GuessCard | null | undefined): boolean {
  const g = normalizeAnswer(guess)
  if (!g) return false
  const accepted = acceptedAnswersFor(card)
  return accepted.includes(g)
}

/** True when the guess (once normalised) matches something already
 *  attempted this round. Used to reject "already tried" without
 *  charging another attempt. */
export function isDuplicateGuess(guess: string, previousGuesses: readonly string[]): boolean {
  const g = normalizeAnswer(guess)
  if (!g) return false
  for (const prev of previousGuesses) {
    if (normalizeAnswer(prev) === g) return true
  }
  return false
}

// ── Reveal-level progression ─────────────────────────────

export type RevealLevel = {
  /** Blur radius in pixels. */
  blurPx: number
  /** Scale factor for the image transform. > 1 crops in. */
  scale:  number
  /** Optional textual clue for THIS level. `null` for the initial
   *  state (no clue offered before the first guess). */
  clue:   RevealClue | null
}
export type RevealClue =
  | { kind: 'set-initial';   text: string }   // set name first letter
  | { kind: 'set-name';      text: string }   // full set name
  | { kind: 'name-hint';     text: string }   // first letter + word count
  | { kind: 'answer';        text: string }   // full answer

/** Level 0 is the initial, most-obscured state (before the first
 *  guess). Each subsequent level applies after an incorrect guess.
 *  Level 4 is the "answer revealed" endpoint. Numbers can be tuned
 *  after visual review without changing the API. */
export const REVEAL_TRANSFORMS = [
  { blurPx: 18, scale: 1.22 },   // 0: initial
  { blurPx: 12, scale: 1.15 },   // 1: after miss 1
  { blurPx:  7, scale: 1.08 },   // 2: after miss 2
  { blurPx:  3, scale: 1.03 },   // 3: after miss 3
  { blurPx:  0, scale: 1.00 },   // 4: answer revealed
] as const

/** Compute the reveal level for the game state.
 *   * `revealed = true` (correct answer / skip / max misses) → level 4
 *   * otherwise → number of misses so far, clamped [0, MAX_ATTEMPTS - 1] */
export function revealLevel(misses: number, revealed: boolean): number {
  if (revealed) return MAX_ATTEMPTS
  const m = Number.isFinite(misses) && misses >= 0 ? Math.floor(misses) : 0
  return Math.min(m, MAX_ATTEMPTS - 1)
}

/** Which clue to show at the given reveal level for this card. Kept
 *  fully deterministic so the same misses always yield the same
 *  clue. */
export function clueForLevel(level: number, card: GuessCard | null | undefined): RevealClue | null {
  if (!card) return null
  const setName = (card.set_name || '').trim()
  const answer = firstAcceptedDisplayName(card)
  switch (level) {
    case 0: return null
    case 1: {
      const initial = setName.charAt(0)
      if (!initial) return null
      return { kind: 'set-initial', text: `Set starts with "${initial}".` }
    }
    case 2: {
      if (!setName) return null
      return { kind: 'set-name', text: `From ${setName}.` }
    }
    case 3: {
      if (!answer) return null
      const words = answer.split(/\s+/).filter(Boolean)
      const firstLetter = (words[0] || '').charAt(0)
      if (!firstLetter) return null
      return {
        kind: 'name-hint',
        text: `Starts with "${firstLetter}" · ${words.length} word${words.length === 1 ? '' : 's'}.`,
      }
    }
    case 4:
    default:
      return answer ? { kind: 'answer', text: answer } : null
  }
}

/** The display-friendly name we use for the answer clue. Prefers
 *  the cleaned (no "#NN") card name so the reveal shows what the
 *  user typed rather than the raw stored string with a number. */
export function firstAcceptedDisplayName(card: GuessCard | null | undefined): string {
  if (!card || typeof card.card_name !== 'string') return ''
  return stripCollectorNumber(card.card_name)
}

// ── Card selection without repeats ───────────────────────

/** Pick the next card from the pool. Cards whose `card_url_slug` is
 *  already in `seenSlugs` are avoided. When every card has been
 *  seen, returns a fresh random card from the whole pool (so a
 *  session can keep playing indefinitely — the caller decides
 *  whether to reset the seen set at that point). Never mutates the
 *  inputs. Returns null when the pool is empty. */
export function pickNextCard(pool: readonly GuessCard[], seenSlugs: ReadonlySet<string>): GuessCard | null {
  if (!Array.isArray(pool) || pool.length === 0) return null
  const remaining = pool.filter(c => c.card_url_slug && !seenSlugs.has(c.card_url_slug))
  if (remaining.length > 0) {
    return remaining[Math.floor(Math.random() * remaining.length)]
  }
  // Everything's been seen. Pick from the full pool — the caller can
  // decide to reset seenSlugs before the next round.
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Best-streak persistence (safe wrapper) ─────────────────

export const BEST_STREAK_STORAGE_KEY = 'pp_game_guess_the_card_best_streak_v1'

/** Read the stored best streak from localStorage. Falls back to 0
 *  on any parse error, missing key, or hostile environment (no
 *  localStorage — e.g. Safari private mode). */
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

/** Write the best streak, ignoring quota / disabled-storage errors. */
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
    // Attempt a probe write — Safari in some private modes throws on
    // setItem even though the property exists.
    const probe = '__pp_ls_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch { return null }
}
