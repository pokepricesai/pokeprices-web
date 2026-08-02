// @vitest-environment jsdom
// Block 5A-W-50E — history-return marker unit tests.
// Block 5A-W-50E-FIX1 — added peekHistoryReturn coverage.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  consumeHistoryReturn,
  markHistoryReturn,
  peekHistoryReturn,
  __TEST__,
} from '../historyReturnMarker'

beforeEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
})

describe('markHistoryReturn + consumeHistoryReturn', () => {
  it('reads and clears once', () => {
    markHistoryReturn('/browse')
    expect(consumeHistoryReturn('/browse')).toBe(true)
    expect(consumeHistoryReturn('/browse')).toBe(false)
  })

  it('is scoped per pathname', () => {
    markHistoryReturn('/browse')
    expect(consumeHistoryReturn('/set/Foo')).toBe(false)
    expect(consumeHistoryReturn('/browse')).toBe(true)
  })

  it('ignores markers older than the short TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'))
    markHistoryReturn('/browse')
    vi.setSystemTime(new Date('2026-08-02T12:01:00Z'))
    expect(consumeHistoryReturn('/browse')).toBe(false)
  })

  it('has a short TTL (well under the 30-minute origin TTL)', () => {
    expect(__TEST__.TTL_MS).toBeLessThan(60_000)
  })

  it('drops search and hash', () => {
    markHistoryReturn('/browse?language=jp#top')
    expect(consumeHistoryReturn('/browse')).toBe(true)
  })
})

describe('peekHistoryReturn', () => {
  it('returns true without consuming', () => {
    markHistoryReturn('/browse')
    expect(peekHistoryReturn('/browse')).toBe(true)
    expect(peekHistoryReturn('/browse')).toBe(true)
    // consume still works after peek
    expect(consumeHistoryReturn('/browse')).toBe(true)
    expect(peekHistoryReturn('/browse')).toBe(false)
  })

  it('honours the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'))
    markHistoryReturn('/browse')
    vi.setSystemTime(new Date('2026-08-02T12:01:00Z'))
    expect(peekHistoryReturn('/browse')).toBe(false)
  })

  it('is pathname-scoped', () => {
    markHistoryReturn('/browse')
    expect(peekHistoryReturn('/set/Foo')).toBe(false)
  })
})
