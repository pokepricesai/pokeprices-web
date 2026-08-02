// src/lib/portfolio/valueHistory.ts
//
// Block 5A-W-50F / FIX1 — historical portfolio-value reconstruction
// with genuine market movement isolated from every non-market cause.
//
// Accounting identity (FIX1):
//   ending_value = starting_value + additions - removals + adjustments + market_movement
//   market_movement = ending_value - starting_value - additions + removals - adjustments
//
// Where adjustments cover every non-market cause: manual-value edits,
// holding-type corrections, and holdings whose price becomes newly
// available (previously unpriced -> priced).
//
// Query surface:
//   * portfolio_item_events   -- fully paginated
//   * portfolio_items         -- fully paginated
//   * daily_prices            -- fully paginated AND chunked by IN
//
// State reconstruction is pure and event-driven; the current
// portfolio_items row is only used to associate deleted holdings
// with their current portfolio_item_id (never to source the
// manual_value_cents for a historical date).

import type { SupabaseClient } from '@supabase/supabase-js'
import { HOLDING_TYPE_TO_PRICE_COLUMN } from '@/lib/portfolioGrades'

// ── Types ────────────────────────────────────────────────────────

export type Granularity = 'daily' | 'weekly' | 'monthly'
export type RangeKey    = '7D' | '30D' | '90D' | '1Y' | 'ALL'

export type DominantCause =
  | 'market_gain'
  | 'market_loss'
  | 'addition'
  | 'removal'
  | 'adjustment'
  | 'mixed'
  | 'estimated'
  | 'none'

export type AdjustmentReason =
  | 'manual_value_changed'
  | 'holding_type_corrected'
  | 'new_price_available'

export interface HistoryPoint {
  /** ISO date (YYYY-MM-DD) — end of the aggregation bucket. */
  date:                     string
  /** Numeric timestamp used as the chart x-axis so event markers
   *  keyed to exact dates remain visible under weekly / monthly
   *  aggregation. */
  ts:                       number
  startingValueCents:       number
  additionsCents:           number
  removalsCents:            number
  saleProceedsCents:        number
  adjustmentsCents:         number
  adjustmentReasons:        AdjustmentReason[]
  marketMovementCents:      number
  endingValueCents:         number
  dominantCause:            DominantCause
  isEstimated:              boolean
  holdingCount:             number
  missingPriceHoldingCount: number
}

export interface EventMarker {
  date:              string
  ts:                number
  kind:              'purchase' | 'sale' | 'removal' | 'correction' | 'manual_value'
  card_slug:         string
  set_name_snapshot: string | null
  holding_type:      string
  quantity_delta:    number
  is_estimated:      boolean
}

export interface ValueHistoryResult {
  points:                       HistoryPoint[]
  events:                       EventMarker[]
  granularity:                  Granularity
  cumulativeMarketMovementCents:  number
  cumulativeAdditionsCents:       number
  cumulativeRemovalsCents:        number
  cumulativeAdjustmentsCents:     number
  cumulativeSaleProceedsCents:    number
  /** True if any bucket contains a holding_sold event. When false
   *  the chart labels removal activity as "Removed holdings" only. */
  hasSaleActivity:                boolean
  currency:                       string
  hasEstimatedHistory:            boolean
  isEmpty:                        boolean
  /** FIX2 — true when every paginated fetch completed successfully.
   *  When false the UI must not display totals as authoritative — a
   *  page errored or a safety ceiling was hit. Ordinary missing
   *  historical prices do NOT flip this flag. */
  isComplete:                     boolean
  /** Load-time diagnostics — populated on failure or truncation. */
  warnings:                       string[]
}

interface RawEventRow {
  id:                            string
  /** FIX3 — permanent ledger identity for this holding's event chain.
   *  Survives deletion. Reconstruction keys state by this, not by the
   *  card+set+holding_type identity fields (which may change or be
   *  shared by separately-created holdings). */
  holding_instance_id:           string
  portfolio_item_id:             string | null
  card_slug:                     string
  set_name_snapshot:             string | null
  holding_type:                  string
  event_type:                    string
  quantity_delta:                number
  event_date:                    string
  market_value_cents_at_event:   number | null
  sale_proceeds_cents:           number | null
  currency:                      string
  is_estimated:                  boolean
  metadata:                      Record<string, unknown> | null
  /** FIX2 — unique monotonic identity assigned by
   *  portfolio_item_events.event_order. Guarantees deterministic
   *  same-transaction ordering (created_at ties inside a trigger). */
  event_order:                   number
}

interface CurrentHoldingRow {
  id:                    string
  card_slug:             string
  set_name_snapshot:     string | null
  holding_type:          string
  quantity:              number | null
  manual_value_cents:    number | null
}

