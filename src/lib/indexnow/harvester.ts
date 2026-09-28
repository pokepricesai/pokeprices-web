// src/lib/indexnow/harvester.ts
// ============================================================================
// Stage 6A — IndexNow queue producer.
//
// The DB triggers in migration 02 write one row per (source, entity, day)
// into public.seo_change_events. This harvester reads that stream, joins
// back to the source tables to reconstruct a canonical URL + content hash,
// and calls enqueueUrl(). The queue's own hash-dedupe means unchanged
// pages become no-ops here.
//
// Related-page invalidation
//   When a batch of card change events all belong to "Chaos Rising", the
//   harvester enqueues the /set/Chaos Rising URL ONCE — not 500 times.
//   Same for Pokémon aggregate pages. Aggregates go in at priority 2
//   (routine), never above the events that drove them.
//
// Non-invasive
//   The harvester never reads seo_indexnow_queue directly. It only calls
//   enqueueUrl(), which is idempotent on (url, contentHash). Two concurrent
//   harvester runs will step on each other harmlessly.
// ============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { enqueueUrl, type EnqueueInput, type PageFamily, type Priority, type EnqueueReason } from './queue'
import { hashCardSignature, hashInsightSignature, hashGenericSignature } from './hash'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as submitter from './submitter.mjs'

const { CANONICAL_HOST } = submitter as { CANONICAL_HOST: string }

const SITE = `https://${CANONICAL_HOST}`

// Pokémon slug generation must match sitemap-pokemon.xml/route.ts.
function pokemonUrlSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type HarvesterTrigger = 'cron' | 'admin_manual' | 'test'

export type HarvesterResult = {
  started_at:              string
  finished_at:             string
  duration_ms:             number
  status:                  'ok' | 'skipped' | 'partial' | 'error'
  reason:                  string
  events_read:             number
  events_marked_processed: number
  card_enqueue_attempted:  number
  card_enqueue_inserted:   number
  card_enqueue_updated:    number
  card_enqueue_unchanged:  number
  set_enqueue_attempted:   number
  pokemon_enqueue_attempted: number
  editorial_enqueue_attempted: number
  directory_enqueue_attempted: number
  deletion_enqueue_attempted:  number
  errors:                  string[]
}

export type RunHarvesterOptions = {
  trigger:        HarvesterTrigger
  eventsPerRun?:  number
  enqueueAggregates?: boolean
  /** Injected client for tests. */
  client?:        SupabaseClient
}

