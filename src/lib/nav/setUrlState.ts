// src/lib/nav/setUrlState.ts
//
// Block 5A-W-50E — parse/serialize the set page sort state carried in
// the URL. Only the existing SortOption values in SetPageClient are
// accepted; unknown values silently fall back to the default so a
// stale bookmark keeps working.

export type SetSort = 'raw_desc' | 'raw_asc' | 'psa10_desc' | 'name_asc' | 'number_asc'

export const SET_DEFAULTS = {
  sort: 'raw_desc' as SetSort,
}

const SORTS: readonly SetSort[] = ['raw_desc', 'raw_asc', 'psa10_desc', 'name_asc', 'number_asc']

export function parseSetUrl(params: URLSearchParams): { sort: SetSort } {
  const raw = params.get('sort')
  if (!raw) return { sort: SET_DEFAULTS.sort }
  if (!(SORTS as readonly string[]).includes(raw)) return { sort: SET_DEFAULTS.sort }
  return { sort: raw as SetSort }
}

export function serializeSetUrl(state: { sort: SetSort }, existing: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(existing.toString())
  if (state.sort === SET_DEFAULTS.sort) out.delete('sort')
  else out.set('sort', state.sort)
  return out
}

export const __TEST__ = { SORTS }