interface DailyPriceRow {
  card_slug: string
  date:      string
  [column: string]: string | number | null
}

// ── Slug normalisation (FIX1 — Part 6) ──────────────────────────

/**
 * portfolio_items.card_slug carries the BARE provider identity (e.g.
 * '8330138'). daily_prices.card_slug uses a 'pc-' prefix (e.g.
 * 'pc-8330138'). Normalise once, in one place.
 */
export function toPricingKey(slug: string): string {
  if (!slug) return slug
  if (slug.startsWith('pc-')) return slug
  return `pc-${slug}`
}

/** Inverse of toPricingKey — safe on both prefixed and bare inputs. */
export function toBareSlug(slug: string): string {
  if (!slug) return slug
  return slug.startsWith('pc-') ? slug.slice(3) : slug
}

// ── Range → granularity + date window ───────────────────────────

export function rangeToWindow(range: RangeKey, today: Date = new Date()): {
  from: Date
  to:   Date
  granularity: Granularity
} {
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  switch (range) {
    case '7D':  return { from: addDays(to, -6),   to, granularity: 'daily' }
    case '30D': return { from: addDays(to, -29),  to, granularity: 'daily' }
    case '90D': return { from: addDays(to, -89),  to, granularity: 'daily' }
    case '1Y':  return { from: addDays(to, -364), to, granularity: 'weekly' }
    case 'ALL': return { from: addDays(to, -365 * 5), to, granularity: 'monthly' }
  }
}

// ── Small date helpers ──────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const c = new Date(d.getTime())
  c.setUTCDate(c.getUTCDate() + n)
  return c
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseIsoDate(s: string): Date {
  return new Date(s.length === 10 ? s + 'T00:00:00Z' : s)
}

function isoToTs(iso: string): number {
  return parseIsoDate(iso).getTime()
}

function eachDay(from: Date, to: Date): string[] {
  const out: string[] = []
  for (let d = new Date(from.getTime()); d.getTime() <= to.getTime(); d = addDays(d, 1)) {
    out.push(toIsoDate(d))
  }
  return out
}

// ── Attribution ─────────────────────────────────────────────────

const DOMINANCE_THRESHOLD = 0.6

export function decideDominantCause(bucket: {
  additionsCents:      number
  removalsCents:       number
  adjustmentsCents:    number
  marketMovementCents: number
  isEstimated:         boolean
}): DominantCause {
  if (bucket.isEstimated) return 'estimated'
  const add   = Math.abs(bucket.additionsCents)
  const rem   = Math.abs(bucket.removalsCents)
  const adj   = Math.abs(bucket.adjustmentsCents)
  const mkt   = Math.abs(bucket.marketMovementCents)
  const total = add + rem + adj + mkt
  if (total === 0) return 'none'
  const max = Math.max(add, rem, adj, mkt)
  if (max / total < DOMINANCE_THRESHOLD) return 'mixed'
  if (max === mkt) return bucket.marketMovementCents >= 0 ? 'market_gain' : 'market_loss'
  if (max === add) return 'addition'
  if (max === rem) return 'removal'
  return 'adjustment'
}

// ── Price lookup ────────────────────────────────────────────────

interface PriceIndex {
  byCard: Map<string, Array<{ date: string; row: DailyPriceRow }>>
}

function buildPriceIndex(rows: DailyPriceRow[]): PriceIndex {
  const byCard = new Map<string, Array<{ date: string; row: DailyPriceRow }>>()
  for (const r of rows) {
    const bare = toBareSlug(r.card_slug)
    const list = byCard.get(bare) ?? []
    list.push({ date: r.date, row: r })
    byCard.set(bare, list)
  }
  byCard.forEach(list => list.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { byCard }
}

/** Latest daily_prices row with date <= target. Forward-fill semantics. */
export function forwardFillPrice(
  index: PriceIndex,
  bareCardSlug: string,
  targetDate: string,
): DailyPriceRow | null {
  const list = index.byCard.get(toBareSlug(bareCardSlug))
  if (!list || list.length === 0) return null
  let lo = 0, hi = list.length - 1, best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].date <= targetDate) { best = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return best === -1 ? null : list[best].row
}

/** Per-holding market value on a specific date. Returns null when no
 *  historical price is available AND the holding has no manual value.
 *  Uses the reconstructed manual_value_cents from the state (which is
 *  event-derived), never the current portfolio_items row directly. */
