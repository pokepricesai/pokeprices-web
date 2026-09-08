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

/** Batches large `.in()` filter calls into safe-sized URL requests.
 *
 *  PostgREST speaks over HTTP GET so a `.in('col', values)` with many
 *  thousands of values produces a URL that exceeds the ~8KB frontend
 *  limit — Supabase returns 414 Request-URI Too Large. This helper
 *  splits `values` into chunks and concatenates the returned rows.
 *
 *  The caller supplies a factory that produces a Supabase query
 *  builder for a single chunk — typically a builder that ends with
 *  `.in(column, chunk)`. Each chunk runs through fetchAllPages so
 *  large per-chunk row counts still page correctly. Chunks run
 *  serially by default (safe for the PostgREST connection pool);
 *  set `concurrent` > 1 for bounded parallelism when appropriate.
 *
 *  Chunk-size heuristic: at 500 items ~8 chars each we're roughly
 *  4KB of query string per request — comfortably below 8KB even
 *  with the rest of the URL. Tune down if columns are longer. */
export async function fetchInChunks<T>(
  values: readonly (string | number)[],
  builderFactory: (chunk: readonly (string | number)[]) => any,
  opts: { chunkSize?: number; concurrent?: number; pageSize?: number; hardMaxRows?: number } = {},
): Promise<T[]> {
  const chunkSize   = Math.max(1, opts.chunkSize   ?? 400)
  const concurrent  = Math.max(1, opts.concurrent  ?? 1)
  const uniqueVals  = Array.from(new Set(values))
  if (uniqueVals.length === 0) return []

  const chunks: Array<readonly (string | number)[]> = []
  for (let i = 0; i < uniqueVals.length; i += chunkSize) chunks.push(uniqueVals.slice(i, i + chunkSize))

  const out: T[] = []
  for (let i = 0; i < chunks.length; i += concurrent) {
    const batch = chunks.slice(i, i + concurrent)
    const results = await Promise.all(
      batch.map(chunk => fetchAllPages<T>(
        () => builderFactory(chunk),
        { pageSize: opts.pageSize, hardMaxRows: opts.hardMaxRows },
      )),
    )
    for (const r of results) out.push(...r.rows)
  }
  return out
}

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
