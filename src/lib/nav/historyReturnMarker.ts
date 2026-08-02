// src/lib/nav/historyReturnMarker.ts
//
// Block 5A-W-50E — short-lived marker set when the user reaches a
// route via browser history (back / forward) or via our smart-back
// visible controls. Consumed by useRouteScrollRestoration so a fresh
// visit does not incorrectly restore an old scroll position.
//
// Keyed by pathname only — filter query changes on the destination
// (via router.replace) do not invalidate the marker. TTL is short
// because popstate -> mount usually completes in well under one
// second; a longer window would risk restoring after unrelated
// navigations.

const PREFIX = 'pokeprices:histreturn:v1:'
const TTL_MS = 10_000

function safeStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function pathnameKey(pathname: string): string {
  const cleaned = pathname.split('#')[0].split('?')[0]
  return PREFIX + cleaned
}

export function markHistoryReturn(pathname: string): void {
  const store = safeStore()
  if (!store) return
  try {
    store.setItem(pathnameKey(pathname), String(Date.now()))
  } catch {
    // no-op
  }
}

function readValidMarker(pathname: string): boolean {
  const store = safeStore()
  if (!store) return false
  let raw: string | null
  try {
    raw = store.getItem(pathnameKey(pathname))
  } catch {
    return false
  }
  if (!raw) return false
  const ts = Number(raw)
  if (!Number.isFinite(ts)) return false
  if (Date.now() - ts > TTL_MS) return false
  return true
}

export function consumeHistoryReturn(pathname: string): boolean {
  const valid = readValidMarker(pathname)
  const store = safeStore()
  if (store) {
    try { store.removeItem(pathnameKey(pathname)) } catch { /* no-op */ }
  }
  return valid
}

/** Block 5A-W-50E-FIX1 — non-destructive read for the destination
 *  page's origin-marker validity check. Lets that check treat "the
 *  user just used browser Back" as a valid reason to trust the
 *  origin marker for continued backwards navigation, without racing
 *  with the scroll-restoration hook's own consume. */
export function peekHistoryReturn(pathname: string): boolean {
  return readValidMarker(pathname)
}

export const __TEST__ = { PREFIX, TTL_MS }