export function priceHoldingAt(
  index: PriceIndex,
  holding: { card_slug: string; holding_type: string; quantity: number; manual_value_cents: number | null },
  isoDate: string,
): number | null {
  if (holding.manual_value_cents != null && holding.manual_value_cents > 0) {
    return holding.manual_value_cents * Math.max(1, holding.quantity)
  }
  const priceCol = HOLDING_TYPE_TO_PRICE_COLUMN[holding.holding_type]
  if (!priceCol) return null
  const row = forwardFillPrice(index, holding.card_slug, isoDate)
  if (!row) return null
  const raw = row[priceCol]
  if (typeof raw !== 'number' || raw <= 0) return null
  return raw * Math.max(1, holding.quantity)
}

/** Per-UNIT price (not multiplied by quantity). Used for computing
 *  per-event market value at event date. */
function unitPriceAt(
  index: PriceIndex,
  h: { card_slug: string; holding_type: string; manual_value_cents: number | null },
  isoDate: string,
): number | null {
  if (h.manual_value_cents != null && h.manual_value_cents > 0) return h.manual_value_cents
  const priceCol = HOLDING_TYPE_TO_PRICE_COLUMN[h.holding_type]
  if (!priceCol) return null
  const row = forwardFillPrice(index, h.card_slug, isoDate)
  if (!row) return null
  const raw = row[priceCol]
  if (typeof raw !== 'number' || raw <= 0) return null
  return raw
}

// ── State reconstruction ────────────────────────────────────────

export interface HoldingState {
  /** FIX3 — always equals holding_instance_id. The state map is keyed
   *  by this so two separately-created holdings (delete + recreate,
   *  or two identical card+set+type rows across portfolios) do not
   *  collide. */
  key:                  string
  holding_instance_id:  string
  card_slug:            string
  set_name_snapshot:    string | null
  /** Current holding type. Updated in place when a holding_type
   *  correction is folded (no key change needed under FIX3 keying). */
  holding_type:         string
  quantity:             number
  /** Reconstructed from manual_value_changed events + initial
   *  metadata on holding_added / opening_balance. Never sourced from
   *  the current portfolio_items row. Correct for every historical
   *  date, including after the holding is deleted. */
  manual_value_cents:   number | null
  /** Live foreign-key value; NULL after the parent portfolio_items
   *  row is deleted. Never used for event-chain matching. */
  portfolio_item_id:    string | null
}

/** DEPRECATED for reconstruction keying. Retained only for
 *  display/anchor helpers that group by (card_slug, set, holding_type).
 *  All reconstruction and event-chain matching MUST use
 *  holding_instance_id under FIX3. */
function keyOfHolding(h: { card_slug: string; set_name_snapshot: string | null; holding_type: string }): string {
  return `${h.card_slug}|${h.set_name_snapshot ?? ''}|${h.holding_type}`
}

/**
 * Fold events forward from earliest to `throughDate` (inclusive). All
 * event kinds are handled:
 *   * quantity events (holding_added / quantity_added / quantity_removed
 *     / holding_sold / holding_removed / opening_balance) fold into
 *     the quantity of the matching key. FIX2: holding_added and
 *     opening_balance can seed manual_value_cents from
 *     metadata.initial_manual_value_cents.
 *   * manual_value_changed updates the manual_value_cents in-place
 *   * correction with holding_type_before/after updates holding_type
 *     in place (FIX3 — no key transfer, since state is keyed by
 *     holding_instance_id, not by card+set+type).
 *   * purchase_date corrections are handled by preprocessEvents
 *     BEFORE this function runs, so this loop never sees them.
 *
 * FIX3 — state map is keyed by holding_instance_id. Two separately-
 * created holdings for the same card+set+type never merge.
 *
 * FIX2 — events must be pre-sorted by (event_date ASC, event_order
 * ASC) or this reconstruction gives non-deterministic results for
 * same-day multi-field UPDATEs.
 */
