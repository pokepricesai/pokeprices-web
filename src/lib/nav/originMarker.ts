// src/lib/nav/originMarker.ts
//
// Block 5A-W-50E — destination-scoped origin markers used by the
// smart-back visible controls.
//
// One marker per destination pathname. This is intentional so that
// browse -> set -> card writes TWO independent markers (one keyed by
// the set pathname, one by the card pathname) and returning card ->
// set consumes only the card marker while the set -> browse marker
// survives untouched for the subsequent back step.
//
// The marker payload records the exact originating URL so the smart
// back handler can restore the browse filters, search and sort that
// were live before the click. Only pathnames and query strings are
// stored — no user identity, no auth token, no card data.

const PREFIX = 'pokeprices:origin:v1:'
const TTL_MS = 30 * 60 * 1000

export type Expects = 'set' | 'card'

export interface OriginMarker {
  fromUrl: string
  destinationUrl: string
  expects: Expects
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

export function destinationKey(pathname: string): string {
  const cleaned = pathname.split('#')[0].split('?')[0]
  return PREFIX + cleaned
}

function pathnameOf(url: string): string | null {
  if (!url) return null
  if (url.startsWith('/')) return url.split('#')[0].split('?')[0]
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

export function setOriginMarker(input: Omit<OriginMarker, 'savedAt'>): void {
  const store = safeStore()
  if (!store) return
  const destPath = pathnameOf(input.destinationUrl)
  if (!destPath) return
  try {
    const payload: OriginMarker = { ...input, savedAt: Date.now() }
    store.setItem(destinationKey(destPath), JSON.stringify(payload))
  } catch {
    // quota exceeded or privacy mode — safely fail
  }
}

function parseAndValidate(raw: string): OriginMarker | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Partial<OriginMarker>
  if (typeof p.savedAt !== 'number') return null
  if (Date.now() - p.savedAt > TTL_MS) return null
  if (p.expects !== 'set' && p.expects !== 'card') return null
  if (typeof p.fromUrl !== 'string' || typeof p.destinationUrl !== 'string') return null
  return {
    fromUrl: p.fromUrl,
    destinationUrl: p.destinationUrl,
    expects: p.expects,
    savedAt: p.savedAt,
  }
}

export function peekOriginMarker(pathname: string): OriginMarker | null {
  const store = safeStore()
  if (!store) return null
  try {
    const raw = store.getItem(destinationKey(pathname))
    if (!raw) return null
    return parseAndValidate(raw)
  } catch {
    return null
  }
}

export function consumeOriginMarker(pathname: string): OriginMarker | null {
  const store = safeStore()
  if (!store) return null
  const key = destinationKey(pathname)
  let raw: string | null
  try {
    raw = store.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    store.removeItem(key)
  } catch {
    // no-op
  }
  return parseAndValidate(raw)
}

export const __TEST__ = { PREFIX, TTL_MS }
