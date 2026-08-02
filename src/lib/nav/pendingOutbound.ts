// src/lib/nav/pendingOutbound.ts
//
// Block 5A-W-50E-FIX1 — application-owned navigation nonce.
//
// When a click on a browse tile, a set-page card tile, or a smart-back
// visible control initiates a client-side navigation, the initiator
// records the intended destination in a short-lived sessionStorage
// slot ("pendingOutbound"). When the destination page's mount effect
// runs, it consumes this slot and — if the destination pathname
// matches — considers the arrival a *confirmed click-through*.
//
// This lets the destination distinguish:
//   * fresh click-through from within our app (marker trusted);
//   * back / forward via native history (verified via the peek helper
//     on the history-return marker — marker also trusted);
//   * everything else, including deep-links, external referrers, and
//     visits from unrelated internal routes that happen to point at a
//     destination we previously wrote a marker for (marker cleared so
//     the visible back button falls back to the safe canonical URL).
//
// The TTL is deliberately short: navigation from click to mount is
// almost always well under one second. A 10-second ceiling covers
// slow / throttled clients without allowing session-lifetime markers.

const KEY = 'pokeprices:pending-outbound:v1'
const TTL_MS = 10_000

interface PendingOutbound {
  destPath: string
  savedAt: number
}

function safeStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function pathClean(p: string): string {
  return p.split('#')[0].split('?')[0]
}

export function markPendingOutbound(destinationUrl: string): void {
  const store = safeStore()
  if (!store) return
  try {
    const payload: PendingOutbound = {
      destPath: pathClean(destinationUrl),
      savedAt: Date.now(),
    }
    store.setItem(KEY, JSON.stringify(payload))
  } catch {
    // no-op
  }
}

/** Returns true when a pending outbound was set for the given path
 *  within the TTL window. Always clears the slot, so a subsequent
 *  visit (even to the same path) will not be treated as a
 *  click-through unless it was accompanied by a fresh mark. */
export function consumePendingOutboundMatching(currentPath: string): boolean {
  const store = safeStore()
  if (!store) return false
  let raw: string | null
  try {
    raw = store.getItem(KEY)
  } catch {
    return false
  }
  if (!raw) return false
  try {
    store.removeItem(KEY)
  } catch {
    // no-op
  }
  let parsed: PendingOutbound
  try {
    parsed = JSON.parse(raw) as PendingOutbound
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  if (typeof parsed.savedAt !== 'number') return false
  if (Date.now() - parsed.savedAt > TTL_MS) return false
  if (typeof parsed.destPath !== 'string') return false
  return pathClean(parsed.destPath) === pathClean(currentPath)
}

export const __TEST__ = { KEY, TTL_MS }
