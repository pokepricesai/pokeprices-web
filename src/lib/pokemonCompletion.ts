// src/lib/pokemonCompletion.ts
//
// Block 5A-W-53A — per-Pokémon completion helpers.
//
// The set-page completion helper (src/lib/setCompletion.ts) aggregates
// portfolio_items rows by `set_name_snapshot`. For the per-Pokémon
// hub we need the same distinct-card discipline but split by
// language: an owned English Pikachu counts toward
// `English 48 / 163`, a Japanese Pikachu counts toward
// `Japanese 12 / 85`, and both totals are computed from the same
// eligible-non-sealed rule used server-side by
// get_pokemon_species_detail.
//
// Reuses the existing portfolio_items table exactly — no new
// ownership store. Uses cards.card_slug + cards.language as the
// join key. Raw and graded holdings of the same card_slug still
// count as one owned card (Set-of-slug semantics).
//
// Query budget:
//   * Anonymous users: 0 queries — the page renders the signed-out
//     CTA and never touches this module.
//   * Authenticated Pokémon page: at most 2 queries — one paginated
//     portfolio_items lookup, one narrow cards lookup to resolve
//     language for the owned slugs. The second lookup is only
//     issued for the union of slugs that landed in the first
//     result, so it stays small.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PokemonCompletionEntry {
  ownedDistinct: number
  totalEligible: number
  percentage:    number  // 0..100 integer
}

export interface PokemonCompletion {
  en: PokemonCompletionEntry
  jp: PokemonCompletionEntry
}

/**
 * Filter a card list to a single language.
 *
 * The `'all'` filter is a pass-through so callers can wire the same
 * helper to every tab; the `'en'` and `'jp'` filters drop rows
 * whose `language` field mismatches the selection. Rows missing a
 * language field are treated as English (defensive default —
 * historical rows before 53A's RPC update land here and were all
 * English by construction).
 */
export function filterCardsByLanguage<T extends { language?: 'en' | 'jp' | null }>(
  cards: T[],
  language: 'all' | 'en' | 'jp',
): T[] {
  if (language === 'all') return cards
  return cards.filter(c => (c.language ?? 'en') === language)
}

/**
 * Group an array of cards into per-language counts. Used to
 * populate the "All (N) / English (E) / Japanese (J)" tab labels
 * when the RPC has not (yet) returned explicit totals.
 */
export function countCardsByLanguage<T extends { language?: 'en' | 'jp' | null }>(
  cards: T[],
): { en: number; jp: number; total: number } {
  let en = 0, jp = 0
  for (const c of cards) {
    if (c.language === 'jp') jp++
    else if (c.language === 'en') en++
    else en++
  }
  return { en, jp, total: en + jp }
}

export function computePercentage(owned: number, total: number): number {
  if (!Number.isFinite(owned) || !Number.isFinite(total)) return 0
  if (total <= 0 || owned <= 0) return 0
  const raw = (owned / total) * 100
  return Math.round(Math.max(0, Math.min(100, raw)))
}

/**
 * Pure aggregator — given the list of card_slugs the user owns
 * that map to this Pokémon, plus a slug→language lookup, return
 * distinct-card counts per language.
 *
 * Exported so tests can pin the (raw + graded of same slug → 1)
 * semantic without a live DB round trip.
 */
export function aggregateOwnedByLanguage(
  ownedSlugs: Iterable<string>,
  slugLanguage: Record<string, 'en' | 'jp' | null | undefined>,
): { en: Set<string>; jp: Set<string> } {
  const en = new Set<string>()
  const jp = new Set<string>()
  for (const slug of ownedSlugs) {
    const lang = slugLanguage[slug]
    if (lang === 'jp') jp.add(slug)
    else if (lang === 'en') en.add(slug)
  }
  return { en, jp }
}

/**
 * Build the two-bar completion object. Denominators come from the
 * RPC (species.en_total_cards / species.jp_total_cards) so this
 * function never needs to know the entire card catalogue.
 */
