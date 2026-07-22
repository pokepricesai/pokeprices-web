// src/lib/seo/pokemonSummary.ts
// Block 5A-W-46C — pure builders for the Pokémon-page "card prices
// at a glance" summary. Every fact is conditional on real data; the
// caller must never render a "No data" placeholder.
//
// Shared with getPokemonSeo (so the meta-description count matches
// the summary count) and with the server component
// src/components/seo/PokemonPriceSummary.tsx.

import { formatUsdFromCents, formatSignedPct } from './quickFacts'

// ─────────────────────────────────────────────────────────────────────
// Public types (loose to accommodate the RPC's actual row shape)
// ─────────────────────────────────────────────────────────────────────

export type PokemonSummarySpecies = {
  name?:        string | null
  total_cards?: number | null
} | null | undefined

export type PokemonSummaryCardRow = {
  card_name:      string
  set_name:       string
  card_url_slug?: string | null
  current_raw?:   number | null
  current_psa10?: number | null
  raw_pct_30d?:   number | null
}

export type PokemonSummaryBySetRow = {
  set_name: string
}

export type PokemonSummaryInput = {
  species:    PokemonSummarySpecies
  topCards?:  ReadonlyArray<PokemonSummaryCardRow> | null
  risers?:    ReadonlyArray<PokemonSummaryCardRow> | null
  fallers?:   ReadonlyArray<PokemonSummaryCardRow> | null
  bySet?:     ReadonlyArray<PokemonSummaryBySetRow> | null
  /** All cards for this species; used to derive a raw price range
   *  when the top-cards slice does not cover it. */
  allCards?:  ReadonlyArray<PokemonSummaryCardRow> | null
}

export type PokemonSummaryFact = {
  key:    string
  label:  string
  /** Plain string (e.g. "63 cards") OR a linkable value with a
   *  destination URL for the callable card. */
  value:  string
  linkHref?: string | null
  variant?: 'default' | 'up' | 'down'
}

export type PokemonSummaryOutput = {
  displayName: string
  facts: PokemonSummaryFact[]
  render: boolean
}

// ─────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  if (!s) return ''
  return s.split('-').map(w => w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w).join(' ')
}

function safeSetSlug(setName: string): string {
  return encodeURIComponent(setName)
}

function cardHref(cardName: string, setName: string, cardUrlSlug: string | null | undefined): string | null {
  if (!setName || !cardUrlSlug) return null
  return `/set/${safeSetSlug(setName)}/card/${cardUrlSlug}`
}

// ─────────────────────────────────────────────────────────────────────
// Range extraction
// ─────────────────────────────────────────────────────────────────────

export type PriceRange = { minCents: number; maxCents: number } | null

/** Compute the raw price range across the provided rows. Ignores
 *  non-positive / non-finite / missing values. Pure. */
export function computeRawRange(
  rows: ReadonlyArray<PokemonSummaryCardRow> | null | undefined,
): PriceRange {
  if (!Array.isArray(rows) || rows.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const r of rows) {
    const v = r.current_raw
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || max <= 0) return null
  if (max < min) return null
  return { minCents: min, maxCents: max }
}

/** Pick the single row with the highest positive `current_raw`. */
export function pickTopByRaw(
  rows: ReadonlyArray<PokemonSummaryCardRow> | null | undefined,
): PokemonSummaryCardRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  let best: PokemonSummaryCardRow | null = null
  let bestCents = 0
  for (const r of rows) {
    const v = r.current_raw
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    if (v > bestCents) { bestCents = v; best = r }
  }
  return best
}

/** Pick the single row with the highest positive `current_psa10`. */
export function pickTopByPsa10(
  rows: ReadonlyArray<PokemonSummaryCardRow> | null | undefined,
): PokemonSummaryCardRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  let best: PokemonSummaryCardRow | null = null
  let bestCents = 0
  for (const r of rows) {
    const v = r.current_psa10
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    if (v > bestCents) { bestCents = v; best = r }
  }
  return best
}

/** Pick the strongest positive 30-day mover from a list. Returns null
 *  when nothing meaningful is available. */
