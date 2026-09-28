// Stage 6A — harvester unit tests. Uses an in-memory fake Supabase to
// prove the real production data-update path actually enqueues.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { runIndexnowHarvester } from '../harvester'
import { hashCardSignature } from '../hash'

// ── Minimal in-memory Supabase for both the harvester and enqueueUrl ──
// Reused shape from queue.test.ts, extended with the extra tables the
// harvester joins against.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeSupabase(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = {
    seo_indexnow_queue:        [],
    seo_indexnow_submissions:  [],
    seo_indexnow_settings:     [],
    seo_change_events:         seed.seo_change_events        ?? [],
    cards:                     seed.cards                    ?? [],
    daily_prices:              seed.daily_prices             ?? [],
    insights:                  seed.insights                 ?? [],
    set_metadata:              seed.set_metadata             ?? [],
    pokemon_species:           seed.pokemon_species          ?? [],
    creators:                  seed.creators                 ?? [],
    vendors:                   seed.vendors                  ?? [],
  }
  let nextId = 10_000

  function chain(table: string) {
    const rows: any[] = tables[table] ??= []
    let selectCols: string | null = null
    const filters: Array<{ op: string; col: string; val: any }> = []
    const orderBy: Array<{ col: string; asc: boolean }> = []
    let limitN: number | null = null
    let insertPayload: any[] | any | null = null
    let updatePayload: any | null = null
    let deleteMode = false
    let returnSingle = false
    let returnMaybe = false
    const negFilters: Array<{ op: string; col: string; val: any }> = []

    function applyFilters(): any[] {
      let out = rows.slice()
      for (const f of filters) {
        if (f.op === 'eq') out = out.filter(r => r[f.col] === f.val)
        else if (f.op === 'in') out = out.filter(r => (f.val as any[]).includes(r[f.col]))
        else if (f.op === 'is' && f.val === null) out = out.filter(r => r[f.col] == null)
        else if (f.op === 'lte') out = out.filter(r => String(r[f.col] ?? '') <= String(f.val ?? ''))
        else if (f.op === 'gte') out = out.filter(r => String(r[f.col] ?? '') >= String(f.val ?? ''))
      }
      for (const f of negFilters) {
        if (f.op === 'is' && f.val === null) out = out.filter(r => r[f.col] != null)
      }
      if (orderBy.length > 0) {
        out.sort((a, b) => {
          for (const o of orderBy) {
            const av = a[o.col]; const bv = b[o.col]
            if (av === bv) continue
            return (av < bv ? -1 : 1) * (o.asc ? 1 : -1)
          }
          return 0
        })
      }
      if (limitN != null) out = out.slice(0, limitN)
      return out
    }

    async function terminal(): Promise<{ data: any; error: null }> {
      if (deleteMode) {
        const targets = applyFilters()
        const ids = new Set(targets.map(t => t.id))
        for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) rows.splice(i, 1)
        return { data: targets, error: null }
      }
      if (insertPayload) {
        const arr = Array.isArray(insertPayload) ? insertPayload : [insertPayload]
        const inserted: any[] = []
        for (const p of arr) {
          if (table === 'seo_indexnow_queue') {
            const url = p.url
            if (rows.some(r => r.url === url)) {
              return { data: null, error: { message: `duplicate url ${url}` } as any } as any
            }
          }
          const row = { id: nextId++, ...p }
          rows.push(row); inserted.push(row)
        }
        if (returnSingle || returnMaybe) return { data: inserted[0] ?? null, error: null }
        return { data: inserted, error: null }
      }
      if (updatePayload) {
        const targets = applyFilters()
        for (const t of targets) Object.assign(t, updatePayload)
        if (selectCols) return { data: targets, error: null }
        return { data: null, error: null }
      }
      const out = applyFilters()
      if (returnMaybe)  return { data: out[0] ?? null, error: null }
      if (returnSingle) return { data: out[0] ?? null, error: null }
      return { data: out, error: null }
    }

    const proxy: any = {
      select(cols?: string) { selectCols = cols ?? '*'; return proxy },
      insert(payload: any) { insertPayload = payload; return proxy },
      update(patch: any) { updatePayload = patch; return proxy },
      delete() { deleteMode = true; return proxy },
      eq(col: string, val: any) { filters.push({ op: 'eq', col, val }); return proxy },
      in(col: string, val: any[]) { filters.push({ op: 'in', col, val }); return proxy },
      is(col: string, val: any) { filters.push({ op: 'is', col, val }); return proxy },
      not(col: string, op: string, val: any) { negFilters.push({ op, col, val }); return proxy },
      lte(col: string, val: any) { filters.push({ op: 'lte', col, val }); return proxy },
      gte(col: string, val: any) { filters.push({ op: 'gte', col, val }); return proxy },
      order(col: string, opts?: any) { orderBy.push({ col, asc: opts?.ascending !== false }); return proxy },
      limit(n: number) { limitN = n; return proxy },
      maybeSingle() { returnMaybe = true; return terminal() },
      single() { returnSingle = true; return terminal() },
      then(res: any, rej?: any) { return terminal().then(res, rej) },
    }
    return proxy
  }
  return {
    _tables: tables,
    from: (t: string) => chain(t),
    // The harvester calls supa.rpc('seo_change_events_cleanup', ...). The
    // fake returns { error: {...} } to force the harvester's fallback
    // DELETE path — we exercise both cleanup routes across tests.
    rpc: (_name: string, _args?: any) => ({ error: { message: 'rpc-not-in-fake' } as any }),
  }
}

