// src/lib/deepSearch/filters.ts
//
// Block 5A-W-56A — Deep Card Search shared types + pure transformers.
//
// One place to change the filter schema so the URL, the RPC arguments,
// the AI parser's return shape and the UI stay aligned.
//
// Currency convention:
//   * All prices in this schema are USD cents (integer).
//   * The UI accepts GBP / USD input and converts via
//     `poundsToUsdCents` / `usdCentsToPounds` before storage.
//   * The DB stores USD cents natively so no conversion happens on
//     the server side.

// ─── Types ────────────────────────────────────────────────────────

export type Language = 'en' | 'jp'

export type DeepCardSearchSort =
  | 'name_asc' | 'name_desc'
  | 'pokemon_asc'
  | 'set_asc'
  | 'release_desc' | 'release_asc'
  | 'raw_asc' | 'raw_desc'
  | 'psa7_asc' | 'psa7_desc'
  | 'psa8_asc' | 'psa8_desc'
  | 'psa9_asc' | 'psa9_desc'
  | 'psa10_asc' | 'psa10_desc'
  | 'change_7d_desc'  | 'change_7d_asc'
  | 'change_30d_desc' | 'change_30d_asc'
  | 'change_90d_desc' | 'change_90d_asc'
  | 'psa9_uplift_desc' | 'psa10_uplift_desc'
  | 'psa9_multiple_desc' | 'psa10_multiple_desc'

export const SORT_LABELS: Record<DeepCardSearchSort, string> = {
  name_asc:              'Card name A–Z',
  name_desc:             'Card name Z–A',
  pokemon_asc:           'Pokémon A–Z',
  set_asc:               'Set A–Z',
  release_desc:          'Release date — newest',
  release_asc:           'Release date — oldest',
  raw_asc:               'Raw price — low to high',
  raw_desc:              'Raw price — high to low',
  psa7_asc:              'PSA 7 — low to high',
  psa7_desc:             'PSA 7 — high to low',
  psa8_asc:              'PSA 8 — low to high',
  psa8_desc:             'PSA 8 — high to low',
  psa9_asc:              'PSA 9 — low to high',
  psa9_desc:             'PSA 9 — high to low',
  psa10_asc:             'PSA 10 — low to high',
  psa10_desc:            'PSA 10 — high to low',
  change_7d_desc:        'Biggest 7-day gain',
  change_7d_asc:         'Biggest 7-day drop',
  change_30d_desc:       'Biggest 30-day gain',
  change_30d_asc:        'Biggest 30-day drop',
  change_90d_desc:       'Biggest 90-day gain',
  change_90d_asc:        'Biggest 90-day drop',
  psa9_uplift_desc:      'Biggest PSA 9 uplift',
  psa10_uplift_desc:     'Biggest PSA 10 uplift',
  psa9_multiple_desc:    'Biggest PSA 9 multiple',
  psa10_multiple_desc:   'Biggest PSA 10 multiple',
}

export const SORT_KEYS: readonly DeepCardSearchSort[] = Object.freeze(
  Object.keys(SORT_LABELS) as DeepCardSearchSort[],
)

export const DEFAULT_SORT: DeepCardSearchSort = 'release_desc'

/**
 * Deep Card Search filter set. All numeric price / uplift fields are
 * USD cents. Percent fields (`change_*`) are literal percent (30 not
 * 0.30). `Undefined` means "no filter". Zero is a valid filter value
 * (e.g. rawMin=0 kept for completeness even though effectively no-op).
 */
