'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SelectedCard {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  raw_pct_30d: number | null
  raw_pct_90d: number | null
  high_12m: number | null
  drawdown_pct: number | null
  psa10_pct_30d?: number | null
}

interface SearchResult {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  raw_usd: number | null
}

type VisualType = 'insight' | 'price-history' | 'psa-gauge' | 'peak-distance' | 'temperature' | 'comparison'
type Timeframe = '7d' | '30d' | '90d' | '1y'
type Theme = 'dark' | 'light'
type AspectRatio = 'square' | 'portrait' | 'landscape'

const VISUAL_TYPES: { id: VisualType; label: string; icon: string; desc: string; badge?: string }[] = [
  { id: 'insight',       label: 'Insight Card',    icon: '◈', desc: 'One strong market takeaway', badge: 'Popular' },
  { id: 'psa-gauge',     label: 'PSA Gauge',        icon: '◎', desc: 'Grade premium dial',         badge: 'Unique' },
  { id: 'peak-distance', label: 'Peak Distance',    icon: '△', desc: 'ATH vs current position',    badge: 'Unique' },
  { id: 'temperature',   label: 'Temperature',      icon: '◉', desc: 'Market heat signal',          badge: 'Unique' },
  { id: 'price-history', label: 'Price History',    icon: '◌', desc: 'Price over time chart' },
  { id: 'comparison',    label: 'Comparison',       icon: '⊕', desc: 'Compare 2–4 cards' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(cents: number | null | undefined): string {
  if (!cents) return '—'
  const v = cents / 100
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + v.toFixed(2)
}

function fmtGbp(cents: number | null | undefined): string {
  if (!cents) return '—'
  return '£' + (cents / 127).toFixed(2)
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
}

function pctColor(n: number | null | undefined): string {
  if (n == null) return 'var(--text-muted)'
  return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : 'var(--text-muted)'
}

// ── Visual Components ─────────────────────────────────────────────────────────

function InsightCard({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const accent = '#3b8fe8'
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'

  const psa10x = card.current_raw && card.current_psa10
    ? (card.current_psa10 / card.current_raw).toFixed(1) : null

  const signal = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15 ? { label: 'Trending Up', color: '#22c55e' }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', color: '#ef4444' }
    : { label: 'Stable', color: '#f59e0b' }
    : { label: 'Stable', color: '#f59e0b' }

  return (
    <div style={{
      background: bg, borderRadius: 20, overflow: 'hidden',
      border: `1px solid ${border}`,
      boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 25px 50px rgba(0,0,0,0.12)',
      fontFamily: "'Figtree', sans-serif",
      minHeight: 320,
    }}>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg, #1a5fad, #2874c8)`, padding: '20px 24px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>
            Market Insight
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: signal.color, background: 'rgba(0,0,0,0.2)', padding: '3px 10px', borderRadius: 20 }}>
            {signal.label}
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1.3, fontFamily: "'Playfair Display', serif" }}>
          {card.card_name}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{card.set_name}</div>
      </div>

      {/* Prices */}
      <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, borderBottom: `1px solid ${border}` }}>
        {[
          { label: 'Raw', val: fmt(card.current_raw), gbp: fmtGbp(card.current_raw) },
          { label: 'PSA 9', val: fmt(card.current_psa9), gbp: fmtGbp(card.current_psa9) },
          { label: 'PSA 10', val: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map(p => (
          <div key={p.label}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: text }}>{p.val}</div>
            <div style={{ fontSize: 11, color: muted }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, borderBottom: `1px solid ${border}` }}>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>30d Move</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: pctColor(card.raw_pct_30d) }}>{pct(card.raw_pct_30d)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>90d Move</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: pctColor(card.raw_pct_90d) }}>{pct(card.raw_pct_90d)}</div>
        </div>
        {psa10x && (
          <div>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>PSA 10 Premium</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: text }}>{psa10x}x raw</div>
          </div>
        )}
        {card.drawdown_pct && (
          <div>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>From Peak</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: pctColor(card.drawdown_pct) }}>{pct(card.drawdown_pct)}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: muted, fontWeight: 600 }}>pokeprices.io</span>
        <span style={{ fontSize: 10, color: muted }}>Not financial advice</span>
      </div>
    </div>
  )
}