export async function runIndexnowHarvester(opts: RunHarvesterOptions): Promise<HarvesterResult> {
  const startedAt  = Date.now()
  const startedIso = new Date(startedAt).toISOString()
  const eventsPerRun     = opts.eventsPerRun     ?? 2000
  const enqueueAggregates = opts.enqueueAggregates ?? true
  const supa = opts.client ?? getSupabaseServiceClient()

  const base: HarvesterResult = {
    started_at: startedIso, finished_at: startedIso, duration_ms: 0,
    status: 'ok', reason: 'noop',
    events_read: 0, events_marked_processed: 0,
    card_enqueue_attempted: 0, card_enqueue_inserted: 0,
    card_enqueue_updated:   0, card_enqueue_unchanged: 0,
    set_enqueue_attempted: 0, pokemon_enqueue_attempted: 0,
    editorial_enqueue_attempted: 0, directory_enqueue_attempted: 0,
    deletion_enqueue_attempted: 0,
    errors: [],
  }

  // ── 1. Read unprocessed events ─────────────────────────────────────
  const { data: eventsData, error: readErr } = await supa
    .from('seo_change_events')
    .select('id, event_source, entity_key, event_kind, observed_at, detail')
    .is('processed_at', null)
    .order('observed_at', { ascending: true })
    .limit(eventsPerRun)

  if (readErr) {
    return finalise({ ...base, status: 'error', reason: 'read_events_failed', errors: [readErr.message] }, startedAt)
  }
  const events = (eventsData ?? []) as Array<RawEvent>
  base.events_read = events.length
  if (events.length === 0) {
    // Even a no-event run gets a chance to cleanup old processed rows.
    await runCleanup(supa, base)
    return finalise({ ...base, reason: 'no_events' }, startedAt)
  }

  // ── 2. Split into two buckets ──────────────────────────────────────
  //   a) "OLD URL" events — kind=deleted with detail carrying enough info
  //      to reconstruct a canonical URL WITHOUT hitting the source table.
  //      These enqueue directly at priority 0.
  //   b) "CURRENT" events — kind=created / updated. These go through the
  //      normal source-join path below.
  //
  // A single card slug can have BOTH kinds in the same batch (e.g. a slug
  // rename produces deleted{old_url} + updated{current}). We handle both.
  const oldUrlEvents:  RawEvent[] = []
  const currentEvents: RawEvent[] = []
  for (const e of events) {
    if (e.event_kind === 'deleted' && hasReconstructableUrl(e)) oldUrlEvents.push(e)
    else                                                        currentEvents.push(e)
  }

  // ── 3. Enqueue OLD URL events first (P0 canonical-change / deletion) ──
  for (const e of oldUrlEvents) {
    const url = urlFromDetail(e)
    if (!url) continue
    const reason: EnqueueReason = detailReason(e) === 'canonical_change' ? 'canonical_change' : 'deleted'
    base.deletion_enqueue_attempted++
    const r = await enqueueUrl({
      url,
      contentHash: hashGenericSignature(e.event_source, {
        entity_key: e.entity_key, kind: 'deleted',
        reason, day: dayStamp(),
      }),
      pageFamily:  pageFamilyForSource(e.event_source),
      entityId:    e.entity_key,
      priority:    0,
      reason,
    }, supa)
    if (!r.ok) base.errors.push(`old-url enqueue ${url}: ${(r as { reason?: string }).reason}`)
  }

  // ── 4. Group CURRENT events by (source, entity_key) → newest per key ──
  const groups = new Map<string, RawEvent>()
  for (const e of currentEvents) {
    const k = `${e.event_source}\t${e.entity_key}`
    const prev = groups.get(k)
    if (!prev || e.observed_at > prev.observed_at) groups.set(k, e)
  }

  const cardEntities:    Array<{ key: string; kind: string }> = []
  const insightEntities: Array<{ key: string; kind: string }> = []
  const setEntities:     Array<{ key: string; kind: string }> = []
  const pokemonEntities: Array<{ key: string; kind: string }> = []
  const creatorEntities: Array<{ key: string; kind: string }> = []
  const vendorEntities:  Array<{ key: string; kind: string }> = []
  for (const e of Array.from(groups.values())) {
    const item = { key: e.entity_key, kind: e.event_kind }
    if (e.event_source === 'daily_prices' || e.event_source === 'cards') cardEntities.push(item)
    else if (e.event_source === 'insights')        insightEntities.push(item)
    else if (e.event_source === 'set_metadata')    setEntities.push(item)
    else if (e.event_source === 'pokemon_species') pokemonEntities.push(item)
    else if (e.event_source === 'creators')        creatorEntities.push(item)
    else if (e.event_source === 'vendors')         vendorEntities.push(item)
  }

  // ── 4. Process cards (with aggregate collection) ───────────────────
  const setsFromCardChanges     = new Set<string>()
  const pokemonFromCardChanges  = new Set<string>()

  if (cardEntities.length > 0) {
    // Dedupe by card_slug (a card can appear in both cards and daily_prices
    // events). "kind" here is never 'deleted' — those are handled up-front
    // in step 3 using detail.set_name + detail.card_url_slug.
    const slugSet = new Map<string, string>()  // slug → most-recent kind
    for (const c of cardEntities) slugSet.set(c.key, c.kind)

    const slugs = Array.from(slugSet.keys())

    // Fetch cards + latest price row per card. We do this in chunks so we
    // stay under PostgREST 1000-row response caps.
    const cardRowsBySlug = new Map<string, CardHydration>()
    const chunkSize = 200
    for (let i = 0; i < slugs.length; i += chunkSize) {
      const chunk = slugs.slice(i, i + chunkSize)
      const { data: cardRows, error } = await supa
        .from('cards')
        .select('card_slug, card_url_slug, card_name, set_name, card_number_display, card_number, set_printed_total, image_url, primary_pokemon_slug, language')
        .in('card_slug', chunk)
      if (error) { base.errors.push(`cards fetch: ${error.message}`); continue }

      for (const row of (cardRows ?? []) as CardRow[]) {
        cardRowsBySlug.set(row.card_slug, { card: row, prices: null })
      }

      // Now fetch latest daily_prices for these cards.
      const pcSlugs = chunk.map(s => `pc-${s}`)
      const { data: priceRows } = await supa
        .from('daily_prices')
        .select('card_slug, date, raw_usd, psa9_usd, psa10_usd')
        .in('card_slug', pcSlugs)
        .order('date', { ascending: false })
      if (priceRows) {
        const seen = new Set<string>()
        for (const p of priceRows as PriceRow[]) {
          const bare = p.card_slug.startsWith('pc-') ? p.card_slug.slice(3) : p.card_slug
          if (seen.has(bare)) continue          // keep only newest date per card
          seen.add(bare)
          const rec = cardRowsBySlug.get(bare)
          if (rec) rec.prices = p
        }
      }
    }

    // Now enqueue per card.
    for (const slug of slugs) {
      const rec = cardRowsBySlug.get(slug)
      if (!rec) {
        // Card no longer exists in cards table — treat as deletion.
        // We don't know the URL, so nothing to submit. Just mark event processed.
        continue
      }
      const card = rec.card
      if (!card.card_url_slug || !card.set_name) continue

      const kind = slugSet.get(slug) ?? 'updated'
      const priority: Priority = kind === 'created' ? 0 : 2
      const reason: EnqueueReason = kind === 'created' ? 'created' : 'price_change'
      const url = buildCardUrl(card.set_name, card.card_url_slug)
      const contentHash = hashCardSignature({
        card_slug:            card.card_slug,
        card_url_slug:        card.card_url_slug,
        card_name:            card.card_name ?? null,
        set_name:             card.set_name ?? null,
        card_number_display:  card.card_number_display ?? null,
        headline_price_cents: rec.prices?.psa10_usd ?? rec.prices?.raw_usd ?? null,
        psa10_price_cents:    rec.prices?.psa10_usd ?? null,
        psa9_price_cents:     rec.prices?.psa9_usd  ?? null,
        raw_price_cents:      rec.prices?.raw_usd   ?? null,
        image_url:            card.image_url ?? null,
      })

      base.card_enqueue_attempted++
      const r = await enqueueUrl({
        url,
        contentHash,
        pageFamily:  'card',
        entityId:    card.card_slug,
        priority,
        reason,
      }, supa)
      if (r.ok === true) {
        if ((r as { action?: string }).action === 'inserted')  base.card_enqueue_inserted++
        if ((r as { action?: string }).action === 'updated')   base.card_enqueue_updated++
        if ((r as { action?: string }).action === 'unchanged') base.card_enqueue_unchanged++
      } else {
        base.errors.push(`card enqueue ${slug}: ${(r as { reason?: string }).reason}`)
      }

      if (card.set_name) setsFromCardChanges.add(card.set_name)
      if (card.primary_pokemon_slug) pokemonFromCardChanges.add(card.primary_pokemon_slug)
    }
  }

  // ── 5. Aggregate URLs from cards ──────────────────────────────────
  if (enqueueAggregates) {
    // Merge set_metadata events with sets touched by card changes.
    const setKeys = new Set<string>(setsFromCardChanges)
    for (const s of setEntities) setKeys.add(s.key)
    for (const setName of Array.from(setKeys)) {
      const url = `${SITE}/set/${encodeURIComponent(setName)}`
      const hash = hashGenericSignature('set', { name: setName, touched_at_day: dayStamp() })
      base.set_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hash, pageFamily: 'set',
        entityId: setName, priority: 2, reason: 'metadata_change',
      }, supa)
    }

    // Pokémon: merge species events with pokemon touched via card changes.
    const pokeKeys = new Set<string>(pokemonFromCardChanges)
    for (const p of pokemonEntities) pokeKeys.add(p.key)
    for (const speciesName of Array.from(pokeKeys)) {
      const slug = pokemonUrlSlug(speciesName)
      if (!slug) continue
      const url = `${SITE}/pokemon/${slug}`
      const hash = hashGenericSignature('pokemon', { name: slug, touched_at_day: dayStamp() })
      base.pokemon_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hash, pageFamily: 'pokemon',
        entityId: slug, priority: 2, reason: 'metadata_change',
      }, supa)
    }
  } else {
    // Even without aggregation, we still enqueue direct set/pokemon events.
    for (const s of setEntities) {
      const url = `${SITE}/set/${encodeURIComponent(s.key)}`
      const hash = hashGenericSignature('set', { name: s.key, touched_at_day: dayStamp() })
      base.set_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hash, pageFamily: 'set',
        entityId: s.key, priority: 2, reason: 'metadata_change',
      }, supa)
    }
    for (const p of pokemonEntities) {
      const slug = pokemonUrlSlug(p.key)
      if (!slug) continue
      const url = `${SITE}/pokemon/${slug}`
      const hash = hashGenericSignature('pokemon', { name: slug, touched_at_day: dayStamp() })
      base.pokemon_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hash, pageFamily: 'pokemon',
        entityId: slug, priority: 2, reason: 'metadata_change',
      }, supa)
    }
  }

  // ── 6. Editorial (insights) ────────────────────────────────────────
  if (insightEntities.length > 0) {
    const slugs = insightEntities.map(e => e.key)
    const { data: rows, error } = await supa
      .from('insights')
      .select('slug, headline, intro, meta_title, meta_description, status, published_at, body_json')
      .in('slug', slugs)
    if (error) { base.errors.push(`insights fetch: ${error.message}`) }
    const bySlug = new Map<string, InsightRow>()
    for (const r of (rows ?? []) as InsightRow[]) bySlug.set(r.slug, r)

    for (const ie of insightEntities) {
      const kind = ie.kind
      // Deletes are handled up-front (step 3) via detail.slug. The current
      // block only handles created / updated events.
      const row = bySlug.get(ie.key)
      if (!row || row.status !== 'published') continue
      const url = `${SITE}/insights/${row.slug}`
      const hash = hashInsightSignature({
        slug:             row.slug,
        headline:         row.headline ?? null,
        intro:            row.intro ?? null,
        meta_title:       row.meta_title ?? null,
        meta_description: row.meta_description ?? null,
        status:           row.status ?? null,
        published_at:     row.published_at ?? null,
        body_hash:        row.body_json ? hashGenericSignature('insight-body', row.body_json as Record<string, unknown>) : null,
      })
      base.editorial_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hash, pageFamily: 'insight', entityId: row.slug,
        priority: 0, reason: kind === 'created' ? 'created' : 'updated',
      }, supa)
    }
  }

  // ── 7. Creators + vendors (small volume, simple path) ──────────────
  await processDirectory(supa, creatorEntities, 'creator', 'creators', base)
  await processDirectory(supa, vendorEntities,  'vendor',  'vendors',  base)

  // ── 8. Mark events processed ───────────────────────────────────────
  const allIds = events.map(e => e.id)
  if (allIds.length > 0) {
    const chunkSize = 500
    for (let i = 0; i < allIds.length; i += chunkSize) {
      const chunk = allIds.slice(i, i + chunkSize)
      const { data, error } = await supa
        .from('seo_change_events')
        .update({ processed_at: new Date().toISOString() })
        .in('id', chunk)
        .select('id')
      if (error) { base.errors.push(`mark processed chunk: ${error.message}`); continue }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      base.events_marked_processed += ((data as any[] | null) ?? []).length
    }
  }

  // ── 9. Bounded retention cleanup ───────────────────────────────────
  //
  // Runs at the end of every successful harvester tick. Never touches
  // unprocessed events (see seo_change_events_cleanup SQL function). At
  // 60k events/day and ~30 day retention, steady-state row count is
  // approximately 1.8M — well within Postgres capacity, and the
  // per-tick DELETE is capped at 5,000 rows to prevent long transactions.
  await runCleanup(supa, base)

  const finalStatus: HarvesterResult['status'] =
    base.errors.length === 0 ? 'ok' :
    (base.events_marked_processed > 0 ? 'partial' : 'error')

  return finalise({ ...base, status: finalStatus, reason: finalStatus === 'ok' ? 'drained' : 'partial_or_failure' }, startedAt)
}

