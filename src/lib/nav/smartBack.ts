// src/lib/nav/smartBack.ts
//
// Block 5A-W-50E — smart back click handler for the two visible back
// controls (SetHeader "Browse all sets" and CardPageClient set
// breadcrumb).
//
// Block 5A-W-50E-FIX1 — deterministic navigation. Instead of calling
// router.back() (which is unsafe when the immediate previous history
// entry is NOT the marker origin — e.g. after browse -> set -> other
// page -> revisit same set), we always call router.replace with the
// exact stored origin URL. That guarantees we never navigate to an
// unrelated intermediate page. The destination's own scroll hook is
// primed via a history-return marker, and a pendingOutbound token is
// written so the destination's origin-marker validity check knows
// this arrival is a legitimate click-through.
//
// Native browser Back is untouched. The ordinary <Link href={fallback}>
// stays present for Ctrl+click / new-tab / assistive tech.

import type { MouseEvent } from 'react'
import { consumeOriginMarker, peekOriginMarker, type OriginMarker } from './originMarker'
import { markHistoryReturn } from './historyReturnMarker'
import { markPendingOutbound } from './pendingOutbound'

export interface SmartBackDecision {
  fromMarker: boolean
  destination: string
}

export interface SmartBackOptions {
  currentPathname: string
  fallbackUrl: string
  expectOriginPath: string | RegExp
}

function pathnameOfUrl(url: string): string {
  return url.split('#')[0].split('?')[0]
}

export function originMatches(fromUrl: string, expect: string | RegExp): boolean {
  const p = pathnameOfUrl(fromUrl)
  if (typeof expect === 'string') {
    return p === expect || p.startsWith(expect + '/') || p.startsWith(expect + '?')
  }
  return expect.test(p)
}

/** Pure decision: what would the smart-back do given the marker state
 *  right now? Used by tests and by the click handler. */
export function resolveSmartBack(opts: SmartBackOptions, marker?: OriginMarker | null): SmartBackDecision {
  const found = marker !== undefined ? marker : peekOriginMarker(opts.currentPathname)
  if (found && originMatches(found.fromUrl, opts.expectOriginPath)) {
    return { fromMarker: true, destination: found.fromUrl }
  }
  return { fromMarker: false, destination: opts.fallbackUrl }
}

export interface RouterLike {
  push: (url: string) => void
  replace: (url: string) => void
}

/** Build an onClick handler for a visible back button. Always uses a
 *  deterministic navigation method (router.replace when we can prove
 *  the destination via a valid marker; otherwise router.push to the
 *  canonical fallback). router.back() is never called from here —
 *  see Block 5A-W-50E-FIX1 for why. */
export function makeSmartBackHandler(
  router: RouterLike,
  opts: SmartBackOptions,
) {
  return (e: MouseEvent) => {
    // Preserve modifier-key behaviours (new tab, download, etc.).
    if (e.button !== 0) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

    e.preventDefault()

    // Always consume the marker so a stale one cannot be reused after
    // this click even if we choose the fallback branch below.
    const marker = consumeOriginMarker(opts.currentPathname)
    const decision = resolveSmartBack(opts, marker)

    if (decision.fromMarker) {
      // Marker matched -- navigate directly to the exact stored URL.
      // Prime restore + pending BEFORE the navigation so the
      // destination hook + validity check see them on mount.
      const destPath = pathnameOfUrl(decision.destination)
      markHistoryReturn(destPath)
      markPendingOutbound(decision.destination)
      // router.replace so we do not push a duplicate history entry
      // on top of the current page.
      router.replace(decision.destination)
      return
    }

    // Fallback path -- no marker, no priming. Destination will
    // clear its own origin marker on mount if any stale one exists.
    router.push(opts.fallbackUrl)
  }
}
