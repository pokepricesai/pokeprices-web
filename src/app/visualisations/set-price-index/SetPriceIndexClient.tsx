'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import PriceChart, { type ChartSeries } from '@/components/PriceChart'

interface SetInfo {
  set_name: string
  card_count: number
  avg_raw_usd: number | null
  total_raw_usd: number | null
  set_release_date: string | null
}

interface HistRow {
  date: string
  value_usd: number | null   // cents — RPC returns dollars, we convert
}

// Up to this many sets can be compared at once. Three is the sweet spot
// before the chart legend gets noisy.
const MAX_SELECTED = 3

// Colour palette for the chart series (one per selected set).
const SERIES_COLOURS = ['var(--primary)', 'var(--accent)', '#22c55e', '#ec4899']

type ChartMode = 'absolute' | 'indexed'

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}k`
  if (d >= 100)       return `$${Math.round(d).toLocaleString('en-US')}`
  return `$${d.toFixed(2)}`
}

async function fetchSetHistory(setName: string): Promise<HistRow[]> {
  const { data } = await supabase.rpc('get_set_price_history', { set_text: setName })
  if (!data) return []
  // RPC returns value_usd in DOLLARS; the rest of the app (and PriceChart's
  // formatter) operates in cents. Convert here so everything stays consistent.
  return (data as any[])
    .map(d => ({ date: d.date, value_usd: d.value_usd != null ? Math.round(d.value_usd * 100) : null }))
    .filter(d => d.date)
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Merge per-set histories into one chart-friendly array keyed by date.
// Each row gets a `value_<sanitised set name>` field with the cents value.
function mergeHistories(histories: { setName: string; key: string; rows: HistRow[] }[]) {
  const byDate = new Map<string, Record<string, any>>()
  for (const h of histories) {
    for (const r of h.rows) {
      const existing = byDate.get(r.date) ?? { date: r.date }
      existing[h.key] = r.value_usd
      byDate.set(r.date, existing)
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// Stable, JS-identifier-friendly key for a set name (chart libs object-key it).
function setKey(name: string): string {
  return 'v_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export default function SetPriceIndexClient() {
  const [allSets, setAllSets]       = useState<SetInfo[]>([])
  const [loadingSets, setLoadingSets] = useState(true)

  const [selected, setSelected]     = useState<string[]>([])
  const [historyMap, setHistoryMap] = useState<Record<string, HistRow[]>>({})
  const [loadingHist, setLoadingHist] = useState(false)

  const [query, setQuery] = useState('')
  const [chartMode, setChartMode] = useState<ChartMode>('indexed')

  // Load the set list once, pre-select two recent popular sets as defaults
  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_set_list_v2').then(({ data }) => {
      if (cancelled) return
      const list = ((data || []) as SetInfo[])
        .filter(s => s.card_count > 0)
      setAllSets(list)
      setLoadingSets(false)
      // Default pre-selection: two highest-value sets we know are tracked
      const defaults = [...list]
        .filter(s => s.total_raw_usd != null)
        .sort((a, b) => (b.total_raw_usd ?? 0) - (a.total_raw_usd ?? 0))
        .slice(0, 2)
        .map(s => s.set_name)
      if (defaults.length > 0) setSelected(defaults)
    })
    return () => { cancelled = true }
  }, [])

  // Fetch history for any selected set we don't already have
  useEffect(() => {
    const missing = selected.filter(s => !historyMap[s])
    if (missing.length === 0) return
    let cancelled = false
    setLoadingHist(true)
    Promise.all(missing.map(name => fetchSetHistory(name).then(rows => ({ name, rows }))))
      .then(results => {
        if (cancelled) return
        setHistoryMap(prev => {
          const next = { ...prev }
          for (const r of results) next[r.name] = r.rows
          return next
        })
        setLoadingHist(false)
      })
    return () => { cancelled = true }
  }, [selected])

  function toggle(setName: string) {
    setSelected(prev => {
      if (prev.includes(setName)) return prev.filter(s => s !== setName)
      if (prev.length >= MAX_SELECTED) {
        // Drop the oldest to make room
        return [...prev.slice(1), setName]
      }
      return [...prev, setName]
    })
  }

  const merged = useMemo(() => {
    if (selected.length === 0) return []
    const series = selected.map(name => {
      const rows = historyMap[name] ?? []
      // For indexed mode, normalise to 100 at the first non-null point.
      // Without this, comparing a $5M set to a $200k set squashes one line
      // into the X-axis. Indexed mode plots % change from the start.
      if (chartMode === 'indexed') {
        const base = rows.find(r => r.value_usd != null && r.value_usd > 0)?.value_usd ?? null
        const normalised = rows.map(r => ({
          date: r.date,
          value_usd: (base && r.value_usd != null) ? (r.value_usd / base) * 100 : null,
        }))
        return { setName: name, key: setKey(name), rows: normalised }
      }
      return { setName: name, key: setKey(name), rows }
    })
    return mergeHistories(series)
  }, [selected, historyMap, chartMode])

  const chartSeries: ChartSeries[] = useMemo(() => selected.map((name, i) => ({
    key: setKey(name),
    label: name,
    color: SERIES_COLOURS[i % SERIES_COLOURS.length],
    defaultOn: true,
  })), [selected])

  const setLookup = useMemo(() => {
    const m: Record<string, SetInfo> = {}
    for (const s of allSets) m[s.set_name] = s
    return m
  }, [allSets])

  const filteredSets = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Default ordering: by release date desc, with selected pinned to top
      return [...allSets].sort((a, b) => {
        const aSel = selected.includes(a.set_name) ? 1 : 0
        const bSel = selected.includes(b.set_name) ? 1 : 0
        if (aSel !== bSel) return bSel - aSel
        return (b.set_release_date || '').localeCompare(a.set_release_date || '')
      })
    }
    return allSets.filter(s => s.set_name.toLowerCase().includes(q))
  }, [allSets, query, selected])

  // First-and-last-value summary per selected set. Returns a partial result
  // when the set has only one datapoint so we still show the current value
  // for very new sets — only `pct` is gated on having two non-null points.
  function summarise(setName: string): { first: number | null; last: number | null; pct: number | null } | null {
    const rows = historyMap[setName]
    if (!rows || rows.length === 0) return null
    const firstRow = rows.find(r => r.value_usd != null)
    const lastRow  = [...rows].reverse().find(r => r.value_usd != null)
    const first = firstRow?.value_usd ?? null
    const last  = lastRow?.value_usd ?? null
    if (last == null) return null
    const canComputePct = first != null && first !== 0 && firstRow !== lastRow
    const pct = canComputePct ? ((last - first!) / first!) * 100 : null
    return { first, last, pct }
  }

  // Y-axis formatter — dollars in absolute mode, "100 = start" index in indexed mode
  const valueFormatter = chartMode === 'indexed'
    ? (v: number) => `${Math.round(v)}`
    : (v: number) => {
        if (!v) return '$0'
        const d = v / 100
        if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`
        if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}k`
        if (d >= 100)       return `$${Math.round(d)}`
        return `$${d.toFixed(2)}`
      }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <Link href="/visualisations" style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none',
        textTransform: 'uppercase', letterSpacing: 1.5,
      }}>
        ← All visualisations
      </Link>

      <div style={{ marginTop: 12, marginBottom: 18 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px' }}>
          Set Price Index
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
          Pick up to {MAX_SELECTED} sets to compare. The chart shows the total tracked value of each set over its full history — useful for spotting which sets are running, which are cooling, and how new releases land against the old guard.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 18 }} className="spi-grid">

        {/* Chart + summary */}
        <div>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
            padding: '20px 22px',
          }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.4, fontWeight: 700 }}>
                {chartMode === 'indexed' ? 'Indexed · 100 = first datapoint per set' : 'Absolute · Total set value (USD)'}
              </div>
              <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: 'var(--bg-light)', borderRadius: 10, border: '1px solid var(--border)' }}>
                {(['indexed', 'absolute'] as ChartMode[]).map(m => (
                  <button key={m} onClick={() => setChartMode(m)}
                    style={{
                      padding: '5px 12px', borderRadius: 7, border: 'none',
                      background: chartMode === m ? 'var(--card)' : 'transparent',
                      color: chartMode === m ? 'var(--text)' : 'var(--text-muted)',
                      fontSize: 11, fontWeight: 800, cursor: 'pointer',
                      boxShadow: chartMode === m ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    {m === 'indexed' ? 'Indexed' : 'Absolute'}
                  </button>
                ))}
              </div>
            </div>

            {selected.length === 0 ? (
              <div style={{
                height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 24,
              }}>
                Pick one or more sets from the panel to start comparing.
              </div>
            ) : loadingHist && merged.length === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Loading set history…
              </div>
            ) : (
              <PriceChart
                data={merged}
                series={chartSeries}
                height={300}
                valueFormatter={valueFormatter}
                note={chartMode === 'indexed'
                  ? 'Each set is normalised so its first datapoint equals 100. Lines above 100 are up since launch; below 100 are down. Lets you compare a $5M vintage set against a $200k modern set on the same chart.'
                  : 'Total tracked value across all cards in each set, in USD. Sourced from sold listings, updated nightly.'}
              />
            )}
          </div>

          {/* Per-set stats summary */}
          {selected.length > 0 && (
            <div style={{
              marginTop: 14, display: 'grid', gap: 10,
              gridTemplateColumns: `repeat(${selected.length}, minmax(0, 1fr))`,
            }}>
              {selected.map((name, i) => {
                const info = setLookup[name]
                const sum = summarise(name)
                const colour = SERIES_COLOURS[i % SERIES_COLOURS.length]
                return (
                  <div key={name} style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
                    padding: '14px 16px', minWidth: 0,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: colour, flexShrink: 0 }} />
                      <Link href={`/set/${encodeURIComponent(name)}`} style={{
                        fontSize: 14, fontWeight: 800, color: 'var(--text)', textDecoration: 'none',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{name}</Link>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {info?.card_count ?? '—'} cards tracked
                    </div>
                    {sum ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 900, color: 'var(--text)', letterSpacing: -0.5 }}>
                            {fmtCents(sum.last)}
                          </div>
                          {sum.pct != null && (
                            <div style={{ fontSize: 12, fontWeight: 800, color: sum.pct >= 0 ? '#22c55e' : '#ef4444' }}>
                              {sum.pct >= 0 ? '+' : ''}{sum.pct.toFixed(1)}%
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {sum.pct != null
                            ? `since ${fmtCents(sum.first)}`
                            : 'Just one datapoint so far — % change will appear once we have more.'}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {historyMap[name] === undefined ? 'Loading history…' : 'No history yet for this set.'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Set picker */}
        <aside style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
          padding: 14, display: 'flex', flexDirection: 'column', minWidth: 0, alignSelf: 'start',
          position: 'sticky', top: 72,
        }}>
          <div style={{ marginBottom: 10 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: '0 0 4px' }}>
              Pick sets
            </h2>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
              Up to {MAX_SELECTED}. Selected are pinned at the top.
            </p>
          </div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sets…"
            style={{
              width: '100%', padding: '8px 12px', borderRadius: 10, marginBottom: 10,
              border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)',
              fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
              fontFamily: "'Figtree', sans-serif",
            }}
          />
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 4,
            maxHeight: 420, overflowY: 'auto', minHeight: 0,
            paddingRight: 4,
          }}>
            {loadingSets ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>
            ) : filteredSets.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>No matches.</div>
            ) : filteredSets.slice(0, 100).map(s => {
              const isSel = selected.includes(s.set_name)
              return (
                <button key={s.set_name} onClick={() => toggle(s.set_name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px', borderRadius: 8,
                    border: isSel ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: isSel ? 'rgba(26,95,173,0.10)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', minWidth: 0,
                    fontFamily: "'Figtree', sans-serif",
                  }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                    border: `1.5px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                    background: isSel ? 'var(--primary)' : 'transparent',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: 10, fontWeight: 900,
                  }}>{isSel ? '✓' : ''}</span>
                  <span style={{
                    fontSize: 12.5, fontWeight: isSel ? 800 : 600,
                    color: isSel ? 'var(--primary)' : 'var(--text)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1,
                  }}>{s.set_name}</span>
                </button>
              )
            })}
          </div>
        </aside>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
        Total set value is the sum of every tracked card's current raw price across the set. Sealed product not included. Sets with very limited price history may not render a useful chart yet.
      </p>

      <style jsx>{`
        @media (max-width: 900px) {
          :global(.spi-grid) {
            grid-template-columns: 1fr !important;
          }
          :global(.spi-grid > aside) {
            position: static !important;
          }
        }
      `}</style>
    </div>
  )
}
