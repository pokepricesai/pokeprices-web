// @vitest-environment jsdom
// Block 5A-W-50E-FIX1 — destination validity check tests. Proves the
// stale-marker safety scenario the correction called out:
//
//   browse -> set -> another page -> revisit same set
//
// The revisit must clear the browse -> set origin marker so the
// visible "Back to browse" button does NOT navigate to the stale
// browse URL. Only click-through arrivals (fresh outbound click or
// browser Back / Forward) preserve the marker.

import { describe, it, expect, beforeEach } from 'vitest'
import { setOriginMarker, peekOriginMarker } from '../originMarker'
import { markPendingOutbound } from '../pendingOutbound'
import { markHistoryReturn } from '../historyReturnMarker'
import { validateOriginMarkerForArrival } from '../destinationValidity'

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('validateOriginMarkerForArrival', () => {
  it('PRESERVES the marker when a matching pendingOutbound token exists (click-through)', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    markPendingOutbound('/set/Foo')
    validateOriginMarkerForArrival('/set/Foo')
    expect(peekOriginMarker('/set/Foo')?.fromUrl).toBe('/browse?language=jp')
  })

  it('PRESERVES the marker when a history-return marker exists (browser Back)', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    markHistoryReturn('/set/Foo')
    validateOriginMarkerForArrival('/set/Foo')
    expect(peekOriginMarker('/set/Foo')?.fromUrl).toBe('/browse?language=jp')
  })

  it('CLEARS the marker on a fresh visit (no pending, no history-return)', () => {
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    // No pendingOutbound, no history-return.
    validateOriginMarkerForArrival('/set/Foo')
    expect(peekOriginMarker('/set/Foo')).toBeNull()
  })

  it('is scoped per destination pathname — different sets stay independent', () => {
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
    markPendingOutbound('/set/A')  // Only /set/A is a click-through.
    validateOriginMarkerForArrival('/set/A')
    // /set/A marker preserved (click-through); /set/B untouched.
    expect(peekOriginMarker('/set/A')).not.toBeNull()
    expect(peekOriginMarker('/set/B')).not.toBeNull()
  })

  it('exact stale-marker scenario: browse -> set -> unrelated -> revisit set', () => {
    // Step 1: browse -> set (click-through).
    setOriginMarker({
      fromUrl: '/browse?language=jp',
      destinationUrl: '/set/Foo',
      expects: 'set',
    })
    markPendingOutbound('/set/Foo')
    validateOriginMarkerForArrival('/set/Foo')
    expect(peekOriginMarker('/set/Foo')).not.toBeNull()

    // Step 2: user navigates to some unrelated internal route. Time
    // passes; no popstate to /set/Foo, no pendingOutbound to /set/Foo.

    // Step 3: user revisits /set/Foo via a fresh link (e.g. from a
    // dashboard tile, an in-app search result, or a direct URL type).
    validateOriginMarkerForArrival('/set/Foo')
    // The stale marker is gone.
    expect(peekOriginMarker('/set/Foo')).toBeNull()
  })
})
