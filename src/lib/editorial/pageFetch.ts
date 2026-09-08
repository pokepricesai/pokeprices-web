// src/lib/editorial/pageFetch.ts
//
// EIC Block 5B — page through Supabase (PostgREST) results reliably.
//
// PostgREST silently caps every response at `db-max-rows` (Supabase's
// default on managed projects is 1,000) regardless of any `.limit()`
// passed by the client. Passing `.limit(200000)` is a lie: PostgREST
// still returns the first 1,000 rows and `Content-Range: 0-999/N`.
//
// This helper walks a query in explicit chunks using `.range(from, to)`
// so the caller ends up with every row the underlying query would
// have returned had the cap not been there. Uses a builder-factory
// pattern because a Supabase query builder cannot be mutated and
// re-executed cleanly after the first `.range()` call.
//
// Safe defaults:
//   * pageSize = 1000                — matches PostgREST's default cap
//   * hardMaxRows = 100_000          — safety valve so a runaway
//                                      Radar can never OOM the process
//   * maxPages    = 200              — belt-and-braces
//
// Both hardMaxRows and maxPages trigger an abort BEFORE the next
// range fetch; the caller sees whatever completed pages accumulated,
// plus a truthy `truncated` flag.

import 'server-only'

export type PagedResult<T> = { rows: T[]; pagesFetched: number; truncated: boolean }

export async function fetchAllPages<T>(
  builderFactory: () => any,
  opts: { pageSize?: number; hardMaxRows?: number; maxPages?: number } = {},
): Promise<PagedResult<T>> {
  const pageSize    = opts.pageSize    ?? 1000
  const hardMaxRows = opts.hardMaxRows ?? 100_000
  const maxPages    = opts.maxPages    ?? 200
  const rows: T[]   = []
  let pagesFetched  = 0
  let truncated     = false

  for (let p = 0; p < maxPages; p++) {
    const from = p * pageSize
    const to   = from + pageSize - 1
    const q    = builderFactory().range(from, to)
    const { data, error } = await q
    pagesFetched++
    if (error) throw new Error(`fetchAllPages: page ${p} failed — ${error.message}`)
    const batch = (data ?? []) as T[]
    if (batch.length === 0) break
    rows.push(...batch)
    if (batch.length < pageSize) break
    if (rows.length >= hardMaxRows) { truncated = true; break }
    if (p === maxPages - 1)         { truncated = true }
  }

  return { rows, pagesFetched, truncated }
}
