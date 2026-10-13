// src/app/api/card/[cardSlug]/extras/route.ts
//
// Phase 1 — card-page cost + performance consolidation.
//
// Replaces the five direct browser → Supabase requests that
// CardPageClient previously issued on every rendered card page view
// (get_card_metrics, get_card_price_history, get_card_insight,
// card_volume for the Ungraded grade, psa_population match). The
// browser now issues one same-origin fetch to this endpoint instead,
// and the Vercel edge caches the response per card for 24h.
//
// SECURITY
// ────────────────────────────────────────────────────────────────────
// Uses the SAME anon key the browser previously used. Row-level
// security evaluates identically. Do NOT swap to service role; a
// public-cached endpoint fronted by RLS gives the same semantics
// without widening the trust boundary.
//
// RESPONSE SHAPE
// ────────────────────────────────────────────────────────────────────
// Each of the five sources returns a discriminated chunk:
//   { status: 'ok' | 'error', data: <value> }
// A backend failure NEVER poses as a legitimate factual zero. The
// client's existing fallback code reads the data regardless of
// status, so a chunk marked 'error' naturally produces the same
// graceful UI it has today when a browser-side RPC errored.
//
// CACHE
// ────────────────────────────────────────────────────────────────────
//   Fully OK  → s-maxage=86400 (24h fresh) + SWR=604800 (7d).
//   Partial   → s-maxage=3600  (1h fresh)  + SWR=604800. A broken
//               RPC must not be re-hammered on every crawler visit,
//               but recovery must not wait a full day either.
//   Invalid   → no-store + 400. Random query strings cannot fan out
//               into unique CDN cache entries.
//   Total     → no-store + 500. All five chunks failed OR the handler
//               itself threw before issuing any call.
//
// CACHE KEY
// ────────────────────────────────────────────────────────────────────
// The resource identity is the CARD, not the viewer. Cache key is
// built from (cardSlug, setName, cardName, cardNumber, variant) with
// deterministic canonicalisation (whitespace trimmed, redundant
// characters stripped). No cookies, no auth, no currency, no
// user-agent, no cosmetic UI state. The handler itself is the sole
// place that controls the key — the browser passes the inputs the
// server page already resolved, but the handler validates + rebuilds
// them before any lookup, so a mis-cased or re-ordered query string
// cannot create a distinct cache entry.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

// ─── Request validation ─────────────────────────────────────────────

// cardSlug is the bare slug (no `pc-` prefix). We accept the two
// shapes the client might send — raw slug and 'pc-'-prefixed — and
// canonicalise both to a bare lower-case slug. Anything else is
// rejected to prevent cache fan-out.
const BARE_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const
const SUCCESS_CACHE_CONTROL =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800, must-revalidate'
const PARTIAL_CACHE_CONTROL =
  'public, max-age=0, s-maxage=3600, stale-while-revalidate=604800, must-revalidate'

type Chunk<T> = { status: 'ok'; data: T } | { status: 'error'; data: null }

type ExtrasResponse = {
  cardSlug: string
  metrics:      Chunk<unknown>
  priceHistory: Chunk<unknown[]>
  insight:      Chunk<string | null>
  volume:       Chunk<{ volume_label: string | null; sales_30d: number | null } | null>
  psaPop:       Chunk<Record<string, unknown> | null>
}

type Params = { cardSlug: string }

function canonicaliseSlug(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  const bare = trimmed.replace(/^pc-/, '')
  if (!BARE_SLUG_RE.test(bare)) return null
  return bare
}

