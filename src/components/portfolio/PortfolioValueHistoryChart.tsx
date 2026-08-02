'use client'
// src/components/portfolio/PortfolioValueHistoryChart.tsx
//
// Block 5A-W-50F / FIX1 — historical portfolio-value chart with
// coloured line SEGMENTS (not just dots) attributing each portion of
// the value change to its cause. Segments are rendered as five
// overlaid Recharts <Line> components, each carrying only the pair
// of points that belong to a segment of that colour.
//
// The x-axis is a numeric timestamp so ReferenceDot markers for
// exact event dates render correctly even when the underlying value
// series is weekly / monthly aggregated (Part 10 of FIX1).
//
// The "Market performance excluding contributions (%)" metric from
// the original W50F implementation was misleading — cumulative
// market movement divided by starting value is not a valid return
// when contributions occurred mid-window. FIX1 replaces it with the
// currency-denominated "Market movement excl. additions/removals"
// (Part 11).

import { useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceDot,
} from 'recharts'
import type { DominantCause, HistoryPoint, RangeKey, ValueHistoryResult } from '@/lib/portfolio/valueHistory'

// ── Colour palette ─────────────────────────────────────────────

const CAUSE_COLOURS: Record<DominantCause, string> = {
  market_gain: '#22c55e',
  market_loss: '#ef4444',
  addition:    '#8b5cf6',
  removal:     '#f59e0b',
  adjustment:  '#9ca3af',
  mixed:       '#9ca3af',
  estimated:   '#9ca3af',
  none:        '#9ca3af',
}

const SEGMENT_KEYS: DominantCause[] = [
  'market_gain', 'market_loss', 'addition', 'removal',
  'adjustment', 'mixed', 'estimated', 'none',
]

const CAUSE_LABELS: Record<DominantCause, string> = {
  market_gain: 'Market gain',
  market_loss: 'Market loss',
  addition:    'Cards added',
  removal:     'Removed holdings',
  adjustment:  'Value adjustment',
  mixed:       'Mixed activity',
  estimated:   'Estimated from legacy data',
  none:        'No change',
}

// ── Format helpers ─────────────────────────────────────────────

function makeFmt(currency: string) {
  const divisor = currency === 'GBP' ? 127 : 100
  const symbol  = currency === 'GBP' ? '£'  : '$'
  return (cents: number): string => {
    const v = Math.round(cents / divisor)
    if (Math.abs(v) >= 1_000_000) return `${symbol}${(v / 1_000_000).toFixed(1)}M`
    if (Math.abs(v) >= 1_000)     return `${symbol}${(v / 1_000).toFixed(1)}k`
    return `${symbol}${v.toLocaleString('en-GB')}`
  }
}

function makeFmtSigned(currency: string) {
  const inner = makeFmt(currency)
  return (cents: number): string => (cents > 0 ? '+' : '') + inner(cents)
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Range picker ───────────────────────────────────────────────

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7D',  label: '7D'  },
  { key: '30D', label: '30D' },
  { key: '90D', label: '90D' },
  { key: '1Y',  label: '1Y'  },
  { key: 'ALL', label: 'All' },
]

// ── Coloured segment reshape ───────────────────────────────────

/**
 * Distributes the ending-value points across N sibling series, one
 * per possible dominant cause. Each series carries ONLY the two
 * endpoints of every segment coloured with that cause (nulls
 * elsewhere so Recharts skips them with connectNulls={false}).
 *
 * The segment from point[i-1] -> point[i] is coloured by point[i]'s
 * dominantCause. When two adjacent segments share the same cause the
 * two segments naturally connect because the shared point sits in
 * the same series with a non-null value on both sides.
 */
function buildSegmentedSeries(points: HistoryPoint[]): Array<{ ts: number } & Record<string, unknown>> {
  const out: Array<{ ts: number } & Record<string, unknown>> = points.map(p => {
    const row: Record<string, unknown> = { ts: p.ts, date: p.date }
    for (const s of SEGMENT_KEYS) row[`v_${s}`] = null
    // The tooltip receives the full attribution payload via _payload.
    row._payload = p
    return row as { ts: number } & Record<string, unknown>
  })
  for (let i = 1; i < points.length; i++) {
    const seg = points[i].dominantCause
    const key = `v_${seg}`
    out[i - 1][key] = points[i - 1].endingValueCents
    out[i][key]     = points[i].endingValueCents
  }
  return out
}