export function reconstructHoldingsAt(
  events: RawEventRow[],
  throughDate: string,
): Map<string, HoldingState> {
  const state = new Map<string, HoldingState>()

  for (const e of events) {
    if (e.event_date > throughDate) break
    const key = e.holding_instance_id

    // Holding-type correction — update the holding_type in place.
    if (
      e.event_type === 'correction'
      && e.metadata
      && typeof e.metadata['holding_type_before'] === 'string'
      && typeof e.metadata['holding_type_after']  === 'string'
    ) {
      const newType = e.metadata['holding_type_after'] as string
      const holding = state.get(key)
      if (holding) holding.holding_type = newType
      continue
    }

    // Manual-value change updates the effective manual value in place.
    if (e.event_type === 'manual_value_changed') {
      const holding = state.get(key)
      const afterRaw = e.metadata?.['manual_value_cents_after']
      const next = typeof afterRaw === 'number' ? afterRaw : null
      if (holding) {
        holding.manual_value_cents = next
      }
      continue
    }

    // Everything else is a quantity delta on this holding_instance_id.
    const prev  = state.get(key)
    const delta = e.quantity_delta
    const nextQty = (prev?.quantity ?? 0) + delta
    if (nextQty <= 0) {
      state.delete(key)
    } else {
      // FIX2 — initial manual value carried in holding_added /
      // opening_balance metadata seeds the state's manual value.
      // A later manual_value_changed event overwrites it.
      let seededManual = prev?.manual_value_cents ?? null
      if (
        (e.event_type === 'holding_added' || e.event_type === 'opening_balance')
        && prev == null
      ) {
        const raw = e.metadata?.['initial_manual_value_cents']
        if (typeof raw === 'number') seededManual = raw
      }
      state.set(key, {
        key,
        holding_instance_id: e.holding_instance_id,
        card_slug:           e.card_slug,
        set_name_snapshot:   e.set_name_snapshot,
        // Keep the holding_type stable from the initial event; later
        // corrections update it in place at the correction branch
        // above.
        holding_type:        prev?.holding_type ?? e.holding_type,
        quantity:            nextQty,
        manual_value_cents:  seededManual,
        portfolio_item_id:   e.portfolio_item_id ?? prev?.portfolio_item_id ?? null,
      })
    }
  }
  return state
}

/**
 * FIX2 — resolves purchase_date correction events into an effective
 * event_date rewrite on the initial event, then drops the correction
 * rows themselves. Returns a fresh array sorted by (event_date,
 * event_order) so reconstruction operates on the correct effective
 * timeline. The immutable ledger rows are unchanged; this rewrites
 * only the in-memory representation the reconstruction sees.
 */
export function preprocessEvents(events: RawEventRow[]): RawEventRow[] {
  // FIX3 — latest purchase_date_after per holding_instance_id wins.
  // Using holding_instance_id means the correction correctly applies
  // even after portfolio_item_id has been NULLed by the FK cascade.
  const latestPurchaseDate = new Map<string, string>()
  for (const e of events) {
    if (
      e.event_type === 'correction'
      && e.holding_instance_id
      && e.metadata
      && (e.metadata['correction_kind'] === 'purchase_date')
      && typeof e.metadata['purchase_date_after'] === 'string'
    ) {
      latestPurchaseDate.set(e.holding_instance_id, e.metadata['purchase_date_after'] as string)
    }
  }

  const remapped = events
    .filter(e => !(
      e.event_type === 'correction'
      && e.metadata
      && e.metadata['correction_kind'] === 'purchase_date'
    ))
    .map(e => {
      const isInitial = e.event_type === 'holding_added' || e.event_type === 'opening_balance'
      if (isInitial && e.holding_instance_id && latestPurchaseDate.has(e.holding_instance_id)) {
        return { ...e, event_date: latestPurchaseDate.get(e.holding_instance_id)! }
      }
      return e
    })

  remapped.sort((a, b) => {
    if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1
    const ao = typeof a.event_order === 'number' ? a.event_order : 0
    const bo = typeof b.event_order === 'number' ? b.event_order : 0
    return ao - bo
  })
  return remapped
}

/** Sum of market values of a state on a given date. */
export function stateMarketValueCents(
  state: Map<string, HoldingState>,
  index: PriceIndex,
  isoDate: string,
): { valueCents: number; missingHoldings: number } {
  let total = 0
  let missing = 0
  state.forEach(h => {
    const v = priceHoldingAt(index, h, isoDate)
    if (v == null) missing++
    else total += v
  })
  return { valueCents: total, missingHoldings: missing }
}

// ── Paginated + chunked reads (FIX1 — Part 7) ───────────────────

const PAGE_SIZE = 1000
const IN_CHUNK  = 100

/**
 * FIX2 — every fetch helper returns a { rows, complete } pair. A page
 * error, safety-ceiling hit or chunk failure sets complete=false so
 * the caller can surface an integrity-failure state instead of
 * displaying partial totals as authoritative. Ordinary missing
 * historical prices do NOT flip complete=false — that is an expected
 * valuation limitation, not a fetch failure.
 */
async function fetchAllEvents(
  supabase: SupabaseClient,
  portfolioId: string,
  warnings: string[],
): Promise<{ rows: RawEventRow[]; complete: boolean }> {
  const all: RawEventRow[] = []
  let offset = 0
  let complete = true
  const cols = 'id, portfolio_item_id, holding_instance_id, card_slug, set_name_snapshot, holding_type, event_type, quantity_delta, event_date, market_value_cents_at_event, sale_proceeds_cents, currency, is_estimated, metadata, event_order'
  for (;;) {
    const { data, error } = await supabase
      .from('portfolio_item_events')
      .select(cols)
      .eq('portfolio_id', portfolioId)
      .order('event_date', { ascending: true })
      .order('event_order', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      warnings.push(`events page @${offset} failed: ${error.message}`)
      complete = false
      break
    }
    const page = (data as unknown as RawEventRow[]) ?? []
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    if (offset > 100_000) {
      warnings.push('events pagination halted at 100k')
      complete = false
      break
    }
  }
  return { rows: all, complete }
}

