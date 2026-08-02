// src/lib/nav/browseUrlState.ts
//
// Block 5A-W-50E — parse/serialize the browse page filter state
// carried in the URL. The exact sort identifiers currently in
// BrowsePageClient must be preserved verbatim so bookmarked URLs
// with the pre-block sort names continue to work.

export type LanguageFilter = 'en' | 'jp' | 'all'
export type BrowseSort =
  | 'release_desc'
  | 'release_asc'
  | 'az'
  | 'za'
  | 'price_desc'
  | 'price_asc'
  | 'cards_desc'
  | 'completion_desc'

export interface BrowseUrlState {
  language: LanguageFilter
  era: string
  sort: BrowseSort
  q: string
}

export const BROWSE_DEFAULTS: BrowseUrlState = {
  language: 'en',
  era: 'all',
  sort: 'release_desc',
  q: '',
}

const LANGUAGES: readonly LanguageFilter[] = ['en', 'jp', 'all']
const SORTS: readonly BrowseSort[] = [
  'release_desc', 'release_asc', 'az', 'za',
  'price_desc', 'price_asc', 'cards_desc', 'completion_desc',
]
const Q_MAX = 60

function parseLanguage(v: string | null): LanguageFilter {
  return (LANGUAGES as readonly string[]).includes(v ?? '') ? (v as LanguageFilter) : BROWSE_DEFAULTS.language
}

function parseSort(v: string | null, canUseCompletion: boolean): BrowseSort {
  if (!v) return BROWSE_DEFAULTS.sort
  if (!(SORTS as readonly string[]).includes(v)) return BROWSE_DEFAULTS.sort
  if (v === 'completion_desc' && !canUseCompletion) return BROWSE_DEFAULTS.sort
  return v as BrowseSort
}

function parseQ(v: string | null): string {
  if (!v) return ''
  const trimmed = v.trim()
  if (trimmed.length === 0) return ''
  return trimmed.slice(0, Q_MAX)
}

function parseEra(v: string | null): string {
  if (!v) return BROWSE_DEFAULTS.era
  // Era values are user-facing strings from ERA_DISPLAY_NAMES / ERA_ORDER.
  // We accept any non-empty string; the page silently ignores unknown eras
  // by falling through the filter chain.
  return v.length > 0 ? v : BROWSE_DEFAULTS.era
}

export function parseBrowseUrl(
  params: URLSearchParams,
  opts: { canUseCompletion: boolean },
): BrowseUrlState {
  return {
    language: parseLanguage(params.get('language')),
    era: parseEra(params.get('era')),
    sort: parseSort(params.get('sort'), opts.canUseCompletion),
    q: parseQ(params.get('q')),
  }
}

/**
 * Merge our four state values back into an existing URLSearchParams,
 * preserving any unrelated keys. Values equal to the default are
 * removed. Returns a fresh URLSearchParams; the caller decides whether
 * to build the URL with router.replace.
 */
export function serializeBrowseUrl(
  state: BrowseUrlState,
  existing: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(existing.toString())
  const set = (k: keyof BrowseUrlState, def: string) => {
    const v = state[k]
    if (v == null || v === def || v === '') out.delete(k)
    else out.set(k, String(v))
  }
  set('language', BROWSE_DEFAULTS.language)
  set('era', BROWSE_DEFAULTS.era)
  set('sort', BROWSE_DEFAULTS.sort)
  set('q', BROWSE_DEFAULTS.q)
  return out
}

export const __TEST__ = { LANGUAGES, SORTS, Q_MAX }