// ── new helper types + functions for old-URL handling and cleanup ─────────

type RawEvent = {
  id:           number
  event_source: string
  entity_key:   string
  event_kind:   string
  observed_at:  string
  detail:       Record<string, unknown> | null
}

/** True when a deleted-kind event carries enough info in `detail` to
 *  reconstruct the OLD canonical URL WITHOUT joining the source table
 *  (which has usually dropped the row by the time we process). */
function hasReconstructableUrl(e: RawEvent): boolean {
  if (!e.detail || typeof e.detail !== 'object') return false
  const d = e.detail as Record<string, unknown>
  if (typeof d.url === 'string' && d.url.length > 0) return true
  switch (e.event_source) {
    case 'cards':
      return typeof d.set_name === 'string' && typeof d.card_url_slug === 'string'
    case 'insights':
    case 'creators':
    case 'vendors':
      return typeof d.slug === 'string' && d.slug.length > 0
    case 'set_metadata':
      return typeof d.set_name === 'string' && d.set_name.length > 0
    case 'pokemon_species':
      return typeof d.name === 'string' && d.name.length > 0
  }
  return false
}

/** Reconstruct the canonical URL for an old-URL event from its detail. */
function urlFromDetail(e: RawEvent): string | null {
  if (!e.detail) return null
  const d = e.detail as Record<string, unknown>
  if (typeof d.url === 'string' && d.url.length > 0) return d.url
  switch (e.event_source) {
    case 'cards':
      return `${SITE}/set/${encodeURIComponent(String(d.set_name))}/card/${String(d.card_url_slug)}`
    case 'insights':
      return `${SITE}/insights/${String(d.slug)}`
    case 'creators':
      return `${SITE}/creators/${encodeURIComponent(String(d.slug))}`
    case 'vendors':
      return `${SITE}/vendors/${encodeURIComponent(String(d.slug))}`
    case 'set_metadata':
      return `${SITE}/set/${encodeURIComponent(String(d.set_name))}`
    case 'pokemon_species':
      return `${SITE}/pokemon/${pokemonUrlSlug(String(d.name))}`
  }
  return null
}

