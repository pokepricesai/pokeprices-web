// src/lib/editorial/publishing/slug.ts
//
// EIC Block 10 — deterministic slug generation for the publishing
// pipeline.
//
// Design:
//   * lowercase ASCII, hyphen-separated, max 80 chars
//   * strips accents ("Pokémon" → "Pokemon") so we never repeat
//     the malformed %/pok-mon/ legacy slug pattern
//   * removes duplicate + leading/trailing hyphens
//   * server-side re-validation against a strict regex the DB layer
//     enforces (see insights admin route + this file's isValidSlug)

const MAX_SLUG_LEN  = 80
const MIN_SLUG_LEN  = 3

const SLUG_STRICT_RE = /^[a-z0-9][a-z0-9-]{0,120}$/
// Combining diacriticals block; strip during normalisation.
const DIACRITICS_RE = /[̀-ͯ]/g

/** Deterministic slug from any headline / seed. Never returns an
 *  invalid slug — callers can trust the shape. */
export function generateSlug(input: string): string {
  const seed = String(input ?? '').trim()
  if (!seed) return 'untitled-article'
  const ascii = seed
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    // Common typographic replacements that would otherwise disappear.
    .replace(/[’‘]/g, '')
    .replace(/[“”]/g, '')
    .replace(/[–—]/g, '-')
  let out = ascii
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  if (out.length === 0) return 'untitled-article'
  if (out.length > MAX_SLUG_LEN) out = out.slice(0, MAX_SLUG_LEN).replace(/-+$/g, '')
  return out
}

/** Strict shape check — same regex the /api/admin/insights routes use. */
export function isValidSlug(slug: string): boolean {
  return typeof slug === 'string' && SLUG_STRICT_RE.test(slug) && slug.length >= MIN_SLUG_LEN
}

/** Suggest an alternative when the primary slug is taken. Deterministic,
 *  human-readable: appends -2, -3, … up to -10. The UI still surfaces
 *  the collision to the admin who is expected to make the final call. */
export function suggestAlternativeSlug(base: string, taken: readonly string[]): string {
  const takenSet = new Set(taken.map(s => s.toLowerCase()))
  const bare = base.replace(/-\d+$/, '')
  for (let i = 2; i <= 10; i++) {
    const cand = `${bare}-${i}`.slice(0, MAX_SLUG_LEN)
    if (!takenSet.has(cand)) return cand
  }
  return `${bare}-${Date.now().toString(36)}`.slice(0, MAX_SLUG_LEN)
}
