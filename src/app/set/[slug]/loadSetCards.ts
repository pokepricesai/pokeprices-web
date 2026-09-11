// Block 5A-W-58D.1 — pure retry helper for the primary set-cards RPC.
//
// Isolated from SetPageClient so the retry + stale-request behaviour
// can be unit-tested without mounting the component or hitting Supabase.
//
// The effect that calls this passes an `isLive` predicate; if the
// effect has been cancelled (deps changed, unmount) while a fetch is
// in flight or the retry delay is pending, the helper aborts silently
// and the caller does no state writes.

export type CardRpcResult = { data: unknown[] | null; error: unknown | null }

export type CardRpcFetcher = (
  setName: string,
  sort: string,
) => Promise<CardRpcResult>

export type IsLive = () => boolean

export type SleepFn = (ms: number) => Promise<void>

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms))

export type PrimaryCardsOutcome =
  | { status: 'success'; data: unknown[] }
  | { status: 'failed' }
  | { status: 'aborted' }

export const PRIMARY_RETRY_DELAY_MS = 500

/**
 * Attempt the primary set-cards RPC up to twice. Wait `retryDelayMs`
 * between attempts. Never retry a second time after a retry — one
 * retry only.
 *
 * The caller supplies `isLive`; the helper checks it after every
 * `await` point so that a superseded effect cannot advance to a
 * `setState` call in the caller. This is the load-bearing guard for
 * the "stale request overwrites fresh result" bug.
 */
export async function fetchPrimarySetCardsWithRetry(
  fetcher: CardRpcFetcher,
  setName: string,
  sort: string,
  isLive: IsLive,
  opts?: { retryDelayMs?: number; sleep?: SleepFn },
): Promise<PrimaryCardsOutcome> {
  const retryDelayMs = opts?.retryDelayMs ?? PRIMARY_RETRY_DELAY_MS
  const sleep = opts?.sleep ?? defaultSleep

  let res = await fetcher(setName, sort)
  if (!isLive()) return { status: 'aborted' }
  if (!res.error && res.data) return { status: 'success', data: res.data }

  await sleep(retryDelayMs)
  if (!isLive()) return { status: 'aborted' }

  res = await fetcher(setName, sort)
  if (!isLive()) return { status: 'aborted' }
  if (!res.error && res.data) return { status: 'success', data: res.data }

  return { status: 'failed' }
}
