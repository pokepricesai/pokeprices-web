'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CardData {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  raw_pct_7d: number | null
  raw_pct_30d: number | null
  raw_pct_90d: number | null
  raw_30d_ago: number | null
  raw_90d_ago: number | null
  raw_180d_ago: number | null
}

interface Mover {
  card_name: string
  set_name: string
  current_price: number
  pct_change: number
  card_url_slug?: string
  image_url?: string
}

interface SetData {
  set_name: string
  top_cards: { card_name: string; current_raw: number; pct_30d: number | null }[]
  set_pct_30d: number | null
  set_pct_90d: number | null
  total_value: number
  card_count: number
}

type VisualType = 'insight' | 'psa-gauge' | 'peak-distance' | 'temperature' | 'movers' | 'grade-compare' | 'set-report'
type Theme = 'dark' | 'light'
type MoversPeriod = '7d' | '30d' | '90d'
type MoversDirection = 'rising' | 'falling'

const VISUAL_TYPES: { id: VisualType; label: string; icon: string; desc: string; category: string }[] = [
  { id: 'insight',       label: 'Insight Card',      icon: '◈', desc: 'Prices, trend & grade premium',        category: 'Card' },
  { id: 'psa-gauge',     label: 'PSA Gauge',          icon: '◎', desc: 'How extreme is the grading premium?', category: 'Card' },
  { id: 'peak-distance', label: 'Peak Distance',      icon: '△', desc: 'Price vs its recent high',            category: 'Card' },
  { id: 'temperature',   label: 'Temperature',        icon: '◉', desc: 'Is this card hot or cooling?',        category: 'Card' },
  { id: 'grade-compare', label: 'Grade Breakdown',    icon: '▤', desc: 'Raw vs PSA 9 vs PSA 10 side by side', category: 'Card' },
  { id: 'movers',        label: 'Market Movers',      icon: '▲', desc: 'Top risers & fallers leaderboard',    category: 'Market' },
  { id: 'set-report',    label: 'Set Report',         icon: '◫', desc: 'Full set performance card',           category: 'Set' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const USD_TO_GBP = 0.79

function fmt(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 10000) return '$' + (v / 1000).toFixed(1) + 'k'
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + v.toFixed(2)
}

function fmtGbp(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return '—'
  const v = (cents / 100) * USD_TO_GBP
  if (v >= 10000) return '£' + (v / 1000).toFixed(1) + 'k'
  if (v >= 1000) return '£' + v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
  return '£' + v.toFixed(2)
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
}

function pctCol(n: number | null | undefined): string {
  if (n == null) return '#94a3b8'
  return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#94a3b8'
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return mobile
}

// ── Data ──────────────────────────────────────────────────────────────────────

async function fetchCard(slug: string): Promise<CardData | null> {
  const [{ data: trend }, { data: meta }] = await Promise.all([
    supabase.from('card_trends')
      .select('card_slug,card_name,set_name,current_raw,current_psa9,current_psa10,raw_pct_7d,raw_pct_30d,raw_pct_90d,raw_30d_ago,raw_90d_ago,raw_180d_ago')
      .eq('card_slug', slug).single(),
    supabase.from('cards').select('card_url_slug,image_url').eq('card_slug', slug).single(),
  ])
  if (!trend) return null
  return { ...trend, card_url_slug: meta?.card_url_slug || null, image_url: meta?.image_url || null }
}

async function fetchMovers(period: MoversPeriod, direction: MoversDirection, limit = 20): Promise<Mover[]> {
  const col = `raw_pct_${period}`
  const { data: rawData } = await supabase
    .from('card_trends')
    .select(`card_slug,card_name,set_name,current_raw,raw_pct_7d,raw_pct_30d,raw_pct_90d`)
    .not('current_raw', 'is', null)
    .not(col, 'is', null)
    .gt('current_raw', 2000) // min $20 to filter junk
    .order(col, { ascending: direction === 'falling' })
    .limit(limit)
  const data = rawData as any[] | null
  if (!data) return []
  // Fetch images
  const slugs = data.map((d: any) => d.card_slug)
  const { data: imgs } = await supabase.from('cards').select('card_slug,image_url,card_url_slug').in('card_slug', slugs)
  return data.map((d: any) => ({
    card_name: d.card_name,
    set_name: d.set_name,
    current_price: d.current_raw,
    pct_change: d[col] as number,
    image_url: imgs?.find(i => i.card_slug === d.card_slug)?.image_url || null,
    card_url_slug: imgs?.find(i => i.card_slug === d.card_slug)?.card_url_slug || null,
  }))
}

async function fetchSetData(setName: string): Promise<SetData | null> {
  const { data } = await supabase
    .from('card_trends')
    .select('card_slug,card_name,set_name,current_raw,raw_pct_30d,raw_pct_90d')
    .ilike('set_name', `%${setName}%`)
    .not('current_raw', 'is', null)
    .order('current_raw', { ascending: false })
    .limit(50)
  if (!data || !data.length) return null
  const total = data.reduce((s, d) => s + (d.current_raw || 0), 0)
  const avg30 = data.filter(d => d.raw_pct_30d != null).reduce((s, d) => s + (d.raw_pct_30d || 0), 0) / Math.max(1, data.filter(d => d.raw_pct_30d != null).length)
  const avg90 = data.filter(d => d.raw_pct_90d != null).reduce((s, d) => s + (d.raw_pct_90d || 0), 0) / Math.max(1, data.filter(d => d.raw_pct_90d != null).length)
  return {
    set_name: data[0].set_name,
    top_cards: data.slice(0, 10).map(d => ({ card_name: d.card_name, current_raw: d.current_raw!, pct_30d: d.raw_pct_30d })),
    set_pct_30d: avg30,
    set_pct_90d: avg90,
    total_value: total,
    card_count: data.length,
  }
}

// ── Shared visual styles ──────────────────────────────────────────────────────

function getThemeVars(theme: Theme) {
  const dk = theme === 'dark'
  return {
    dk,
    bg:   dk ? '#0d1520' : '#ffffff',
    card: dk ? '#131e2e' : '#f8fafc',
    tx:   dk ? '#f1f5f9' : '#0f172a',
    mu:   dk ? '#4a5e78' : '#94a3b8',
    br:   dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    shadow: dk ? '0 24px 80px rgba(0,0,0,0.7)' : '0 24px 80px rgba(0,0,0,0.12)',
    accent: '#1a5fad',
    green: '#22c55e',
    red: '#ef4444',
    yellow: '#f59e0b',
  }
}

function CardImg({ src, w, h, radius = 6 }: { src: string | null; w: number; h: number; radius?: number }) {
  if (!src) return <div style={{ width: w, height: h, borderRadius: radius, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
  return <img src={src} alt="" style={{ width: w, height: h, objectFit: 'contain', borderRadius: radius, flexShrink: 0 }} />
}

function Watermark({ color }: { color: string }) {
  return <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color, textTransform: 'uppercase', opacity: 0.5 }}>pokeprices.io</span>
}

// ── VISUAL 1: Insight Card ────────────────────────────────────────────────────

function InsightCard({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15 ? { label: '▲ Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: '▼ Cooling', col: v.red }
    : { label: '— Stable', col: v.yellow }
    : { label: '— Stable', col: v.yellow }

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)', padding: '22px 24px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Watermark color="rgba(255,255,255,0.7)" />
          <span style={{ fontSize: 10, fontWeight: 800, color: sig.col, background: 'rgba(0,0,0,0.3)', padding: '3px 12px', borderRadius: 20, letterSpacing: 0.5 }}>{sig.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <CardImg src={card.image_url} w={58} h={80} radius={8} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1.15, fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3 }}>{card.card_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 5, fontWeight: 600 }}>{card.set_name}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9)  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map((p, i) => (
          <div key={p.label} style={{ padding: '16px 18px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>{p.label}</div>
            <div style={{ fontSize: 17, fontWeight: 900, color: v.tx, letterSpacing: -0.3 }}>{p.usd}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 3 }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: psa10x ? '1fr 1fr 1fr' : '1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: '7d',  val: pct(card.raw_pct_7d),  col: pctCol(card.raw_pct_7d)  },
          { label: '30d', val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d) },
          ...(psa10x ? [{ label: 'Grade ×', val: psa10x + '×', col: '#a78bfa' }] : []),
        ].map((s, i, arr) => (
          <div key={s.label} style={{ padding: '14px 18px', borderRight: i < arr.length - 1 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.col, letterSpacing: -0.5 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 9, color: v.mu, fontWeight: 600 }}>Not financial advice</span>
      </div>
    </div>
  )
}

// ── VISUAL 2: PSA Gauge ───────────────────────────────────────────────────────

function PsaGauge({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const multiple = card.current_raw && card.current_psa10 ? card.current_psa10 / card.current_raw : null
  const capped = Math.min(multiple ?? 0, 15)
  const needleAngle = -180 + (capped / 15) * 180
  const info = !multiple
    ? { label: 'No Data',        col: v.mu,       desc: 'No PSA 10 price data yet.' }
    : multiple < 2  ? { label: 'Low Premium',    col: '#3b82f6', desc: 'Grading adds little value — buy PSA 10 directly or stay raw.' }
    : multiple < 5  ? { label: 'Healthy',        col: v.green,  desc: 'A fair premium. Market rewards quality sensibly.' }
    : multiple < 10 ? { label: 'Strong Premium', col: v.yellow, desc: 'High reward, high risk — only near-perfect cards hold full value.' }
    :                 { label: 'Extreme',         col: v.red,    desc: 'Massive grade premium — condition is everything here.' }

  const r = 80, cx = 120, cy = 100
  const toRad = (d: number) => d * Math.PI / 180
  const arc = (s: number, e: number) => {
    const sx = cx + r * Math.cos(toRad(s)), sy = cy + r * Math.sin(toRad(s))
    const ex = cx + r * Math.cos(toRad(e)), ey = cy + r * Math.sin(toRad(e))
    return `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`
  }
  const nx = cx + (r - 10) * Math.cos(toRad(needleAngle))
  const ny = cy + (r - 10) * Math.sin(toRad(needleAngle))

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", padding: '24px 26px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={52} h={72} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: v.mu, textTransform: 'uppercase', marginBottom: 4 }}>PSA Premium Gauge</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 3, fontWeight: 600 }}>{card.set_name}</div>
          </div>
        </div>
        <Watermark color={v.mu} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
        <svg width={240} height={120} viewBox="0 0 240 120">
          {[{ s: -180, e: -135, c: '#3b82f6' }, { s: -135, e: -90, c: v.green }, { s: -90, e: -45, c: v.yellow }, { s: -45, e: 0, c: v.red }].map((seg, i) => (
            <path key={i} d={arc(seg.s, seg.e)} fill="none" stroke={seg.c} strokeWidth={14} opacity={0.15} />
          ))}
          {multiple != null && <path d={arc(-180, needleAngle)} fill="none" stroke={info.col} strokeWidth={14} strokeLinecap="round" opacity={0.95} />}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={v.tx} strokeWidth={3} strokeLinecap="round" opacity={0.5} />
          <circle cx={cx} cy={cy} r={6} fill={info.col} />
          <text x={10}  y={118} fontSize={9} fill={v.mu} fontFamily="Figtree,sans-serif" fontWeight="700">LOW</text>
          <text x={76}  y={20}  fontSize={9} fill={v.mu} fontFamily="Figtree,sans-serif" fontWeight="700">HEALTHY</text>
          <text x={140} y={20}  fontSize={9} fill={v.mu} fontFamily="Figtree,sans-serif" fontWeight="700">STRONG</text>
          <text x={186} y={118} fontSize={9} fill={v.mu} fontFamily="Figtree,sans-serif" fontWeight="700">EXTREME</text>
        </svg>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 48, fontWeight: 900, color: info.col, lineHeight: 1, letterSpacing: -2 }}>{multiple ? multiple.toFixed(1) + '×' : '—'}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: info.col, marginBottom: 8, marginTop: 4 }}>{info.label}</div>
        <div style={{ fontSize: 12, color: v.mu, lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>{info.desc}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${v.br}`, paddingTop: 18 }}>
        {[{ label: 'Raw', val: fmt(card.current_raw), gbp: fmtGbp(card.current_raw) }, { label: 'PSA 10', val: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) }].map((p, i) => (
          <div key={p.label} style={{ textAlign: 'center', borderRight: i === 0 ? `1px solid ${v.br}` : 'none', padding: '0 8px' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{p.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: v.tx }}>{p.val}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 2 }}>{p.gbp}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── VISUAL 3: Peak Distance ───────────────────────────────────────────────────

function PeakDistance({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const peak = Math.max(card.raw_30d_ago ?? 0, card.raw_90d_ago ?? 0, card.raw_180d_ago ?? 0, card.current_raw ?? 0) || null
  const drawdown = peak && card.current_raw && peak > card.current_raw ? ((card.current_raw - peak) / peak) * 100 : 0
  const recovery = Math.min(100, Math.max(0, 100 + drawdown))
  const stLabel = drawdown > -10 ? 'Near Peak' : drawdown > -40 ? 'Recovering' : 'Off Highs'
  const stCol   = drawdown > -10 ? v.red : drawdown > -40 ? v.yellow : '#3b82f6'
  const stDesc  = drawdown > -10 ? 'Near its recent high — potential exit window for holders.'
    : drawdown > -40 ? 'Off peak but recovering. A possible entry for patient buyers.'
    : 'Well below peak — value play if the trend reverses.'
  const barH = 160, peakY = 20
  const currY = peakY + barH * (1 - recovery / 100)

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", padding: '24px 26px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={52} h={72} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: v.mu, textTransform: 'uppercase', marginBottom: 4 }}>Peak vs Current</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 3, fontWeight: 600 }}>{card.set_name}</div>
          </div>
        </div>
        <Watermark color={v.mu} />
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{ position: 'relative', width: 44, height: barH + 32, flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 18, top: peakY, width: 8, height: barH, background: v.br, borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: 18, top: currY, width: 8, height: Math.max(4, barH - (currY - peakY)), borderRadius: 4, background: `linear-gradient(to top, ${stCol}, ${stCol}99)` }} />
          <div style={{ position: 'absolute', left: 11, top: peakY - 8, width: 22, height: 22, borderRadius: '50%', background: v.red, border: `2px solid ${v.bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 8, color: '#fff', fontWeight: 900 }}>▲</span>
          </div>
          <div style={{ position: 'absolute', left: 11, top: currY - 8, width: 22, height: 22, borderRadius: '50%', background: stCol, border: `2px solid ${v.bg}` }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: v.red, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>6m High</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: v.tx, letterSpacing: -0.5 }}>{fmt(peak)}</div>
            <div style={{ fontSize: 11, color: v.mu }}>{fmtGbp(peak)}</div>
          </div>
          <div style={{ padding: '14px 0', borderTop: `1px solid ${v.br}`, borderBottom: `1px solid ${v.br}`, marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Drawdown</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: stCol, lineHeight: 1, letterSpacing: -1 }}>{drawdown === 0 ? 'At Peak' : pct(drawdown)}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: stCol, marginTop: 4 }}>{stLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Current</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: v.tx, letterSpacing: -0.5 }}>{fmt(card.current_raw)}</div>
            <div style={{ fontSize: 11, color: v.mu }}>{fmtGbp(card.current_raw)}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 16px', background: v.dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, fontSize: 12, color: v.mu, lineHeight: 1.6 }}>{stDesc}</div>
    </div>
  )
}