export function buildPokemonCompletion(
  owned: { en: Set<string>; jp: Set<string> },
  totals: { en: number; jp: number },
): PokemonCompletion {
  return {
    en: {
      ownedDistinct: owned.en.size,
      totalEligible: totals.en,
      percentage: computePercentage(owned.en.size, totals.en),
    },
    jp: {
      ownedDistinct: owned.jp.size,
      totalEligible: totals.jp,
      percentage: computePercentage(owned.jp.size, totals.jp),
    },
  }
}

/**
 * End-to-end loader for the per-Pokémon page. Returns `null` when
 * the user has zero owned cards for this Pokémon (either language)
 * — the caller then renders "You don't own any [Pokémon] cards yet"
 * rather than two 0/N bars.
 *
 * Block 5A-W-53A.1 — Pokémon membership is resolved through
 * `card_pokemon.species_slug` (the same source the page's card
 * grid uses), NOT through `cards.primary_pokemon_slug`. This is
 * load-bearing:
 *   * The page catalogue includes secondary-Pokémon cards
 *     (e.g. "Ditto (Pikachu)" is primary=ditto but has a
 *     card_pokemon row for pikachu). The 53A completion loader
 *     used primary_pokemon_slug only, so 14 secondary Pikachu
 *     cards existed in the grid but were invisible to
 *     completion — probed live against the DB.
 *   * The denominator (species.en_total_cards / jp_total_cards
 *     from the RPC) is already computed via card_pokemon, so the
 *     numerator and denominator now come from the same
 *     population.
 *   * card_pokemon uses (card_slug, species_slug) as PK, so a
 *     given (owned card, species) pair appears at most once —
 *     no risk of double-counting the same card_slug.
 */
export async function loadPokemonCompletion(
  supabase: SupabaseClient,
  userId:   string,
  pokemonSlug: string,
  totals: { en: number; jp: number },
): Promise<PokemonCompletion | null> {
  const ownedSlugs: string[] = []
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('card_slug')
      .eq('user_id', userId)
      .range(offset, offset + pageSize - 1)
    if (error || !data || data.length === 0) break
    for (const r of data) {
      if (r.card_slug) ownedSlugs.push(r.card_slug)
    }
    if (data.length < pageSize) break
    offset += pageSize
  }
  if (ownedSlugs.length === 0) return null

  const uniqueOwned = [...new Set(ownedSlugs)]

  // Intersect owned slugs against the species membership table.
  // `card_pokemon` PK is (card_slug, species_slug) so at most one
  // row per owned card ever comes back — no dedupe needed for the
  // join itself.
  const { data: membershipRows, error: membershipErr } = await supabase
    .from('card_pokemon')
    .select('card_slug')
    .eq('species_slug', pokemonSlug)
    .in('card_slug', uniqueOwned)
  if (membershipErr) return null
  const ownedInSpecies = [...new Set((membershipRows ?? []).map(r => r.card_slug).filter(Boolean))]
  if (ownedInSpecies.length === 0) return null

  // Resolve language for those specific slugs. is_sealed=false
  // matches the eligibility rule the RPC uses server-side.
  const { data: cardRows, error: cardsErr } = await supabase
    .from('cards')
    .select('card_slug,language')
    .in('card_slug', ownedInSpecies)
    .eq('is_sealed', false)
  if (cardsErr) return null

  const slugLanguage: Record<string, 'en' | 'jp' | null> = {}
  for (const r of cardRows ?? []) {
    slugLanguage[r.card_slug] = r.language === 'jp' ? 'jp' : r.language === 'en' ? 'en' : null
  }
  const owned = aggregateOwnedByLanguage(ownedInSpecies, slugLanguage)
  if (owned.en.size === 0 && owned.jp.size === 0) return null
  return buildPokemonCompletion(owned, totals)
}
