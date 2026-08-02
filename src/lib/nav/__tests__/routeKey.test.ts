// Block 5A-W-50E — normaliseRouteKey unit tests.

import { describe, it, expect } from 'vitest'
import { normaliseRouteKey } from '../routeKey'

describe('normaliseRouteKey', () => {
  it('produces the same key regardless of param insertion order', () => {
    const a = normaliseRouteKey('/browse', { language: 'jp', sort: 'cards_desc' })
    const b = normaliseRouteKey('/browse', { sort: 'cards_desc', language: 'jp' })
    expect(a).toBe(b)
  })

  it('omits null / undefined / empty values so defaults collapse to bare path', () => {
    expect(normaliseRouteKey('/browse', { language: null, era: undefined, sort: '' })).toBe('/browse')
  })

  it('English and Japanese browse URLs receive different keys', () => {
    const en = normaliseRouteKey('/browse', { language: 'en' })
    const jp = normaliseRouteKey('/browse', { language: 'jp' })
    expect(en).not.toBe(jp)
  })

  it('different sets receive different keys', () => {
    const a = normaliseRouteKey('/set/A', {})
    const b = normaliseRouteKey('/set/B', {})
    expect(a).not.toBe(b)
  })

  it('encodes values so special characters do not corrupt the key', () => {
    const key = normaliseRouteKey('/browse', { q: 'char & rare' })
    expect(key).toContain('char%20%26%20rare')
  })

  it('drops hash and stray search from the pathname', () => {
    expect(normaliseRouteKey('/browse?x=1#hero', { sort: 'az' })).toBe('/browse?sort=az')
  })
})