// ── VISUAL 4: Temperature ─────────────────────────────────────────────────────

function MarketTemperature({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const score = (card.raw_pct_30d ?? 0) * 0.6 + (card.raw_pct_90d ?? 0) * 0.4
  const { label, col, emoji, desc } =
    score > 30  ? { label: 'Overheated', col: v.red,    emoji: '🔥', desc: 'Moved hard recently. Price may be extended — risky entry now.' }
    : score > 10  ? { label: 'Hot',      col: '#f97316', emoji: '♨️', desc: 'Strong momentum. High interest, but watch for a pullback.' }
    : score > 0   ? { label: 'Warming',  col: v.yellow,  emoji: '↗', desc: 'Mild upward trend. Gradual buying interest building.' }
    : score > -10 ? { label: 'Cooling',  col: '#3b82f6', emoji: '↘', desc: 'Drifting lower. Patience may reward with a better entry.' }
    :               { label: 'Cold',     col: '#60a5fa', emoji: '❄', desc: 'Little activity. Potentially undervalued or out of favour.' }
  const segs    = ['Cold', 'Cooling', 'Warming', 'Hot', 'Overheated']
  const segCols = ['#60a5fa', '#3b82f6', v.yellow, '#f97316', v.red]
  const idx     = segs.indexOf(label)

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", padding: '24px 26px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={52} h={72} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: v.mu, textTransform: 'uppercase', marginBottom: 4 }}>Market Temperature</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 3, fontWeight: 600 }}>{card.set_name}</div>
          </div>
        </div>
        <Watermark color={v.mu} />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ fontSize: 72, lineHeight: 1, marginBottom: 14 }}>{emoji}</div>
        <div style={{ fontSize: 44, fontWeight: 900, color: col, letterSpacing: -1.5, marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 12, color: v.mu, lineHeight: 1.7, maxWidth: 300, margin: '0 auto' }}>{desc}</div>
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {segs.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 6, borderRadius: 3, background: segCols[i], opacity: i === idx ? 1 : 0.12 }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 8, color: v.mu, fontWeight: 800, letterSpacing: 0.5 }}>COLD</span>
          <span style={{ fontSize: 8, color: v.mu, fontWeight: 800, letterSpacing: 0.5 }}>OVERHEATED</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${v.br}`, paddingTop: 18 }}>
        {[
          { label: '30d Move', val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d) },
          { label: '90d Move', val: pct(card.raw_pct_90d), col: pctCol(card.raw_pct_90d) },
        ].map((s, i) => (
          <div key={s.label} style={{ textAlign: 'center', borderRight: i === 0 ? `1px solid ${v.br}` : 'none', padding: '0 8px' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: s.col, letterSpacing: -0.5 }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── VISUAL 5: Grade Breakdown ─────────────────────────────────────────────────

function GradeCompare({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const grades = [
    { label: 'Raw', price: card.current_raw, color: '#64748b', desc: 'Ungraded' },
    { label: 'PSA 9', price: card.current_psa9, color: '#3b82f6', desc: 'Near Mint+' },
    { label: 'PSA 10', price: card.current_psa10, color: '#f59e0b', desc: 'Gem Mint' },
  ].filter(g => g.price && g.price > 0)

  const maxPrice = Math.max(...grades.map(g => g.price || 0))
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw) : null
  const psa9x  = card.current_raw && card.current_psa9  ? (card.current_psa9  / card.current_raw) : null

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", padding: '24px 26px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={52} h={72} radius={8} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: v.mu, textTransform: 'uppercase', marginBottom: 4 }}>Grade Breakdown</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 3, fontWeight: 600 }}>{card.set_name}</div>
          </div>
        </div>
        <Watermark color={v.mu} />
      </div>

      {/* Bar chart */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 22, height: 130 }}>
        {grades.map(g => {
          const barPct = maxPrice > 0 ? ((g.price || 0) / maxPrice) * 100 : 0
          const barH = Math.max(16, (barPct / 100) * 110)
          return (
            <div key={g.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: g.color }}>{fmt(g.price)}</div>
              <div style={{ width: '100%', height: barH, borderRadius: '8px 8px 4px 4px', background: `linear-gradient(to top, ${g.color}, ${g.color}88)`, position: 'relative', minHeight: 16 }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: v.tx }}>{g.label}</div>
                <div style={{ fontSize: 9, color: v.mu, fontWeight: 600 }}>{g.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Multipliers */}
      {(psa9x || psa10x) && (
        <div style={{ display: 'grid', gridTemplateColumns: psa9x && psa10x ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 16 }}>
          {psa9x && (
            <div style={{ padding: '12px 14px', background: v.dk ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.06)', borderRadius: 10, border: '1px solid rgba(59,130,246,0.15)', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#3b82f6', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>PSA 9 vs Raw</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#3b82f6' }}>{psa9x.toFixed(1)}×</div>
            </div>
          )}
          {psa10x && (
            <div style={{ padding: '12px 14px', background: v.dk ? 'rgba(245,158,11,0.08)' : 'rgba(245,158,11,0.06)', borderRadius: 10, border: '1px solid rgba(245,158,11,0.15)', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>PSA 10 vs Raw</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: '#f59e0b' }}>{psa10x.toFixed(1)}×</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${v.br}`, paddingTop: 14 }}>
        {[
          { label: '30d Move', val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d) },
          { label: '90d Move', val: pct(card.raw_pct_90d), col: pctCol(card.raw_pct_90d) },
        ].map((s, i) => (
          <div key={s.label} style={{ textAlign: 'center', borderRight: i === 0 ? `1px solid ${v.br}` : 'none', padding: '0 8px' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.col }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── VISUAL 6: Market Movers ───────────────────────────────────────────────────

function MarketMovers({ movers, theme, period, direction }: { movers: Mover[]; theme: Theme; period: MoversPeriod; direction: MoversDirection }) {
  const v = getThemeVars(theme)
  const periodLabel = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' }[period]
  const accentCol = direction === 'rising' ? v.green : v.red
  const arrow = direction === 'rising' ? '▲' : '▼'
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>
      {/* Header */}
      <div style={{ background: v.dk ? '#0d2040' : '#0d2040', padding: '20px 24px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>pokeprices.io</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>{today}</span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', letterSpacing: -0.5, fontFamily: "'Outfit', sans-serif" }}>
          {arrow} Top {movers.length} {direction === 'rising' ? 'Risers' : 'Fallers'}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: 600 }}>
          Past {periodLabel} · Raw price movement
        </div>
      </div>

      {/* Table */}
      <div style={{ padding: '8px 0' }}>
        {/* Header row */}
        <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 80px 70px', gap: 8, padding: '6px 20px', borderBottom: `1px solid ${v.br}` }}>
          {['#', 'Card', 'Price', 'Change'].map(h => (
            <div key={h} style={{ fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, textAlign: h === '#' ? 'center' : h === 'Change' ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>

        {movers.slice(0, 20).map((m, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '32px 1fr 80px 70px', gap: 8,
            padding: '9px 20px',
            borderBottom: i < movers.length - 1 ? `1px solid ${v.br}` : 'none',
            background: i % 2 === 0 ? 'transparent' : v.dk ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: v.mu, textAlign: 'center', alignSelf: 'center' }}>{i + 1}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: v.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.card_name}</div>
              <div style={{ fontSize: 10, color: v.mu, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.set_name}</div>
            </div>
            <div style={{ alignSelf: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: v.tx }}>{fmt(m.current_price)}</div>
              <div style={{ fontSize: 10, color: v.mu }}>{fmtGbp(m.current_price)}</div>
            </div>
            <div style={{ textAlign: 'right', alignSelf: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: accentCol, letterSpacing: -0.3 }}>
                {pct(m.pct_change)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 20px', borderTop: `1px solid ${v.br}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: v.mu, fontWeight: 600 }}>Min $20 raw · Data: PriceCharting</span>
        <span style={{ fontSize: 9, color: v.mu, fontWeight: 600 }}>Not financial advice</span>
      </div>
    </div>
  )
}

// ── VISUAL 7: Set Report ──────────────────────────────────────────────────────

function SetReport({ setData, theme }: { setData: SetData; theme: Theme }) {
  const v = getThemeVars(theme)
  const pct30col = pctCol(setData.set_pct_30d)
  const pct90col = pctCol(setData.set_pct_90d)

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)', padding: '22px 24px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Watermark color="rgba(255,255,255,0.5)" />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>Set Performance Report</span>
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: -0.5, lineHeight: 1.1, fontFamily: "'Outfit', sans-serif" }}>{setData.set_name}</div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6, fontWeight: 600 }}>{setData.card_count} cards tracked</div>
      </div>

      {/* Set stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Set Value', val: fmtGbp(setData.total_value), sub: fmt(setData.total_value) },
          { label: 'Avg 30d',   val: pct(setData.set_pct_30d),    sub: 'all cards',   col: pct30col },
          { label: 'Avg 90d',   val: pct(setData.set_pct_90d),    sub: 'all cards',   col: pct90col },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: '16px 16px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: (s as any).col || v.tx, letterSpacing: -0.5 }}>{s.val}</div>
            <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Top cards */}
      <div style={{ padding: '14px 0' }}>
        <div style={{ padding: '0 20px 10px', fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1.5 }}>
          Top Cards by Value
        </div>
        {setData.top_cards.slice(0, 10).map((c, i) => {
          const sharePct = setData.total_value > 0 ? (c.current_raw / setData.total_value) * 100 : 0
          const barW = Math.min(100, sharePct * 3)
          return (
            <div key={i} style={{ padding: '8px 20px', borderBottom: i < setData.top_cards.length - 1 ? `1px solid ${v.br}` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, width: 14, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: v.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.card_name}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: v.tx }}>{fmt(c.current_raw)}</span>
                  {c.pct_30d != null && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: pctCol(c.pct_30d), minWidth: 50, textAlign: 'right' }}>{pct(c.pct_30d)}</span>
                  )}
                </div>
              </div>
              <div style={{ marginLeft: 22 }}>
                <div style={{ height: 3, borderRadius: 2, background: v.br, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barW}%`, background: 'linear-gradient(to right, #1a5fad, #2874c8)', borderRadius: 2 }} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ padding: '10px 20px', borderTop: `1px solid ${v.br}`, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, color: v.mu }}>Data: PriceCharting · pokeprices.io</span>
        <span style={{ fontSize: 9, color: v.mu }}>Not financial advice</span>
      </div>
    </div>
  )
}

// ── Placeholder ───────────────────────────────────────────────────────────────

function Placeholder({ message }: { message?: string }) {
  return (
    <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 22, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.15 }}>◈</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
        {message || 'Search for a card to begin'}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, maxWidth: 280 }}>
        Try "Charizard Base Set", "Umbreon 215 Evolving Skies", or any card name
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StudioPageClient({ initialCardSlug, initialVisual }: { initialCardSlug?: string; initialVisual?: string }) {
  const isMobile = useIsMobile()
  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [card,          setCard]          = useState<CardData | null>(null)
  const [movers,        setMovers]        = useState<Mover[]>([])
  const [setData,       setSetData]       = useState<SetData | null>(null)
  const [setQuery,      setSetQuery]      = useState('')
  const [visualType,    setVisualType]    = useState<VisualType>((initialVisual as VisualType) || 'insight')
  const [theme,         setTheme]         = useState<Theme>('dark')
  const [moversPeriod,  setMoversPeriod]  = useState<MoversPeriod>('30d')
  const [moversDir,     setMoversDir]     = useState<MoversDirection>('rising')
  const [loading,       setLoading]       = useState(false)
  const [exporting,     setExporting]     = useState(false)
  const searchDebounce  = useRef<NodeJS.Timeout>()
  const setDebounce     = useRef<NodeJS.Timeout>()

  // Load initial card
  useEffect(() => {
    if (initialCardSlug) {
      setLoading(true)
      fetchCard(initialCardSlug).then(data => { if (data) setCard(data); setLoading(false) })
    }
  }, [initialCardSlug])

  // Load movers when tab selected or period/direction changes
  useEffect(() => {
    if (visualType === 'movers') {
      setLoading(true)
      fetchMovers(moversPeriod, moversDir).then(data => { setMovers(data); setLoading(false) })
    }
  }, [visualType, moversPeriod, moversDir])

  // Card search
  useEffect(() => {
    clearTimeout(searchDebounce.current)
    const q = search.trim()
    if (q.length < 2) { setSearchResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_global', { query: q })
      if (data) setSearchResults((data as any[]).filter(r => r.result_type === 'card').slice(0, 8))
    }, 280)
  }, [search])

  // Set search
  useEffect(() => {
    clearTimeout(setDebounce.current)
    const q = setQuery.trim()
    if (q.length < 2) return
    setDebounce.current = setTimeout(async () => {
      setLoading(true)
      const data = await fetchSetData(q)
      setSetData(data)
      setLoading(false)
    }, 600)
  }, [setQuery])

  async function selectCard(result: any) {
    setSearch(''); setSearchResults([]); setLoading(true)
    let data = await fetchCard(result.url_slug || result.card_slug)
    if (!data) {
      const { data: row } = await supabase.from('cards').select('card_slug').eq('card_url_slug', result.url_slug || result.card_slug).single()
      if (row) data = await fetchCard(row.card_slug)
    }
    if (data) setCard(data)
    setLoading(false)
  }

  // Server-side PNG export via API route
  async function exportPng() {
    if (exporting) return
    setExporting(true)
    try {
      let url = `/api/studio/render?type=${visualType}&theme=${theme}`
      if (card && ['insight','psa-gauge','peak-distance','temperature','grade-compare'].includes(visualType)) {
        url += `&card=${card.card_slug}`
      } else if (visualType === 'movers') {
        url += `&period=${moversPeriod}&direction=${moversDir}`
      } else if (visualType === 'set-report' && setData) {
        url += `&set=${encodeURIComponent(setData.set_name)}`
      }
      const resp = await fetch(url)
      if (!resp.ok) throw new Error('Render failed')
      const blob = await resp.blob()
      const link = document.createElement('a')
      const fileName = card ? `pokeprices-${card.card_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${visualType}.png`
        : `pokeprices-${visualType}-${moversPeriod}.png`
      link.download = fileName
      link.href = URL.createObjectURL(blob)
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (e) {
      // Fallback to html2canvas
      const el = document.getElementById('studio-preview')
      if (!el) return
      try {
        if (!(window as any).html2canvas) {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
          document.head.appendChild(s)
          await new Promise((res, rej) => { s.onload = res; s.onerror = rej })
        }
        const canvas = await (window as any).html2canvas(el, { scale: 2, useCORS: true, backgroundColor: null })
        const link = document.createElement('a')
        link.download = `pokeprices-export.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      } catch {}
    }
    setExporting(false)
  }

  const needsCard    = ['insight','psa-gauge','peak-distance','temperature','grade-compare'].includes(visualType)
  const needsMovers  = visualType === 'movers'
  const needsSet     = visualType === 'set-report'
  const canExport    = (needsCard && !!card) || (needsMovers && movers.length > 0) || (needsSet && !!setData)

  function renderVisual() {
    if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", fontSize: 14 }}>Loading…</div>
    if (needsCard && !card)  return <Placeholder />
    if (needsMovers) {
      if (!movers.length) return <Placeholder message="Loading market data…" />
      return <MarketMovers movers={movers} theme={theme} period={moversPeriod} direction={moversDir} />
    }
    if (needsSet) {
      if (!setData) return <Placeholder message="Type a set name on the left to load" />
      return <SetReport setData={setData} theme={theme} />
    }
    switch (visualType) {
      case 'insight':       return <InsightCard       card={card!} theme={theme} />
      case 'psa-gauge':     return <PsaGauge          card={card!} theme={theme} />
      case 'peak-distance': return <PeakDistance      card={card!} theme={theme} />
      case 'temperature':   return <MarketTemperature card={card!} theme={theme} />
      case 'grade-compare': return <GradeCompare      card={card!} theme={theme} />
    }
  }

  const panelStyle: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }
  const labelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree',sans-serif", display: 'block' }
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree',sans-serif", outline: 'none', boxSizing: 'border-box' }

  // Group visuals by category
  const categories = ['Card', 'Market', 'Set']

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: isMobile ? '20px 14px 110px' : '32px 24px' }}>

      <div style={{ marginBottom: isMobile ? 18 : 28 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: isMobile ? 24 : 30, margin: '0 0 4px', color: 'var(--text)', fontWeight: 900 }}>PokePrices Studio</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree',sans-serif" }}>
          Create shareable market intelligence visuals for Twitter, Reddit, and Discord.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '300px 1fr', gap: isMobile ? 14 : 28, alignItems: 'start' }}>

        {/* ── CONTROLS ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Visual type picker */}
          <div style={panelStyle}>
            <span style={labelStyle}>1. Choose Visual</span>
            {categories.map(cat => {
              const catVisuals = VISUAL_TYPES.filter(v => v.category === cat)
              return (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6, fontFamily: "'Figtree',sans-serif" }}>{cat}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {catVisuals.map(vt => (
                      <button key={vt.id} onClick={() => setVisualType(vt.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, border: visualType === vt.id ? '1px solid var(--primary)' : '1px solid var(--border)', background: visualType === vt.id ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                        <span style={{ fontSize: 14, color: visualType === vt.id ? 'var(--primary)' : 'var(--text-muted)', width: 20, flexShrink: 0 }}>{vt.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif" }}>{vt.label}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{vt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Card search — shown for card visuals */}
          {needsCard && (
            <div style={panelStyle}>
              <span style={labelStyle}>2. Select Card</span>
              <div style={{ position: 'relative' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                  placeholder="Charizard Base Set…" style={inputStyle} />
                {searchResults.length > 0 && (
                  <div onMouseDown={e => e.preventDefault()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 4, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
                    {searchResults.map((r, i) => (
                      <div key={i} onClick={() => selectCard(r)}
                        style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                        {r.image_url ? <img src={r.image_url} alt="" style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} /> : <div style={{ width: 26, height: 36, background: 'var(--bg-light)', borderRadius: 3, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{r.subtitle}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {card && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(26,95,173,0.07)', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                  {card.image_url && <img src={card.image_url} alt="" style={{ width: 24, height: 34, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{card.set_name}</div>
                  </div>
                  <button onClick={() => setCard(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              )}
            </div>
          )}

          {/* Movers controls */}
          {needsMovers && (
            <div style={panelStyle}>
              <span style={labelStyle}>2. Configure</span>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", fontWeight: 700, marginBottom: 6 }}>Direction</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([['rising', '▲ Risers'], ['falling', '▼ Fallers']] as const).map(([d, label]) => (
                    <button key={d} onClick={() => setMoversDir(d)}
                      style={{ flex: 1, padding: '8px', borderRadius: 8, border: moversDir === d ? '1px solid var(--primary)' : '1px solid var(--border)', background: moversDir === d ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: moversDir === d ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", fontWeight: 700, marginBottom: 6 }}>Period</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['7d', '30d', '90d'] as MoversPeriod[]).map(p => (
                    <button key={p} onClick={() => setMoversPeriod(p)}
                      style={{ flex: 1, padding: '8px', borderRadius: 8, border: moversPeriod === p ? '1px solid var(--primary)' : '1px solid var(--border)', background: moversPeriod === p ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: moversPeriod === p ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Set search */}
          {needsSet && (
            <div style={panelStyle}>
              <span style={labelStyle}>2. Select Set</span>
              <input value={setQuery} onChange={e => setSetQuery(e.target.value)} placeholder="Evolving Skies, Base Set…" style={inputStyle} />
              {setData && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--primary)', fontFamily: "'Figtree',sans-serif", fontWeight: 700 }}>
                  ✓ {setData.set_name} · {setData.card_count} cards
                </div>
              )}
            </div>
          )}

          {/* Theme */}
          <div style={panelStyle}>
            <span style={labelStyle}>3. Theme</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['dark', 'light'] as Theme[]).map(t => (
                <button key={t} onClick={() => setTheme(t)}
                  style={{ flex: 1, padding: '9px', borderRadius: 10, border: theme === t ? '1px solid var(--primary)' : '1px solid var(--border)', background: theme === t ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: theme === t ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>
                  {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── PREVIEW ── */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={labelStyle}>Preview</span>
            {canExport && !isMobile && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={exportPng} disabled={exporting}
                  style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree',sans-serif", cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
                  {exporting ? 'Exporting…' : '↓ Download PNG'}
                </button>
                {card && (
                  <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(card.card_name + ' market data via @PokePricesIO')}&url=${encodeURIComponent('https://pokeprices.io/studio?card=' + card.card_slug + '&visual=' + visualType)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, fontFamily: "'Figtree',sans-serif", textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    Share
                  </a>
                )}
              </div>
            )}
          </div>

          <div id="studio-preview" style={{ maxWidth: needsMovers ? 680 : 560 }}>
            {renderVisual()}
          </div>
        </div>
      </div>

      {/* Mobile export bar */}
      {isMobile && canExport && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card)', borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', gap: 10, zIndex: 50 }}>
          <button onClick={exportPng} disabled={exporting}
            style={{ flex: 2, padding: '13px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: "'Figtree',sans-serif", cursor: exporting ? 'wait' : 'pointer' }}>
            {exporting ? 'Exporting…' : '↓ Download PNG'}
          </button>
        </div>
      )}
    </div>
  )
}