function PsaGauge({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'

  const multiple = card.current_raw && card.current_psa10
    ? card.current_psa10 / card.current_raw : null
  const gaugeAngle = multiple ? Math.min(180, (multiple / 15) * 180) : 90

  const getLabel = (m: number | null) => {
    if (!m) return { label: 'No Data', color: muted }
    if (m < 2) return { label: 'Low Premium', color: '#3b82f6' }
    if (m < 5) return { label: 'Healthy', color: '#22c55e' }
    if (m < 10) return { label: 'Strong', color: '#f59e0b' }
    return { label: 'Extreme', color: '#ef4444' }
  }

  const { label: gaugeLabel, color: gaugeColor } = getLabel(multiple)

  // Gauge arc SVG
  const r = 80
  const cx = 120, cy = 100
  const startAngle = -180
  const endAngle = 0
  const toRad = (d: number) => (d * Math.PI) / 180
  const arcPath = (startDeg: number, endDeg: number, radius: number) => {
    const sx = cx + radius * Math.cos(toRad(startDeg))
    const sy = cy + radius * Math.sin(toRad(startDeg))
    const ex = cx + radius * Math.cos(toRad(endDeg))
    const ey = cy + radius * Math.sin(toRad(endDeg))
    const large = endDeg - startDeg > 180 ? 1 : 0
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`
  }
  const needleAngle = -180 + gaugeAngle
  const nx = cx + (r - 10) * Math.cos(toRad(needleAngle))
  const ny = cy + (r - 10) * Math.sin(toRad(needleAngle))

  return (
    <div style={{
      background: bg, borderRadius: 20, overflow: 'hidden',
      border: `1px solid ${border}`,
      boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 25px 50px rgba(0,0,0,0.12)',
      fontFamily: "'Figtree', sans-serif", padding: 24,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>PSA Premium Gauge</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
      <div style={{ fontSize: 12, color: muted, marginBottom: 20 }}>{card.set_name}</div>

      {/* Gauge SVG */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={240} height={130} viewBox="0 0 240 130">
          {/* Track segments */}
          {[
            { start: -180, end: -135, color: '#3b82f6' },
            { start: -135, end: -90,  color: '#22c55e' },
            { start: -90,  end: -45,  color: '#f59e0b' },
            { start: -45,  end: 0,    color: '#ef4444' },
          ].map((seg, i) => (
            <path key={i} d={arcPath(seg.start, seg.end, r)} fill="none" stroke={seg.color} strokeWidth={16} strokeLinecap="butt" opacity={0.3} />
          ))}
          {/* Active arc */}
          <path d={arcPath(-180, needleAngle, r)} fill="none" stroke={gaugeColor} strokeWidth={16} strokeLinecap="round" opacity={0.9} />
          {/* Needle */}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={text} strokeWidth={3} strokeLinecap="round" opacity={0.8} />
          <circle cx={cx} cy={cy} r={6} fill={gaugeColor} />
          {/* Labels */}
          <text x={32} y={115} fontSize={9} fill={muted} fontFamily="Figtree">Low</text>
          <text x={85} y={32} fontSize={9} fill={muted} fontFamily="Figtree">Healthy</text>
          <text x={148} y={32} fontSize={9} fill={muted} fontFamily="Figtree">Strong</text>
          <text x={193} y={115} fontSize={9} fill={muted} fontFamily="Figtree">Extreme</text>
        </svg>
      </div>

      {/* Reading */}
      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: gaugeColor }}>{multiple ? multiple.toFixed(1) + 'x' : '—'}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: gaugeLabel === 'No Data' ? muted : gaugeColor, marginBottom: 16 }}>{gaugeLabel}</div>
      </div>

      {/* Price detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>Raw</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: text, marginTop: 4 }}>{fmt(card.current_raw)}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>PSA 10</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: text, marginTop: 4 }}>{fmt(card.current_psa10)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: muted }}>pokeprices.io</div>
    </div>
  )
}

function PeakDistance({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'

  const drawdown = card.drawdown_pct ?? 0
  const recovery = Math.min(100, Math.max(0, 100 + drawdown))
  const isNearPeak = drawdown > -10
  const isRecovering = drawdown < -10 && drawdown > -40
  const isOff = drawdown <= -40

  const stateLabel = isNearPeak ? 'Near Peak' : isRecovering ? 'Recovering' : 'Deeply Off Highs'
  const stateColor = isNearPeak ? '#ef4444' : isRecovering ? '#f59e0b' : '#3b82f6'

  const barH = 200
  const peakY = 20
  const currentY = peakY + (barH * (1 - recovery / 100))

  return (
    <div style={{
      background: bg, borderRadius: 20, overflow: 'hidden',
      border: `1px solid ${border}`,
      boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 25px 50px rgba(0,0,0,0.12)',
      fontFamily: "'Figtree', sans-serif", padding: 24,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>Peak vs Current</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
      <div style={{ fontSize: 12, color: muted, marginBottom: 24 }}>{card.set_name}</div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* Vertical bar visual */}
        <div style={{ position: 'relative', width: 48, height: barH + 40, flexShrink: 0 }}>
          {/* Track */}
          <div style={{ position: 'absolute', left: 20, top: peakY, width: 8, height: barH, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 4 }} />
          {/* Fill */}
          <div style={{
            position: 'absolute', left: 20, top: currentY, width: 8,
            height: barH - (currentY - peakY), borderRadius: 4,
            background: `linear-gradient(to top, ${stateColor}, ${stateColor}88)`,
          }} />
          {/* Peak dot */}
          <div style={{ position: 'absolute', left: 14, top: peakY - 6, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: `2px solid ${bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#fff', fontWeight: 800 }}>▲</span>
          </div>
          {/* Current dot */}
          <div style={{ position: 'absolute', left: 14, top: currentY - 6, width: 20, height: 20, borderRadius: '50%', background: stateColor, border: `2px solid ${bg}` }} />
        </div>

        {/* Labels */}
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Peak (12m High)</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: text }}>{fmt(card.high_12m)}</div>
          </div>
          <div style={{ padding: '12px 0', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}`, marginBottom: 24 }}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Drawdown</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: stateColor }}>{pct(drawdown)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: stateColor }}>{stateLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Current</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: text }}>{fmt(card.current_raw)}</div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right', marginTop: 16, fontSize: 11, color: muted }}>pokeprices.io</div>
    </div>
  )
}

function MarketTemperature({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'

  const score = ((card.raw_pct_30d ?? 0) * 0.6 + (card.raw_pct_90d ?? 0) * 0.4)
  const temp = score > 30 ? 'Overheated' : score > 10 ? 'Hot' : score > 0 ? 'Warming' : score > -10 ? 'Cooling' : 'Cold'
  const tempColor = score > 30 ? '#ef4444' : score > 10 ? '#f97316' : score > 0 ? '#f59e0b' : score > -10 ? '#3b82f6' : '#60a5fa'
  const tempEmoji = score > 30 ? '🔥' : score > 10 ? '♨️' : score > 0 ? '↑' : score > -10 ? '↓' : '❄️'

  // Temperature scale segments
  const segments = ['Cold', 'Cooling', 'Warming', 'Hot', 'Overheated']
  const segColors = ['#60a5fa', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']
  const tempIndex = segments.indexOf(temp)

  return (
    <div style={{
      background: bg, borderRadius: 20, overflow: 'hidden',
      border: `1px solid ${border}`,
      boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 25px 50px rgba(0,0,0,0.12)',
      fontFamily: "'Figtree', sans-serif", padding: 24,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>Market Temperature</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
      <div style={{ fontSize: 12, color: muted, marginBottom: 24 }}>{card.set_name}</div>

      {/* Big temp reading */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>{tempEmoji}</div>
        <div style={{ fontSize: 36, fontWeight: 900, color: tempColor }}>{temp}</div>
        <div style={{ fontSize: 13, color: muted, marginTop: 4 }}>Market signal based on 30d + 90d momentum</div>
      </div>

      {/* Scale */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {segments.map((s, i) => (
            <div key={s} style={{
              flex: 1, height: 8, borderRadius: 4,
              background: segColors[i],
              opacity: i === tempIndex ? 1 : 0.25,
              transition: 'opacity 0.2s',
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: muted, fontWeight: 600 }}>COLD</span>
          <span style={{ fontSize: 9, color: muted, fontWeight: 600 }}>OVERHEATED</span>
        </div>
      </div>

      {/* Supporting data */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: `1px solid ${border}`, paddingTop: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>30d Move</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: pctColor(card.raw_pct_30d) }}>{pct(card.raw_pct_30d)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>90d Move</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: pctColor(card.raw_pct_90d) }}>{pct(card.raw_pct_90d)}</div>
        </div>
      </div>

      <div style={{ textAlign: 'right', marginTop: 16, fontSize: 11, color: muted }}>pokeprices.io</div>
    </div>
  )
}

function PlaceholderPreview() {
  return (
    <div style={{
      background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 340, padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>◈</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
        Build a shareable Pokémon market visual
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
        Search for a card to begin
      </div>
    </div>
  )
}

// ── Main Studio Component ─────────────────────────────────────────────────────

export default function StudioPageClient({ initialCardSlug }: { initialCardSlug?: string }) {
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null)
  const [visualType, setVisualType] = useState<VisualType>('insight')
  const [theme, setTheme] = useState<Theme>('dark')
  const [ratio, setRatio] = useState<AspectRatio>('portrait')
  const [loading, setLoading] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const searchDebounce = useRef<NodeJS.Timeout>()

  // Load initial card from URL param
  useEffect(() => {
    if (initialCardSlug) loadCardBySlug(initialCardSlug)
  }, [initialCardSlug])

  async function loadCardBySlug(slug: string) {
    setLoading(true)
    const { data } = await supabase
      .from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d, raw_pct_90d, high_12m, drawdown_pct')
      .eq('card_slug', slug)
      .single()
    if (data) {
      const { data: cardData } = await supabase
        .from('cards')
        .select('card_url_slug, image_url')
        .eq('card_slug', slug)
        .single()
      setSelectedCard({ ...data, card_url_slug: cardData?.card_url_slug || null, image_url: cardData?.image_url || null })
    }
    setLoading(false)
  }

  // Search debounce
  useEffect(() => {
    clearTimeout(searchDebounce.current)
    if (search.length < 2) { setSearchResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase
        .from('card_trends')
        .select('card_slug, card_name, set_name, current_raw')
        .ilike('card_name', `%${search}%`)
        .not('current_raw', 'is', null)
        .order('current_raw', { ascending: false })
        .limit(8)
      if (data) {
        const slugs = data.map(d => d.card_slug)
        const { data: cardData } = await supabase
          .from('cards')
          .select('card_slug, card_url_slug, image_url')
          .in('card_slug', slugs)
        const merged: SearchResult[] = data.map(d => {
          const c = cardData?.find(cd => cd.card_slug === d.card_slug)
          return { ...d, card_url_slug: c?.card_url_slug || null, image_url: c?.image_url || null, raw_usd: d.current_raw }
        })
        setSearchResults(merged)
      }
      setSearching(false)
    }, 300)
  }, [search])

  async function selectCard(result: SearchResult) {
    console.log('selectCard called', result.card_name)
    setSearch('')
    setSearchResults([])
    setLoading(true)
    const { data } = await supabase
      .from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d, raw_pct_90d, high_12m, drawdown_pct')
      .eq('card_slug', result.card_slug)
      .single()
    if (data) {
      setSelectedCard({ ...data, card_url_slug: result.card_url_slug, image_url: result.image_url })
    }
    setLoading(false)
  }

  function renderVisual() {
    if (!selectedCard) return <PlaceholderPreview />
    if (loading) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340 }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Loading…</div>
      </div>
    )
    switch (visualType) {
      case 'insight':       return <InsightCard card={selectedCard} theme={theme} />
      case 'psa-gauge':     return <PsaGauge card={selectedCard} theme={theme} />
      case 'peak-distance': return <PeakDistance card={selectedCard} theme={theme} />
      case 'temperature':   return <MarketTemperature card={selectedCard} theme={theme} />
      default:              return <InsightCard card={selectedCard} theme={theme} />
    }
  }

  async function exportPng() {
    if (!selectedCard) return
    // Use server-side OG image generation — no html2canvas needed
    const params = new URLSearchParams({
      card:   selectedCard.card_slug,
      visual: visualType,
      theme,
      ratio,
    })
    const url = `/api/studio/og?${params.toString()}`
    const link = document.createElement('a')
    link.download = `pokeprices-${selectedCard.card_slug}-${visualType}.png`
    link.href = url
    link.click()
  }

  const ratioStyle: React.CSSProperties = ratio === 'square'
    ? { aspectRatio: '1/1' } : ratio === 'landscape'
    ? { aspectRatio: '16/9' } : { aspectRatio: '4/5' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, margin: '0 0 6px', color: 'var(--text)' }}>
          PokePrices Studio
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          Turn market data into shareable visuals
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Left Panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Search */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>
              Select Card
            </div>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                placeholder="Search card name…"
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-light)',
                  color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchResults.length > 0 && (
                <div
                  onMouseDown={e => e.preventDefault()}
                  style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, marginTop: 4, overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                }}>
                  {searchResults.map(r => (
                    <div
                      key={r.card_slug}
                      onClick={() => selectCard(r)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', gap: 10,
                        borderBottom: '1px solid var(--border-light)',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                    >
                      {r.image_url && (
                        <img src={r.image_url} alt="" style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.set_name}</div>
                      </div>
                      {r.raw_usd && (
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>${(r.raw_usd / 100).toFixed(0)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selected card chip */}
            {selectedCard && (
              <div style={{
                marginTop: 10, display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--bg-light)', borderRadius: 10, padding: '8px 12px',
              }}>
                {selectedCard.image_url && (
                  <img src={selectedCard.image_url} alt="" style={{ width: 28, height: 38, objectFit: 'contain', borderRadius: 3 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCard.card_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selectedCard.set_name}</div>
                </div>
                <button onClick={() => setSelectedCard(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: 2 }}>×</button>
              </div>
            )}
          </div>

          {/* Visual type */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>
              Visual Type
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {VISUAL_TYPES.map(v => (
                <button
                  key={v.id}
                  onClick={() => setVisualType(v.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10,
                    border: visualType === v.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                    background: visualType === v.id ? 'rgba(26,95,173,0.08)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 16, color: visualType === v.id ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>{v.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{v.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{v.desc}</div>
                  </div>
                  {v.badge && (
                    <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.1)', padding: '2px 6px', borderRadius: 4, letterSpacing: 0.3 }}>{v.badge}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <button
              onClick={() => setOptionsOpen(!optionsOpen)}
              style={{
                width: '100%', padding: '14px 16px', background: 'none', border: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif" }}>
                Customise
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{optionsOpen ? '▲' : '▼'}</span>
            </button>
            {optionsOpen && (
              <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Theme</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['dark', 'light'] as Theme[]).map(t => (
                      <button key={t} onClick={() => setTheme(t)} className={`sort-btn ${theme === t ? 'active' : ''}`} style={{ fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize', flex: 1 }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Format</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['portrait', 'square', 'landscape'] as AspectRatio[]).map(r => (
                      <button key={r} onClick={() => setRatio(r)} className={`sort-btn ${ratio === r ? 'active' : ''}`} style={{ fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize', flex: 1 }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel: Preview ── */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif" }}>
              Preview
            </div>
            {selectedCard && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={exportPng}
                  style={{
                    padding: '8px 18px', borderRadius: 10, border: 'none',
                    background: 'var(--primary)', color: '#fff',
                    fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  ↓ Download PNG
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              ...ratioStyle,
              maxWidth: '100%',
              display: 'flex',
              alignItems: 'stretch',
            }}
          >
            <div style={{ flex: 1 }}>
              {renderVisual()}
            </div>
          </div>

          {selectedCard && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  const url = `${window.location.origin}/studio?card=${selectedCard.card_slug}&visual=${visualType}`
                  navigator.clipboard.writeText(url)
                }}
                style={{
                  padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--bg-light)', color: 'var(--text-muted)',
                  fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                }}
              >
                Copy Link
              </button>
              <a
                href={`https://x.com/intent/tweet?text=Check out ${encodeURIComponent(selectedCard.card_name)} on @PokePricesIO&url=${encodeURIComponent(`https://pokeprices.io/studio?card=${selectedCard.card_slug}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--bg-light)', color: 'var(--text-muted)',
                  fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
                  textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Share on X
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
