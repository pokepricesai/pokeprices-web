// src/lib/games/buildABinder.ts
// Block 5A-W-47E — pure helpers for the Build a Binder game.
//
// The MVP rule: pick TARGET_CARD_COUNT cards, keep total ≤ budget.
// Scoring rewards spending the budget efficiently and picking a
// diverse binder (different sets, different Pokémon).
//
// Everything is fetch-free — the client component reads cards from
// Supabase and passes them into these pure functions.

// ── Types ──────────────────────────────────────────────────────

export type BinderCard = {
  card_name:            string
  set_name:             string
  card_url_slug:        string | null
  card_number:          string | null
  card_number_display:  string | null
  set_printed_total:    string | null
  image_url:            string | null
  /** Current raw price in cents. Must be > 0 for the card to be
   *  usable in the game. */
  current_raw:          number
  sales_30d:            number | null
  is_sealed?:           boolean | null
}

export type SortMode = 'popular' | 'price-asc' | 'price-desc'

/** Target binder size. Kept as a constant so the UI + tests + scoring
 *  agree on the same value. */
export const TARGET_CARD_COUNT = 5

/** Preset budgets exposed by the UI, in cents. */
export const BUDGETS_CENTS: readonly number[] = [5_000, 10_000, 25_000] as const

// ── Card-pool filtering ────────────────────────────────────

/** Reject cards that can't be used: no image, no slug, missing/zero
 *  price, or sealed / product-like names. The game only lists cards
 *  the user could conceivably imagine collecting. */
export function isPlayableCard(card: BinderCard | null | undefined): card is BinderCard {
  if (!card) return false
  if (card.is_sealed === true) return false
  if (!card.image_url)   return false
  if (!card.card_url_slug) return false
  if (typeof card.current_raw !== 'number' || card.current_raw <= 0) return false
  if (!card.card_name) return false
  // Product-name reject (mirrors the guard in the other games). Uses
  // word-ish boundaries so a card called e.g. "Deoxys" isn't caught by
  // "deck".
  if (/booster|elite trainer|\btin\b|blister|bundle|\bbinder\b|collection\b|\bdeck\b|\bbox\b|2\s*-?\s*pack|3\s*-?\s*pack/i.test(card.card_name)) return false
  return true
}

/** Filter + limit a card list to only cards that fit inside the
 *  given remaining budget. Callers pass the amount they still have
 *  left after their current picks. */
export function affordableCards(cards: readonly BinderCard[], remainingCents: number): BinderCard[] {
  if (!Number.isFinite(remainingCents) || remainingCents < 0) return []
  return cards.filter(c => c.current_raw <= remainingCents)
}

/** Case-insensitive substring search over the card name AND set name.
 *  Empty / whitespace-only query returns the input unchanged. */
export function searchCards(cards: readonly BinderCard[], query: string): BinderCard[] {
  const q = (query || '').trim().toLowerCase()
  if (!q) return cards.slice()
  return cards.filter(c => {
    const name = (c.card_name || '').toLowerCase()
    const set  = (c.set_name  || '').toLowerCase()
    return name.includes(q) || set.includes(q)
  })
}

/** Sort the pool by the chosen mode. Returns a new array — never
 *  mutates the caller's list. */
export function sortCards(cards: readonly BinderCard[], mode: SortMode): BinderCard[] {
  const copy = cards.slice()
  switch (mode) {
    case 'price-asc':  return copy.sort((a, b) => a.current_raw - b.current_raw)
    case 'price-desc': return copy.sort((a, b) => b.current_raw - a.current_raw)
    case 'popular':
    default:           return copy.sort((a, b) => (b.sales_30d ?? 0) - (a.sales_30d ?? 0))
  }
}

// ── Binder statistics ──────────────────────────────────────