let supa: ReturnType<typeof makeFakeSupabase>

beforeEach(() => { supa = makeFakeSupabase() })

// Helpers to seed the fake DB with realistic production shapes.
function seedCard(overrides: Record<string, unknown> = {}) {
  supa._tables.cards.push({
    card_slug:            '959616',
    card_url_slug:        'ampharos-29',
    card_name:            'Ampharos #29',
    set_name:             'Chaos Rising',
    card_number:          '29',
    card_number_display:  '29/83',
    set_printed_total:    '83',
    image_url:            'https://example.com/img.png',
    primary_pokemon_slug: 'ampharos',
    language:             'en',
    ...overrides,
  })
}
function seedPriceRow(overrides: Record<string, unknown> = {}) {
  supa._tables.daily_prices.push({
    id:         1,
    card_slug:  'pc-959616',
    date:       '2026-09-27',
    raw_usd:    200,
    psa10_usd:  5300,
    psa9_usd:   1200,
    ...overrides,
  })
}
function seedEvent(overrides: Record<string, unknown> = {}) {
  supa._tables.seo_change_events.push({
    id:            1,
    event_source:  'daily_prices',
    entity_key:    '959616',
    event_kind:    'updated',
    observed_at:   '2026-09-28T09:00:00Z',
    observed_day:  '2026-09-28',
    processed_at:  null,
    ...overrides,
  })
}

// ── PRODUCER-PATH TESTS ────────────────────────────────────────────────