export function pickTopMover(
  rows: ReadonlyArray<PokemonSummaryCardRow> | null | undefined,
): PokemonSummaryCardRow | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  // Prefer the row with the largest absolute pct_30d.
  let best: PokemonSummaryCardRow | null = null
  let bestAbs = 0
  for (const r of rows) {
    const v = r.raw_pct_30d
    if (v == null || !Number.isFinite(v)) continue
    const abs = Math.abs(v)
    if (abs > bestAbs) { bestAbs = abs; best = r }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────
// Main builder
// ─────────────────────────────────────────────────────────────────────

export function buildPokemonSummary(input: PokemonSummaryInput): PokemonSummaryOutput {
  const displayName = input.species?.name
    ? capitalize(String(input.species.name))
    : ''
  const totalCards = typeof input.species?.total_cards === 'number' && input.species.total_cards > 0
    ? Math.floor(input.species.total_cards)
    : null

  const facts: PokemonSummaryFact[] = []

  // ── Fact 1: card count ─────────────────────────────────────────
  if (totalCards != null) {
    facts.push({
      key:   'card_count',
      label: 'Cards tracked',
      value: `${totalCards} card${totalCards === 1 ? '' : 's'}`,
    })
  }

  // ── Fact 2: set count ──────────────────────────────────────────
  const setCount = Array.isArray(input.bySet) ? input.bySet.length : 0
  if (setCount > 0) {
    facts.push({
      key:   'set_count',
      label: 'Represented sets',
      value: `${setCount} set${setCount === 1 ? '' : 's'}`,
    })
  }

  // ── Fact 3: raw price range ────────────────────────────────────
  //   Use topCards + allCards for the widest reliable view.
  const merged: PokemonSummaryCardRow[] = []
  if (Array.isArray(input.topCards))  merged.push(...input.topCards)
  if (Array.isArray(input.allCards))  merged.push(...input.allCards)
  const range = computeRawRange(merged)
  if (range && range.minCents > 0 && range.maxCents > 0) {
    // Only render a range when the two ends are noticeably different.
    if (range.maxCents >= range.minCents * 1.05) {
      const lo = formatUsdFromCents(range.minCents)
      const hi = formatUsdFromCents(range.maxCents)
      if (lo && hi) facts.push({
        key:   'raw_range',
        label: 'Raw price range',
        value: `${lo} – ${hi}`,
      })
    }
  }

  // ── Facts 4 + 5: most valuable raw AND most valuable PSA 10 ────
  // W46C-FIX1 — the brief requires BOTH questions to be answered. If
  // the same card wins both, we merge them into a single row that
  // shows both prices; otherwise we render two distinct rows.
  const topRaw   = pickTopByRaw(input.topCards ?? [])
  const topPsa10 = pickTopByPsa10(input.topCards ?? [])
  const rawPrice   = topRaw   ? formatUsdFromCents(topRaw.current_raw ?? null)     : null
  const psa10Price = topPsa10 ? formatUsdFromCents(topPsa10.current_psa10 ?? null) : null
  const isSameWinner = !!(topRaw && topPsa10
    && topRaw.card_name === topPsa10.card_name
    && topRaw.set_name  === topPsa10.set_name)

  if (isSameWinner && rawPrice && psa10Price && topRaw) {
    // One card, both categories — combined fact.
    facts.push({
      key:      'top_valuable',
      label:    'Most valuable card',
      value:    `${topRaw.card_name} — ${topRaw.set_name} · ${rawPrice} raw / ${psa10Price} PSA 10`,
      linkHref: cardHref(topRaw.card_name, topRaw.set_name, topRaw.card_url_slug ?? null),
    })
  } else {
    if (topRaw && rawPrice) facts.push({
      key:      'top_raw',
      label:    'Most valuable (raw)',
      value:    `${topRaw.card_name} — ${topRaw.set_name} · ${rawPrice}`,
      linkHref: cardHref(topRaw.card_name, topRaw.set_name, topRaw.card_url_slug ?? null),
    })
    if (topPsa10 && psa10Price) facts.push({
      key:      'top_psa10',
      label:    'Most valuable (PSA 10)',
      value:    `${topPsa10.card_name} — ${topPsa10.set_name} · ${psa10Price}`,
      linkHref: cardHref(topPsa10.card_name, topPsa10.set_name, topPsa10.card_url_slug ?? null),
    })
  }

  // ── Fact 6: strongest 30-day mover ─────────────────────────────
  // W46C-FIX1 — pick the LARGEST ABSOLUTE valid pct_30d across risers
  // AND fallers combined. Do not preferentially prefer a riser just
  // because at least one exists — a -35% faller must win against a
  // +2% riser. pickTopMover already handles the abs-value rank; we
  // just need to feed it the union.
  const moverPool: PokemonSummaryCardRow[] = []
  if (Array.isArray(input.risers))  moverPool.push(...input.risers)
  if (Array.isArray(input.fallers)) moverPool.push(...input.fallers)
  const mover = pickTopMover(moverPool)
  if (mover && mover.raw_pct_30d != null && Number.isFinite(mover.raw_pct_30d)) {
    const pctLabel = formatSignedPct(mover.raw_pct_30d)
    if (pctLabel) facts.push({
      key:      'top_mover_30d',
      label:    'Biggest 30-day move',
      value:    `${mover.card_name} — ${mover.set_name} · ${pctLabel}`,
      linkHref: cardHref(mover.card_name, mover.set_name, mover.card_url_slug ?? null),
      variant:  mover.raw_pct_30d > 0 ? 'up' : mover.raw_pct_30d < 0 ? 'down' : 'default',
    })
  }

  // Render decision: need at least 2 facts to be useful. A single
  // "63 cards" line on its own is not a summary.
  return {
    displayName,
    facts,
    render: facts.length >= 2,
  }
}