// ── Component ──────────────────────────────────────────────────

export interface PortfolioValueHistoryChartProps {
  result:        ValueHistoryResult
  currency:      string
  currentRange:  RangeKey
  onRangeChange: (r: RangeKey) => void
  loading?:      boolean
}

export default function PortfolioValueHistoryChart(props: PortfolioValueHistoryChartProps): React.ReactElement {
  const { result, currency, currentRange, onRangeChange, loading } = props

  const fmt       = useMemo(() => makeFmt(currency),       [currency])
  const fmtSigned = useMemo(() => makeFmtSigned(currency), [currency])

  const segmented = useMemo(() => buildSegmentedSeries(result.points), [result.points])

  const startingValue = result.points[0]?.startingValueCents ?? 0
  const endingValue   = result.points[result.points.length - 1]?.endingValueCents ?? 0
  const removalLabel  = result.hasSaleActivity ? 'Sold or removed' : 'Removed holdings'

  // Screen-reader summary sentence.
  const srSummary = useMemo(() => {
    const net = endingValue - startingValue
    const parts: string[] = [
      `Portfolio value ${net >= 0 ? 'increased' : 'decreased'} by ${fmtSigned(net).replace('+', '')}.`,
    ]
    if (result.cumulativeMarketMovementCents !== 0) parts.push(`${fmtSigned(result.cumulativeMarketMovementCents)} was market movement.`)
    if (result.cumulativeAdditionsCents      !== 0) parts.push(`${fmtSigned(result.cumulativeAdditionsCents)} was added holdings.`)
    if (result.cumulativeRemovalsCents       !== 0) parts.push(`${fmtSigned(-result.cumulativeRemovalsCents)} was ${removalLabel.toLowerCase()}.`)
    if (result.cumulativeAdjustmentsCents    !== 0) parts.push(`${fmtSigned(result.cumulativeAdjustmentsCents)} was non-market adjustments.`)
    return parts.join(' ')
  }, [endingValue, startingValue, fmtSigned, removalLabel, result.cumulativeMarketMovementCents, result.cumulativeAdditionsCents, result.cumulativeRemovalsCents, result.cumulativeAdjustmentsCents])

  const rangeControls = (
    <div role="tablist" aria-label="Portfolio history date range" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {RANGES.map(r => {
        const active = currentRange === r.key
        return (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onRangeChange(r.key)}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: active ? 800 : 600,
              color: active ? 'var(--primary)' : 'var(--text-muted)',
              background: active ? 'rgba(26,95,173,0.10)' : 'var(--card)',
              border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 14, cursor: 'pointer',
              fontFamily: "'Figtree', sans-serif",
            }}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )

  if (loading) {
    return (
      <div style={panelStyle} aria-busy="true">
        <ChartHeader currentRange={currentRange} rangeControls={rangeControls} title="Portfolio value history" />
        <div className="skeleton" style={{ height: 240, borderRadius: 12, marginTop: 12 }} />
      </div>
    )
  }
  // FIX2 — when a paginated fetch failed or a safety ceiling was hit
  // we deliberately do NOT display any totals. Partial data would
  // misrepresent market movement and contributions as authoritative.
  if (!result.isComplete) {
    return (
      <div style={panelStyle} role="alert">
        <ChartHeader currentRange={currentRange} rangeControls={rangeControls} title="Portfolio value history" />
        <div style={{
          marginTop: 16, padding: '24px 16px',
          border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-light)',
          fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'var(--text)',
          textAlign: 'center' as const,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Portfolio history could not be loaded completely.
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            Please try changing the date range or refresh the page. If the issue persists, contact support.
          </div>
        </div>
      </div>
    )
  }
  if (result.isEmpty || result.points.length === 0) {
    return (
      <div style={panelStyle}>
        <ChartHeader currentRange={currentRange} rangeControls={rangeControls} title="Portfolio value history" />
        <div style={{
          marginTop: 16, padding: '32px 16px', textAlign: 'center' as const,
          color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif",
        }}>
          No history for this range yet. Add a holding or expand the range to see your portfolio&rsquo;s market value over time.
        </div>
      </div>
    )
  }

  const domainMin = result.points[0].ts
  const domainMax = result.points[result.points.length - 1].ts

  return (
    <div style={panelStyle}>
      <ChartHeader
        currentRange={currentRange}
        rangeControls={rangeControls}
        title="Portfolio value history"
        subtitle={result.hasEstimatedHistory ? 'Some activity for this range is estimated from legacy portfolio data.' : undefined}
      />

      {/* Sub-metric row. FIX1 — the misleading percentage metric has
          been replaced with currency-denominated market movement. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '12px 0 8px', fontFamily: "'Figtree', sans-serif" }}>
        <MetricPill label="Portfolio value" value={fmt(endingValue)} />
        <MetricPill
          label="Market movement (excl. additions/removals)"
          value={fmtSigned(result.cumulativeMarketMovementCents)}
          valueColor={result.cumulativeMarketMovementCents >= 0 ? '#22c55e' : '#ef4444'}
        />
        <MetricPill label="Cards added" value={fmt(result.cumulativeAdditionsCents)} valueColor={CAUSE_COLOURS.addition} />
        <MetricPill label={removalLabel} value={fmt(result.cumulativeRemovalsCents)} valueColor={CAUSE_COLOURS.removal} />
        {result.cumulativeAdjustmentsCents !== 0 && (
          <MetricPill
            label="Adjustments"
            value={fmtSigned(result.cumulativeAdjustmentsCents)}
            valueColor={CAUSE_COLOURS.adjustment}
          />
        )}
      </div>

      <div style={{ width: '100%', height: 240 }} role="img" aria-label={srSummary}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={segmented} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="ts"
              type="number"
              domain={[domainMin, domainMax]}
              tickFormatter={fmtDate}
              minTickGap={40}
              tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'Figtree', sans-serif" }}
              stroke="var(--border)"
            />
            <YAxis
              tickFormatter={fmt}
              tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: "'Figtree', sans-serif" }}
              stroke="var(--border)"
              width={64}
            />
            <Tooltip
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  payload={props.payload as { payload: { _payload: HistoryPoint; ts: number } }[] | undefined}
                  fmt={fmt}
                  fmtSigned={fmtSigned}
                  removalLabel={removalLabel}
                />
              )}
            />
            {/* One <Line> per possible dominant cause. connectNulls=
                false so a series only draws where it has values,
                producing a naturally coloured multi-segment line. */}
            {SEGMENT_KEYS.map(cause => (
              <Line
                key={cause}
                type="monotone"
                dataKey={`v_${cause}`}
                stroke={CAUSE_COLOURS[cause]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: CAUSE_COLOURS[cause] }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {/* Event markers — numeric timestamp x means these render
                correctly whether the series is daily, weekly or
                monthly. Y-anchor uses the nearest bucket's value. */}
            {result.events.map((e, i) => {
              const y = nearestValueForTs(result.points, e.ts)
              if (y == null) return null
              return (
                <ReferenceDot
                  key={`ev-${i}-${e.date}`}
                  x={e.ts}
                  y={y}
                  r={0}
                  shape={(shapeProps: unknown) => {
                    const s = shapeProps as { cx?: number; cy?: number }
                    if (typeof s.cx !== 'number' || typeof s.cy !== 'number') return <g />
                    const color = e.kind === 'sale' || e.kind === 'removal'
                      ? CAUSE_COLOURS.removal
                      : CAUSE_COLOURS.addition
                    const up = e.quantity_delta >= 0
                    const yy = s.cy + (up ? -10 : 10)
                    const points = up
                      ? `${s.cx},${yy - 4} ${s.cx - 4},${yy + 4} ${s.cx + 4},${yy + 4}`
                      : `${s.cx},${yy + 4} ${s.cx - 4},${yy - 4} ${s.cx + 4},${yy - 4}`
                    return <polygon points={points} fill={color} opacity={0.85} />
                  }}
                />
              )
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{
        display: 'flex', flexWrap: 'wrap' as const, gap: 12,
        marginTop: 8, fontSize: 11, color: 'var(--text-muted)',
        fontFamily: "'Figtree', sans-serif",
      }}>
        <LegendItem colour={CAUSE_COLOURS.market_gain} label="Market gain" />
        <LegendItem colour={CAUSE_COLOURS.market_loss} label="Market loss" />
        <LegendItem colour={CAUSE_COLOURS.addition}    label="Cards added" />
        <LegendItem colour={CAUSE_COLOURS.removal}     label={removalLabel} />
        <LegendItem colour={CAUSE_COLOURS.adjustment}  label="Adjustment / mixed / estimated" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 10 }} aria-hidden="true">▲</span>event marker
        </span>
      </div>

      <div className="sr-only" style={srOnlyStyle}>{srSummary}</div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function ChartHeader({ rangeControls, title, subtitle }: {
  currentRange: RangeKey
  rangeControls: React.ReactNode
  title: string
  subtitle?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' as const, justifyContent: 'space-between' }}>
      <div>
        <h2 style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
        {subtitle && (
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {subtitle}
          </p>
        )}
      </div>
      {rangeControls}
    </div>
  )
}

function MetricPill({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{
      background: 'var(--bg-light)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '6px 12px',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: valueColor ?? 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

function LegendItem({ colour, label }: { colour: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span aria-hidden="true" style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: colour,
      }} />
      {label}
    </span>
  )
}

function ChartTooltip({ active, payload, fmt, fmtSigned, removalLabel }: {
  active?: boolean
  payload?: { payload: { _payload: HistoryPoint; ts: number } }[]
  fmt:       (cents: number) => string
  fmtSigned: (cents: number) => string
  removalLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload._payload
  const net = p.endingValueCents - p.startingValueCents
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px', fontFamily: "'Figtree', sans-serif",
      fontSize: 12, color: 'var(--text)', minWidth: 220, boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>{fmtDate(p.ts)}</div>
      <Row label="Portfolio value" value={fmt(p.endingValueCents)} bold />
      {p.marketMovementCents !== 0 && (
        <Row label="Market movement" value={fmtSigned(p.marketMovementCents)}
             color={p.marketMovementCents >= 0 ? CAUSE_COLOURS.market_gain : CAUSE_COLOURS.market_loss} />
      )}
      {p.additionsCents !== 0 && (
        <Row label="Cards added" value={fmtSigned(p.additionsCents)} color={CAUSE_COLOURS.addition} />
      )}
      {p.removalsCents !== 0 && (
        <Row label={removalLabel} value={fmtSigned(-p.removalsCents)} color={CAUSE_COLOURS.removal} />
      )}
      {p.adjustmentsCents !== 0 && (
        <>
          <Row label="Adjustment" value={fmtSigned(p.adjustmentsCents)} color={CAUSE_COLOURS.adjustment} />
          {p.adjustmentReasons.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, marginBottom: 2 }}>
              {p.adjustmentReasons.map(labelForAdjustmentReason).join(' · ')}
            </div>
          )}
        </>
      )}
      {p.saleProceedsCents !== 0 && (
        <Row label="Sale proceeds" value={fmt(p.saleProceedsCents)} muted />
      )}
      <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0 4px' }} />
      <Row label="Net change" value={fmtSigned(net)} bold color={net >= 0 ? CAUSE_COLOURS.market_gain : CAUSE_COLOURS.market_loss} />
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        {CAUSE_LABELS[p.dominantCause]}
      </div>
      {p.isEstimated && (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' as const }}>
          Some activity for this date is estimated from legacy portfolio data.
        </div>
      )}
      {p.missingPriceHoldingCount > 0 && (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
          {p.missingPriceHoldingCount} holding(s) without a historical price on this date.
        </div>
      )}
    </div>
  )
}

function labelForAdjustmentReason(r: string): string {
  switch (r) {
    case 'manual_value_changed':    return 'manual value changed'
    case 'holding_type_corrected':  return 'holding type corrected'
    case 'new_price_available':     return 'price data newly available'
    default:                        return r
  }
}

function Row({ label, value, color, bold, muted }: { label: string; value: string; color?: string; bold?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '1px 0' }}>
      <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text)' }}>{label}</span>
      <span style={{ fontWeight: bold ? 800 : 600, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  )
}

// ── Utils ──────────────────────────────────────────────────────

function nearestValueForTs(points: HistoryPoint[], ts: number): number | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDiff = Math.abs(points[0].ts - ts)
  for (const p of points) {
    const d = Math.abs(p.ts - ts)
    if (d < bestDiff) { best = p; bestDiff = d }
  }
  return best.endingValueCents
}

const panelStyle: React.CSSProperties = {
  position: 'relative',
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 14, padding: '16px 18px',
}

const srOnlyStyle: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' as const, border: 0,
}