export interface DeepCardSearchFilters {
  pokemonSlug?:        string
  cardName?:           string
  setName?:            string
  language?:           Language
  releaseYearMin?:     number
  releaseYearMax?:     number
  rawMin?:             number
  rawMax?:             number
  psa7Min?:            number
  psa7Max?:            number
  psa8Min?:            number
  psa8Max?:            number
  psa9Min?:            number
  psa9Max?:            number
  psa10Min?:           number
  psa10Max?:           number
  change7dMin?:        number
  change7dMax?:        number
  change30dMin?:       number
  change30dMax?:       number
  change90dMin?:       number
  change90dMax?:       number
  psa9UpliftMin?:      number
  psa10UpliftMin?:     number
  psa9MultipleMin?:    number
  psa10MultipleMin?:   number
  // Reserved — pokemonType filter deferred until a data audit
  // confirms type_primary is populated for enough species.
  pokemonType?:        string
}

// ─── URL <-> Filters ────────────────────────────────────────────

// Every filter key in the URL, in a stable order for UI/test parity.
const URL_KEYS: readonly (keyof DeepCardSearchFilters)[] = [
  'pokemonSlug', 'cardName', 'setName', 'language',
  'releaseYearMin', 'releaseYearMax',
  'rawMin', 'rawMax',
  'psa7Min', 'psa7Max',
  'psa8Min', 'psa8Max',
  'psa9Min', 'psa9Max',
  'psa10Min', 'psa10Max',
  'change7dMin', 'change7dMax',
  'change30dMin', 'change30dMax',
  'change90dMin', 'change90dMax',
  'psa9UpliftMin', 'psa10UpliftMin',
  'psa9MultipleMin', 'psa10MultipleMin',
  'pokemonType',
]

const NUMERIC_KEYS: ReadonlySet<keyof DeepCardSearchFilters> = new Set([
  'releaseYearMin', 'releaseYearMax',
  'rawMin', 'rawMax',
  'psa7Min', 'psa7Max',
  'psa8Min', 'psa8Max',
  'psa9Min', 'psa9Max',
  'psa10Min', 'psa10Max',
  'change7dMin', 'change7dMax',
  'change30dMin', 'change30dMax',
  'change90dMin', 'change90dMax',
  'psa9UpliftMin', 'psa10UpliftMin',
  'psa9MultipleMin', 'psa10MultipleMin',
] as (keyof DeepCardSearchFilters)[])

/** Serialise a filter set + sort into a URLSearchParams instance.
 *  Only defined values appear. Sort is only emitted when non-default. */