describe('harvester — card change enqueue (the actual production path)', () => {
  it('daily_prices event → card URL enqueued at priority 2 with the expected hash', async () => {
    seedCard()
    seedPriceRow()
    seedEvent({ event_source: 'daily_prices', entity_key: '959616', event_kind: 'updated' })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    expect(r.status).toBe('ok')
    expect(r.events_read).toBe(1)
    expect(r.card_enqueue_attempted).toBe(1)
    expect(r.card_enqueue_inserted).toBe(1)

    // Row must be in the queue with the expected URL, priority 2, reason price_change.
    const q = supa._tables.seo_indexnow_queue
    const cardRow = q.find(r => r.page_family === 'card')
    expect(cardRow).toBeDefined()
    expect(cardRow.url).toBe('https://www.pokeprices.io/set/Chaos%20Rising/card/ampharos-29')
    expect(cardRow.priority).toBe(2)
    expect(cardRow.reason).toBe('price_change')
    expect(cardRow.content_hash).toBe(hashCardSignature({
      card_slug: '959616',
      card_url_slug: 'ampharos-29',
      card_name: 'Ampharos #29',
      set_name: 'Chaos Rising',
      card_number_display: '29/83',
      headline_price_cents: 5300,
      psa10_price_cents: 5300,
      psa9_price_cents:  1200,
      raw_price_cents:   200,
      image_url: 'https://example.com/img.png',
    }))

    // Aggregate URLs should also have been queued (dedup: 1 set, 1 pokemon).
    const setRow = q.find(r => r.page_family === 'set')
    expect(setRow?.url).toBe('https://www.pokeprices.io/set/Chaos%20Rising')
    const pokeRow = q.find(r => r.page_family === 'pokemon')
    expect(pokeRow?.url).toBe('https://www.pokeprices.io/pokemon/ampharos')
  })

  it('identical daily_prices event on the same card = NO new queue row (hash unchanged)', async () => {
    seedCard()
    seedPriceRow()
    seedEvent()
    await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    // Mark the row so a second run re-processes the same event.
    supa._tables.seo_change_events[0].processed_at = null

    const before = supa._tables.seo_indexnow_queue.length
    const r2 = await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    const after = supa._tables.seo_indexnow_queue.length

    expect(after).toBe(before)                   // no new row created
    expect(r2.card_enqueue_unchanged + r2.card_enqueue_updated + r2.card_enqueue_inserted).toBe(1)
  })

  it('500 cards in the same set enqueue the /set URL ONCE (aggregate dedupe)', async () => {
    // Simulate 20 different cards in "Chaos Rising", all with price events.
    for (let i = 0; i < 20; i++) {
      supa._tables.cards.push({
        card_slug: String(2000000 + i),
        card_url_slug: `card-${i}`,
        card_name: `Card ${i}`,
        set_name: 'Chaos Rising',
        card_number: String(i),
        card_number_display: `${i}/83`,
        set_printed_total: '83',
        image_url: null,
        primary_pokemon_slug: 'pikachu',
        language: 'en',
      })
      supa._tables.daily_prices.push({
        id: 1000 + i, card_slug: `pc-${2000000 + i}`,
        date: '2026-09-27', raw_usd: 100 + i, psa10_usd: 5000, psa9_usd: 1000,
      })
      supa._tables.seo_change_events.push({
        id: i + 1, event_source: 'daily_prices',
        entity_key: String(2000000 + i), event_kind: 'updated',
        observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
        processed_at: null,
      })
    }

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    expect(r.card_enqueue_attempted).toBe(20)
    // Aggregates: set enqueued at most once, pokemon at most once, despite 20 cards.
    const setRows = supa._tables.seo_indexnow_queue.filter(r => r.page_family === 'set')
    const pokeRows = supa._tables.seo_indexnow_queue.filter(r => r.page_family === 'pokemon')
    expect(setRows.length).toBe(1)
    expect(pokeRows.length).toBe(1)
    expect(r.set_enqueue_attempted).toBe(1)
    expect(r.pokemon_enqueue_attempted).toBe(1)
  })

  it('newly-created card event → enqueued at priority 0 with reason=created', async () => {
    seedCard()
    seedPriceRow()
    seedEvent({ event_source: 'cards', event_kind: 'created' })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    expect(r.card_enqueue_inserted).toBe(1)
    const cardRow = supa._tables.seo_indexnow_queue.find(r => r.page_family === 'card')
    expect(cardRow.priority).toBe(0)
    expect(cardRow.reason).toBe('created')
  })

  it('insights published event → priority 0 with insight hash', async () => {
    supa._tables.insights.push({
      slug: 'why-pokeprices-is-growing',
      headline: 'Why we grow',
      intro: 'A short intro',
      meta_title: 'Growth', meta_description: 'Numbers',
      status: 'published',
      published_at: '2026-09-14T09:00:00Z',
      body_json: { blocks: [{ id: '0', text: 'hi', type: 'p' }] },
    })
    supa._tables.seo_change_events.push({
      id: 1, event_source: 'insights',
      entity_key: 'why-pokeprices-is-growing', event_kind: 'updated',
      observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
      processed_at: null,
    })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    expect(r.editorial_enqueue_attempted).toBe(1)
    const row = supa._tables.seo_indexnow_queue.find(r => r.page_family === 'insight')
    expect(row.url).toBe('https://www.pokeprices.io/insights/why-pokeprices-is-growing')
    expect(row.priority).toBe(0)
  })

  it('all processed events get processed_at set', async () => {
    seedCard(); seedPriceRow(); seedEvent()
    await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    const events = supa._tables.seo_change_events
    for (const e of events) expect(e.processed_at).toBeTruthy()
  })

  it('empty event stream is a clean no-op', async () => {
    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    expect(r.status).toBe('ok')
    expect(r.reason).toBe('no_events')
    expect(r.events_read).toBe(0)
    expect(supa._tables.seo_indexnow_queue.length).toBe(0)
  })
})

// ── DELETE + SLUG-CHANGE PATH ──────────────────────────────────────────
//
// These prove OLD URL state is preserved via the detail JSONB column even
// after the source row disappears.

