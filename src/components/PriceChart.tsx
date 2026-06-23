'use client'
import { useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatChartPrice } from '@/lib/supabase'

export interface ChartSeries {
  /** dataKey present on each row of `data` (e.g. 'raw_usd'). */
  key: string
  label: string
  color: string
  /** Visible by default. */
  defaultOn?: boolean
}

export type ChartRange = '7d' | '30d' | '90d' | '6m' | '1y' | 'all'

interface PriceChartProps {
  data: Record<string, any>[]
  series?: ChartSeries[]
  height?: number
  /** Optional note shown beneath the toggle row (e.g. "new tiers limited history"). */
  note?: string
  /** Override the default cents-to-USD formatter (axis ticks + tooltip). */
  valueFormatter?: (v: number) => string
  /** When true, render a 7D / 30D / 90D / 6M / 1Y / All range selector
   *  above the chart. Filtering is anchored to the latest data point, not
   *  Date.now(), so stale datasets still render. */
  ranges?: boolean
}

const defaultSeries: ChartSeries[] = [
  { key: 'raw_usd',   label: 'Raw',    color: 'var(--primary)',     defaultOn: true },
  { key: 'psa9_usd',  label: 'PSA 9',  color: 'var(--type-water)',  defaultOn: true },
  { key: 'psa10_usd', label: 'PSA 10', color: 'var(--accent)',      defaultOn: true },
]

const RANGE_OPTIONS: { key: ChartRange; label: string }[] = [
  { key: '7d',  label: '7D'  },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '6m',  label: '6M'  },
  { key: '1y',  label: '1Y'  },
  { key: 'all', label: 'All' },
]

/**
 * Compute the cutoff date string (YYYY-MM-DD) for a range, anchored to
 * the supplied latest-date string. Returns null for the 'all' range.
 * Exported for unit tests.
 */
export function rangeCutoff(latestDate: string, range: ChartRange): string | null {
  if (range === 'all') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latestDate)
  if (!m) return null
  // Parse as UTC so timezone shifts cannot bump the cutoff a day forward.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  switch (range) {
    case '7d':  d.setUTCDate(d.getUTCDate() - 7);   break
    case '30d': d.setUTCDate(d.getUTCDate() - 30);  break
    case '90d': d.setUTCDate(d.getUTCDate() - 90);  break
    case '6m':  d.setUTCMonth(d.getUTCMonth() - 6); break
    case '1y':  d.setUTCFullYear(d.getUTCFullYear() - 1); break
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Filter a sorted-ASC price-history dataset to the supplied range.
 * Falls back to the full dataset if the filtered set has <2 points
 * (charts need at least two points to render a line). Exported for
 * unit tests.
 */
export function applyRange<T extends { date: string }>(rows: T[], range: ChartRange): T[] {
  if (range === 'all' || rows.length < 2) return rows
  const latest = rows[rows.length - 1]?.date
  if (!latest) return rows
  const cutoff = rangeCutoff(latest, range)
  if (!cutoff) return rows
  const filtered = rows.filter(r => r.date >= cutoff)
  return filtered.length >= 2 ? filtered : rows
}

/**
 * Pick a sensible default range for the given dataset. 90D when the
 * dataset spans at least ~90 days; otherwise 'all'. Exported for tests.
 */
export function pickDefaultRange<T extends { date: string }>(rows: T[]): ChartRange {
  if (rows.length < 2) return 'all'
  const first = rows[0]?.date
  const last  = rows[rows.length - 1]?.date
  if (!first || !last) return 'all'
  const ms = Date.parse(last + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')
  if (Number.isFinite(ms) && ms / 86_400_000 >= 90) return '90d'
  return 'all'
}

export default function PriceChart({ data, series, height = 260, note, valueFormatter, ranges }: PriceChartProps) {
  const allSeries = series ?? defaultSeries
  const fmt = valueFormatter ?? formatChartPrice

  // Hide series with no data anywhere in the history (keeps the toggle row tidy).
  const seriesWithData = allSeries.filter(s =>
    s.defaultOn || data.some(d => d[s.key] != null && d[s.key] !== 0)
  )

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(allSeries.filter(s => s.defaultOn).map(s => s.key))
  )

  const dated = data as Array<Record<string, any> & { date: string }>
  const initialRange = useMemo(() => ranges ? pickDefaultRange(dated) : 'all', [ranges, dated])
  const [range, setRange] = useState<ChartRange>(initialRange)

  const filtered = useMemo(
    () => ranges ? applyRange(dated, range) : dated,
    [ranges, dated, range],
  )

  // The "not enough data" message is gated on the ORIGINAL dataset so a
  // user picking a narrow range on a sparse card cannot wipe out the
  // chart entirely — applyRange already falls back to the full dataset
  // in that case.
  if (!data || data.length < 2) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 13, background: 'var(--bg)', borderRadius: 10,
      }}>
        Not enough price history data yet
      </div>
    )
  }

  const formatted = filtered.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
  }))

  const toggle = (key: string) => {
    setVisible(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div style={{ width: '100%' }}>
      {ranges && (
        <div
          role="tablist"
          aria-label="Price history range"
          style={{
            display:       'flex',
            flexWrap:      'wrap',
            justifyContent:'flex-end',
            gap:            4,
            marginBottom:   8,
          }}
        >
          {RANGE_OPTIONS.map(opt => {
            const active = opt.key === range
            return (
              <button
                key={opt.key}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setRange(opt.key)}
                style={{
                  padding:     '4px 10px',
                  fontSize:     11,
                  fontWeight:   700,
                  background:   active ? 'var(--accent)' : 'transparent',
                  color:        active ? '#fff'          : 'var(--text-muted)',
                  border:      '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
                  borderRadius: 6,
                  cursor:      'pointer',
                  fontFamily:  "'Figtree', sans-serif",
                  lineHeight:   1.4,
                  transition:  'background-color 0.12s, border-color 0.12s, color 0.12s',
                }}
              >{opt.label}</button>
            )
          })}
        </div>
      )}

      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={formatted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmt(v)}
              width={55}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              formatter={(value: number, name: string) => {
                const s = allSeries.find(x => x.key === name)
                return [fmt(value), s?.label || name]
              }}
            />
            {allSeries.filter(s => visible.has(s.key)).map(s => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Toggle pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
        {seriesWithData.map(s => {
          const on = visible.has(s.key)
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={on}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 16,
                border: `1px solid ${on ? 'currentColor' : 'var(--border)'}`,
                background: on ? 'var(--bg-light)' : 'transparent',
                color: on ? s.color : 'var(--text-muted)',
                fontSize: 11, fontWeight: 700,
                fontFamily: "'Figtree', sans-serif",
                cursor: 'pointer',
                opacity: on ? 1 : 0.7,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 4,
                background: on ? s.color : 'var(--border)',
                display: 'inline-block',
              }} />
              {s.label}
            </button>
          )
        })}
      </div>

      {note && (
        <p style={{
          fontSize: 11, color: 'var(--text-muted)', textAlign: 'center',
          margin: '10px 0 0', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5,
        }}>
          {note}
        </p>
      )}
    </div>
  )
}
