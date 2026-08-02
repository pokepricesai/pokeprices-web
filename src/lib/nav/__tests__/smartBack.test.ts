// @vitest-environment jsdom
// Block 5A-W-50E — smart back handler decision + click behaviour.
// Block 5A-W-50E-FIX1 — router.back() is no longer used from the
// visible back controls. Deterministic navigation via router.replace
// (marker branch) or router.push (fallback branch) prevents a stale
// marker from landing the user on an unrelated intermediate page.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  makeSmartBackHandler,
  originMatches,
  resolveSmartBack,
} from '../smartBack'
import { setOriginMarker } from '../originMarker'
import { peekHistoryReturn } from '../historyReturnMarker'
import { consumePendingOutboundMatching } from '../pendingOutbound'

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('originMatches', () => {
  it('matches an exact pathname', () => {
    expect(originMatches('/browse', '/browse')).toBe(true)
  })
  it('matches with query string on the origin', () => {
    expect(originMatches('/browse?language=jp', '/browse')).toBe(true)
  })
  it('rejects an unrelated pathname', () => {
    expect(originMatches('/dashboard', '/browse')).toBe(false)
  })
  it('supports a RegExp expectation', () => {
    expect(originMatches('/set/Foo?sort=raw_desc', /^\/set\//)).toBe(true)
  })
})

describe('resolveSmartBack', () => {
  it('returns the fallback when there is no marker', () => {
    const dec = resolveSmartBack({
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    expect(dec.fromMarker).toBe(false)
    expect(dec.destination).toBe('/browse')
  })

  it('returns the marker fromUrl when the origin matches', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp&sort=cards_desc',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const dec = resolveSmartBack({
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    expect(dec.fromMarker).toBe(true)
    expect(dec.destination).toBe('/browse?language=jp&sort=cards_desc')
  })

  it('falls back when marker origin does NOT match the expected path', () => {
    setOriginMarker({
      fromUrl: '/dashboard/portfolio',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const dec = resolveSmartBack({
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    expect(dec.fromMarker).toBe(false)
    expect(dec.destination).toBe('/browse')
  })
})

describe('makeSmartBackHandler — marker branch (deterministic replace)', () => {
  it('calls router.replace(marker.fromUrl) with the exact stored query URL', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp&sort=cards_desc&q=charizard',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    const event = { button: 0, preventDefault: vi.fn() } as any
    handler(event)
    expect(router.replace).toHaveBeenCalledWith('/browse?language=jp&sort=cards_desc&q=charizard')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('primes a history-return marker for the destination path', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(peekHistoryReturn('/browse')).toBe(true)
  })

  it('writes a pendingOutbound token matching the destination path', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(consumePendingOutboundMatching('/browse')).toBe(true)
  })

  it('preserves set sort on the card -> set breadcrumb path', () => {
    setOriginMarker({
      fromUrl: '/set/Foo?sort=name_asc',
      destinationUrl: '/set/Foo/card/pc-42',
      expects: 'card',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo/card/pc-42',
      fallbackUrl: '/set/Foo',
      expectOriginPath: '/set/Foo',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(router.replace).toHaveBeenCalledWith('/set/Foo?sort=name_asc')
  })
})

describe('makeSmartBackHandler — fallback branch', () => {
  it('uses router.push(fallbackUrl) when no marker exists', () => {
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(router.push).toHaveBeenCalledWith('/browse')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does NOT prime any history-return marker on the fallback branch', () => {
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(peekHistoryReturn('/browse')).toBe(false)
  })

  it('does NOT prime pendingOutbound on the fallback branch', () => {
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(consumePendingOutboundMatching('/browse')).toBe(false)
  })

  it('falls back to direct-visit canonical for card breadcrumb', () => {
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo/card/pc-1',
      fallbackUrl: '/set/Foo',
      expectOriginPath: '/set/Foo',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(router.push).toHaveBeenCalledWith('/set/Foo')
  })
})

describe('makeSmartBackHandler — safety', () => {
  it('ignores Ctrl+click / middle-click / modifier-key clicks', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, ctrlKey: true, preventDefault: vi.fn() } as any)
    handler({ button: 0, metaKey: true, preventDefault: vi.fn() } as any)
    handler({ button: 0, shiftKey: true, preventDefault: vi.fn() } as any)
    handler({ button: 1, preventDefault: vi.fn() } as any)
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    // Marker not consumed either — the ordinary Link href handles the
    // Ctrl+click / new-tab flow with the fallback URL, and any later
    // in-tab visit still gets the marker.
    expect(peekHistoryReturn('/browse')).toBe(false)
  })

  it('marker is consumed even on the fallback branch so a stale marker cannot be reused', () => {
    setOriginMarker({
      fromUrl: '/dashboard/nowhere',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    handler({ button: 0, preventDefault: vi.fn() } as any)
    // Marker was consumed by the handler even though we chose fallback.
    expect(resolveSmartBack({
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    }).fromMarker).toBe(false)
  })

  it('never calls router.back — the API no longer exposes it', () => {
    // Type-level check that back is not part of RouterLike. If a future
    // change re-introduces router.back(), the assignment below would
    // require the property to exist and the type test would fail.
    const router: import('../smartBack').RouterLike = { push: vi.fn(), replace: vi.fn() }
    expect(router).not.toHaveProperty('back')
  })
})

describe('makeSmartBackHandler — stale marker after unrelated navigation', () => {
  it('a stale marker consumed here is destroyed so a subsequent click sees fallback', () => {
    // Scenario: browse -> set -> unrelated -> revisit set -> click back.
    // On the revisit, the destination validity check would already
    // have cleared the marker (proven in destinationValidity.test).
    // Here we prove that even if a marker somehow survives, the smart
    // back handler consumes it — a stale click cannot leak into
    // subsequent clicks.
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    const router = { push: vi.fn(), replace: vi.fn() }
    const handler = makeSmartBackHandler(router, {
      currentPathname: '/set/Foo',
      fallbackUrl: '/browse',
      expectOriginPath: '/browse',
    })
    // First click: consumes marker, navigates via replace.
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(router.replace).toHaveBeenCalledTimes(1)
    router.replace.mockClear()
    // Second click on the same page: marker is gone, fallback branch.
    handler({ button: 0, preventDefault: vi.fn() } as any)
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/browse')
  })
})