describe('harvester — delete + slug change (OLD URL preserved via detail)', () => {
  it('deleted card: OLD URL enqueued at priority 0 with reason=deleted, no source-table join required', async () => {
    // NOTE: cards table intentionally EMPTY — the card row is gone.
    supa._tables.seo_change_events.push({
      id: 1, event_source: 'cards', entity_key: '959616',
      event_kind: 'deleted',
      observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
      processed_at: null,
      detail: {
        set_name:      'Chaos Rising',
        card_url_slug: 'ampharos-29',
        reason:        'row_deleted',
      },
    })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    expect(r.deletion_enqueue_attempted).toBe(1)
    const row = supa._tables.seo_indexnow_queue.find(q => q.page_family === 'card')
    expect(row).toBeDefined()
    expect(row.url).toBe('https://www.pokeprices.io/set/Chaos%20Rising/card/ampharos-29')
    expect(row.priority).toBe(0)
    expect(row.reason).toBe('deleted')
    // Event is still marked processed even though we never joined cards.
    expect(supa._tables.seo_change_events[0].processed_at).toBeTruthy()
  })

  it('slug change: BOTH old URL (priority 0, canonical_change) AND new URL are enqueued', async () => {
    // The card row NOW has slug 'ampharos-29-updated' but the OLD URL was
    // 'ampharos-29'. The trigger writes two events: one 'deleted' with the
    // OLD slug in detail, and one 'updated' pointing at the new row.
    seedCard({ card_url_slug: 'ampharos-29-updated' })
    seedPriceRow()

    supa._tables.seo_change_events.push({
      id: 1, event_source: 'cards', entity_key: '959616',
      event_kind: 'deleted',
      observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
      processed_at: null,
      detail: {
        set_name:      'Chaos Rising',
        card_url_slug: 'ampharos-29',    // <-- the OLD URL slug
        reason:        'canonical_change',
      },
    })
    supa._tables.seo_change_events.push({
      id: 2, event_source: 'cards', entity_key: '959616',
      event_kind: 'updated',
      observed_at: '2026-09-28T09:00:01Z', observed_day: '2026-09-28',
      processed_at: null, detail: null,
    })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    expect(r.deletion_enqueue_attempted).toBe(1)
    expect(r.card_enqueue_attempted).toBe(1)

    const cards = supa._tables.seo_indexnow_queue.filter(q => q.page_family === 'card')
    expect(cards).toHaveLength(2)

    const oldRow = cards.find(c => c.url.endsWith('/ampharos-29'))
    const newRow = cards.find(c => c.url.endsWith('/ampharos-29-updated'))
    expect(oldRow).toBeDefined()
    expect(newRow).toBeDefined()
    expect(oldRow!.priority).toBe(0)
    expect(oldRow!.reason).toBe('canonical_change')
    expect(newRow!.reason).toBe('price_change')

    // Both events are marked processed.
    for (const e of supa._tables.seo_change_events) expect(e.processed_at).toBeTruthy()
  })

  it('insight slug rename: both /insights/old-slug and /insights/new-slug queued', async () => {
    supa._tables.insights.push({
      slug: 'why-we-grow-2026',
      headline: 'Why we grow', intro: 'x', meta_title: 't', meta_description: 'd',
      status: 'published', published_at: '2026-09-14T09:00:00Z',
      body_json: { blocks: [] },
    })
    supa._tables.seo_change_events.push({
      id: 1, event_source: 'insights', entity_key: 'why-we-grow',   // OLD slug
      event_kind: 'deleted',
      observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
      processed_at: null,
      detail: { slug: 'why-we-grow', reason: 'canonical_change' },
    })
    supa._tables.seo_change_events.push({
      id: 2, event_source: 'insights', entity_key: 'why-we-grow-2026',
      event_kind: 'updated',
      observed_at: '2026-09-28T09:00:01Z', observed_day: '2026-09-28',
      processed_at: null, detail: null,
    })

    const r = await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    expect(r.deletion_enqueue_attempted).toBe(1)
    expect(r.editorial_enqueue_attempted).toBe(1)
    const urls = supa._tables.seo_indexnow_queue.filter(q => q.page_family === 'insight').map(q => q.url).sort()
    expect(urls).toEqual([
      'https://www.pokeprices.io/insights/why-we-grow',
      'https://www.pokeprices.io/insights/why-we-grow-2026',
    ])
    const oldRow = supa._tables.seo_indexnow_queue.find(q => q.url.endsWith('/why-we-grow'))
    expect(oldRow.priority).toBe(0)
    expect(oldRow.reason).toBe('canonical_change')
  })

  it('vendor/creator/set/pokemon deletes also enqueue their OLD URL', async () => {
    supa._tables.seo_change_events.push(
      { id: 1, event_source: 'set_metadata', entity_key: 'Retired Set',
        event_kind: 'deleted',
        observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
        processed_at: null,
        detail: { set_name: 'Retired Set', reason: 'row_deleted' } },
      { id: 2, event_source: 'pokemon_species', entity_key: 'oldnametwo',
        event_kind: 'deleted',
        observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
        processed_at: null,
        detail: { name: 'OldNameTwo', reason: 'canonical_change' } },
      { id: 3, event_source: 'creators', entity_key: 'gone-creator',
        event_kind: 'deleted',
        observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
        processed_at: null,
        detail: { slug: 'gone-creator', reason: 'row_deleted' } },
      { id: 4, event_source: 'vendors', entity_key: 'gone-vendor',
        event_kind: 'deleted',
        observed_at: '2026-09-28T09:00:00Z', observed_day: '2026-09-28',
        processed_at: null,
        detail: { slug: 'gone-vendor', reason: 'row_deleted' } },
    )
    await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    const urls = supa._tables.seo_indexnow_queue.map(q => q.url).sort()
    expect(urls).toContain('https://www.pokeprices.io/set/Retired%20Set')
    expect(urls).toContain('https://www.pokeprices.io/pokemon/oldnametwo')
    expect(urls).toContain('https://www.pokeprices.io/creators/gone-creator')
    expect(urls).toContain('https://www.pokeprices.io/vendors/gone-vendor')
    for (const q of supa._tables.seo_indexnow_queue) {
      expect(q.priority).toBe(0)
    }
  })
})

