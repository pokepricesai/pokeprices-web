'use client'
import { useState } from 'react'
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

interface PriceChartProps {
  data: Record<string, any>[]
  series?: ChartSeries[]
  height?: number
  /** Optional note shown beneath the toggle row (e.g. "new tiers limited history"). */
  note?: string
  /** Override the default cents-to-USD formatter (axis ticks + tooltip). */
  valueFormatter?: (v: number) => string
}

const defaultSeries: ChartSeries[] = [
  { key: 'raw_usd',   label: 'Raw',    color: 'var(--primary)',     defaultOn: true },
  { key: 'psa9_usd',  label: 'PSA 9',  color: 'var(--type-water)',  defaultOn: true },
  { key: 'psa10_usd', label: 'PSA 10', color: 'var(--accent)',      defaultOn: true },
]

export default function PriceChart({ data, series, height = 260, note, valueFormatter }: PriceChartProps) {
  const allSeries = series ?? defaultSeries
  const fmt = valueFormatter ?? formatChartPrice

  // Hide series with no data anywhere in the history (keeps the toggle row tidy).
  const seriesWithData = allSeries.filter(s =>
    s.defaultOn || data.some(d => d[s.key] != null && d[s.key] !== 0)
  )

  const [visible, setVisible] = useState<Set<string>>(
    () => new Set(allSeries.filter(s => s.defaultOn).map(s => s.key))
  )

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

  const formatted = data.map(d => ({
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