async function fetchAllCurrentHoldings(
  supabase: SupabaseClient,
  portfolioId: string,
  warnings: string[],
): Promise<{ rows: CurrentHoldingRow[]; complete: boolean }> {
  const all: CurrentHoldingRow[] = []
  let offset = 0
  let complete = true
  const cols = 'id, card_slug, set_name_snapshot, holding_type, quantity, manual_value_cents'
  for (;;) {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select(cols)
      .eq('portfolio_id', portfolioId)
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      warnings.push(`portfolio_items page @${offset} failed: ${error.message}`)
      complete = false
      break
    }
    const page = (data as unknown as CurrentHoldingRow[]) ?? []
    all.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    if (offset > 100_000) {
      warnings.push('portfolio_items pagination halted at 100k')
      complete = false
      break
    }
  }
  return { rows: all, complete }
}

async function fetchAllDailyPrices(
  supabase: SupabaseClient,
  bareSlugs: string[],
  fromIso: string,
  toIso: string,
  warnings: string[],
): Promise<{ rows: DailyPriceRow[]; complete: boolean }> {
  if (bareSlugs.length === 0) return { rows: [], complete: true }
  const pcSlugs = Array.from(new Set(bareSlugs.map(toPricingKey)))
  const priceCols = ['card_slug', 'date', ...Object.values(HOLDING_TYPE_TO_PRICE_COLUMN)]
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ')

  const all: DailyPriceRow[] = []
  let complete = true
  for (let i = 0; i < pcSlugs.length; i += IN_CHUNK) {
    const chunk = pcSlugs.slice(i, i + IN_CHUNK)
    let offset = 0
    for (;;) {
      const { data, error } = await supabase
        .from('daily_prices')
        .select(priceCols)
        .in('card_slug', chunk)
        .gte('date', fromIso)
        .lte('date', toIso)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        warnings.push(`daily_prices chunk ${i}-${i + IN_CHUNK} page @${offset} failed: ${error.message}`)
        complete = false
        break
      }
      const page = ((data as unknown) as DailyPriceRow[]) ?? []
      all.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
      if (offset > 500_000) {
        warnings.push('daily_prices pagination halted at 500k')
        complete = false
        break
      }
    }
  }
  return { rows: all, complete }
}

// ── Public entry point ──────────────────────────────────────────

export interface ComputeValueHistoryInput {
  supabase:    SupabaseClient
  portfolioId: string
  range:       RangeKey
  currency:    string
  /** For deterministic tests; defaults to system time. */
  now?:        Date
}