export function filtersToSearchParams(
  filters: DeepCardSearchFilters,
  sort: DeepCardSearchSort = DEFAULT_SORT,
): URLSearchParams {
  const sp = new URLSearchParams()
  for (const key of URL_KEYS) {
    const v = filters[key]
    if (v == null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    sp.set(kebab(key), String(v))
  }
  if (sort !== DEFAULT_SORT) sp.set('sort', sort)
  return sp
}

/** Parse a URLSearchParams (or URL string) back into a filter set +
 *  sort. Unknown keys are ignored; malformed numeric values are dropped
 *  rather than throwing. */
export function searchParamsToFilters(input: URLSearchParams | string | null | undefined): {
  filters: DeepCardSearchFilters
  sort:    DeepCardSearchSort
} {
  const sp = typeof input === 'string' || input == null
    ? new URLSearchParams(input ?? '')
    : input
  const out: DeepCardSearchFilters = {}
  for (const key of URL_KEYS) {
    const raw = sp.get(kebab(key))
    if (raw == null) continue
    if (NUMERIC_KEYS.has(key)) {
      const n = Number(raw)
      if (Number.isFinite(n)) (out as any)[key] = n
    } else if (key === 'language') {
      if (raw === 'en' || raw === 'jp') out.language = raw
    } else {
      const trimmed = raw.trim()
      if (trimmed) (out as any)[key] = trimmed
    }
  }
  const sortRaw = sp.get('sort') as DeepCardSearchSort | null
  const sort = sortRaw && (SORT_KEYS as readonly string[]).includes(sortRaw)
    ? sortRaw
    : DEFAULT_SORT
  return { filters: out, sort }
}

function kebab(k: string): string {
  return k.replace(/([A-Z0-9])/g, (m) => '_' + m.toLowerCase())
}

// ─── RPC argument mapping ────────────────────────────────────────

/** Map a client-side filter set into the exact keyword-argument
 *  payload the Supabase RPC expects. Keys are snake_case p_* names.
 *  Only defined values are included so nulls don't overwrite the RPC's
 *  own defaults. Pure — no network call. */
export function filtersToRpcArgs(
  filters: DeepCardSearchFilters,
  sort: DeepCardSearchSort,
  limit: number,
  offset: number,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_sort:   sort,
    p_limit:  limit,
    p_offset: offset,
  }
  const set = <T>(k: string, v: T | undefined) => { if (v !== undefined) args[k] = v }
  set('p_pokemon_slug',       filters.pokemonSlug)
  set('p_card_name',          filters.cardName)
  set('p_set_name',           filters.setName)
  set('p_language',           filters.language)
  set('p_year_min',           filters.releaseYearMin)
  set('p_year_max',           filters.releaseYearMax)
  set('p_raw_min',            filters.rawMin)
  set('p_raw_max',            filters.rawMax)
  set('p_psa7_min',           filters.psa7Min)
  set('p_psa7_max',           filters.psa7Max)
  set('p_psa8_min',           filters.psa8Min)
  set('p_psa8_max',           filters.psa8Max)
  set('p_psa9_min',           filters.psa9Min)
  set('p_psa9_max',           filters.psa9Max)
  set('p_psa10_min',          filters.psa10Min)
  set('p_psa10_max',          filters.psa10Max)
  set('p_change_7d_min',      filters.change7dMin)
  set('p_change_7d_max',      filters.change7dMax)
  set('p_change_30d_min',     filters.change30dMin)
  set('p_change_30d_max',     filters.change30dMax)
  set('p_change_90d_min',     filters.change90dMin)
  set('p_change_90d_max',     filters.change90dMax)
  set('p_psa9_uplift_min',    filters.psa9UpliftMin)
  set('p_psa10_uplift_min',   filters.psa10UpliftMin)
  set('p_psa9_multiple_min',  filters.psa9MultipleMin)
  set('p_psa10_multiple_min', filters.psa10MultipleMin)
  return args
}

// ─── Currency helpers (GBP <-> USD cents) ───────────────────────
// Block 5A-W-56A uses a single conservative FX constant — matches
// the site-wide 0.79 GBP-per-USD used by the grading calculator and
// the chat edge function. If a live-rate feed lands later, swap the
// constant here.

export const USD_PER_GBP_RATE = 1 / 0.79   // ≈ 1.266 USD per 1 GBP

/** Convert a GBP amount (e.g. 70) to USD cents. Returns undefined for
 *  non-finite inputs so it composes cleanly with optional filters. */
export function poundsToUsdCents(gbp: number | null | undefined): number | undefined {
  if (gbp == null || !Number.isFinite(gbp)) return undefined
  return Math.round(gbp * USD_PER_GBP_RATE * 100)
}

/** Convert USD cents back to whole GBP. Rounds down to nearest whole
 *  pound so filter chips read cleanly (£70 not £69.87). */
export function usdCentsToPounds(cents: number | null | undefined): number | undefined {
  if (cents == null || !Number.isFinite(cents)) return undefined
  return Math.floor(cents / USD_PER_GBP_RATE / 100)
}

// ─── Filter chip labels (used by the active-chips row + a11y) ───

/** Human-readable label + a URL-slug identifier for each active
 *  filter. UI renders these as removable pills above the results. */
export interface ActiveFilterChip {
  key:   keyof DeepCardSearchFilters
  label: string
}

