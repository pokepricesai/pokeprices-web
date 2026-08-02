// src/lib/nav/destinationValidity.ts
//
// Block 5A-W-50E-FIX1 — mount-time validity check for a destination's
// origin marker.
//
// Runs once per destination mount. The marker for the current
// pathname is *cleared* unless:
//   1. a pendingOutbound token is present that matches this
//      pathname (a legitimate click-through from our own smart-back
//      or from an outbound tile click), OR
//   2. a history-return marker is present for this pathname (the
//      user reached this route via browser Back or Forward).
//
// In either case the marker was written by a genuine navigation from
// the origin, so continued backwards navigation via the visible back
// button is safe. In every other case (deep-link, external referrer,
// unrelated internal link) any leftover marker is stale and must be
// cleared so the visible back button falls back to the safe
// canonical URL rather than navigating to some old origin.

import { consumePendingOutboundMatching } from './pendingOutbound'
import { peekHistoryReturn } from './historyReturnMarker'
import { consumeOriginMarker } from './originMarker'

export function validateOriginMarkerForArrival(pathname: string): void {
  if (typeof window === 'undefined') return
  const clickThrough = consumePendingOutboundMatching(pathname)
  if (clickThrough) return
  if (peekHistoryReturn(pathname)) return
  // Neither signal present: this is a fresh visit. Discard any
  // stale marker for this destination so the visible back button
  // falls back to the safe canonical URL.
  consumeOriginMarker(pathname)
}
