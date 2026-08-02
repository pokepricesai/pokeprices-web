// @vitest-environment jsdom
// Block 5A-W-50E-FIX1 — pendingOutbound unit tests.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  consumePendingOutboundMatching,
  markPendingOutbound,
  __TEST__,
} from '../pendingOutbound'

beforeEach(() => {
  window.sessionStorage.clear()
  vi.useRealTimers()
})

describe('markPendingOutbound + consumePendingOutboundMatching', () => {
  it('matches when destination pathname matches', () => {
    markPendingOutbound('/set/Foo')
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(true)
  })

  it('rejects when destination differs', () => {
    markPendingOutbound('/set/Foo')
    expect(consumePendingOutboundMatching('/set/Bar')).toBe(false)
  })

  it('drops query and hash from the destination for the comparison', () => {
    markPendingOutbound('/set/Foo?sort=name_asc#top')
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(true)
  })

  it('is consumed once — a subsequent call returns false', () => {
    markPendingOutbound('/set/Foo')
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(true)
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(false)
  })

  it('ignores markers older than the short TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'))
    markPendingOutbound('/set/Foo')
    vi.setSystemTime(new Date('2026-08-02T12:00:15Z')) // 15s > 10s TTL
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(false)
  })

  it('has a short TTL (well under the 30-minute origin TTL)', () => {
    expect(__TEST__.TTL_MS).toBeLessThan(60_000)
  })

  it('overwrites a previous pending outbound (single-slot)', () => {
    markPendingOutbound('/set/Foo')
    markPendingOutbound('/set/Foo/card/pc-1')
    // Only the latest pending is present.
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(false)
  })

  it('discards malformed JSON silently', () => {
    window.sessionStorage.setItem(__TEST__.KEY, 'not json')
    expect(consumePendingOutboundMatching('/set/Foo')).toBe(false)
  })

  it('never throws when sessionStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => markPendingOutbound('/set/Foo')).not.toThrow()
    spy.mockRestore()
  })
})