export async function computeValueHistory(
  input: ComputeValueHistoryInput,
): Promise<ValueHistoryResult> {
  const { supabase, portfolioId, range, currency, now } = input
  const win = rangeToWindow(range, now)
  const warnings: string[] = []

  // Three paginated queries. Each returns { rows, complete }; the
  // final isComplete flag is the AND of all three.
  const eventsRes  = await fetchAllEvents(supabase, portfolioId, warnings)
  const currentRes = await fetchAllCurrentHoldings(supabase, portfolioId, warnings)

  const events  = preprocessEvents(eventsRes.rows)
  const current = currentRes.rows

  if (events.length === 0 && current.length === 0) {
    return emptyResult(win.granularity, currency, warnings, eventsRes.complete && currentRes.complete)
  }

  const bareSlugsSet = new Set<string>()
  for (const e of events)  bareSlugsSet.add(toBareSlug(e.card_slug))
  for (const c of current) bareSlugsSet.add(toBareSlug(c.card_slug))

  const fetchFrom = toIsoDate(addDays(win.from, -60))
  const fetchTo   = toIsoDate(win.to)
  const pricesRes = await fetchAllDailyPrices(
    supabase, Array.from(bareSlugsSet), fetchFrom, fetchTo, warnings,
  )
  const priceIndex = buildPriceIndex(pricesRes.rows)

  const isComplete = eventsRes.complete && currentRes.complete && pricesRes.complete

  const dailyBuckets = buildDailyBuckets(events, priceIndex, win.from, win.to)
  const aggregated   = aggregateBuckets(dailyBuckets, win.granularity)

  const hasSaleActivity = events.some(e => e.event_type === 'holding_sold' && e.event_date >= toIsoDate(win.from) && e.event_date <= toIsoDate(win.to))

  const eventMarkers: EventMarker[] = events
    .filter(e => e.event_date >= toIsoDate(win.from) && e.event_date <= toIsoDate(win.to))
    .filter(e =>
      // Filter out the derived events users would find noisy in the
      // exact-date markers layer: manual_value_changed + correction
      // are already reflected in the segment colour and tooltip.
      e.event_type !== 'manual_value_changed' && e.event_type !== 'correction',
    )
    .map(e => ({
      date:              e.event_date,
      ts:                isoToTs(e.event_date),
      kind:              markerKind(e.event_type),
      card_slug:         e.card_slug,
      set_name_snapshot: e.set_name_snapshot,
      holding_type:      e.holding_type,
      quantity_delta:    e.quantity_delta,
      is_estimated:      e.is_estimated,
    }))

  const cumulativeMarketMovementCents = aggregated.reduce((a, p) => a + p.marketMovementCents, 0)
  const cumulativeAdditionsCents      = aggregated.reduce((a, p) => a + p.additionsCents, 0)
  const cumulativeRemovalsCents       = aggregated.reduce((a, p) => a + p.removalsCents, 0)
  const cumulativeAdjustmentsCents    = aggregated.reduce((a, p) => a + p.adjustmentsCents, 0)
  const cumulativeSaleProceedsCents   = aggregated.reduce((a, p) => a + p.saleProceedsCents, 0)

  return {
    points:                          aggregated,
    events:                          eventMarkers,
    granularity:                     win.granularity,
    cumulativeMarketMovementCents,
    cumulativeAdditionsCents,
    cumulativeRemovalsCents,
    cumulativeAdjustmentsCents,
    cumulativeSaleProceedsCents,
    hasSaleActivity,
    currency,
    hasEstimatedHistory:             events.some(e => e.is_estimated),
    isEmpty:                         aggregated.every(p => p.endingValueCents === 0 && p.startingValueCents === 0),
    isComplete,
    warnings,
  }
}

function markerKind(eventType: string): EventMarker['kind'] {
  switch (eventType) {
    case 'holding_added':
    case 'quantity_added':
    case 'opening_balance':      return 'purchase'
    case 'holding_sold':         return 'sale'
    case 'quantity_removed':
    case 'holding_removed':      return 'removal'
    case 'manual_value_changed': return 'manual_value'
    default:                     return 'correction'
  }
}

function emptyResult(granularity: Granularity, currency: string, warnings: string[], isComplete: boolean = true): ValueHistoryResult {
  return {
    points: [],
    events: [],
    granularity,
    cumulativeMarketMovementCents: 0,
    cumulativeAdditionsCents:      0,
    cumulativeRemovalsCents:       0,
    cumulativeAdjustmentsCents:    0,
    cumulativeSaleProceedsCents:   0,
    hasSaleActivity:               false,
    currency,
    hasEstimatedHistory:           false,
    isEmpty:                       true,
    isComplete,
    warnings,
  }
}

// ── Daily bucketing (before aggregation) ────────────────────────

