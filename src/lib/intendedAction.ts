// src/lib/intendedAction.ts
// A tiny client-side store for "the action the user was about to take
// before we sent them through login/signup".
//
// Storage: sessionStorage. This survives the same-tab OAuth redirect and
// magic-link callback flows that Supabase Auth uses. It does NOT survive
// magic links opened in a different tab or on a different device; in
// that case the user simply lands back on the original page and can
// click the action again.
//
// Only a small fixed set of action types is supported — adding a new
// type requires updating both this file and the replay site.

const STORAGE_KEY = 'pp_intended_action_v1'
const TTL_MS      = 30 * 60 * 1000 // 30 minutes; longer than a Supabase magic-link window.

export type IntendedAction =
  | { type: 'watchlist_add';   payload: { card_slug: string; card_name: string; set_name: string; image_url?: string | null; card_number?: string | null; raw_usd?: number | null; psa10_usd?: number | null } }
  | { type: 'card_show_star';  payload: { show_id: string } }

type StoredAction = IntendedAction & { ts: number }

function safeSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.sessionStorage
  } catch {
    return null
  }
}

export function setIntendedAction(a: IntendedAction): void {
  const store = safeSessionStorage()
  if (!store) return
  try {
    const payload: StoredAction = { ...a, ts: Date.now() }
    store.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch { /* quota or privacy mode — fail silent */ }
}

/**
 * Reads and CLEARS the intended action. Returns null if missing, parse
 * fails, or the entry is older than the TTL.
 */
export function consumeIntendedAction(): IntendedAction | null {
  const store = safeSessionStorage()
  if (!store) return null
  let raw: string | null = null
  try { raw = store.getItem(STORAGE_KEY) } catch { return null }
  if (!raw) return null
  try { store.removeItem(STORAGE_KEY) } catch { /* fine */ }
  let parsed: StoredAction
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > TTL_MS) return null
  if (parsed.type !== 'watchlist_add' && parsed.type !== 'card_show_star') return null
  if (!parsed.payload || typeof parsed.payload !== 'object') return null
  // Strip the ts field before returning.
  const { ts: _ts, ...rest } = parsed
  return rest as IntendedAction
}

/**
 * Reads without clearing — useful only when the caller wants to decide
 * whether to consume based on whether the action matches the current
 * context.
 */
export function peekIntendedAction(): IntendedAction | null {
  const store = safeSessionStorage()
  if (!store) return null
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredAction
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > TTL_MS) return null
    const { ts: _ts, ...rest } = parsed
    return rest as IntendedAction
  } catch {
    return null
  }
}

export function clearIntendedAction(): void {
  const store = safeSessionStorage()
  if (!store) return
  try { store.removeItem(STORAGE_KEY) } catch { /* fine */ }
}