export type BinderStats = {
  totalCents:      number
  remainingCents:  number
  count:           number
  target:          number
  isOverBudget:    boolean
  /** True when the binder has exactly TARGET_CARD_COUNT cards AND
   *  is at/under budget. Only then may the user "finalise". */
  isComplete:      boolean
}

/** Compute the current binder state. `budgetCents` must be a positive
 *  finite number. Cards contribute their `current_raw` in cents. */
export function computeBinderStats(cards: readonly BinderCard[], budgetCents: number): BinderStats {
  const target = TARGET_CARD_COUNT
  const safeBudget = Number.isFinite(budgetCents) && budgetCents > 0 ? budgetCents : 0
  const totalCents = cards.reduce((sum, c) => sum + (Number.isFinite(c.current_raw) ? c.current_raw : 0), 0)
  const remainingCents = safeBudget - totalCents
  const count = cards.length
  const isOverBudget = totalCents > safeBudget
  const isComplete   = count === target && !isOverBudget
  return { totalCents, remainingCents, count, target, isOverBudget, isComplete }
}

// ── Diversity heuristic ────────────────────────────────────

/** Extract the leading Pokémon-name token from a card name. Strips
 *  the trailing `#NN` suffix + any bracketed variant, then returns
 *  the first whitespace-separated word (lower-cased for comparison).
 *  Used only for the diversity bonus — never for display. */
export function pokemonKey(cardName: string): string {
  if (typeof cardName !== 'string') return ''
  const cleaned = cardName
    .replace(/\s*#\d+\w*\s*$/, '')  // strip trailing #NN
    .replace(/\[.*?\]/g, '')         // strip bracketed variant markers
    .trim()
  if (!cleaned) return ''
  const first = cleaned.split(/\s+/)[0] || ''
  return first.toLowerCase()
}

// ── Scoring ─────────────────────────────────────────────────

export type ScoreBreakdown = {
  /** 0-100. How much of the budget was actually spent. Over-budget
   *  binders score 0 — they're invalid. */
  efficiencyPoints:   number
  /** 0-10 when every card in the binder is from a different set. */
  setDiversityPoints: number
  /** 0-10 when every card in the binder is from a different Pokémon
   *  (heuristic — leading token of the cleaned card name). */
  pokemonDiversityPoints: number
  /** Sum of the above. Capped at 120. */
  totalScore: number
}

/** Score a finalised binder. Callers should only invoke this once the
 *  BinderStats says `isComplete`. */
export function scoreBinder(cards: readonly BinderCard[], budgetCents: number): ScoreBreakdown {
  const stats = computeBinderStats(cards, budgetCents)
  if (!stats.isComplete) {
    return { efficiencyPoints: 0, setDiversityPoints: 0, pokemonDiversityPoints: 0, totalScore: 0 }
  }
  // Efficiency — how much of the budget was spent (0 to 100).
  const efficiencyPoints = Math.max(0, Math.min(100, Math.round((stats.totalCents / budgetCents) * 100)))
  // Diversity — set + Pokémon.
  const sets      = new Set(cards.map(c => (c.set_name || '').toLowerCase()))
  const pokemons  = new Set(cards.map(c => pokemonKey(c.card_name)))
  const setDiversityPoints     = sets.size     === cards.length ? 10 : 0
  const pokemonDiversityPoints = pokemons.size === cards.length ? 10 : 0
  const totalScore = Math.min(120, efficiencyPoints + setDiversityPoints + pokemonDiversityPoints)
  return { efficiencyPoints, setDiversityPoints, pokemonDiversityPoints, totalScore }
}

/** A short editorial label for a score — used in the results panel. */
export function scoreLabel(totalScore: number): string {
  if (totalScore >= 115) return 'Master collector'
  if (totalScore >= 100) return 'Sharp binder'
  if (totalScore >=  80) return 'Solid picks'
  if (totalScore >=  60) return 'Decent effort'
  if (totalScore >    0) return 'Room to grow'
  return 'Over budget'
}
