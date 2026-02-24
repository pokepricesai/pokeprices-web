'use client'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { formatChartPrice } from '@/lib/supabase'

interface PriceChartProps {
  data: { date: string; raw_usd?: number | null; psa9_usd?: number | null; psa10_usd?: number | null; median_usd?: number | null; value_usd?: number | null }[]
  lines?: { key: string; color: string; label: string }[]
  height?: number
}

const defaultCardLines = [
  { key: 'raw_usd', color: 'var(--primary)', label: 'Raw' },
  { key: 'psa9_usd', color: 'var(--type-water)', label: 'PSA 9' },
  { key: 'psa10_usd', color: 'var(--accent)', label: 'PSA 10' },
]

export default function PriceChart({ data, lines, height = 260 }: PriceChartProps) {
  const chartLines = lines || defaultCardLines

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

  // Format date labels
  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
  }))

  return (
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
            tickFormatter={(v) => formatChartPrice(v)}
            width={55}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 10, fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
            formatter={(value: number, name: string) => {
              const line = chartLines.find((l) => l.key === name)
              return [formatChartPrice(value), line?.label || name]
            }}
          />
          {chartLines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8 }}>
        {chartLines.map((line) => (
          <div key={line.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 3, borderRadius: 2, background: line.color }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{line.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
