// src/lib/seo/canonicaliseUrl.ts
// ============================================================================
// PokePrices canonical URL rule — the single definition every SEO ingest
// path shares (Google GSC, Bing Webmaster, future GA4).
//
// Canonical form:
//   https://www.pokeprices.io/...
//
// Rules:
//   - Rewrite both www and non-www PokePrices hosts to www.pokeprices.io
//   - Preserve path case (URLs like /set/Chaos%20Rising are case-sensitive)
//   - Strip query string and fragment
//   - Strip trailing slash except on root '/'
//   - Return null when the URL is unparsable OR points to a different host
// ============================================================================

import 'server-only'

export const CANONICAL_ORIGIN = 'https://www.pokeprices.io'
export const CANONICAL_HOST   = 'www.pokeprices.io'
export const CANONICAL_APEX_HOST = 'pokeprices.io'

export function canonicaliseUrl(u: string | null | undefined): string | null {
  if (typeof u !== 'string' || u.length === 0) return null
  try {
    const parsed = new URL(u)
    if (parsed.host !== CANONICAL_HOST && parsed.host !== CANONICAL_APEX_HOST) return null
    let p = parsed.pathname || '/'
    if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1)
    return `${CANONICAL_ORIGIN}${p}`
  } catch {
    return null
  }
}
