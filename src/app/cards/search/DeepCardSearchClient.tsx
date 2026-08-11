'use client'
// Block 5A-W-56A — Deep Card Search client shell. Owns filter state,
// search-params sync, RPC calls and layout switching (desktop table
// vs mobile cards). Filter panel + results table are separated into
// their own modules so this file stays readable.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import {
  filtersToSearchParams,
  searchParamsToFilters,
  filtersToRpcArgs,
  activeFilterChips,
  removeFilter,
  SORT_KEYS,
  SORT_LABELS,
  DEFAULT_SORT,
  type DeepCardSearchFilters,
  type DeepCardSearchSort,
} from '@/lib/deepSearch/filters'
import SearchFilters from './SearchFilters'
import SearchResults, { type SearchResultRow } from './SearchResults'
import AiFilterInput from './AiFilterInput'

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

interface RpcResponse {
  rows:         SearchResultRow[]
  total_count:  number
  limit:        number
  offset:       number
  sort:         DeepCardSearchSort
}

export default function DeepCardSearchClient({ catalogueCount }: { catalogueCount: number | null }) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  // Filter state hydrated from the URL on mount so a shared link
  // preserves the search. Updates flow both ways: user changes →
  // state → replace URL; browser back/forward → URL → state.
  const initial = useMemo(() => searchParamsToFilters(searchParams?.toString() ?? ''), [])
  const [filters,   setFilters]   = useState<DeepCardSearchFilters>(initial.filters)
  const [sort,      setSort]      = useState<DeepCardSearchSort>(initial.sort)
  const [pageSize,  setPageSize]  = useState<PageSize>(50)
  const [page,      setPage]      = useState(0)

  const [rows,      setRows]      = useState<SearchResultRow[]>([])
  const [total,     setTotal]     = useState<number | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [aiNotice,  setAiNotice]  = useState<string | null>(null)
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  // View analytics — once per mount.
  useEffect(() => {
    trackEvent('deep_search_view', {
      has_initial_filters: Object.keys(initial.filters).length > 0 ? 'true' : 'false',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push filter state into the URL as a shallow replace so back /
  // forward navigation works but doesn't spam history.
  useEffect(() => {
    const sp = filtersToSearchParams(filters, sort)
    const qs = sp.toString()
    const nextUrl = qs ? `${pathname}?${qs}` : pathname
    // Avoid an infinite loop: only replace if the URL actually differs
    // from what's live. useRouter().replace triggers a re-render.
    const current = searchParams?.toString() ?? ''
    if (qs !== current) router.replace(nextUrl, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort])

  // Debounce card-name so we don't RPC on every keystroke.
  const debouncedCardName = useDebounced(filters.cardName, 300)
  const effectiveFilters: DeepCardSearchFilters = useMemo(
    () => ({ ...filters, cardName: debouncedCardName }),
    [filters, debouncedCardName],
  )

  // Fetch on filter / sort / paging change.
  useEffect(() => {
    let live = true
    setLoading(true)
    const args = filtersToRpcArgs(effectiveFilters, sort, pageSize, page * pageSize)
    supabase.rpc('search_cards_deep', args).then(({ data, error }) => {
      if (!live) return
      if (error || !data) {
        setRows([])
        setTotal(0)
      } else {
        const parsed = data as RpcResponse
        setRows(parsed.rows ?? [])
        setTotal(typeof parsed.total_count === 'number' ? parsed.total_count : 0)
      }
      setLoading(false)
    })
    return () => { live = false }
  }, [effectiveFilters, sort, page, pageSize])

  // Reset to page 0 when the filter set changes (any key edit).
  const filtersHash = JSON.stringify(effectiveFilters)
  useEffect(() => { setPage(0) }, [filtersHash, sort])

  const chips     = activeFilterChips(filters)
  const totalPages = total != null && total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 0

  const onManualEdit = useCallback((patch: Partial<DeepCardSearchFilters>) => {
    setFilters(prev => {
      const next: DeepCardSearchFilters = { ...prev }
      for (const [k, v] of Object.entries(patch) as [keyof DeepCardSearchFilters, unknown][]) {
        if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) {
          delete (next as any)[k]
        } else {
          (next as any)[k] = v
        }
      }
      return next
    })
    setAiNotice(null)
    trackEvent('deep_search_manual_filter', {
      filter_keys: Object.keys(patch).join(','),
    })
  }, [])

  const onClearAll = useCallback(() => {
    setFilters({})
    setSort(DEFAULT_SORT)
    setAiNotice(null)
  }, [])

  const onChipRemove = useCallback((key: keyof DeepCardSearchFilters) => {
    setFilters(prev => removeFilter(prev, key))
  }, [])

  const onAiParsed = useCallback((
    parsedFilters: DeepCardSearchFilters,
    parsedSort:    DeepCardSearchSort | undefined,
    unsupportedTerms: string[],
  ) => {
    setFilters(parsedFilters)
    if (parsedSort) setSort(parsedSort)
    setPage(0)
    setAiNotice(unsupportedTerms.length > 0
      ? `Filter applied. ${unsupportedTerms.join(', ')} isn't available yet.`
      : null)
    trackEvent('deep_search_ai_success', {
      filter_keys:  Object.keys(parsedFilters).join(','),
      unsupported:  unsupportedTerms.join(',') || 'none',
    })
  }, [])

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 24px' }}>
      {/* Hero */}
      <header style={{ marginBottom: 22 }}>
        <div style={{
          display: 'inline-block', fontSize: 10, fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: 1.6,
          background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
          padding: '3px 10px', borderRadius: 999,
          fontFamily: "'Figtree', sans-serif", marginBottom: 10,
        }}>PokePrices Tool</div>
        <h1 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 32, margin: '0 0 8px',
          color: 'var(--text)', letterSpacing: -0.5, lineHeight: 1.15,
        }}>
          Deep Card Search
        </h1>
        <p style={{
          fontSize: 15, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: '0 0 6px', lineHeight: 1.55, maxWidth: 780,
        }}>
          Find the right Pokémon card for your budget, collection or strategy.
        </p>
        <p style={{
          fontSize: 13, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: 0, lineHeight: 1.55, maxWidth: 780,
        }}>
          Search every English and Japanese Pokémon card by price, PSA grade, Pokémon, set, age and price movement — or simply describe what you&apos;re looking for.
          {catalogueCount ? ` Search across ${catalogueCount.toLocaleString()} English and Japanese Pokémon cards.` : ''}
        </p>
      </header>

      {/* NL box + example searches */}
      <AiFilterInput onParsed={onAiParsed} />

      {/* Layout: filter panel + results */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)',
        gap: 20,
        marginTop: 22,
      }} className="deep-search-grid">
        {/* Desktop sidebar */}
        <aside className="deep-search-sidebar" style={{ minWidth: 0 }}>
          <SearchFilters
            filters={filters}
            onChange={onManualEdit}
            onClearAll={onClearAll}
          />
        </aside>

        <div style={{ minWidth: 0 }}>
          {/* Mobile filter open button — shown only on narrow */}
          <button
            className="deep-search-mobile-filter-btn"
            onClick={() => setFilterDrawerOpen(true)}
            style={{
              display: 'none',
              width: '100%',
              padding: '11px 16px',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--text)',
              fontSize: 14, fontWeight: 700,
              fontFamily: "'Figtree', sans-serif",
              marginBottom: 14,
              cursor: 'pointer',
            }}
          >
            Filters ({chips.length})
          </button>

          {/* Active chips + sort + result count */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap', marginBottom: 14,
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              {loading
                ? 'Searching…'
                : total != null
                  ? `${total.toLocaleString()} matching card${total === 1 ? '' : 's'}`
                  : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                Sort
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as DeepCardSearchSort)}
                style={selectStyle}
              >
                {SORT_KEYS.map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </div>
          </div>

          {chips.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {chips.map(chip => (
                <button
                  key={chip.key}
                  onClick={() => onChipRemove(chip.key)}
                  style={chipStyle}
                  aria-label={`Remove filter: ${chip.label}`}
                >
                  {chip.label}
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>×</span>
                </button>
              ))}
              <button onClick={onClearAll} style={{ ...chipStyle, background: 'transparent' }}>
                Clear all
              </button>
            </div>
          )}

          {aiNotice && (
            <div role="status" style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 14,
              background: 'rgba(245,158,11,0.10)',
              border: '1px solid rgba(245,158,11,0.30)',
              color: '#92400e', fontSize: 12,
              fontFamily: "'Figtree', sans-serif", lineHeight: 1.5,
            }}>
              {aiNotice}
            </div>
          )}

          <SearchResults
            rows={rows}
            loading={loading}
            filters={filters}
            onClearFilters={onClearAll}
          />

          {/* Pagination */}
          {total != null && total > pageSize && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: 12, flexWrap: 'wrap', marginTop: 18,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                  Per page
                </label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
                  style={selectStyle}
                >
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0 || loading}
                  style={pageBtnStyle(page === 0 || loading)}
                >
                  ← Prev
                </button>
                <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
                  disabled={page + 1 >= totalPages || loading}
                  style={pageBtnStyle(page + 1 >= totalPages || loading)}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile filter drawer */}
      {filterDrawerOpen && (
        <div
          role="dialog"
          aria-label="Filters"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            zIndex: 1000, display: 'flex', alignItems: 'flex-end',
          }}
          onClick={e => e.target === e.currentTarget && setFilterDrawerOpen(false)}
        >
          <div style={{
            background: 'var(--card)', width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
            borderTopLeftRadius: 18, borderTopRightRadius: 18,
            padding: '20px 20px 30px',
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0 }}>Filters</h2>
              <button
                onClick={() => setFilterDrawerOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}
                aria-label="Close filters"
              >×</button>
            </div>
            <SearchFilters filters={filters} onChange={onManualEdit} onClearAll={() => { onClearAll(); setFilterDrawerOpen(false) }} />
            <button
              onClick={() => setFilterDrawerOpen(false)}
              style={{
                width: '100%', marginTop: 16,
                padding: '12px', borderRadius: 10, border: 'none',
                background: 'var(--primary)', color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'Figtree', sans-serif",
              }}
            >
              Show {total ?? 0} result{total === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}

      {/* Mobile responsive rules — hide sidebar, show button */}
      <style jsx>{`
        @media (max-width: 900px) {
          :global(.deep-search-grid) {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          :global(.deep-search-sidebar) {
            display: none;
          }
          :global(.deep-search-mobile-filter-btn) {
            display: block !important;
          }
        }
      `}</style>
    </div>
  )
}

// ─── Small hooks + styles ─────────────────────────────

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  const ref = useRef<T>(value)
  useEffect(() => {
    ref.current = value
    const t = setTimeout(() => setV(ref.current), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const selectStyle: React.CSSProperties = {
  padding: '7px 12px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
  cursor: 'pointer',
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '5px 12px', borderRadius: 999,
  background: 'var(--bg-light)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 12, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 8,
    background: 'var(--card)', border: '1px solid var(--border)',
    color: disabled ? 'var(--text-muted)' : 'var(--text)',
    fontSize: 13, fontWeight: 700,
    fontFamily: "'Figtree', sans-serif",
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}