export function activeFilterChips(f: DeepCardSearchFilters): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = []
  if (f.pokemonSlug) chips.push({ key: 'pokemonSlug', label: `Pokémon: ${capitalize(f.pokemonSlug)}` })
  if (f.cardName)    chips.push({ key: 'cardName',    label: `Name: ${f.cardName}` })
  if (f.setName)     chips.push({ key: 'setName',     label: `Set: ${f.setName}` })
  if (f.language)    chips.push({ key: 'language',    label: f.language === 'jp' ? 'Japanese only' : 'English only' })
  if (f.releaseYearMin != null || f.releaseYearMax != null) {
    const lo = f.releaseYearMin != null ? String(f.releaseYearMin) : 'any'
    const hi = f.releaseYearMax != null ? String(f.releaseYearMax) : 'any'
    chips.push({ key: 'releaseYearMin', label: `Year: ${lo} – ${hi}` })
  }
  for (const [prefix, minK, maxK, gradeLabel] of GRADE_CHIP_SPEC) {
    const min = f[minK] as number | undefined
    const max = f[maxK] as number | undefined
    if (min != null || max != null) {
      const loStr = min != null ? `£${usdCentsToPounds(min) ?? Math.round(min / 100)}` : 'any'
      const hiStr = max != null ? `£${usdCentsToPounds(max) ?? Math.round(max / 100)}` : 'any'
      chips.push({ key: minK, label: `${gradeLabel}: ${loStr} – ${hiStr}` })
      void prefix
    }
  }
  for (const [minK, maxK, label] of PCT_CHIP_SPEC) {
    const min = f[minK] as number | undefined
    const max = f[maxK] as number | undefined
    if (min != null || max != null) {
      const lo = min != null ? `${min > 0 ? '+' : ''}${min}%` : 'any'
      const hi = max != null ? `${max > 0 ? '+' : ''}${max}%` : 'any'
      chips.push({ key: minK, label: `${label}: ${lo} – ${hi}` })
    }
  }
  if (f.psa9UpliftMin  != null) chips.push({ key: 'psa9UpliftMin',  label: `PSA 9 uplift ≥ £${usdCentsToPounds(f.psa9UpliftMin)}` })
  if (f.psa10UpliftMin != null) chips.push({ key: 'psa10UpliftMin', label: `PSA 10 uplift ≥ £${usdCentsToPounds(f.psa10UpliftMin)}` })
  if (f.psa9MultipleMin  != null) chips.push({ key: 'psa9MultipleMin',  label: `PSA 9 ≥ ${f.psa9MultipleMin}× raw` })
  if (f.psa10MultipleMin != null) chips.push({ key: 'psa10MultipleMin', label: `PSA 10 ≥ ${f.psa10MultipleMin}× raw` })
  return chips
}

const GRADE_CHIP_SPEC: readonly [string, keyof DeepCardSearchFilters, keyof DeepCardSearchFilters, string][] = [
  ['raw',   'rawMin',   'rawMax',   'Raw'],
  ['psa7',  'psa7Min',  'psa7Max',  'PSA 7'],
  ['psa8',  'psa8Min',  'psa8Max',  'PSA 8'],
  ['psa9',  'psa9Min',  'psa9Max',  'PSA 9'],
  ['psa10', 'psa10Min', 'psa10Max', 'PSA 10'],
]

const PCT_CHIP_SPEC: readonly [keyof DeepCardSearchFilters, keyof DeepCardSearchFilters, string][] = [
  ['change7dMin',  'change7dMax',  '7d change'],
  ['change30dMin', 'change30dMax', '30d change'],
  ['change90dMin', 'change90dMax', '90d change'],
]

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Return a new filter set with the given key removed. Pure. */
export function removeFilter(
  f: DeepCardSearchFilters,
  key: keyof DeepCardSearchFilters,
): DeepCardSearchFilters {
  const out = { ...f }
  delete out[key]
  // Special-case ranges — removing a "min" chip should also clear the
  // paired "max" so the chip disappears entirely.
  if (key.endsWith('Min')) {
    const pair = (key as string).replace(/Min$/, 'Max') as keyof DeepCardSearchFilters
    if (pair in out) delete out[pair]
  }
  return out
}
