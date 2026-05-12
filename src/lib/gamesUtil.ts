// Shared helpers for /games — daily seeding, share builders, format helpers.

// ── Daily seed ─────────────────────────────────────────────────────────────
// Deterministic number derived from today's date (UTC). Every visitor
// playing on the same calendar day sees the same card / matchup / sequence.

export function todayKey(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dailySeed(date = new Date()): number {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  return y * 10000 + m * 100 + d
}

// Day-of-year is handy for cycling through hardcoded pools (matchups).
export function dayOfYear(date = new Date()): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((now - start) / 86400000)
}

// Mulberry32 — small deterministic 32-bit PRNG. Same seed → same sequence.
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return function () {
    s |= 0
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Shuffle in-place with a seeded RNG so the order is reproducible per day.
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rng = seededRandom(seed)
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// ── Local storage (per-game per-day) ───────────────────────────────────────

const LS_PREFIX = 'pp_games:'

export function lsKey(game: string, date = new Date()): string {
  return `${LS_PREFIX}${game}:${todayKey(date)}`
}

export function readLs<T = any>(game: string, date?: Date): T | null {
  try {
    const raw = localStorage.getItem(lsKey(game, date))
    return raw ? JSON.parse(raw) as T : null
  } catch { return null }
}

export function writeLs(game: string, value: any, date?: Date): void {
  try { localStorage.setItem(lsKey(game, date), JSON.stringify(value)) } catch {}
}

// ── Share to X ─────────────────────────────────────────────────────────────

export function buildXShareUrl(text: string, shareUrl = 'https://www.pokeprices.io/games'): string {
  const params = new URLSearchParams({ text, url: shareUrl })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

// ── Formatting helpers ─────────────────────────────────────────────────────

export function fmtUsd(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

export function fmtGbp(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return ''
  const v = (cents / 100) * 0.79
  if (v >= 1000) return `£${Math.round(v).toLocaleString('en-GB')}`
  return `£${v.toFixed(0)}`
}

// "abs % off" formatter — e.g. 87 for "you were 13% off".
export function priceAccuracyPct(guessCents: number, actualCents: number): number {
  if (!actualCents) return 0
  const err = Math.abs(guessCents - actualCents) / actualCents
  return Math.max(0, Math.round((1 - err) * 100))
}

// Strip the trailing " #NN" the DB appends to card_name for display purposes.
export function cleanCardName(name: string | null | undefined): string {
  if (!name) return ''
  return name.replace(/\s*#\d+\w*\s*$/, '').replace(/\[.*?\]/g, '').trim()
}

// ── Daily Pick matchups ────────────────────────────────────────────────────
// Static rotation — day-of-year mod length. Each matchup references cards
// by `card_url_slug` (the URL slug used on /set/{set}/card/{slug}). The
// game page hydrates name + image via popular_card_trends on render.

export interface MatchupSide {
  card_url_slug: string
  label: string
  fallback_image?: string
}

export interface DailyMatchup {
  id: number
  question: string
  a: MatchupSide
  b: MatchupSide
}

export const DAILY_MATCHUPS: DailyMatchup[] = [
  { id: 1,  question: 'Crown jewel of vintage — which one?',
    a: { card_url_slug: 'charizard-4',  label: 'Charizard Base Set' },
    b: { card_url_slug: 'blastoise-2',  label: 'Blastoise Base Set' } },
  { id: 2,  question: 'Modern chase or vintage holo?',
    a: { card_url_slug: 'umbreon-vmax-215', label: 'Umbreon VMAX 215' },
    b: { card_url_slug: 'charizard-4',      label: 'Charizard Base Set' } },
  { id: 3,  question: 'Eeveelutions face-off',
    a: { card_url_slug: 'umbreon-vmax-215', label: 'Umbreon VMAX' },
    b: { card_url_slug: 'sylveon-vmax-211', label: 'Sylveon VMAX' } },
  { id: 4,  question: 'Best starter on a card?',
    a: { card_url_slug: 'charizard-ex-223', label: 'Charizard ex' },
    b: { card_url_slug: 'venusaur-ex-198',  label: 'Venusaur ex' } },
  { id: 5,  question: 'Pikachu pull priority',
    a: { card_url_slug: 'pikachu-ex-238',           label: 'Pikachu ex' },
    b: { card_url_slug: 'pikachu-illustrator',      label: 'Pikachu Illustrator' } },
  { id: 6,  question: 'Which legendary is the better collect?',
    a: { card_url_slug: 'mewtwo-ex-244',  label: 'Mewtwo ex' },
    b: { card_url_slug: 'rayquaza-vmax-217', label: 'Rayquaza VMAX' } },
  { id: 7,  question: 'Sealed product to actually open?',
    a: { card_url_slug: 'booster-box',  label: 'Evolving Skies BB' },
    b: { card_url_slug: 'booster-box',  label: '151 BB' } },
  { id: 8,  question: 'Most underrated chase right now?',
    a: { card_url_slug: 'gengar-vmax-156', label: 'Gengar VMAX' },
    b: { card_url_slug: 'lugia-v-186',     label: 'Lugia V Alt Art' } },
  { id: 9,  question: 'Set you would grind to complete',
    a: { card_url_slug: 'charizard-4', label: 'Base Set' },
    b: { card_url_slug: 'charizard-25', label: 'Evolving Skies' } },
  { id: 10, question: 'Most iconic Pokémon art ever?',
    a: { card_url_slug: 'lugia-9',       label: 'Lugia Neo Genesis' },
    b: { card_url_slug: 'umbreon-vmax-215', label: 'Moonbreon' } },
]

export function todaysMatchup(date = new Date()): DailyMatchup {
  const idx = dayOfYear(date) % DAILY_MATCHUPS.length
  return DAILY_MATCHUPS[idx]
}
