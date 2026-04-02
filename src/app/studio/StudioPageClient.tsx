'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

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
  raw_30d_ago: number | null
  raw_90d_ago: number | null
  raw_180d_ago: number | null
}

interface SearchResult {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  raw_usd: number | null
}

type VisualType = 'insight' | 'psa-gauge' | 'peak-distance' | 'temperature'
type Theme = 'dark' | 'light'

const VISUAL_TYPES: { id: VisualType; label: string; icon: string; desc: string; badge?: string }[] = [
  { id: 'insight',       label: 'Insight Card',  icon: '◈', desc: 'Prices, trend & grade premium at a glance', badge: 'Popular' },
  { id: 'psa-gauge',     label: 'PSA Gauge',      icon: '◎', desc: 'How extreme is the grading premium?',       badge: 'Unique'  },
  { id: 'peak-distance', label: 'Peak Distance',  icon: '△', desc: 'Where is price vs its recent high?',        badge: 'Unique'  },
  { id: 'temperature',   label: 'Temperature',    icon: '◉', desc: 'Is this card heating up or cooling down?',  badge: 'Unique'  },
]

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
  if (n == null) return '#94a3b8'
  return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#94a3b8'
}

function InsightCard({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const signal = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15 ? { label: 'Trending Up', color: '#22c55e' }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', color: '#ef4444' }
    : { label: 'Stable', color: '#f59e0b' }
    : { label: 'Stable', color: '#f59e0b' }
  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${border}`, boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 20px 40px rgba(0,0,0,0.1)', fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #1a5fad, #2874c8)', padding: '20px 24px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }}>Market Insight</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: signal.color, background: 'rgba(0,0,0,0.25)', padding: '3px 12px', borderRadius: 20 }}>{signal.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {card.image_url && <img crossOrigin="anonymous" src={card.image_url + '?v=1'} alt="" style={{ width: 48, height: 67, objectFit: 'contain', borderRadius: 5, flexShrink: 0 }} />}
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25, fontFamily: "'Playfair Display', serif" }}>{card.card_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 3 }}>{card.set_name}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, borderBottom: `1px solid ${border}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9)  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map(p => (
          <div key={p.label}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: text }}>{p.usd}</div>
            <div style={{ fontSize: 11, color: muted, marginTop: 1 }}>{p.gbp}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, borderBottom: `1px solid ${border}` }}>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>30d Move</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: pctColor(card.raw_pct_30d) }}>{pct(card.raw_pct_30d)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>90d Move</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: pctColor(card.raw_pct_90d) }}>{pct(card.raw_pct_90d)}</div>
        </div>
        {psa10x && (
          <div>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Grade Premium</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: text }}>{psa10x}x raw</div>
          </div>
        )}
      </div>
      <div style={{ padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: muted, fontWeight: 700 }}>pokeprices.io</span>
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
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const multiple = card.current_raw && card.current_psa10 ? card.current_psa10 / card.current_raw : null
  const gaugeAngle = multiple ? Math.min(180, (multiple / 15) * 180) : 0
  const needleAngle = -180 + gaugeAngle
  const getInfo = (m: number | null) => {
    if (!m) return { label: 'No Data', color: muted, desc: 'No PSA 10 pricing available for this card yet.' }
    if (m < 2) return { label: 'Low Premium', color: '#3b82f6', desc: 'Grading adds little value over raw — buy raw or find a cheap PSA 10 directly.' }
    if (m < 5) return { label: 'Healthy Premium', color: '#22c55e', desc: 'The grade premium is reasonable — PSA 10 buyers are paying a fair markup.' }
    if (m < 10) return { label: 'Strong Premium', color: '#f59e0b', desc: 'PSA 10s command a significant premium — grading is rewarding but risky.' }
    return { label: 'Extreme Premium', color: '#ef4444', desc: 'Very high grade premium — any grade below a 10 loses significant value.' }
  }
  const { label: gaugeLabel, color: gaugeColor, desc } = getInfo(multiple)
  const r = 80; const cx = 120; const cy = 105
  const toRad = (d: number) => (d * Math.PI) / 180
  const arcPath = (s: number, e: number, rad: number) => {
    const sx = cx + rad * Math.cos(toRad(s)), sy = cy + rad * Math.sin(toRad(s))
    const ex = cx + rad * Math.cos(toRad(e)), ey = cy + rad * Math.sin(toRad(e))
    return `M ${sx} ${sy} A ${rad} ${rad} 0 0 1 ${ex} ${ey}`
  }
  const nx = cx + (r - 8) * Math.cos(toRad(needleAngle))
  const ny = cy + (r - 8) * Math.sin(toRad(needleAngle))
  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${border}`, boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 20px 40px rgba(0,0,0,0.1)', fontFamily: "'Figtree', sans-serif", padding: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>PSA Premium Gauge</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {card.image_url && <img crossOrigin="anonymous" src={card.image_url + '?v=1'} alt="" style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
          <div style={{ fontSize: 12, color: muted }}>{card.set_name}</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={240} height={130} viewBox="0 0 240 130">
          {[{ s: -180, e: -135, c: '#3b82f6' }, { s: -135, e: -90, c: '#22c55e' }, { s: -90, e: -45, c: '#f59e0b' }, { s: -45, e: 0, c: '#ef4444' }].map((seg, i) => (
            <path key={i} d={arcPath(seg.s, seg.e, r)} fill="none" stroke={seg.c} strokeWidth={14} strokeLinecap="butt" opacity={0.2} />
          ))}
          {multiple != null && <path d={arcPath(-180, needleAngle, r)} fill="none" stroke={gaugeColor} strokeWidth={14} strokeLinecap="round" opacity={0.95} />}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={dark ? '#f1f5f9' : '#0f172a'} strokeWidth={3} strokeLinecap="round" opacity={0.7} />
          <circle cx={cx} cy={cy} r={6} fill={gaugeColor} />
          <text x={14} y={126} fontSize={9} fill={muted} fontFamily="Figtree,sans-serif">Low</text>
          <text x={88} y={18} fontSize={9} fill={muted} fontFamily="Figtree,sans-serif">Healthy</text>
          <text x={145} y={18} fontSize={9} fill={muted} fontFamily="Figtree,sans-serif">Strong</text>
          <text x={194} y={126} fontSize={9} fill={muted} fontFamily="Figtree,sans-serif">Extreme</text>
        </svg>
      </div>
      <div style={{ textAlign: 'center', marginTop: 4, marginBottom: 16 }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: gaugeColor }}>{multiple ? multiple.toFixed(1) + 'x' : '—'}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: gaugeColor, marginBottom: 8 }}>{gaugeLabel}</div>
        <div style={{ fontSize: 12, color: muted, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>{desc}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: `1px solid ${border}`, paddingTop: 16, marginBottom: 16 }}>
        {[{ label: 'Raw', val: fmt(card.current_raw) }, { label: 'PSA 10', val: fmt(card.current_psa10) }].map(p => (
          <div key={p.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: text }}>{p.val}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: muted, fontWeight: 700 }}>pokeprices.io</div>
    </div>
  )
}

function PeakDistance({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const peak = Math.max(card.raw_30d_ago ?? 0, card.raw_90d_ago ?? 0, card.raw_180d_ago ?? 0, card.current_raw ?? 0) || null
  const drawdown = peak && card.current_raw && peak > card.current_raw ? ((card.current_raw - peak) / peak) * 100 : 0
  const recovery = Math.min(100, Math.max(0, 100 + drawdown))
  const stateLabel = drawdown > -10 ? 'Near Peak' : drawdown > -40 ? 'Recovering' : 'Deeply Off Highs'
  const stateColor = drawdown > -10 ? '#ef4444' : drawdown > -40 ? '#f59e0b' : '#3b82f6'
  const stateDesc = drawdown > -10
    ? 'Price is near its recent high. If holding, this may be a good time to consider your exit.'
    : drawdown > -40
    ? 'Price has pulled back but is recovering. Could be a reasonable entry point.'
    : 'Significantly below its recent peak. Potential value if the trend reverses.'
  const barH = 180; const peakY = 16
  const currY = peakY + barH * (1 - recovery / 100)
  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${border}`, boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 20px 40px rgba(0,0,0,0.1)', fontFamily: "'Figtree', sans-serif", padding: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>Peak vs Current</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {card.image_url && <img crossOrigin="anonymous" src={card.image_url + '?v=1'} alt="" style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
          <div style={{ fontSize: 12, color: muted }}>{card.set_name}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ position: 'relative', width: 44, height: barH + 32, flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 18, top: peakY, width: 8, height: barH, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: 18, top: currY, width: 8, height: Math.max(4, barH - (currY - peakY)), borderRadius: 4, background: `linear-gradient(to top, ${stateColor}, ${stateColor}99)` }} />
          <div style={{ position: 'absolute', left: 12, top: peakY - 7, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: `2px solid ${bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 7, color: '#fff', fontWeight: 900 }}>▲</span>
          </div>
          <div style={{ position: 'absolute', left: 12, top: currY - 7, width: 20, height: 20, borderRadius: '50%', background: stateColor, border: `2px solid ${bg}` }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>6m High</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: text }}>{fmt(peak)}</div>
          </div>
          <div style={{ padding: '12px 0', borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}`, marginBottom: 20 }}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Drawdown</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: stateColor }}>{drawdown === 0 ? '+0.0%' : pct(drawdown)}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: stateColor, marginTop: 2 }}>{stateLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Current</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: text }}>{fmt(card.current_raw)}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 14px', background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 10, fontSize: 12, color: muted, lineHeight: 1.5, marginBottom: 16 }}>{stateDesc}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: muted, fontWeight: 700 }}>pokeprices.io</div>
    </div>
  )
}