// Set names and card names come from a verified card row the server
// page already resolved. We don't do any lookup validation here — we
// just normalise whitespace + strip a known cosmetic prefix so two
// visits to the same card never produce two distinct cache entries.
function canonicaliseInput(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

// ─── Handler ────────────────────────────────────────────────────────

export async function GET(
  req: Request,
  context: { params: Promise<Params> },
): Promise<NextResponse> {
  const { cardSlug: rawSlug } = await context.params
  const bareSlug = canonicaliseSlug(rawSlug)
  if (!bareSlug) {
    return NextResponse.json(
      { error: 'invalid cardSlug' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  // The slug the five queries key off is the bare slug; the SetPage
  // and other callers always pass this shape. (Historical note:
  // daily_prices uses `pc-` prefix but the RPCs on the card page do
  // not. Mirroring the exact client semantics we had before.)
  const slug = bareSlug

  const url = new URL(req.url)
  const setName = url.searchParams.get('setName')
  const cardName = url.searchParams.get('cardName')
  const cardNumberRaw = url.searchParams.get('cardNumber')
  const variantRaw = url.searchParams.get('variant')

  if (!setName || !cardName) {
    return NextResponse.json(
      { error: 'missing setName or cardName' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const canonSetName = canonicaliseInput(setName)
  const canonCardName = canonicaliseInput(cardName)
  const canonCardNumber = cardNumberRaw ? canonicaliseInput(cardNumberRaw) : null
  const canonVariant = variantRaw ? canonicaliseInput(variantRaw) : null

  // Defence in depth: reject empty-after-trim inputs so no card ever
  // dead-ends in a wide-open ilike match.
  if (!canonSetName || !canonCardName) {
    return NextResponse.json(
      { error: 'empty setName or cardName' },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnon) {
    // Treat as total infrastructure failure. The client's existing
    // fallback paths render a usable page without extras data.
    return NextResponse.json(
      { error: 'supabase env missing' },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Build the PSA population query up-front so it fans out alongside
  // the other four. psa_population set_name uses "Pokemon <SetName>"
  // for many sets; the browser query stripped that prefix client-side
  // before matching. We preserve that semantic exactly.
  const setNameClean = canonSetName.replace(/^Pokemon /, '')
  let popQuery = supabase
    .from('psa_population')
    .select('card_name, variant, set_name, card_number, psa_7, psa_8, psa_9, psa_10, total_graded, gem_rate')
    .ilike('card_name', `%${canonCardName}%`)
    .ilike('set_name', `%${setNameClean}%`)
    .gt('total_graded', 0)
  if (canonVariant) {
    popQuery = popQuery.ilike('variant', `%${canonVariant}%`)
  } else if (canonCardNumber) {
    popQuery = popQuery.eq('card_number', canonCardNumber)
  }
  const popPromise = popQuery.order('total_graded', { ascending: false }).limit(1)

  // Promise.allSettled on the five sources so one failure cannot
  // destroy the other four. Each source is independently classified
  // into {ok, error} using the (data, error) PostgREST convention.
  const results = await Promise.allSettled([
    supabase.rpc('get_card_metrics',       { card_slug: slug }),
    supabase.rpc('get_card_price_history', { slug }),
    supabase.rpc('get_card_insight',       { slug }),
    supabase
      .from('card_volume')
      .select('volume_label, sales_30d')
      .eq('card_slug', slug)
      .eq('grade', 'Ungraded')
      .maybeSingle(),
    popPromise,
  ])

  const metrics      = classifyRpc<unknown>(results[0])
  const priceHistory = classifyRpc<unknown[]>(results[1], { defaultOk: [] })
  const insight      = classifyRpc<string | null>(results[2], { defaultOk: null })
  const volume       = classifyRpc<{ volume_label: string | null; sales_30d: number | null } | null>(results[3], { defaultOk: null })
  const psaPopList   = classifyRpc<Record<string, unknown>[]>(results[4], { defaultOk: [] })

  // psa_population returns an array; the client previously consumed
  // only the first element. We mirror that: ok with the first row
  // (or null if the list was empty), error passthrough otherwise.
  const psaPop: Chunk<Record<string, unknown> | null> =
    psaPopList.status === 'ok'
      ? { status: 'ok', data: (psaPopList.data?.[0] ?? null) }
      : { status: 'error', data: null }

  const chunks: ExtrasResponse = {
    cardSlug: bareSlug,
    metrics,
    priceHistory,
    insight,
    volume,
    psaPop,
  }

  const errorCount =
    (metrics.status === 'error' ? 1 : 0) +
    (priceHistory.status === 'error' ? 1 : 0) +
    (insight.status === 'error' ? 1 : 0) +
    (volume.status === 'error' ? 1 : 0) +
    (psaPop.status === 'error' ? 1 : 0)

  // Total backend failure — every chunk errored. The response carries
  // no useful data; return 500 + no-store so the CDN never pins this
  // and the client's existing fallback renders the page unadorned.
  if (errorCount === 5) {
    return NextResponse.json(
      chunks,
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }

  const cacheControl = errorCount === 0 ? SUCCESS_CACHE_CONTROL : PARTIAL_CACHE_CONTROL

  return NextResponse.json(
    chunks,
    { status: 200, headers: { 'Cache-Control': cacheControl } },
  )
}

// ─── classifier ─────────────────────────────────────────────────────

type PostgrestLikeResult<T> = { data: T | null; error: { message?: string } | null }

/** Convert one PostgREST result (data + error OR a thrown promise)
 *  into our discriminated Chunk shape. A thrown promise and a
 *  non-null `error` both resolve to `{ status: 'error', data: null }`.
 *  A null `data` with no `error` is a LEGITIMATE factual zero — the
 *  chunk is `ok` with null (or `defaultOk` if the caller prefers an
 *  empty collection). This is the critical invariant that keeps the
 *  CDN from caching backend blips as confident emptiness. */
function classifyRpc<T>(
  settled: PromiseSettledResult<PostgrestLikeResult<T>>,
  opts: { defaultOk?: T } = {},
): Chunk<T> {
  if (settled.status === 'rejected') {
    return { status: 'error', data: null }
  }
  const r = settled.value
  if (r && r.error) {
    return { status: 'error', data: null }
  }
  const value = (r?.data ?? null) as T | null
  if (value === null && opts.defaultOk !== undefined) {
    return { status: 'ok', data: opts.defaultOk }
  }
  return { status: 'ok', data: value as T }
}
