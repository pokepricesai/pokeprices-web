// Block 5A-W-57B — source-contract test for the main card image
// fallback. Vitest runs in the node environment (no jsdom), so we
// verify the shipped source carries the ship-critical guarantees:
//
//   * a stateful CardHeroImage component exists,
//   * it wires onError → setFailed(true),
//   * the fallback path renders the shared 🃏 div when src is
//     missing OR the image failed to load,
//   * the main <img> is no longer emitted directly from the hero
//     block (a regression here would restore the broken-image icon
//     users saw in the 57A audit).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx'),
  'utf8',
)

describe('CardPageClient — hero image fallback (Block 57B)', () => {
  it('defines the CardHeroImage component', () => {
    expect(SRC).toMatch(/export function CardHeroImage\(\s*\{\s*src\s*,\s*alt\s*\}/)
  })

  it('CardHeroImage owns a boolean failed state via useState', () => {
    expect(SRC).toMatch(/const \[failed, setFailed\] = useState\(false\)/)
  })

  it('CardHeroImage wires onError to setFailed(true) so a broken remote image swaps to the fallback', () => {
    // The onError handler must set the failed flag — otherwise a
    // remote 404 leaves the browser's broken-image icon in place.
    expect(SRC).toMatch(/onError=\{[^}]*setFailed\(true\)/)
  })

  it('CardHeroImage renders the shared 🃏 fallback when src is missing OR failed', () => {
    // Regression pin: the fallback branch must trigger on !src || failed.
    expect(SRC).toMatch(/const showFallback = !src \|\| failed/)
    // And render the 🃏 emoji div.
    expect(SRC).toMatch(/if \(showFallback\)[\s\S]*?🃏/)
  })

  it('hero section delegates to <CardHeroImage>, never renders a raw <img> for card.image_url', () => {
    // The old branchy render (<img src={card.image_url} …>) is what
    // surfaced browser broken-image icons; regression pin removes it.
    // NB: other <img> usages elsewhere in the file (ExploreMore
    // thumbnails, badges, etc.) already have their own onError.
    expect(SRC).toMatch(/<CardHeroImage\s+src=\{card\.image_url\}/)
    // No `<img src={card.image_url}` remaining in the file.
    expect(SRC).not.toMatch(/<img\s+src=\{card\.image_url\}/)
  })
})
