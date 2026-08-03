// src/lib/set-assets/assetKey.ts
//
// Block 5A-W-50H — deterministic filesystem-safe asset key derived
// from set_metadata.set_name.
//
// Why derived rather than from an existing app slug:
//   * The app uses encodeURIComponent(set_name) in URLs. That is
//     just URL-safe percent-encoding of a mutable display name, not
//     a distinct stable identifier — a set rename would change every
//     URL and every asset path.
//   * set_metadata has no separate `id` / `code` column — the
//     canonical stable identifier IS set_name itself (the primary
//     key). But set_name is not filesystem-safe (spaces,
//     apostrophes, punctuation) and cannot serve as a directory
//     name on Windows.
//
// So the asset key is a deterministic slug of set_name with the
// leading "Japanese " prefix removed. The mapping back to set_name
// is preserved in the index so the key never has to be recomputed
// from a mutable display name during import.
//
// If two set_names ever collide to the same asset key (via
// punctuation differences that slugify identically), the scaffold
// must FAIL LOUDLY rather than pick one silently. See
// detectKeyCollisions.

/**
 * Strips the internal "Japanese " prefix that PokePrices uses on
 * every JP set. Case-sensitive on the exact leading token.
 */
export function stripJapanesePrefix(setName: string): string {
  return setName.replace(/^Japanese\s+/, '')
}

/**
 * Returns a filesystem-safe, lowercase, ASCII-only slug. Preserves
 * word order. Collapses runs of non-alphanumeric characters to a
 * single '-'. Trims leading/trailing '-'. Empty output is rejected
 * by the caller — a set with no identifying characters is a
 * scaffold error, not a silently-empty key.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')                       // strip combining marks where possible
    .replace(/[̀-ͯ]/g, '')         // remove combining diacritics
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’‘`ʼ']/g, '')                 // drop ALL apostrophe forms (straight + smart) cleanly
    .replace(/[^a-z0-9]+/g, '-')             // everything else → single '-'
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)                            // filesystem-safe upper bound
}

/**
 * Derives the asset key for a Japanese set. Guarantees:
 *   * deterministic (same input → same output)
 *   * lower-case ASCII alphanumeric + '-'
 *   * non-empty (throws if it would be empty)
 */
export function assetKeyForJpSet(setName: string): string {
  const visible = stripJapanesePrefix(setName)
  const key = slugify(visible)
  if (!key) throw new Error(`assetKeyForJpSet: could not derive a stable key from "${setName}"`)
  return key
}

/**
 * Returns any group of {setName, key} that produce the same asset
 * key. An empty array means every set has a unique key. The scaffold
 * script rejects any non-empty result.
 */
export function detectKeyCollisions(setNames: string[]): Array<{ key: string; setNames: string[] }> {
  const groups = new Map<string, string[]>()
  for (const name of setNames) {
    const k = assetKeyForJpSet(name)
    const arr = groups.get(k) ?? []
    arr.push(name)
    groups.set(k, arr)
  }
  const out: Array<{ key: string; setNames: string[] }> = []
  groups.forEach((names, k) => {
    if (names.length > 1) out.push({ key: k, setNames: names })
  })
  return out
}
