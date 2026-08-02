// @vitest-environment jsdom
// Block 5A-W-50E — origin marker unit tests.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  consumeOriginMarker,
  destinationKey,
  peekOriginMarker,
  setOriginMarker,
  __TEST__,
} from '../originMarker'

beforeEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
})

describe('destinationKey', () => {
  it('drops search and hash from the pathname', () => {
    expect(destinationKey('/set/Foo?sort=raw_desc#hero')).toBe(__TEST__.PREFIX + '/set/Foo')
  })
})

describe('setOriginMarker + peek + consume', () => {
  it('round-trips a valid marker', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp&sort=cards_desc',
      destinationUrl: '/set/Japanese%20Battle%20Partners',
      expects: 'set',
    })
    const peeked = peekOriginMarker('/set/Japanese%20Battle%20Partners')
    expect(peeked?.fromUrl).toBe('/browse?language=jp&sort=cards_desc')
    expect(peeked?.expects).toBe('set')

    const consumed = consumeOriginMarker('/set/Japanese%20Battle%20Partners')
    expect(consumed?.destinationUrl).toBe('/set/Japanese%20Battle%20Partners')
    expect(peekOriginMarker('/set/Japanese%20Battle%20Partners')).toBeNull()
  })

  it('does not overwrite a marker for a different destination', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/A',
      expects: 'set',
    })
    setOriginMarker({
      fromUrl: '/set/A?sort=raw_desc',
      destinationUrl: '/set/A/card/pc-1',
      expects: 'card',
    })

    // Consuming the card marker leaves the set marker intact.
    expect(consumeOriginMarker('/set/A/card/pc-1')?.expects).toBe('card')
    expect(peekOriginMarker('/set/A')?.expects).toBe('set')
  })

  it('discards markers older than the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'))
    setOriginMarker({
      fromUrl: '/browse',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    // Skip forward 31 minutes.
    vi.setSystemTime(new Date('2026-08-02T12:31:00Z'))
    expect(peekOriginMarker('/set/Foo')).toBeNull()
  })

  it('discards malformed JSON silently', () => {
    window.sessionStorage.setItem(destinationKey('/set/Foo'), 'not json')
    expect(peekOriginMarker('/set/Foo')).toBeNull()
    // Consume with malformed value returns null and clears the key.
    expect(consumeOriginMarker('/set/Foo')).toBeNull()
  })

  it('discards payloads with wrong shape', () => {
    window.sessionStorage.setItem(destinationKey('/set/Foo'), JSON.stringify({ foo: 'bar' }))
    expect(peekOriginMarker('/set/Foo')).toBeNull()
  })

  it('never stores authenticated identity or private data', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const raw = window.sessionStorage.getItem(destinationKey('/set/Foo')) ?? ''
    expect(raw).not.toMatch(/user/i)
    expect(raw).not.toMatch(/session/i)
    expect(raw).not.toMatch(/token/i)
  })

  it('falls back safely when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    // Should not throw.
    setOriginMarker({ fromUrl: '/browse', destinationUrl: '/set/Foo', expects: 'set' })
    spy.mockRestore()
  })
})
