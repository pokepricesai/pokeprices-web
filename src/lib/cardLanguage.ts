// src/lib/cardLanguage.ts
//
// Block 5A-W-48B — pure derivation of a card / set's language from
// the set_name string. This is the ONE authoritative fallback used by
// the SearchBar, BrowsePageClient, SetPageClient, and CardPageClient
// whenever the underlying RPC has not yet been extended to return a
// language column.
//
// Design principle: the seeder (seed_set_cards.py) enforces the naming
// convention "Japanese <set title>" for every Japanese pilot set — the
// scraper repo's `--require-console` gate and the W48B block brief
// both pin this. As long as that convention holds, deriving language
// from the set_name prefix is 100% accurate for the pilot and every
// future Japanese set imported through the same tooling.
//
// Why derive on the client instead of extending the RPCs?
//   * search_global and get_set_list_v2 are Supabase functions that
//     live only in the live database — their bodies are not versioned
//     into this git repo, and PostgREST does not expose pg_proc for
//     introspection. Rewriting them from observed return shapes would
//     risk subtle ranking regressions in the global search.
//   * The client-side derivation gives us JP-aware badges + browse
//     tabs + card-page pills today, with zero DB risk. When Luke has
//     verified parity between his live RPC bodies and a proposed
//     replacement, extending them to return c.language directly is a
//     small W48C follow-up — the client will automatically prefer the
//     RPC-supplied value over this derivation (see
//     `resolveLanguage`).
//
// Correctness note: this file is single-purpose. If the naming
// convention changes (e.g. "Battle Partners (JP)"), update
// isJapaneseSetName below and the seeder in the same commit.

export const JAPANESE_SET_NAME_PREFIX = 'Japanese '

/** True when the set name follows the W48B naming convention for
 *  Japanese sets. Case-sensitive on purpose — the seeder writes the
 *  exact prefix and the display-name convention preserves it. */
export function isJapaneseSetName(setName: string | null | undefined): boolean {
  if (!setName || typeof setName !== 'string') return false
  return setName.startsWith(JAPANESE_SET_NAME_PREFIX)
}

/** Return the canonical language code ('en' | 'jp') for a card/set,
 *  preferring an explicit language value when the RPC or DB row
 *  supplies one, and falling back to the set_name prefix convention
 *  otherwise. Anything ambiguous falls through to 'en' so English
 *  behaviour is unchanged pre-migration.
 *
 *  Precedence:
 *    1. explicit === 'jp'  → 'jp'
 *    2. explicit === 'en'  → 'en'   (RPC already answered)
 *    3. set_name starts with "Japanese " → 'jp'  (derived)
 *    4. otherwise 'en'
 */
export function resolveLanguage(
  explicit: string | null | undefined,
  setName: string | null | undefined,
): 'en' | 'jp' {
  if (explicit === 'jp') return 'jp'
  if (explicit === 'en') return 'en'
  if (isJapaneseSetName(setName)) return 'jp'
  return 'en'
}
