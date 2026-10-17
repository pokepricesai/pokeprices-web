// src/lib/prose/variety.ts
//
// Deterministic variety helpers for the programmatically assembled
// prose on card / set / Pokémon species pages. Two goals:
//
//   1. No AI-flavoured sameness across pages — species A should not
//      open with the exact same clause as species B.
//   2. Server-side rendering stays byte-identical to client-side
//      hydration — nothing random, no timestamps, no Math.random.
//
// Everything here is a pure function of its inputs. A given slug
// always produces the same variant; the variant distribution across
// slugs is uniform.

// FNV-1a 32-bit hash — stable, no dependency.
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h >>> 0
}

/** Pick one of N variants deterministically from a seed string. */
export function pickVariant<T>(seed: string, variants: ReadonlyArray<T>): T {
  if (variants.length === 0) throw new Error('variety.pickVariant: empty variants array')
  const idx = hash32(seed) % variants.length
  return variants[idx]
}
