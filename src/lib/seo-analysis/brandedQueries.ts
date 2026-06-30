// src/lib/seo-analysis/brandedQueries.ts
// Block 5A-W-33 — branded query classifier.
//
// A query counts as branded when, after case-folding + removing
// non-alphanumeric characters, it CONTAINS one of the brand tokens.
// We strip rather than match exact phrases so "pokeprices uk" and
// "pokeprices.io" both count.
//
// Pure — same input always produces the same output.

const BRAND_TOKENS = [
  'pokeprices',  // canonical
  'pokeprice',   // singular variant
  // Spaced variants get caught by the normalization (we strip spaces
  // before matching) so "poke prices" and "poke price" both fold to
  // "pokeprices" / "pokeprice".
] as const

function normalize(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function isBrandedQuery(query: string): boolean {
  if (typeof query !== 'string' || query.length === 0) return false
  const n = normalize(query)
  if (n.length === 0) return false
  for (const t of BRAND_TOKENS) {
    if (n.includes(t)) return true
  }
  return false
}

export function splitBrandedNonBranded<T extends { query?: string | null }>(
  rows: T[],
): { branded: T[]; nonBranded: T[] } {
  const branded: T[] = []
  const nonBranded: T[] = []
  for (const r of rows) {
    const q = r.query ?? ''
    if (isBrandedQuery(q)) branded.push(r)
    else nonBranded.push(r)
  }
  return { branded, nonBranded }
}
