'use client'
import { useState, useEffect, useRef } from 'react'
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
  image_url: string | null
  raw_usd: number | null
}

type VisualType = 'insight' | 'psa-gauge' | 'peak-distance' | 'temperature'
type Theme = 'dark' | 'light'

const VISUAL_TYPES: { id: VisualType; label: string; icon: string; desc: string }[] = [
  { id: 'insight',       label: 'Insight Card',  icon: '◈', desc: 'Prices, trend & grade premium'    },
  { id: 'psa-gauge',     label: 'PSA Gauge',      icon: '◎', desc: 'How extreme is grading premium?'  },
  { id: 'peak-distance', label: 'Peak Distance',  icon: '△', desc: 'Price vs its recent high'         },
  { id: 'temperature',   label: 'Temperature',    icon: '◉', desc: 'Is this card hot or cooling?'     },
]

// ── Formatters ────────────────────────────────────────────────────────────────

const USD_TO_GBP = 0.79

function fmt(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const v = cents / 100
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + v.toFixed(2)
}

function fmtGbp(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return '£' + ((cents / 100) * USD_TO_GBP).toFixed(2)
}

function pct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
}

function pctCol(n: number | null | undefined): string {
  if (n == null) return '#94a3b8'
  return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#94a3b8'
}

// ── Responsive hook ───────────────────────────────────────────────────────────

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

// ── Data loader ───────────────────────────────────────────────────────────────

async function fetchCard(slug: string): Promise<CardData | null> {
  const [{ data: trend }, { data: meta }] = await Promise.all([
    supabase.from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d, raw_pct_90d, raw_30d_ago, raw_90d_ago, raw_180d_ago')
      .eq('card_slug', slug).single(),
    supabase.from('cards')
      .select('card_url_slug, image_url')
      .eq('card_slug', slug).single(),
  ])
  if (!trend) return null
  return { ...trend, card_url_slug: meta?.card_url_slug || null, image_url: meta?.image_url || null }
}

// ── Card image component ──────────────────────────────────────────────────────