function buildDailyBuckets(
  events: RawEventRow[],
  priceIndex: PriceIndex,
  from: Date,
  to: Date,
): HistoryPoint[] {
  const dates = eachDay(from, to)
  if (dates.length === 0) return []
  const points: HistoryPoint[] = []

  const priorIso = toIsoDate(addDays(from, -1))
  let prevState = reconstructHoldingsAt(events, priorIso)
  let prevValueCents = stateMarketValueCents(prevState, priceIndex, priorIso).valueCents
  let prevIso = priorIso

  for (const isoDate of dates) {
    const dayEvents = events.filter(e => e.event_date === isoDate)

    // ── Contributions / withdrawals from quantity events ──
    let additionsCents  = 0
    let removalsCents   = 0
    let saleProceedsCents = 0
    let dayIsEstimated  = false

    // For manual-value / correction adjustments we need the state
    // JUST BEFORE the event to know the previous manual value or
    // holding type. We fold events one at a time.

    // Compute values of add/remove events at day's market price.
    // FIX2 — holding_added / opening_balance events with an
    // `initial_manual_value_cents` in metadata are valued at that
    // manual value (not market). This is what makes the addition
    // "carry" its manual value instead of appearing as a 0-value
    // addition followed by a large adjustment.
    for (const e of dayEvents) {
      const delta = e.quantity_delta
      if (delta !== 0) {
        // Determine per-unit valuation source.
        let perUnit = 0
        const isInitial = e.event_type === 'holding_added' || e.event_type === 'opening_balance'
        const initialManualRaw = isInitial ? e.metadata?.['initial_manual_value_cents'] : undefined
        if (typeof initialManualRaw === 'number' && initialManualRaw > 0) {
          perUnit = initialManualRaw
        } else if (e.market_value_cents_at_event != null) {
          perUnit = e.market_value_cents_at_event
        } else {
          // FIX3 — look up prior manual value by holding_instance_id.
          // Also use the CURRENT holding_type from state so that a
          // quantity_added arriving after a holding_type correction
          // is valued at the corrected type's market price.
          const priorState = prevState.get(e.holding_instance_id)
          perUnit = unitPriceAt(priceIndex, {
            card_slug:          e.card_slug,
            holding_type:       priorState?.holding_type ?? e.holding_type,
            manual_value_cents: priorState?.manual_value_cents ?? null,
          }, isoDate) ?? 0
        }
        const marketValueOfEvent = perUnit * Math.abs(delta)
        if (delta > 0) additionsCents += marketValueOfEvent
        if (delta < 0) removalsCents  += marketValueOfEvent
      }
      if (e.sale_proceeds_cents != null) saleProceedsCents += e.sale_proceeds_cents
      if (e.is_estimated) dayIsEstimated = true
    }

    // ── Adjustments from manual_value_changed / correction /
    //    new-price-availability ──
    let adjustmentsCents = 0
    const adjustmentReasons = new Set<AdjustmentReason>()

    // (a) Manual-value adjustments: fold events one at a time and
    // measure per-holding delta.
    // (b) Correction adjustments: holding_type_before -> after transfer.
    // We walk manual-value + correction events sequentially against
    // a rolling state started from prevState so we can measure the
    // exact value delta caused by each adjustment.
    const rollingState = new Map(prevState) // copy
    // Deep-copy the values so mutations don't leak backward.
    rollingState.forEach((v, k) => rollingState.set(k, { ...v }))

    for (const e of dayEvents) {
      if (e.event_type === 'manual_value_changed') {
        // FIX3 — lookup by holding_instance_id, not by card+set+type.
        const key = e.holding_instance_id
        const h = rollingState.get(key)
        if (h) {
          const before = h.manual_value_cents
          const afterRaw = e.metadata?.['manual_value_cents_after']
          const after = typeof afterRaw === 'number' ? afterRaw : null
          // Effective per-unit value BEFORE the change (manual override
          // if set, else market price).
          const effBefore = (before != null && before > 0)
            ? before
            : (unitPriceAt(priceIndex, { ...h, manual_value_cents: null }, isoDate) ?? 0)
          // Effective per-unit value AFTER the change.
          const effAfter = (after != null && after > 0)
            ? after
            : (unitPriceAt(priceIndex, { ...h, manual_value_cents: null }, isoDate) ?? 0)
          const delta = (effAfter - effBefore) * Math.max(1, h.quantity)
          adjustmentsCents += delta
          adjustmentReasons.add('manual_value_changed')
          h.manual_value_cents = after
          rollingState.set(key, h)
        }
      } else if (
        e.event_type === 'correction'
        && e.metadata
        && typeof e.metadata['holding_type_before'] === 'string'
        && typeof e.metadata['holding_type_after']  === 'string'
      ) {
        const oldType = e.metadata['holding_type_before'] as string
        const newType = e.metadata['holding_type_after']  as string
        if (oldType !== newType) {
          // FIX3 — the holding is identified by holding_instance_id
          // regardless of type; no key transfer needed. Just measure
          // the value delta of the type change and update the state.
          const h = rollingState.get(e.holding_instance_id)
          if (h) {
            const qty    = h.quantity
            const manual = h.manual_value_cents
            const oldEff = (manual != null && manual > 0)
              ? manual
              : (unitPriceAt(priceIndex, { card_slug: e.card_slug, holding_type: oldType, manual_value_cents: null }, isoDate) ?? 0)
            const newEff = (manual != null && manual > 0)
              ? manual
              : (unitPriceAt(priceIndex, { card_slug: e.card_slug, holding_type: newType, manual_value_cents: null }, isoDate) ?? 0)
            const delta = (newEff - oldEff) * Math.max(1, qty)
            adjustmentsCents += delta
            adjustmentReasons.add('holding_type_corrected')
            h.holding_type = newType
            rollingState.set(e.holding_instance_id, h)
          }
        }
      }
    }

    // (c) New-price-availability adjustment: for holdings that were
    // in prevState AND remain in state today (regardless of manual
    // value), if they were unpriced yesterday and priced today, the
    // (0 -> today_price) delta is an adjustment.
    prevState.forEach((h, key) => {
      // Skip if the holding was manual-valued yesterday — no
      // "unpriced" state applies.
      if (h.manual_value_cents != null && h.manual_value_cents > 0) return
      const vPrev = priceHoldingAt(priceIndex, h, prevIso)
      // Skip if the holding has been removed today entirely (delta
      // already covered under removalsCents).
      // For new-price adjustment we care about the SAME quantity being
      // continuously held. Approximate by using yesterday's quantity.
      if (vPrev == null) {
        const vToday = priceHoldingAt(priceIndex, h, isoDate)
        if (vToday != null && vToday > 0) {
          adjustmentsCents += vToday
          adjustmentReasons.add('new_price_available')
        }
      }
    })

    // ── Ending value from the fully-folded state ──
    const dayState = reconstructHoldingsAt(events, isoDate)
    const dayValue = stateMarketValueCents(dayState, priceIndex, isoDate)
    const endingValueCents = dayValue.valueCents

    const startingValueCents = prevValueCents
    // Rearrangement of the accounting identity:
    //   ending = starting + additions - removals + adjustments + market
    // => market = ending - starting - additions + removals - adjustments
    const marketMovementCents = endingValueCents - startingValueCents - additionsCents + removalsCents - adjustmentsCents

    const dominantCause = decideDominantCause({
      additionsCents, removalsCents, adjustmentsCents, marketMovementCents, isEstimated: dayIsEstimated,
    })

    points.push({
      date: isoDate,
      ts:   isoToTs(isoDate),
      startingValueCents,
      additionsCents,
      removalsCents,
      saleProceedsCents,
      adjustmentsCents,
      adjustmentReasons: Array.from(adjustmentReasons),
      marketMovementCents,
      endingValueCents,
      dominantCause,
      isEstimated: dayIsEstimated,
      holdingCount: dayState.size,
      missingPriceHoldingCount: dayValue.missingHoldings,
    })

    prevValueCents = endingValueCents
    prevState = dayState
    prevIso = isoDate
  }
  return points
}