function detailReason(e: RawEvent): string {
  if (!e.detail || typeof e.detail !== 'object') return 'unknown'
  const d = e.detail as Record<string, unknown>
  return typeof d.reason === 'string' ? d.reason : 'unknown'
}

function pageFamilyForSource(source: string): PageFamily {
  switch (source) {
    case 'daily_prices':
    case 'cards':           return 'card'
    case 'set_metadata':    return 'set'
    case 'pokemon_species': return 'pokemon'
    case 'insights':        return 'insight'
    case 'creators':        return 'creator'
    case 'vendors':         return 'vendor'
    default:                return 'other'
  }
}

async function runCleanup(supa: SupabaseClient, base: HarvesterResult): Promise<void> {
  try {
    // Prefer the DB function (bounded, guarded against absurd retention).
    // Falls back to a direct DELETE if the RPC surface isn't available.
    const rpc = await supa.rpc('seo_change_events_cleanup', {
      p_older_than_days: 30,
      p_batch_limit:     5000,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(rpc as any).error) return
    // Fallback path — direct DELETE with the same predicate. Bounded via
    // a subquery LIMIT so we don't wedge the harvester on a huge backlog.
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data: victims } = await supa
      .from('seo_change_events')
      .select('id')
      .not('processed_at', 'is', null)
      .lte('processed_at', cutoff)
      .order('processed_at', { ascending: true })
      .limit(5000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ids = ((victims as any[] | null) ?? []).map(r => r.id as number)
    if (ids.length === 0) return
    await supa.from('seo_change_events').delete().in('id', ids)
  } catch (e) {
    base.errors.push(`cleanup: ${e instanceof Error ? e.message : 'unknown'}`)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

type CardRow = {
  card_slug:            string
  card_url_slug:        string | null
  card_name:            string | null
  set_name:             string | null
  card_number_display:  string | null
  card_number:          string | null
  set_printed_total:    string | null
  image_url:            string | null
  primary_pokemon_slug: string | null
  language:             string | null
}
type PriceRow = {
  card_slug:  string
  date:       string
  raw_usd:    number | null
  psa9_usd:   number | null
  psa10_usd:  number | null
}
type CardHydration = {
  card:   CardRow
  prices: PriceRow | null
}
type InsightRow = {
  slug:             string
  headline:         string | null
  intro:            string | null
  meta_title:       string | null
  meta_description: string | null
  status:           string | null
  published_at:     string | null
  body_json:        unknown
}

function buildCardUrl(setName: string, cardUrlSlug: string): string {
  return `${SITE}/set/${encodeURIComponent(setName)}/card/${cardUrlSlug}`
}

function dayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

async function processDirectory(
  supa: SupabaseClient,
  entities: Array<{ key: string; kind: string }>,
  family: PageFamily,
  table: string,
  base: HarvesterResult,
): Promise<void> {
  if (entities.length === 0) return
  const slugs = entities.map(e => e.key)
  const { data, error } = await supa
    .from(table)
    .select('slug, name, description, image_url, country, ' + (family === 'vendor' ? 'active' : 'status'))
    .in('slug', slugs)
  if (error) { base.errors.push(`${table} fetch: ${error.message}`); return }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bySlug = new Map<string, any>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (data ?? []) as any[]) bySlug.set(r.slug, r)

  for (const e of entities) {
    const url = family === 'creator'
      ? `${SITE}/creators/${encodeURIComponent(e.key)}`
      : `${SITE}/vendors/${encodeURIComponent(e.key)}`
    if (e.kind === 'deleted') {
      base.deletion_enqueue_attempted++
      await enqueueUrl({
        url, contentHash: hashGenericSignature(family, { slug: e.key, deleted: true }),
        pageFamily: family, entityId: e.key,
        priority: 0, reason: 'deleted',
      }, supa)
      continue
    }
    const row = bySlug.get(e.key)
    if (!row) continue
    // Gate: creators need status='approved', vendors need active=true.
    if (family === 'creator' && row.status !== 'approved') continue
    if (family === 'vendor'  && row.active   !== true)     continue

    const hash = hashGenericSignature(family, {
      slug: e.key, name: row.name ?? '', desc: row.description ?? '',
      image: row.image_url ?? '', country: row.country ?? '',
    })
    base.directory_enqueue_attempted++
    await enqueueUrl({
      url, contentHash: hash, pageFamily: family, entityId: e.key,
      priority: 0, reason: e.kind === 'created' ? 'created' : 'updated',
    } as EnqueueInput, supa)
  }
}

function finalise(r: HarvesterResult, startedAt: number): HarvesterResult {
  const finishedAt = Date.now()
  return { ...r, finished_at: new Date(finishedAt).toISOString(), duration_ms: finishedAt - startedAt }
}
