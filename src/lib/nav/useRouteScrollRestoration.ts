// src/lib/nav/useRouteScrollRestoration.ts
//
// Block 5A-W-50E — save & restore scroll position for a specific
// client-rendered route (browse, set page). See the block memo for
// the exact interaction rules with URL query-state and the smart-back
// controls.
//
// The hook restores ONLY when a history-return marker for the current
// pathname is present (set either by the ambient popstate listener or
// by the smart-back click handler). A stale sessionStorage entry from
// a previous browsing session is never restored on a fresh visit.

import { useEffect, useRef } from 'react'
import { consumeHistoryReturn } from './historyReturnMarker'

const SCROLL_PREFIX = 'pokeprices:scroll:v1:'
const SCROLL_TTL_MS = 30 * 60 * 1000
const SAVE_THROTTLE_MS = 200

export interface RouteAnchor {
  kind: string
  id: string
}

interface ScrollPayload {
  y: number
  savedAt: number
  docHeight: number
  anchor?: RouteAnchor
  anchorOffsetY?: number
}

export interface UseRouteScrollRestorationOpts {
  /** True once data + layout for this routeKey are stable enough to
   *  restore against. Restoration is deferred until this flips true. */
  ready: boolean
  /** Deterministic key derived from pathname + the meaningful params
   *  (see normaliseRouteKey). Restarting with a different key resets
   *  the internal restore latch. */
  routeKey: string
  /** Called while saving; returns the anchor identity of the first
   *  visible item, or null if none is available yet. */
  getAnchor?: () => RouteAnchor | null
  /** Called while restoring; returns the DOM element for the saved
   *  anchor, or null if it no longer exists. Callers should use
   *  CSS.escape or a dataset iteration so raw user data can never
   *  produce an unsafe selector. */
  findAnchor?: (a: RouteAnchor) => Element | null
}

function safeStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function storeKey(routeKey: string): string {
  return SCROLL_PREFIX + routeKey
}

function loadPayload(routeKey: string): ScrollPayload | null {
  const store = safeStore()
  if (!store) return null
  let raw: string | null
  try {
    raw = store.getItem(storeKey(routeKey))
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as ScrollPayload
  if (typeof p.y !== 'number' || typeof p.savedAt !== 'number') return null
  if (Date.now() - p.savedAt > SCROLL_TTL_MS) return null
  return p
}

export function useRouteScrollRestoration({
  ready,
  routeKey,
  getAnchor,
  findAnchor,
}: UseRouteScrollRestorationOpts): void {
  const currentKeyRef = useRef(routeKey)
  const restoredRef = useRef(false)
  const getAnchorRef = useRef(getAnchor)
  const findAnchorRef = useRef(findAnchor)

  useEffect(() => {
    getAnchorRef.current = getAnchor
  }, [getAnchor])
  useEffect(() => {
    findAnchorRef.current = findAnchor
  }, [findAnchor])

  // Reset restore latch whenever the route key changes so a subsequent
  // arrival (e.g. via back) can restore again.
  useEffect(() => {
    currentKeyRef.current = routeKey
    restoredRef.current = false
  }, [routeKey])

  // Save on scroll (throttled) + immediately on visibilitychange to
  // hidden. The synchronous "save right before deeper navigation" is
  // performed by the tile click handler via saveScrollForRoute, so
  // the hook itself does not need pagehide/beforeunload plumbing.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let lastSave = 0
    let scheduled = false

    const doSave = () => {
      scheduled = false
      lastSave = Date.now()
      saveScrollForRoute(currentKeyRef.current, getAnchorRef.current, findAnchorRef.current)
    }

    const onScroll = () => {
      const now = Date.now()
      if (now - lastSave >= SAVE_THROTTLE_MS) {
        doSave()
        return
      }
      if (!scheduled) {
        scheduled = true
        window.requestAnimationFrame(() => {
          // Coalesce until at least SAVE_THROTTLE_MS since last save.
          if (Date.now() - lastSave >= SAVE_THROTTLE_MS) doSave()
          else scheduled = false
        })
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') doSave()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // Deliberately empty — the ref-backed callbacks keep the listeners
    // stable across re-renders that only change getAnchor/findAnchor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Restoration path: only fires when the destination page mounts with
  // a valid history-return marker for our current pathname.
  useEffect(() => {
    if (!ready) return
    if (restoredRef.current) return
    if (typeof window === 'undefined') return

    // Read the pathname from location so the pathname key matches what
    // the popstate / smart-back handler wrote.
    const pathname = window.location.pathname
    const isReturn = consumeHistoryReturn(pathname)
    if (!isReturn) return

    const payload = loadPayload(currentKeyRef.current)
    if (!payload) return

    restoredRef.current = true

    // Two rAF beats let React commit + browser paint, then run the
    // absolute-scroll attempt. A tiny bounded retry follows so images
    // loading a few frames later can be refined against.
    let attempts = 0
    const maxAttempts = 3

    const performScroll = () => {
      attempts++
      let targetY = payload.y

      if (payload.anchor && findAnchorRef.current) {
        const el = findAnchorRef.current(payload.anchor)
        if (el && el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect()
          const anchorTopAbs = rect.top + window.scrollY
          const offset = payload.anchorOffsetY ?? 0
          // The anchor's viewport-relative top at save time was
          // (-anchorOffsetY). Re-establishing that relationship:
          targetY = anchorTopAbs + offset
        }
      }

      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      const clamped = Math.max(0, Math.min(targetY, maxY))
      window.scrollTo(0, clamped)

      if (attempts < maxAttempts) {
        window.setTimeout(() => window.requestAnimationFrame(performScroll), 60)
      }
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(performScroll))
  }, [ready])
}

/**
 * Synchronous save helper for click handlers that navigate away from
 * the current route. Called from Link onClick handlers so the scroll
 * position of the exact click moment is captured, even if the
 * throttled listener has not fired recently.
 */
export function saveScrollForRoute(
  routeKey: string,
  getAnchor?: (() => RouteAnchor | null) | null,
  findAnchor?: ((a: RouteAnchor) => Element | null) | null,
): void {
  const store = safeStore()
  if (!store) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const anchor = getAnchor ? (getAnchor() ?? undefined) : undefined
  let anchorOffsetY: number | undefined
  if (anchor && findAnchor) {
    const el = findAnchor(anchor)
    if (el && el instanceof HTMLElement) {
      const rect = el.getBoundingClientRect()
      // The current viewport-relative top of the anchor. Negated so
      // adding this to the anchor's absolute top at restore time
      // recreates the same viewport position.
      anchorOffsetY = -rect.top
    }
  }
  const payload: ScrollPayload = {
    y: window.scrollY,
    savedAt: Date.now(),
    docHeight: document.documentElement.scrollHeight,
    anchor,
    anchorOffsetY,
  }
  try {
    store.setItem(SCROLL_PREFIX + routeKey, JSON.stringify(payload))
  } catch {
    // no-op
  }
}

export const __TEST__ = { SCROLL_PREFIX, SCROLL_TTL_MS, SAVE_THROTTLE_MS }