function MarketTemperature({ card, theme }: { card: SelectedCard; theme: Theme }) {
  const dark = theme === 'dark'
  const bg = dark ? '#0f1923' : '#fff'
  const text = dark ? '#f1f5f9' : '#0f172a'
  const muted = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const score = (card.raw_pct_30d ?? 0) * 0.6 + (card.raw_pct_90d ?? 0) * 0.4
  const { label: temp, color: tempColor, emoji: tempEmoji, desc } =
    score > 30  ? { label: 'Overheated', color: '#ef4444', emoji: '🔥', desc: 'Moved fast recently — price may be extended. Be cautious buying in now.' } :
    score > 10  ? { label: 'Hot',        color: '#f97316', emoji: '♨️', desc: 'Strong recent momentum. Interest is high but watch for a cooldown.' }       :
    score > 0   ? { label: 'Warming',    color: '#f59e0b', emoji: '↗',  desc: 'Mild positive trend. Price is gradually rising — a reasonable time to buy.' } :
    score > -10 ? { label: 'Cooling',    color: '#3b82f6', emoji: '↘',  desc: 'Price is drifting lower. Patience may reward with a better entry point.' }   :
                  { label: 'Cold',       color: '#60a5fa', emoji: '❄',  desc: 'No recent buying activity. Could be undervalued or simply out of favour.' }
  const segments  = ['Cold', 'Cooling', 'Warming', 'Hot', 'Overheated']
  const segColors = ['#60a5fa', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']
  const tempIdx   = segments.indexOf(temp)
  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${border}`, boxShadow: dark ? '0 25px 50px rgba(0,0,0,0.5)' : '0 20px 40px rgba(0,0,0,0.1)', fontFamily: "'Figtree', sans-serif", padding: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: muted, textTransform: 'uppercase', marginBottom: 4 }}>Market Temperature</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        {card.image_url && <img crossOrigin="anonymous" src={card.image_url + '?v=1'} alt="" style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: text, fontFamily: "'Playfair Display', serif", marginBottom: 2 }}>{card.card_name}</div>
          <div style={{ fontSize: 12, color: muted }}>{card.set_name}</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 60, marginBottom: 10, lineHeight: 1 }}>{tempEmoji}</div>
        <div style={{ fontSize: 38, fontWeight: 900, color: tempColor, marginBottom: 4 }}>{temp}</div>
        <div style={{ fontSize: 12, color: muted, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>{desc}</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
          {segments.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 8, borderRadius: 4, background: segColors[i], opacity: i === tempIdx ? 1 : 0.2, transition: 'opacity 0.2s' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: muted, fontWeight: 700 }}>COLD</span>
          <span style={{ fontSize: 9, color: muted, fontWeight: 700 }}>OVERHEATED</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderTop: `1px solid ${border}`, paddingTop: 16, marginBottom: 16 }}>
        {[{ label: '30d Move', val: pct(card.raw_pct_30d), color: pctColor(card.raw_pct_30d) }, { label: '90d Move', val: pct(card.raw_pct_90d), color: pctColor(card.raw_pct_90d) }].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: 10, color: muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'right', fontSize: 11, color: muted, fontWeight: 700 }}>pokeprices.io</div>
    </div>
  )
}

function PlaceholderPreview() {
  return (
    <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.2 }}>◈</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>Build a shareable market visual</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Search for a card to get started</div>
    </div>
  )
}

export default function StudioPageClient({ initialCardSlug }: { initialCardSlug?: string }) {
  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selectedCard,  setSelectedCard]  = useState<SelectedCard | null>(null)
  const [visualType,    setVisualType]    = useState<VisualType>('insight')
  const [theme,         setTheme]         = useState<Theme>('dark')
  const [loading,       setLoading]       = useState(false)
  const searchDebounce = useRef<NodeJS.Timeout>()

  useEffect(() => { if (initialCardSlug) loadCard(initialCardSlug) }, [initialCardSlug])

  async function loadCard(slug: string) {
    setLoading(true)
    const { data } = await supabase
      .from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d, raw_pct_90d, raw_30d_ago, raw_90d_ago, raw_180d_ago')
      .eq('card_slug', slug)
      .single()
    if (data) {
      const { data: meta } = await supabase.from('cards').select('card_url_slug, image_url').eq('card_slug', slug).single()
      setSelectedCard({ ...data, card_url_slug: meta?.card_url_slug || null, image_url: meta?.image_url || null })
    }
    setLoading(false)
  }

  useEffect(() => {
    clearTimeout(searchDebounce.current)
    if (search.length < 2) { setSearchResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      const { data } = await supabase
        .from('card_trends')
        .select('card_slug, card_name, set_name, current_raw')
        .ilike('card_name', `%${search}%`)
        .not('current_raw', 'is', null)
        .order('current_raw', { ascending: false })
        .limit(8)
      if (data) {
        const slugs = data.map(d => d.card_slug)
        const { data: meta } = await supabase.from('cards').select('card_slug, card_url_slug, image_url').in('card_slug', slugs)
        setSearchResults(data.map(d => {
          const m = meta?.find(x => x.card_slug === d.card_slug)
          return { ...d, card_url_slug: m?.card_url_slug || null, image_url: m?.image_url || null, raw_usd: d.current_raw }
        }))
      }
    }, 300)
  }, [search])

  async function selectCard(r: SearchResult) {
    setSearch('')
    setSearchResults([])
    await loadCard(r.card_slug)
  }

  async function exportPng() {
    if (!selectedCard) return
    const previewEl = document.getElementById('studio-preview')
    if (!previewEl) return
    try {
      // Load html2canvas from CDN at runtime — no install needed
      if (!(window as any).html2canvas) {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
        document.head.appendChild(script)
        await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject })
      }
      // Swap card images to use our proxy so CORS doesn't block them
      const imgs = previewEl.querySelectorAll('img') as NodeListOf<HTMLImageElement>
      const origSrcs: string[] = []
      imgs.forEach(img => {
        origSrcs.push(img.src)
        if (img.src && !img.src.startsWith(window.location.origin)) {
          img.src = `/api/imgproxy?url=${encodeURIComponent(img.src.split('?')[0])}`
        }
      })
      // Wait for images to reload
      await Promise.all(Array.from(imgs).map(img =>
        img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r })
      ))
      const h2c = (window as any).html2canvas
      const canvas = await h2c(previewEl, { scale: 2, useCORS: true, allowTaint: false, backgroundColor: null, logging: false })
      // Restore original srcs
      imgs.forEach((img, i) => { img.src = origSrcs[i] })
      const link = document.createElement('a')
      link.download = `pokeprices-${selectedCard.card_name.replace(/[^a-z0-9]/gi, '-')}-${visualType}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Export failed:', e)
      alert('Export failed — try right-clicking the preview and saving the image.')
    }
  }

  function renderVisual() {
    if (loading)       return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Loading…</div>
    if (!selectedCard) return <PlaceholderPreview />
    switch (visualType) {
      case 'insight':       return <InsightCard       card={selectedCard} theme={theme} />
      case 'psa-gauge':     return <PsaGauge          card={selectedCard} theme={theme} />
      case 'peak-distance': return <PeakDistance      card={selectedCard} theme={theme} />
      case 'temperature':   return <MarketTemperature card={selectedCard} theme={theme} />
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: '0 0 5px', color: 'var(--text)' }}>PokePrices Studio</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          Turn card market data into shareable visuals — perfect for X, Discord, and collector communities.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, alignItems: 'start' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>1. Select a Card</div>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                placeholder="Search card name…"
                style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }}
              />
              {searchResults.length > 0 && (
                <div onMouseDown={e => e.preventDefault()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
                  {searchResults.map(r => (
                    <div key={r.card_slug} onClick={() => selectCard(r)}
                      style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                    >
                      {r.image_url && <img src={r.image_url} alt="" style={{ width: 28, height: 39, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.set_name}</div>
                      </div>
                      {r.raw_usd && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>${(r.raw_usd / 100).toFixed(0)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedCard && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(26,95,173,0.06)', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                {selectedCard.image_url && <img src={selectedCard.image_url} alt="" style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCard.card_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selectedCard.set_name}</div>
                </div>
                <button onClick={() => setSelectedCard(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>2. Choose Visual</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {VISUAL_TYPES.map(v => (
                <button key={v.id} onClick={() => setVisualType(v.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: visualType === v.id ? '1px solid var(--primary)' : '1px solid var(--border)', background: visualType === v.id ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%' }}>
                  <span style={{ fontSize: 15, color: visualType === v.id ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>{v.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{v.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{v.desc}</div>
                  </div>
                  {v.badge && <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.1)', padding: '2px 7px', borderRadius: 4, letterSpacing: 0.3, flexShrink: 0 }}>{v.badge}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>3. Theme</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['dark', 'light'] as Theme[]).map(t => (
                <button key={t} onClick={() => setTheme(t)} style={{ flex: 1, padding: '9px', borderRadius: 10, border: theme === t ? '1px solid var(--primary)' : '1px solid var(--border)', background: theme === t ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: theme === t ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize', transition: 'all 0.15s' }}>
                  {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.4 }}>
              Dark looks best on X and Discord. Light works well for lighter backgrounds.
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif" }}>Preview</div>
            {selectedCard && (
              <button onClick={exportPng} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                ↓ Download PNG
              </button>
            )}
          </div>

          <div id="studio-preview" style={{ maxWidth: 520 }}>
            {renderVisual()}
          </div>

          {selectedCard && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/studio?card=${selectedCard.card_slug}&visual=${visualType}`)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                Copy Link
              </button>
              <a href={`https://x.com/intent/tweet?text=Check out ${encodeURIComponent(selectedCard.card_name)} on @PokePricesIO&url=${encodeURIComponent(`https://pokeprices.io/studio?card=${selectedCard.card_slug}`)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Share on X
              </a>
            </div>
          )}

          {!selectedCard && !loading && (
            <div style={{ marginTop: 16, padding: '14px 18px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontFamily: "'Figtree', sans-serif" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>How it works</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Search for any card → choose a visual style → download the PNG. Each visual tells a different story — Insight Card for a full overview, PSA Gauge for grade premium, Peak Distance for buy/sell timing, Temperature for momentum.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