// ── Aggregation ─────────────────────────────────────────────────

function bucketKey(iso: string, granularity: Granularity): string {
  if (granularity === 'daily') return iso
  const d = parseIsoDate(iso)
  if (granularity === 'weekly') {
    const day = d.getUTCDay() || 7
    const monday = addDays(d, -(day - 1))
    return toIsoDate(monday)
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
  return toIsoDate(first)
}

function aggregateBuckets(daily: HistoryPoint[], granularity: Granularity): HistoryPoint[] {
  if (granularity === 'daily') return daily
  const groups = new Map<string, HistoryPoint[]>()
  for (const p of daily) {
    const k = bucketKey(p.date, granularity)
    const list = groups.get(k) ?? []
    list.push(p)
    groups.set(k, list)
  }
  const out: HistoryPoint[] = []
  const keys = Array.from(groups.keys()).sort()
  for (const k of keys) {
    const list = groups.get(k)!.sort((a, b) => a.date < b.date ? -1 : 1)
    const startingValueCents   = list[0].startingValueCents
    const endingValueCents     = list[list.length - 1].endingValueCents
    const additionsCents       = list.reduce((s, p) => s + p.additionsCents, 0)
    const removalsCents        = list.reduce((s, p) => s + p.removalsCents, 0)
    const saleProceedsCents    = list.reduce((s, p) => s + p.saleProceedsCents, 0)
    const adjustmentsCents     = list.reduce((s, p) => s + p.adjustmentsCents, 0)
    const reasonsSet           = new Set<AdjustmentReason>()
    list.forEach(p => p.adjustmentReasons.forEach(r => reasonsSet.add(r)))
    const marketMovementCents  = endingValueCents - startingValueCents - additionsCents + removalsCents - adjustmentsCents
    const isEstimated          = list.some(p => p.isEstimated)
    const missingPriceHoldingCount = list[list.length - 1].missingPriceHoldingCount
    const lastDate = list[list.length - 1].date
    out.push({
      date: lastDate,
      ts:   isoToTs(lastDate),
      startingValueCents,
      additionsCents,
      removalsCents,
      saleProceedsCents,
      adjustmentsCents,
      adjustmentReasons: Array.from(reasonsSet),
      marketMovementCents,
      endingValueCents,
      dominantCause: decideDominantCause({
        additionsCents, removalsCents, adjustmentsCents, marketMovementCents, isEstimated,
      }),
      isEstimated,
      holdingCount: list[list.length - 1].holdingCount,
      missingPriceHoldingCount,
    })
  }
  return out
}

export const __TEST__ = {
  buildDailyBuckets,
  aggregateBuckets,
  bucketKey,
  reconstructHoldingsAt,
  stateMarketValueCents,
  buildPriceIndex,
  eachDay,
  addDays,
  toIsoDate,
  isoToTs,
  fetchAllDailyPrices,
  fetchAllEvents,
  fetchAllCurrentHoldings,
  preprocessEvents,
  PAGE_SIZE,
  IN_CHUNK,
}