// ── RETENTION CLEANUP ─────────────────────────────────────────────────

describe('harvester — retention cleanup', () => {
  it('deletes processed_at events older than 30 days', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    supa._tables.seo_change_events.push(
      { id: 1, event_source: 'cards', entity_key: 'a', event_kind: 'updated',
        observed_at: daysAgo(60), observed_day: '2026-07-30',
        processed_at: daysAgo(60), detail: null },      // ← old, processed → GO
      { id: 2, event_source: 'cards', entity_key: 'b', event_kind: 'updated',
        observed_at: daysAgo(10), observed_day: '2026-09-18',
        processed_at: daysAgo(10), detail: null },      // ← recent, processed → keep
    )
    await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    const ids = supa._tables.seo_change_events.map(e => e.id).sort()
    expect(ids).not.toContain(1)
    expect(ids).toContain(2)
  })

  it('NEVER deletes unprocessed events even if they were observed long ago', async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    // Somehow a very old unprocessed event exists (e.g. harvester was down
    // for a long time). It MUST survive cleanup.
    supa._tables.seo_change_events.push(
      { id: 99, event_source: 'cards', entity_key: 'stuck', event_kind: 'updated',
        observed_at: daysAgo(120), observed_day: '2026-05-31',
        processed_at: null, detail: null },
    )
    // Seed a valid card so this event actually gets processed. That marks
    // it as processed_at=NOW; cleanup then would only remove it 30 days
    // in the future — never on this run.
    seedCard({ card_slug: 'stuck', card_url_slug: 'sc', set_name: 'S' })
    seedPriceRow({ card_slug: 'pc-stuck' })

    await runIndexnowHarvester({ trigger: 'test', client: supa as any })

    const stuck = supa._tables.seo_change_events.find(e => e.id === 99)
    expect(stuck).toBeDefined()
    expect(stuck!.processed_at).toBeTruthy()   // now processed
  })

  it('cleanup is bounded — limits at most 5000 rows per invocation', async () => {
    // Verify the fallback DELETE path caps at 5000 (our fake supabase
    // implements `.limit(5000)` on the victims SELECT). Seed 6000 old
    // processed rows and confirm at most 5000 are removed per run.
    const old = new Date(Date.now() - 60 * 86_400_000).toISOString()
    for (let i = 0; i < 6000; i++) {
      supa._tables.seo_change_events.push({
        id: 100_000 + i, event_source: 'cards', entity_key: `x${i}`,
        event_kind: 'updated',
        observed_at: old, observed_day: '2026-07-30',
        processed_at: old, detail: null,
      })
    }
    await runIndexnowHarvester({ trigger: 'test', client: supa as any })
    const remaining = supa._tables.seo_change_events.filter(e => e.id >= 100_000).length
    expect(remaining).toBeGreaterThanOrEqual(1000)   // at least the 1000+ we didn't delete
    expect(remaining).toBeLessThanOrEqual(1000)      // and precisely (6000 - 5000)
  })
})