function CardImg({ src, w, h }: { src: string | null; w: number; h: number }) {
  if (!src) return <div style={{ width: w, height: h, borderRadius: 6, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
  return <img src={src} alt="" style={{ width: w, height: h, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
}

// ── Visual: Insight Card ──────────────────────────────────────────────────────

function InsightCard({ card, theme }: { card: CardData; theme: Theme }) {
  const dk = theme === 'dark'
  const bg = dk ? '#0f1923' : '#fff'
  const tx = dk ? '#f1f5f9' : '#0f172a'
  const mu = dk ? '#64748b' : '#94a3b8'
  const br = dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15 ? { label: 'Trending Up', col: '#22c55e' }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', col: '#ef4444' }
    : { label: 'Stable', col: '#f59e0b' }
    : { label: 'Stable', col: '#f59e0b' }

  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${br}`, boxShadow: dk ? '0 20px 60px rgba(0,0,0,0.6)' : '0 20px 60px rgba(0,0,0,0.12)', fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)', padding: '20px 22px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase' }}>Market Insight · pokeprices.io</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: sig.col, background: 'rgba(0,0,0,0.3)', padding: '3px 12px', borderRadius: 20 }}>{sig.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CardImg src={card.image_url} w={52} h={72} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.2, fontFamily: "'Outfit', sans-serif" }}>{card.card_name}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{card.set_name}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9)  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map((p, i) => (
          <div key={p.label} style={{ padding: '16px 18px', borderRight: i < 2 ? `1px solid ${br}` : 'none' }}>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5 }}>{p.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: tx }}>{p.usd}</div>
            <div style={{ fontSize: 11, color: mu, marginTop: 2 }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: psa10x ? '1fr 1fr 1fr' : '1fr 1fr', borderBottom: `1px solid ${br}` }}>
        {[
          { label: '30d Move',     val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d) },
          { label: '90d Move',     val: pct(card.raw_pct_90d), col: pctCol(card.raw_pct_90d) },
          ...(psa10x ? [{ label: 'Grade Premium', val: psa10x + '× raw', col: tx }] : []),
        ].map((s, i, arr) => (
          <div key={s.label} style={{ padding: '14px 18px', borderRight: i < arr.length - 1 ? `1px solid ${br}` : 'none' }}>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.col }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 18px', display: 'flex', justifyContent: 'flex-end' }}>
        <span style={{ fontSize: 10, color: mu }}>Not financial advice</span>
      </div>
    </div>
  )
}

// ── Visual: PSA Gauge ─────────────────────────────────────────────────────────

function PsaGauge({ card, theme }: { card: CardData; theme: Theme }) {
  const dk = theme === 'dark'
  const bg = dk ? '#0f1923' : '#fff'
  const tx = dk ? '#f1f5f9' : '#0f172a'
  const mu = dk ? '#64748b' : '#94a3b8'
  const br = dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const multiple = card.current_raw && card.current_psa10 ? card.current_psa10 / card.current_raw : null
  const capped = Math.min(multiple ?? 0, 15)
  const needleAngle = -180 + (capped / 15) * 180
  const info = !multiple
    ? { label: 'No Data',        col: mu,        desc: 'No PSA 10 price data available yet.' }
    : multiple < 2  ? { label: 'Low Premium',    col: '#3b82f6', desc: 'Grading adds little value — buy a PSA 10 directly or stay raw.' }
    : multiple < 5  ? { label: 'Healthy',        col: '#22c55e', desc: 'A fair grade premium — the market is rewarding quality sensibly.' }
    : multiple < 10 ? { label: 'Strong Premium', col: '#f59e0b', desc: 'High reward, high risk — only near-perfect grades hold full value.' }
    :                 { label: 'Extreme',         col: '#ef4444', desc: 'Very high grade premium — anything below PSA 10 loses significant value.' }

  const r = 80; const cx = 120; const cy = 100
  const toRad = (d: number) => d * Math.PI / 180
  const arc = (s: number, e: number) => {
    const sx = cx + r * Math.cos(toRad(s)), sy = cy + r * Math.sin(toRad(s))
    const ex = cx + r * Math.cos(toRad(e)), ey = cy + r * Math.sin(toRad(e))
    return `M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${ey}`
  }
  const nx = cx + (r - 10) * Math.cos(toRad(needleAngle))
  const ny = cy + (r - 10) * Math.sin(toRad(needleAngle))

  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${br}`, boxShadow: dk ? '0 20px 60px rgba(0,0,0,0.6)' : '0 20px 60px rgba(0,0,0,0.12)', fontFamily: "'Figtree', sans-serif", padding: '22px 24px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={48} h={67} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: mu, textTransform: 'uppercase', marginBottom: 3 }}>PSA Premium Gauge</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: mu, marginTop: 2 }}>{card.set_name}</div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: mu, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>pokeprices.io</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={240} height={120} viewBox="0 0 240 120">
          {[{ s: -180, e: -135, c: '#3b82f6' }, { s: -135, e: -90, c: '#22c55e' }, { s: -90, e: -45, c: '#f59e0b' }, { s: -45, e: 0, c: '#ef4444' }].map((seg, i) => (
            <path key={i} d={arc(seg.s, seg.e)} fill="none" stroke={seg.c} strokeWidth={12} strokeLinecap="butt" opacity={0.2} />
          ))}
          {multiple != null && <path d={arc(-180, needleAngle)} fill="none" stroke={info.col} strokeWidth={12} strokeLinecap="round" opacity={0.95} />}
          <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={tx} strokeWidth={2.5} strokeLinecap="round" opacity={0.6} />
          <circle cx={cx} cy={cy} r={5} fill={info.col} />
          <text x={14}  y={116} fontSize={9} fill={mu} fontFamily="Figtree,sans-serif">Low</text>
          <text x={80}  y={22}  fontSize={9} fill={mu} fontFamily="Figtree,sans-serif">Healthy</text>
          <text x={145} y={22}  fontSize={9} fill={mu} fontFamily="Figtree,sans-serif">Strong</text>
          <text x={196} y={116} fontSize={9} fill={mu} fontFamily="Figtree,sans-serif">Extreme</text>
        </svg>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 20, marginTop: 4 }}>
        <div style={{ fontSize: 40, fontWeight: 900, color: info.col, lineHeight: 1.1 }}>{multiple ? multiple.toFixed(1) + 'x' : '—'}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: info.col, marginBottom: 8 }}>{info.label}</div>
        <div style={{ fontSize: 12, color: mu, lineHeight: 1.6, maxWidth: 280, margin: '0 auto' }}>{info.desc}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${br}`, paddingTop: 16 }}>
        {[{ label: 'Raw', val: fmt(card.current_raw), gbp: fmtGbp(card.current_raw) }, { label: 'PSA 10', val: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) }].map((p, i) => (
          <div key={p.label} style={{ textAlign: 'center', borderRight: i === 0 ? `1px solid ${br}` : 'none', padding: '0 8px' }}>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{p.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: tx }}>{p.val}</div>
            <div style={{ fontSize: 11, color: mu }}>{p.gbp}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Visual: Peak Distance ─────────────────────────────────────────────────────

function PeakDistance({ card, theme }: { card: CardData; theme: Theme }) {
  const dk = theme === 'dark'
  const bg = dk ? '#0f1923' : '#fff'
  const tx = dk ? '#f1f5f9' : '#0f172a'
  const mu = dk ? '#64748b' : '#94a3b8'
  const br = dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const peak = Math.max(card.raw_30d_ago ?? 0, card.raw_90d_ago ?? 0, card.raw_180d_ago ?? 0, card.current_raw ?? 0) || null
  const drawdown = peak && card.current_raw && peak > card.current_raw ? ((card.current_raw - peak) / peak) * 100 : 0
  const recovery = Math.min(100, Math.max(0, 100 + drawdown))
  const stLabel = drawdown > -10 ? 'Near Peak' : drawdown > -40 ? 'Recovering' : 'Deeply Off Highs'
  const stCol   = drawdown > -10 ? '#ef4444'  : drawdown > -40 ? '#f59e0b'   : '#3b82f6'
  const stDesc  = drawdown > -10 ? 'Near its recent high — if holding, this may be a good exit window.'
    : drawdown > -40 ? 'Off its peak but recovering. A possible entry point for patient buyers.'
    : 'Well below peak — potential value play if the trend reverses.'
  const barH = 160; const peakY = 20
  const currY = peakY + barH * (1 - recovery / 100)

  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${br}`, boxShadow: dk ? '0 20px 60px rgba(0,0,0,0.6)' : '0 20px 60px rgba(0,0,0,0.12)', fontFamily: "'Figtree', sans-serif", padding: '22px 24px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={48} h={67} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: mu, textTransform: 'uppercase', marginBottom: 3 }}>Peak vs Current</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: mu, marginTop: 2 }}>{card.set_name}</div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: mu, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>pokeprices.io</div>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ position: 'relative', width: 44, height: barH + 32, flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 18, top: peakY, width: 8, height: barH, background: br, borderRadius: 4 }} />
          <div style={{ position: 'absolute', left: 18, top: currY, width: 8, height: Math.max(4, barH - (currY - peakY)), borderRadius: 4, background: `linear-gradient(to top, ${stCol}, ${stCol}99)` }} />
          <div style={{ position: 'absolute', left: 12, top: peakY - 7, width: 20, height: 20, borderRadius: '50%', background: '#ef4444', border: `2px solid ${bg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 7, color: '#fff', fontWeight: 900 }}>▲</span>
          </div>
          <div style={{ position: 'absolute', left: 12, top: currY - 7, width: 20, height: 20, borderRadius: '50%', background: stCol, border: `2px solid ${bg}` }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>6m High</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: tx }}>{fmt(peak)}</div>
            <div style={{ fontSize: 11, color: mu }}>{fmtGbp(peak)}</div>
          </div>
          <div style={{ padding: '12px 0', borderTop: `1px solid ${br}`, borderBottom: `1px solid ${br}`, marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Drawdown</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: stCol, lineHeight: 1 }}>{drawdown === 0 ? 'At Peak' : pct(drawdown)}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: stCol, marginTop: 3 }}>{stLabel}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>Current</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: tx }}>{fmt(card.current_raw)}</div>
            <div style={{ fontSize: 11, color: mu }}>{fmtGbp(card.current_raw)}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 14px', background: dk ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderRadius: 10, fontSize: 12, color: mu, lineHeight: 1.6 }}>{stDesc}</div>
    </div>
  )
}

// ── Visual: Temperature ───────────────────────────────────────────────────────

function MarketTemperature({ card, theme }: { card: CardData; theme: Theme }) {
  const dk = theme === 'dark'
  const bg = dk ? '#0f1923' : '#fff'
  const tx = dk ? '#f1f5f9' : '#0f172a'
  const mu = dk ? '#64748b' : '#94a3b8'
  const br = dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const score = (card.raw_pct_30d ?? 0) * 0.6 + (card.raw_pct_90d ?? 0) * 0.4
  const { label, col, emoji, desc } =
    score > 30  ? { label: 'Overheated', col: '#ef4444', emoji: '🔥', desc: 'Moved hard recently — price may be extended. Risky entry now.' }     :
    score > 10  ? { label: 'Hot',        col: '#f97316', emoji: '♨️', desc: 'Strong momentum — high interest, but watch for a pullback.' }        :
    score > 0   ? { label: 'Warming',    col: '#f59e0b', emoji: '↗',  desc: 'Mild upward trend — gradual buying interest building.' }             :
    score > -10 ? { label: 'Cooling',    col: '#3b82f6', emoji: '↘',  desc: 'Drifting lower — patience may reward with a better entry.' }         :
                  { label: 'Cold',       col: '#60a5fa', emoji: '❄',  desc: 'Little activity — potentially undervalued or out of favour.' }
  const segs    = ['Cold', 'Cooling', 'Warming', 'Hot', 'Overheated']
  const segCols = ['#60a5fa', '#3b82f6', '#f59e0b', '#f97316', '#ef4444']
  const idx     = segs.indexOf(label)

  return (
    <div style={{ background: bg, borderRadius: 20, overflow: 'hidden', border: `1px solid ${br}`, boxShadow: dk ? '0 20px 60px rgba(0,0,0,0.6)' : '0 20px 60px rgba(0,0,0,0.12)', fontFamily: "'Figtree', sans-serif", padding: '22px 24px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <CardImg src={card.image_url} w={48} h={67} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: mu, textTransform: 'uppercase', marginBottom: 3 }}>Market Temperature</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: tx, fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: mu, marginTop: 2 }}>{card.set_name}</div>
          </div>
        </div>
        <div style={{ fontSize: 9, color: mu, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>pokeprices.io</div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 12 }}>{emoji}</div>
        <div style={{ fontSize: 40, fontWeight: 900, color: col, marginBottom: 8 }}>{label}</div>
        <div style={{ fontSize: 12, color: mu, lineHeight: 1.6, maxWidth: 300, margin: '0 auto' }}>{desc}</div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
          {segs.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 8, borderRadius: 4, background: segCols[i], opacity: i === idx ? 1 : 0.15, transition: 'opacity 0.2s' }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: mu, fontWeight: 700 }}>COLD</span>
          <span style={{ fontSize: 9, color: mu, fontWeight: 700 }}>OVERHEATED</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${br}`, paddingTop: 16 }}>
        {[
          { label: '30d Move', val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d) },
          { label: '90d Move', val: pct(card.raw_pct_90d), col: pctCol(card.raw_pct_90d) },
        ].map((s, i) => (
          <div key={s.label} style={{ textAlign: 'center', borderRight: i === 0 ? `1px solid ${br}` : 'none', padding: '0 8px' }}>
            <div style={{ fontSize: 10, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.col }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Placeholder ───────────────────────────────────────────────────────────────

function Placeholder() {
  return (
    <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, padding: 40, textAlign: 'center' }}>
      <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.2 }}>◈</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>Search for a card to begin</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, maxWidth: 260 }}>Try "Charizard Base Set", "Umbreon 215 Evolving Skies", or any set name</div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function StudioPageClient({ initialCardSlug, initialVisual }: { initialCardSlug?: string; initialVisual?: string }) {
  const isMobile = useIsMobile()
  const [search,        setSearch]        = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [card,          setCard]          = useState<CardData | null>(null)
  const [visualType,    setVisualType]    = useState<VisualType>((initialVisual as VisualType) || 'insight')
  const [theme,         setTheme]         = useState<Theme>('dark')
  const [loading,       setLoading]       = useState(false)
  const [exporting,     setExporting]     = useState(false)
  const searchDebounce = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (initialCardSlug) {
      setLoading(true)
      fetchCard(initialCardSlug).then(data => { if (data) setCard(data); setLoading(false) })
    }
  }, [initialCardSlug])

  // Flexible search using search_global RPC
  useEffect(() => {
    clearTimeout(searchDebounce.current)
    const q = search.trim()
    if (q.length < 2) { setSearchResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      const { data: rpcData } = await supabase.rpc('search_global', { query: q })
      if (rpcData && rpcData.length > 0) {
        const cards = (rpcData as any[]).filter(r => r.result_type === 'card').slice(0, 8)
        if (cards.length > 0) {
          setSearchResults(cards.map((r: any) => ({
            card_slug: r.url_slug,
            card_name: r.name,
            set_name:  r.subtitle,
            image_url: r.image_url,
            raw_usd:   r.price_usd,
          })))
          return
        }
      }
      // Fallback direct search
      const { data } = await supabase
        .from('card_trends')
        .select('card_slug, card_name, set_name, current_raw')
        .or(`card_name.ilike.%${q}%,set_name.ilike.%${q}%`)
        .not('current_raw', 'is', null)
        .order('current_raw', { ascending: false })
        .limit(8)
      if (data) {
        const slugs = data.map(d => d.card_slug)
        const { data: meta } = await supabase.from('cards').select('card_slug, image_url').in('card_slug', slugs)
        setSearchResults(data.map(d => ({
          card_slug: d.card_slug,
          card_name: d.card_name,
          set_name:  d.set_name,
          image_url: meta?.find(m => m.card_slug === d.card_slug)?.image_url || null,
          raw_usd:   d.current_raw,
        })))
      }
    }, 280)
  }, [search])

  async function selectCard(result: SearchResult) {
    setSearch('')
    setSearchResults([])
    setLoading(true)
    // search_global returns url_slug — try as card_slug first, then look up by url_slug
    let data = await fetchCard(result.card_slug)
    if (!data) {
      const { data: row } = await supabase.from('cards').select('card_slug').eq('card_url_slug', result.card_slug).single()
      if (row) data = await fetchCard(row.card_slug)
    }
    if (data) setCard(data)
    setLoading(false)
  }

  async function exportPng() {
    if (!card || exporting) return
    setExporting(true)
    const el = document.getElementById('studio-preview')
    if (!el) { setExporting(false); return }
    try {
      if (!(window as any).html2canvas) {
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
        document.head.appendChild(s)
        await new Promise((res, rej) => { s.onload = res; s.onerror = rej })
      }
      // Proxy images through our server to bypass CORS
      const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[]
      const orig = imgs.map(i => i.src)
      for (const img of imgs) {
        if (img.src && !img.src.startsWith(window.location.origin)) {
          img.src = `/api/imgproxy?url=${encodeURIComponent(img.src.split('?')[0])}`
        }
      }
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r })))
      const canvas = await (window as any).html2canvas(el, { scale: 2, useCORS: true, allowTaint: false, backgroundColor: null, logging: false })
      imgs.forEach((img, i) => { img.src = orig[i] })
      const link = document.createElement('a')
      link.download = `pokeprices-${card.card_name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${visualType}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('Export failed:', e)
      alert('Export failed — try right-clicking the preview and saving.')
    }
    setExporting(false)
  }

  function renderVisual() {
    if (loading)  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", fontSize: 14 }}>Loading…</div>
    if (!card)    return <Placeholder />
    switch (visualType) {
      case 'insight':       return <InsightCard       card={card} theme={theme} />
      case 'psa-gauge':     return <PsaGauge          card={card} theme={theme} />
      case 'peak-distance': return <PeakDistance      card={card} theme={theme} />
      case 'temperature':   return <MarketTemperature card={card} theme={theme} />
    }
  }

  const panelStyle: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree',sans-serif" }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto', padding: isMobile ? '20px 14px 110px' : '32px 24px' }}>

      <div style={{ marginBottom: isMobile ? 18 : 26 }}>
        <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: isMobile ? 24 : 30, margin: '0 0 4px', color: 'var(--text)' }}>PokePrices Studio</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree',sans-serif" }}>
          Turn card market data into shareable visuals.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '296px 1fr', gap: isMobile ? 14 : 24, alignItems: 'start' }}>

        {/* ── CONTROLS ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Search */}
          <div style={panelStyle}>
            <div style={labelStyle}>1. Select a Card</div>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                placeholder="Charizard · Umbreon 215 · Evolving Skies..."
                style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree',sans-serif", outline: 'none', boxSizing: 'border-box' }}
              />
              {searchResults.length > 0 && (
                <div onMouseDown={e => e.preventDefault()} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 4, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
                  {searchResults.map(r => (
                    <div key={r.card_slug} onClick={() => selectCard(r)}
                      style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                    >
                      {r.image_url
                        ? <img src={r.image_url} alt="" style={{ width: 28, height: 39, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                        : <div style={{ width: 28, height: 39, background: 'var(--bg-light)', borderRadius: 3, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{r.set_name}</div>
                      </div>
                      {r.raw_usd != null && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", flexShrink: 0 }}>${(r.raw_usd / 100).toFixed(0)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {card && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(26,95,173,0.07)', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                {card.image_url && <img src={card.image_url} alt="" style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.card_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{card.set_name}</div>
                </div>
                <button onClick={() => setCard(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, padding: '0 2px', lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>

          {/* Visual type */}
          <div style={panelStyle}>
            <div style={labelStyle}>2. Choose Visual</div>
            {isMobile ? (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                {VISUAL_TYPES.map(v => (
                  <button key={v.id} onClick={() => setVisualType(v.id)} style={{ flexShrink: 0, width: 130, padding: '10px 12px', borderRadius: 10, border: visualType === v.id ? '1px solid var(--primary)' : '1px solid var(--border)', background: visualType === v.id ? 'rgba(26,95,173,0.08)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: 16, color: visualType === v.id ? 'var(--primary)' : 'var(--text-muted)', marginBottom: 4 }}>{v.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif" }}>{v.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", marginTop: 2, lineHeight: 1.3 }}>{v.desc}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {VISUAL_TYPES.map(v => (
                  <button key={v.id} onClick={() => setVisualType(v.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: visualType === v.id ? '1px solid var(--primary)' : '1px solid var(--border)', background: visualType === v.id ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', width: '100%' }}>
                    <span style={{ fontSize: 15, color: visualType === v.id ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0, width: 20 }}>{v.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree',sans-serif" }}>{v.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif" }}>{v.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Theme */}
          <div style={panelStyle}>
            <div style={labelStyle}>3. Theme</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['dark', 'light'] as Theme[]).map(t => (
                <button key={t} onClick={() => setTheme(t)} style={{ flex: 1, padding: '9px', borderRadius: 10, border: theme === t ? '1px solid var(--primary)' : '1px solid var(--border)', background: theme === t ? 'rgba(26,95,173,0.07)' : 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: theme === t ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", transition: 'all 0.15s' }}>
                  {t === 'dark' ? '🌙 Dark' : '☀️ Light'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── PREVIEW ── */}
        <div>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={labelStyle}>Preview</div>
            {card && !isMobile && (
              <button onClick={exportPng} disabled={exporting} style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree',sans-serif", cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
                {exporting ? 'Exporting…' : '↓ Download PNG'}
              </button>
            )}
          </div>

          <div id="studio-preview" style={{ maxWidth: 560 }}>
            {renderVisual()}
          </div>

          {card && !isMobile && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/studio?card=${card.card_slug}&visual=${visualType}`)}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree',sans-serif", cursor: 'pointer' }}>
                Copy Link
              </button>
              <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(card.card_name + ' on @PokePricesIO')}&url=${encodeURIComponent('https://pokeprices.io/studio?card=' + card.card_slug + '&visual=' + visualType)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree',sans-serif", textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                Share on X
              </a>
            </div>
          )}

          {!card && !loading && (
            <div style={{ marginTop: 16, padding: '14px 18px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontFamily: "'Figtree',sans-serif" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Search tips</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Type any combination — card name, set name, card number, Pokémon name — in any order. The search handles all of it. Examples: "Charizard Base Set", "215 Evolving Skies", "Umbreon VMAX", "Neo Destiny Shining Mewtwo".
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky bottom bar */}
      {isMobile && card && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--card)', borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', gap: 10, zIndex: 50, boxShadow: '0 -4px 20px rgba(0,0,0,0.15)' }}>
          <button onClick={exportPng} disabled={exporting} style={{ flex: 2, padding: '13px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 800, fontFamily: "'Figtree',sans-serif", cursor: exporting ? 'wait' : 'pointer', opacity: exporting ? 0.7 : 1 }}>
            {exporting ? 'Exporting…' : '↓ Download PNG'}
          </button>
          <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(card.card_name + ' on @PokePricesIO')}&url=${encodeURIComponent('https://pokeprices.io/studio?card=' + card.card_slug)}`}
            target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, padding: '13px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 14, fontWeight: 800, fontFamily: "'Figtree',sans-serif", textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            Share
          </a>
        </div>
      )}
    </div>
  )
}
