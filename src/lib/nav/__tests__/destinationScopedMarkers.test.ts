// @vitest-environment jsdom
// Block 5A-W-50E — end-to-end coverage of the destination-scoped
// origin marker rules: browse -> set -> card should write TWO
// independent markers that survive independently, and consuming one
// must leave the other untouched.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  consumeOriginMarker,
  peekOriginMarker,
  setOriginMarker,
} from '../originMarker'

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('browse -> set -> card sequence', () => {
  it('creates two independent markers keyed by destination pathname', () => {
    // 1) Browse tile click.
    setOriginMarker({
      fromUrl: '/browse?language=jp&sort=completion_desc',
      destinationUrl: '/set/Japanese%20Battle%20Partners',
      expects: 'set',
    })
    // 2) Card tile click on the set page.
    setOriginMarker({
      fromUrl: '/set/Japanese%20Battle%20Partners?sort=name_asc',
      destinationUrl: '/set/Japanese%20Battle%20Partners/card/mimikyu-vmax-95',
      expects: 'card',
    })

    // Both markers are present under separate keys.
    expect(peekOriginMarker('/set/Japanese%20Battle%20Partners')).not.toBeNull()
    expect(peekOriginMarker('/set/Japanese%20Battle%20Partners/card/mimikyu-vmax-95')).not.toBeNull()
  })

  it('consuming the card marker preserves the set marker for the next hop', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    setOriginMarker({
      fromUrl: '/set/Foo?sort=name_asc',
      destinationUrl: '/set/Foo/card/pc-42',
      expects: 'card',
    })

    // User returns card -> set: consumes the card marker.
    const cardBack = consumeOriginMarker('/set/Foo/card/pc-42')
    expect(cardBack?.fromUrl).toBe('/set/Foo?sort=name_asc')
    // Set marker survives so the subsequent set -> browse hop still
    // knows the exact browse URL to return to.
    expect(peekOriginMarker('/set/Foo')?.fromUrl).toBe('/browse?language=jp')
  })

  it('different sets never overwrite each other', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/A',
      expects: 'set',
    })
    setOriginMarker({
      fromUrl: '/browse?language=en',
      destinationUrl: '/set/B',
      expects: 'set',
    })
    expect(peekOriginMarker('/set/A')?.fromUrl).toBe('/browse?language=jp')
    expect(peekOriginMarker('/set/B')?.fromUrl).toBe('/browse?language=en')
  })
})
