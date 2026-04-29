'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import FAQ from '@/components/FAQ'
import { getStudioFaqItems } from '@/lib/faqs'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// -- Types ---------------------------------------------------------------------

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
  set_logo_url: string | null
}

interface Mover {
  card_name: string
  set_name: string
  current_price: number
  pct_change: number
  card_url_slug?: string
  image_url?: string
  card_slug?: string
  volume_label?: string
  confidence?: string
}

interface SetData {
  set_name: string
  logo_url: string | null
  release_year: string | null
  top_cards: { card_name: string; current_raw: number; current_psa9: number | null; current_psa10: number | null; pct_30d: number | null; image_url: string | null; card_slug: string }[]
  set_pct_30d: number | null
  set_pct_90d: number | null
  set_pct_7d: number | null
  sparkline: number[]
  total_value: number
}

type VisualType = 'insight' | 'peak-distance' | 'temperature' | 'movers' | 'grade-compare' | 'set-report'
type Theme = 'dark' | 'light'
type MoversPeriod = '7d' | '30d' | '90d'
type MoversDirection = 'rising' | 'falling'
type GradeView = 'raw' | 'psa9' | 'psa10'
// Layout variants for the Insight Card
type CardLayout = 'compact' | 'showcase' | 'minimal' | 'hero'

const VISUAL_TYPES: { id: VisualType; label: string; icon: string; desc: string; category: string }[] = [
  { id: 'insight',       label: 'Insight Card',   icon: '*', desc: 'Prices, trend & grade premium',        category: 'Card'   },
  { id: 'peak-distance', label: 'Peak Distance',   icon: '^', desc: 'Price vs its recent high',            category: 'Card'   },
  { id: 'temperature',   label: 'Temperature',     icon: 'o', desc: 'Is this card hot or cooling?',        category: 'Card'   },
  { id: 'grade-compare', label: 'Grade Compare',   icon: 'o', desc: 'Raw vs PSA 9 vs PSA 10 bars',        category: 'Card'   },
  { id: 'movers',        label: 'Market Movers',   icon: '^v', desc: 'Top risers or fallers',              category: 'Market' },
  { id: 'set-report',    label: 'Set Report',      icon: '#', desc: '30-day performance snapshot',         category: 'Set'    },
]

// -- Data fetching -------------------------------------------------------------

const GBP = 0.79

function fmt(cents: number | null): string {
  if (!cents || cents <= 0) return '-'
  const v = cents / 100
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return `$${v.toFixed(2)}`
}
function fmtGbp(cents: number | null): string {
  if (!cents || cents <= 0) return '-'
  const v = (cents / 100) * GBP
  const gbp = '\u00a3'
  if (v >= 1000) return gbp + v.toLocaleString('en-GB', { maximumFractionDigits: 0 })
  return gbp + v.toFixed(2)
}
function pct(v: number | null): string {
  if (v == null) return '-'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}
function pctCol(v: number | null, v2 = getThemeVars('dark')) {
  if (v == null) return v2.mu
  return v > 0 ? v2.green : v2.red
}

async function fetchCard(slug: string): Promise<CardData | null> {
  const { data } = await supabase
    .from('card_trends')
    .select('card_slug,card_name,set_name,current_raw,current_psa9,current_psa10,raw_pct_7d,raw_pct_30d,raw_pct_90d,raw_30d_ago,raw_90d_ago,raw_180d_ago')
    .eq('card_slug', slug)
    .single()
  if (!data) return null
  const { data: cardRow } = await supabase.from('cards').select('card_url_slug,image_url').eq('card_slug', slug).single()
  return {
    ...data,
    card_url_slug: cardRow?.card_url_slug ?? null,
    image_url: cardRow?.image_url ?? null,
    set_logo_url: getSetLogoUrl(data.set_name),
  }
}

async function fetchMovers(direction: MoversDirection, period: MoversPeriod): Promise<Mover[]> {
  const fnName = direction === 'rising' ? 'get_top_risers_filtered' : 'get_top_fallers'
  const { data } = await supabase.rpc(fnName, { time_period: period, min_price: 3000 })
  if (!data) return []
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const results: any[] = parsed?.results || []

  // Exclude sealed product noise
  const SEALED = [/booster box/i, /booster pack/i, /elite trainer/i, /\betb\b/i, /collection box/i, /\btin\b/i, /topps/i, /display box/i, /stadium/i, /build.*battle/i]
  const filtered = results
    .filter(r => !SEALED.some(p => p.test(r.card_name || '') || p.test(r.set_name || '')))
    .slice(0, 10)

  const slugs = filtered.map((r: any) => r.card_slug).filter(Boolean)
  const [{ data: imgData }, { data: volData }] = await Promise.all([
    supabase.from('cards').select('card_slug,image_url,card_url_slug').in('card_slug', slugs),
    supabase.from('card_volume').select('card_slug,volume_label,confidence').in('card_slug', slugs).eq('grade', 'Ungraded'),
  ])
  const imgMap: Record<string, any> = {}
  ;(imgData || []).forEach((c: any) => { imgMap[String(c.card_slug)] = c })
  const volMap: Record<string, any> = {}
  ;(volData || []).forEach((v: any) => { volMap[String(v.card_slug)] = v })

  return filtered.map((r: any) => ({
    card_name: r.card_name,
    set_name: r.set_name,
    current_price: r.current_price ?? r.current_raw ?? 0,
    pct_change: direction === 'rising' ? r.pct_30d ?? r.pct_change : -(Math.abs(r.pct_30d ?? r.pct_change ?? 0)),
    card_url_slug: imgMap[r.card_slug]?.card_url_slug ?? null,
    image_url: imgMap[r.card_slug]?.image_url ?? null,
    card_slug: r.card_slug,
    volume_label: volMap[r.card_slug]?.volume_label ?? null,
    confidence: volMap[r.card_slug]?.confidence ?? 'unknown',
  }))
}

async function fetchSetData(setName: string): Promise<SetData | null> {
  const { data } = await supabase
    .from('card_trends')
    .select('card_slug,card_name,set_name,current_raw,current_psa9,current_psa10,raw_pct_7d,raw_pct_30d,raw_pct_90d,raw_30d_ago,raw_90d_ago,raw_180d_ago')
    .ilike('set_name', `%${setName}%`)
    .not('current_raw', 'is', null)
    .order('current_raw', { ascending: false })
    .limit(60)
  if (!data || !data.length) return null

  // Exclude sealed products from set report
  const SEALED = [/booster box/i, /booster pack/i, /blister/i, /elite trainer/i, /\betb\b/i, /collection box/i, /\btin\b/i, /display box/i, /stadium/i, /build.*battle/i, /pokemon center/i, /trainer deck/i, /theme deck/i]
  const cards = data.filter(d => !SEALED.some(p => p.test(d.card_name || '')))

  const total = cards.reduce((s, d) => s + (d.current_raw || 0), 0)
  const withPct30 = cards.filter(d => d.raw_pct_30d != null)
  const withPct90 = cards.filter(d => d.raw_pct_90d != null)
  const avg30 = withPct30.length ? withPct30.reduce((s, d) => s + (d.raw_pct_30d || 0), 0) / withPct30.length : null
  const avg90 = withPct90.length ? withPct90.reduce((s, d) => s + (d.raw_pct_90d || 0), 0) / withPct90.length : null

  const top5 = cards.slice(0, 5)
  const top5Slugs = top5.map((d: any) => d.card_slug).filter(Boolean)

  const { data: imgData } = await supabase.from('cards').select('card_slug,image_url').in('card_slug', top5Slugs)
  const imgMap: Record<string, string | null> = {}
  ;(imgData || []).forEach((r: any) => { imgMap[r.card_slug] = r.image_url })

  // Build sparkline - same basket, exclude sealed + data outliers
  // Sealed products and extreme price swings (>80%) skew the average badly
  const SEALED_SPARK = [/booster box/i, /booster pack/i, /blister/i, /elite trainer/i, /theme deck/i, /trainer deck/i, /tin/i]
  const sparkCards = cards.filter((d: any) => {
    // Must have current + 30d data
    if (!d.current_raw || !d.raw_30d_ago) return false
    // Exclude sealed products
    if (SEALED_SPARK.some((p: RegExp) => p.test(d.card_name || ''))) return false
    // Exclude data errors: >80% swing between any two consecutive points
    const pct30 = Math.abs((d.current_raw - d.raw_30d_ago) / d.raw_30d_ago)
    if (pct30 > 0.8) return false
    if (d.raw_90d_ago) {
      const pct90 = Math.abs((d.raw_30d_ago - d.raw_90d_ago) / d.raw_90d_ago)
      if (pct90 > 0.8) return false
    }
    return true
  })
  const medianAvg = (field: string, subset: any[]) => {
    const vals = subset.map((d: any) => (d as any)[field] as number).filter(Boolean).sort((a: number, b: number) => a - b)
    if (!vals.length) return null
    // Use median to resist outliers
    const mid = Math.floor(vals.length / 2)
    return vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  }
  const sparkPoints: { label: string; val: number }[] = []
  const has180 = sparkCards.filter((d: any) => d.raw_180d_ago)
  const a180 = medianAvg('raw_180d_ago', has180)
  const a90  = medianAvg('raw_90d_ago',  sparkCards.filter((d: any) => d.raw_90d_ago))
  const a30  = medianAvg('raw_30d_ago',  sparkCards)
  const aNow = medianAvg('current_raw',  sparkCards)
  if (a180 && has180.length >= 3) sparkPoints.push({ label: '180d', val: a180 })
  if (a90  && sparkCards.filter((d: any) => d.raw_90d_ago).length >= 3) sparkPoints.push({ label: '90d', val: a90 })
  if (a30  && sparkCards.length >= 3) sparkPoints.push({ label: '30d', val: a30 })
  if (aNow && sparkCards.length >= 3) sparkPoints.push({ label: 'Now', val: aNow })
  const spark = sparkPoints.map(p => p.val)

  const withPct7 = cards.filter((d: any) => d.raw_pct_7d != null)
  const avg7 = withPct7.length ? withPct7.reduce((s: number, d: any) => s + (d.raw_pct_7d || 0), 0) / withPct7.length : null

  return {
    set_name: cards[0].set_name,
    logo_url: getSetLogoUrl(cards[0].set_name),
    release_year: null,
    top_cards: top5.map((d: any) => ({
      card_name: d.card_name,
      current_raw: d.current_raw!,
      current_psa9: d.current_psa9 ?? null,
      current_psa10: d.current_psa10 ?? null,
      pct_30d: d.raw_pct_30d,
      image_url: imgMap[d.card_slug] ?? null,
      card_slug: d.card_slug,
    })),
    set_pct_30d: avg30,
    set_pct_90d: avg90,
    set_pct_7d: avg7,
    sparkline: spark,
    total_value: total,
  }
}

// -- Theme ---------------------------------------------------------------------

function getThemeVars(theme: Theme) {
  const dk = theme === 'dark'
  return {
    dk,
    bg:     dk ? '#0d1520' : '#ffffff',
    card:   dk ? '#131e2e' : '#f8fafc',
    tx:     dk ? '#f1f5f9' : '#0f172a',
    mu:     dk ? '#4a5e78' : '#94a3b8',
    br:     dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    shadow: dk ? '0 24px 80px rgba(0,0,0,0.7)' : '0 24px 80px rgba(0,0,0,0.12)',
    accent: '#1a5fad',
    green:  '#22c55e',
    red:    '#ef4444',
    yellow: '#f59e0b',
  }
}

// -- Shared components ---------------------------------------------------------

// Proxy external images through our API to avoid CORS issues with html2canvas
function getSetLogoUrl(setName: string): string {
  // Files stored with spaces - Next.js serves them fine with spaces in URL
  return '/set-assets/logos/' + setName + '.webp'
}

function proxyImg(url: string | null, bust?: string): string | null {
  if (!url) return null
  const b = bust ? `&b=${encodeURIComponent(bust)}` : ''
  return `/api/imgproxy?url=${encodeURIComponent(url)}${b}`
}

function CardImg({ src, cardSlug, w, h, radius = 6 }: { src: string | null; cardSlug?: string; w: number; h: number; radius?: number }) {
  const proxied = proxyImg(src, cardSlug)
  if (!proxied) return <div style={{ width: w, height: h, borderRadius: radius, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />
  return <img key={proxied} crossOrigin="anonymous" src={proxied} alt="" style={{ width: w, height: h, objectFit: 'contain', borderRadius: radius, flexShrink: 0, display: 'block' }} />
}

function Watermark({ color = 'rgba(255,255,255,0.7)' }: { color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, opacity: 0.8 }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color, textTransform: 'uppercase', opacity: 0.85 }}>PokePrices.io</span>
    </div>
  )
}

// Footer branding bar - consistent across all visuals
// -- Full-width sparkline for Hero layout -------------------------------------
function FullWidthSparkline({ card, v }: { card: CardData; v: ReturnType<typeof getThemeVars> }) {
  const now = card.current_raw
  if (!now) return null
  const pts: { label: string; val: number }[] = []
  if (card.raw_180d_ago) pts.push({ label: '180d', val: card.raw_180d_ago })
  if (card.raw_90d_ago)  pts.push({ label: '90d',  val: card.raw_90d_ago  })
  if (card.raw_30d_ago)  pts.push({ label: '30d',  val: card.raw_30d_ago  })
  pts.push({ label: 'Now', val: now })
  if (pts.length < 2) return null

  const values = pts.map(p => p.val)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const col = pctCol(card.raw_pct_30d, v)

  const W = 480, H = 80, padX = 24, padY = 10
  const coords = pts.map((p, i) => ({
    x: padX + (i / (pts.length - 1)) * (W - padX * 2),
    y: H - padY - ((p.val - min) / range) * (H - padY * 2),
    label: p.label,
    val: p.val,
  }))

  const polyline = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const fillPath = `${padX},${H} ${polyline} ${W - padX},${H}`

  return (
    <div style={{ padding: '12px 0 0', borderBottom: `1px solid ${v.br}` }}>
      <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', paddingLeft: 24, marginBottom: 4, fontFamily: "'Figtree', sans-serif" }}>Price Trend</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Subtle grid lines */}
        {[0.25, 0.5, 0.75].map(t => {
          const y = H - padY - t * (H - padY * 2)
          return <line key={t} x1={padX} y1={y} x2={W - padX} y2={y} stroke={v.br} strokeWidth={1} />
        })}
        {/* Fill */}
        <polygon points={fillPath} fill={col} opacity={0.1} />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke={col} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {/* Data points + labels */}
        {coords.map((c2, i) => (
          <g key={i}>
            <circle cx={c2.x} cy={c2.y} r={i === coords.length - 1 ? 4 : 3} fill={col} />
            <text x={c2.x} y={H + 16} textAnchor="middle" fontSize={8} fill={v.mu} fontFamily="Figtree, sans-serif" fontWeight={600}>{c2.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}


function Sparkline({ card, color, height = 40 }: { card: CardData; color: string; height?: number }) {
  const now = card.current_raw
  if (!now) return null
  const points: number[] = []
  if (card.raw_180d_ago) points.push(card.raw_180d_ago)
  if (card.raw_90d_ago)  points.push(card.raw_90d_ago)
  if (card.raw_30d_ago)  points.push(card.raw_30d_ago)
  points.push(now)
  if (points.length < 2) return null

  const w = 120, h = height, pad = 3
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1

  const coords = points.map((p, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2)
    const y = h - pad - ((p - min) / range) * (h - pad * 2)
    return [x, y] as [number, number]
  })

  const polyline = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const fillPath = `${pad},${h} ${polyline} ${w - pad},${h}`
  const lastX = coords[coords.length - 1][0].toFixed(1)
  const lastY = coords[coords.length - 1][1].toFixed(1)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <polygon points={fillPath} fill={color} opacity={0.12} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  )
}

// -- Pokemon silhouettes + inline SVG circles for card headers ---------------
const CARD_POKEMON = [
  { id: 6,   right: -20, top: -20,   size: 110, opacity: 0.12 },
  { id: 150, right: 68,  top: 5,     size: 65,  opacity: 0.07 },
  { id: 25,  left: -12,  bottom: -12, size: 55, opacity: 0.08 },
  { id: 197, left: 72,   top: -5,    size: 40,  opacity: 0.05 },
]

function PokeBgDecor({ v }: { v: ReturnType<typeof getThemeVars> }) {
  return (
    <>
      {/* Inline SVG for circles + sparkles - works in html-to-image */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }} viewBox="0 0 520 180">
        <circle cx="500" cy="10"  r="90"  fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.5"/>
        <circle cx="500" cy="10"  r="50"  fill="rgba(255,255,255,0.05)"/>
        <circle cx="10"  cy="90"  r="70"  fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1"/>
        <circle cx="260" cy="160" r="60"  fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
        <circle cx="420" cy="85"  r="35"  fill="rgba(255,255,255,0.03)"/>
        <circle cx="190" cy="55"  r="2.5" fill="rgba(255,255,255,0.45)"/>
        <circle cx="340" cy="85"  r="2"   fill="rgba(255,255,255,0.35)"/>
        <circle cx="120" cy="115" r="1.5" fill="rgba(255,255,255,0.30)"/>
        <circle cx="390" cy="35"  r="2"   fill="rgba(255,255,255,0.40)"/>
        <circle cx="270" cy="25"  r="1.5" fill="rgba(255,255,255,0.30)"/>
      </svg>
      {/* Pokemon silhouettes */}
      {CARD_POKEMON.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          top: (p as any).top !== undefined ? p.top : 'auto',
          bottom: (p as any).bottom !== undefined ? (p as any).bottom : 'auto',
          left: (p as any).left !== undefined ? (p as any).left : 'auto',
          right: (p as any).right !== undefined ? (p as any).right : 'auto',
          width: p.size, height: p.size,
          opacity: p.opacity, pointerEvents: 'none',
          filter: 'brightness(0) invert(1)',
          zIndex: 1,
        }}>
          <img
            data-bg-pokemon="true"
            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`}
            alt="" width={p.size} height={p.size}
            style={{ objectFit: 'contain', width: '100%', height: '100%' }}
          />
        </div>
      ))}
    </>
  )
}
function BrandingBar({ v }: { v: ReturnType<typeof getThemeVars> }) {
  return (
    <div style={{
      padding: '12px 20px',
      borderTop: `1px solid ${v.br}`,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      minHeight: 44,
      background: v.dk ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
      flexWrap: 'nowrap',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'linear-gradient(135deg, #1a5fad, #2874c8)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.9)' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: v.tx, letterSpacing: 0.3, opacity: 0.6, whiteSpace: 'nowrap' }}>Powered by PokePrices.io</span>
      </div>
      <span style={{ fontSize: 10, color: v.mu, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Not financial advice</span>
    </div>
  )
}

// Signal badge - contained, no overflow
function SignalBadge({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: `${color}18`,
      padding: '5px 12px 5px 8px', borderRadius: 20,
      border: `1px solid ${color}60`,
      flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
      <span style={{ fontSize: 10, fontWeight: 800, color, letterSpacing: 0.3, fontFamily: "'Figtree', sans-serif" }}>{label}</span>
    </div>
  )
}

// -- VISUAL 1a: Insight Card - Compact (original style, fixed) -----------------

function InsightCardCompact({ card, theme, gradeView }: { card: CardData; theme: Theme; gradeView: GradeView }) {
  const v = getThemeVars(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15  ? { label: 'Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', col: v.red   }
    : { label: 'Stable', col: v.yellow }
    : { label: 'Stable', col: v.yellow }

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)', padding: '20px 22px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <Watermark />
          <SignalBadge label={sig.label} color={sig.col} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CardImg src={card.image_url} cardSlug={card.card_slug} w={58} h={80} radius={8} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1.15, fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3, overflow: 'hidden' }}>{card.card_name}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.set_name}</div>
            {gradeView !== 'raw' && (
              <div style={{ marginTop: 8, display: 'inline-flex', background: 'rgba(255,255,255,0.15)', borderRadius: 8, padding: '3px 10px' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>Viewing: {focusLabel}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Featured price */}
      <div style={{ padding: '16px 22px', borderBottom: `1px solid ${v.br}`, background: v.dk ? 'rgba(26,95,173,0.06)' : 'rgba(26,95,173,0.03)' }}>
        <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>{focusLabel} Price</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 34, fontWeight: 900, color: v.tx, letterSpacing: -1, lineHeight: 1 }}>{fmt(focusPrice)}</div>
          <div style={{ fontSize: 13, color: v.mu, marginTop: 4 }}>{fmtGbp(focusPrice)}</div>
        </div>
      </div>

      {/* Grade prices grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw),   active: gradeView === 'raw'   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9),  active: gradeView === 'psa9'  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10), active: gradeView === 'psa10' },
        ].map((p, i) => (
          <div key={p.label} style={{ padding: '13px 14px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none', background: p.active ? (v.dk ? 'rgba(26,95,173,0.08)' : 'rgba(26,95,173,0.04)') : 'transparent' }}>
            <div style={{ fontSize: 9, color: p.active ? '#1a5fad' : v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{p.label}</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: v.tx, letterSpacing: -0.3 }}>{p.usd}</div>
            <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      {/* Trend row + sparkline */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: psa10x ? '1fr 1fr 1fr' : '1fr 1fr', flex: 1 }}>
          {[
            { label: '7d',      val: pct(card.raw_pct_7d),  col: pctCol(card.raw_pct_7d,  v) },
            { label: '30d',     val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d, v) },
            ...(psa10x ? [{ label: 'Grade x', val: psa10x + 'x', col: '#a78bfa' }] : []),
          ].map((s, i, arr) => (
            <div key={s.label} style={{ padding: '12px 14px', borderRight: i < arr.length - 1 ? `1px solid ${v.br}` : 'none' }}>
              <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 19, fontWeight: 900, color: s.col, letterSpacing: -0.5 }}>{s.val}</div>
            </div>
          ))}
        </div>
        {/* Sparkline */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 16px 8px 8px', borderLeft: `1px solid ${v.br}` }}>
          <Sparkline card={card} color={pctCol(card.raw_pct_30d, v)} height={44} />
        </div>
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 1b: Insight Card - Showcase (Syncd-style, large image) -------------

function InsightCardShowcase({ card, theme, gradeView }: { card: CardData; theme: Theme; gradeView: GradeView }) {
  const v = getThemeVars(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15  ? { label: 'Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', col: v.red   }
    : { label: 'Stable', col: v.yellow }
    : { label: 'Stable', col: v.yellow }

  const accentGrad = 'linear-gradient(160deg, #0d2b5e 0%, #1a5fad 50%, #2874c8 100%)'

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>
      {/* Top header bar */}
      <div style={{ background: accentGrad, padding: '14px 22px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Watermark />
          <SignalBadge label={sig.label} color={sig.col} />
        </div>
      </div>

      {/* Hero: large card image left, price info right */}
      <div style={{ background: accentGrad, padding: '0 22px 24px', display: 'flex', gap: 20, alignItems: 'flex-end' }}>
        {/* Large card image */}
        <div style={{ flexShrink: 0, position: 'relative', marginTop: -10 }}>
          <CardImg src={card.image_url} cardSlug={card.card_slug} w={130} h={182} radius={12} />
        </div>

        {/* Name + featured price */}
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700, letterSpacing: 0.3, marginBottom: 4 }}>{card.set_name}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1.1, fontFamily: "'Outfit', sans-serif", letterSpacing: -0.5, marginBottom: 14 }}>{card.card_name}</div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>{focusLabel} Price</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: -1.5, lineHeight: 1 }}>{fmt(focusPrice)}</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', fontWeight: 700, marginTop: 4 }}>{fmtGbp(focusPrice)}</div>
          </div>
        </div>
      </div>

      {/* Grade prices grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw),   active: gradeView === 'raw'   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9),  active: gradeView === 'psa9'  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10), active: gradeView === 'psa10' },
        ].map((p, i) => (
          <div key={p.label} style={{ padding: '14px 16px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none', background: p.active ? (v.dk ? 'rgba(26,95,173,0.1)' : 'rgba(26,95,173,0.05)') : 'transparent' }}>
            <div style={{ fontSize: 9, color: p.active ? '#3b82f6' : v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{p.label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: v.tx, letterSpacing: -0.3 }}>{p.usd}</div>
            <div style={{ fontSize: 11, color: v.mu, marginTop: 2 }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      {/* Trend + grade multiple */}
      <div style={{ display: 'grid', gridTemplateColumns: psa10x ? '1fr 1fr 1fr' : '1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: '7d',      val: pct(card.raw_pct_7d),  col: pctCol(card.raw_pct_7d,  v) },
          { label: '30d',     val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d, v) },
          ...(psa10x ? [{ label: 'Grade x', val: psa10x + 'x', col: '#a78bfa' }] : []),
        ].map((s, i, arr) => (
          <div key={s.label} style={{ padding: '14px 16px', borderRight: i < arr.length - 1 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: s.col, letterSpacing: -0.5 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 1c: Insight Card - Minimal (clean, text-forward) ------------------

function InsightCardMinimal({ card, theme, gradeView }: { card: CardData; theme: Theme; gradeView: GradeView }) {
  const v = getThemeVars(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const trend30 = card.raw_pct_30d
  const trendCol = trend30 != null ? (trend30 > 0 ? v.green : v.red) : v.mu

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>
      {/* Clean header */}
      <div style={{ padding: '20px 24px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 10, color: v.mu, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>{card.set_name}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: v.tx, lineHeight: 1.1, fontFamily: "'Outfit', sans-serif", letterSpacing: -0.5 }}>{card.card_name}</div>
        </div>
        {card.image_url && (
          <div style={{ flexShrink: 0, marginLeft: 16 }}>
            <CardImg src={card.image_url} cardSlug={card.card_slug} w={56} h={78} radius={6} />
          </div>
        )}
      </div>

      {/* Huge price */}
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${v.br}` }}>
        <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{focusLabel} Price</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 44, fontWeight: 900, color: v.tx, letterSpacing: -2, lineHeight: 1 }}>{fmt(focusPrice)}</div>
          <div style={{ fontSize: 14, color: v.mu, fontWeight: 700, marginTop: 4 }}>{fmtGbp(focusPrice)}</div>
        </div>
        {trend30 != null && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: trendCol }}>{pct(trend30)}</span>
            <span style={{ fontSize: 11, color: v.mu }}>past 30 days</span>
          </div>
        )}
      </div>

      {/* Grade grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9)  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map((p, i) => (
          <div key={p.label} style={{ padding: '14px 18px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{p.label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: v.tx }}>{p.usd}</div>
            <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{p.gbp}</div>
          </div>
        ))}
      </div>

      {psa10x && (
        <div style={{ padding: '12px 24px', borderBottom: `1px solid ${v.br}` }}>
          <span style={{ fontSize: 12, color: v.mu }}>Grade multiple: </span>
          <span style={{ fontSize: 14, fontWeight: 900, color: '#a78bfa' }}>{psa10x}x raw</span>
        </div>
      )}

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 1d: Insight Card - Hero ------------------------------------------

function InsightCardHero({ card, theme, gradeView }: { card: CardData; theme: Theme; gradeView: GradeView }) {
  const v = getThemeVars(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15  ? { label: 'Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: 'Cooling', col: v.red   }
    : { label: 'Stable', col: v.yellow }
    : { label: 'Stable', col: v.yellow }

  // Pokemon IDs for background silhouettes
  const bgPokemon = [6, 150, 130, 197, 249]

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>

      {/* === GRADIENT HEADER - self-contained, no overflow tricks === */}
      <div style={{
        background: 'linear-gradient(160deg, #050e1f 0%, #0d2b5e 40%, #1a5fad 75%, #2874c8 100%)',
        position: 'relative',
        paddingBottom: 24,
      }}>

        {/* Background circles - inline SVG so html-to-image captures them */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }} viewBox="0 0 520 440">
          <circle cx="480" cy="10"  r="140" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
          <circle cx="480" cy="10"  r="90"  fill="rgba(255,255,255,0.04)"/>
          <circle cx="10"  cy="80"  r="110" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
          <circle cx="10"  cy="80"  r="60"  fill="rgba(255,255,255,0.03)"/>
          <circle cx="260" cy="320" r="70"  fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
          <circle cx="420" cy="180" r="40"  fill="rgba(255,255,255,0.03)"/>
          <circle cx="80"  cy="250" r="55"  fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1"/>
          <circle cx="180" cy="60"  r="2.5" fill="rgba(255,255,255,0.5)"/>
          <circle cx="350" cy="90"  r="2"   fill="rgba(255,255,255,0.4)"/>
          <circle cx="120" cy="160" r="1.5" fill="rgba(255,255,255,0.35)"/>
          <circle cx="400" cy="250" r="2"   fill="rgba(255,255,255,0.4)"/>
          <circle cx="260" cy="40"  r="1.5" fill="rgba(255,255,255,0.3)"/>
          <circle cx="70"  cy="300" r="2"   fill="rgba(255,255,255,0.35)"/>
        </svg>

        {/* Pokemon silhouettes */}
        {bgPokemon.map((id, i) => {
          const configs = [
            { top: -20, right: -20, size: 150, opacity: 0.12 },
            { top: 10,  left: -15, size: 85,  opacity: 0.08 },
            { bottom: 10, left: 50, size: 65, opacity: 0.07 },
            { top: 30, right: 130, size: 48, opacity: 0.06 },
            { bottom: 20, right: 60, size: 55, opacity: 0.07 },
          ][i]
          return (
            <div key={id} style={{
              position: 'absolute',
              top: configs.top !== undefined ? configs.top : 'auto',
              bottom: (configs as any).bottom !== undefined ? (configs as any).bottom : 'auto',
              left: (configs as any).left !== undefined ? (configs as any).left : 'auto',
              right: (configs as any).right !== undefined ? (configs as any).right : 'auto',
              width: configs.size, height: configs.size,
              opacity: configs.opacity, pointerEvents: 'none',
              filter: 'brightness(0) invert(1)',
              zIndex: 1,
            }}>
              <img
                data-bg-pokemon="true"
                src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`}
                alt="" width={configs.size} height={configs.size}
                style={{ objectFit: 'contain', width: '100%', height: '100%' }}
              />
            </div>
          )
        })}

        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 22px 0', position: 'relative', zIndex: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
            </div>
            <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.85)', letterSpacing: 1.4, textTransform: 'uppercase' }}>PokePrices.io</span>
          </div>
          <SignalBadge label={sig.label} color={sig.col} />
        </div>

        {/* Set name + card name */}
        <div style={{ textAlign: 'center', padding: '16px 22px 20px', position: 'relative', zIndex: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
            {card.set_logo_url ? (
              <img crossOrigin="anonymous" src={card.set_logo_url} alt={card.set_name} style={{ height: 20, maxWidth: 80, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.75 }} />
            ) : (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: 700, letterSpacing: 0.5 }}>{card.set_name}</span>
            )}
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: -0.5, lineHeight: 1.1 }}>{card.card_name}</div>
        </div>

        {/* Card image - inside gradient, centred, no negative margins */}
        {card.image_url && (
          <div style={{ display: 'flex', justifyContent: 'center', position: 'relative', zIndex: 4 }}>
            <img
              key={card.card_slug}
              crossOrigin="anonymous"
              src={proxyImg(card.image_url, card.card_slug) || ''}
              alt={card.card_name}
              style={{
                width: 200, height: 280, objectFit: 'contain', borderRadius: 16,
                filter: 'drop-shadow(0 16px 48px rgba(0,0,0,0.8))',
                display: 'block',
              }}
            />
          </div>
        )}
      </div>

      {/* === DATA SECTION - directly below gradient, no gap === */}
      <div style={{ background: v.bg }}>

        {/* Price */}
        <div style={{ textAlign: 'center', padding: '20px 24px 16px', borderBottom: `1px solid ${v.br}` }}>
          <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>{focusLabel} Price</div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: 44, fontWeight: 900, color: v.tx, letterSpacing: -2, lineHeight: 1, fontFamily: "'Outfit', sans-serif" }}>{fmt(focusPrice)}</div>
            <div style={{ fontSize: 14, color: v.mu, fontWeight: 700, marginTop: 4 }}>{fmtGbp(focusPrice)}</div>
          </div>
        </div>

        {/* Grade grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
          {[
            { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw),   active: gradeView === 'raw'   },
            { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9),  active: gradeView === 'psa9'  },
            { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10), active: gradeView === 'psa10' },
          ].map((p, i) => (
            <div key={p.label} style={{ padding: '14px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none', textAlign: 'center', background: p.active ? (v.dk ? 'rgba(26,95,173,0.12)' : 'rgba(26,95,173,0.06)') : 'transparent' }}>
              <div style={{ fontSize: 9, color: p.active ? '#60a5fa' : v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{p.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif" }}>{p.usd}</div>
              <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{p.gbp}</div>
            </div>
          ))}
        </div>

        {/* Trend */}
        <div style={{ display: 'grid', gridTemplateColumns: psa10x ? '1fr 1fr 1fr' : '1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
          {[
            { label: '7D',      val: pct(card.raw_pct_7d),  col: pctCol(card.raw_pct_7d,  v) },
            { label: '30D',     val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d, v) },
            ...(psa10x ? [{ label: 'GRADE X', val: psa10x + 'x', col: '#a78bfa' }] : []),
          ].map((s, i, arr) => (
            <div key={s.label} style={{ padding: '13px 14px', borderRight: i < arr.length - 1 ? `1px solid ${v.br}` : 'none', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.col, letterSpacing: -0.5, fontFamily: "'Outfit', sans-serif" }}>{s.val}</div>
            </div>
          ))}
        </div>

        <FullWidthSparkline card={card} v={v} />
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

function InsightCard({ card, theme, gradeView, layout }: { card: CardData; theme: Theme; gradeView: GradeView; layout: CardLayout }) {
  if (layout === 'showcase') return <InsightCardShowcase card={card} theme={theme} gradeView={gradeView} />
  if (layout === 'minimal')  return <InsightCardMinimal  card={card} theme={theme} gradeView={gradeView} />
  if (layout === 'hero')     return <InsightCardHero     card={card} theme={theme} gradeView={gradeView} />
  return <InsightCardCompact card={card} theme={theme} gradeView={gradeView} />
}

// -- VISUAL 2: PSA Gauge -------------------------------------------------------

function PsaGauge({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const multiple = card.current_raw && card.current_psa10 ? card.current_psa10 / card.current_raw : null
  const maxMultiple = 20
  const pct20 = multiple ? Math.min(100, (multiple / maxMultiple) * 100) : 0
  const gaugeCol = !multiple ? v.mu : multiple < 3 ? v.green : multiple < 8 ? v.yellow : v.red
  const label = !multiple ? 'No data' : multiple < 3 ? 'Low premium - consider PSA 10' : multiple < 8 ? 'Meaningful premium' : 'Very high premium - high risk'

  const arcPath = (pct: number) => {
    // Semicircle from left (-180deg) to right (0deg) going OVER the top
    // Left point: (cx-r, cy), Right point: (cx+r, cy), apex: (cx, cy-r)
    const r = 90, cx = 150, cy = 130
    const lx = cx - r, ly = cy  // always starts from left
    const angleRad = Math.PI * (1 - pct / 100)  // 0% = right side, 100% = left side sweep
    const ex = cx + r * Math.cos(angleRad)
    const ey = cy - r * Math.sin(angleRad)  // negative because SVG y-axis is flipped
    const largeArc = pct > 50 ? 1 : 0
    // sweep=0 = counter-clockwise = goes over the top
    return `M ${lx} ${ly} A ${r} ${r} 0 ${largeArc} 0 ${ex.toFixed(1)} ${ey.toFixed(1)}`
  }

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #1a0a3e 0%, #4a1a8a 60%, #7c3aed 100%)', padding: '20px 22px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <Watermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>Grade Premium</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3 }}>{card.card_name}</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3 }}>{card.set_name}</div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        <svg viewBox="0 0 300 145" style={{ width: '100%', maxWidth: 300, margin: '0 auto', display: 'block', overflow: 'visible' }}>
          <path d={arcPath(100)} fill="none" stroke={v.br} strokeWidth={16} strokeLinecap="round" />
          {pct20 > 0 && <path d={arcPath(pct20)} fill="none" stroke={gaugeCol} strokeWidth={16} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${gaugeCol}80)` }} />}
          <text x="150" y="108" textAnchor="middle" fill={v.tx} fontSize="30" fontWeight="900" fontFamily="Figtree, sans-serif">{multiple ? `${multiple.toFixed(1)}x` : '-'}</text>
          <text x="150" y="126" textAnchor="middle" fill={v.mu} fontSize="10" fontWeight="700">Raw to PSA 10</text>
          <text x="60" y="140" textAnchor="middle" fill={v.mu} fontSize="9" fontWeight="700">1x</text>
          <text x="240" y="140" textAnchor="middle" fill={v.mu} fontSize="9" fontWeight="700">20x</text>
        </svg>

        <div style={{ textAlign: 'center', marginTop: 8, fontSize: 12, color: gaugeCol, fontWeight: 800 }}>{label}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18 }}>
          {[
            { label: 'Raw',    val: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
            { label: 'PSA 10', val: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
          ].map(s => (
            <div key={s.label} style={{ background: v.dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '12px 14px', border: `1px solid ${v.br}` }}>
              <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: v.tx }}>{s.val}</div>
              <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{s.gbp}</div>
            </div>
          ))}
        </div>
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 3: Peak Distance ---------------------------------------------------

function PeakDistance({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const rawNow = card.current_raw
  const peaks = [card.raw_30d_ago, card.raw_90d_ago, card.raw_180d_ago].filter(Boolean) as number[]
  const peakPrice = peaks.length ? Math.max(...peaks) : null
  const drawdownPct = rawNow && peakPrice ? ((rawNow - peakPrice) / peakPrice) * 100 : null
  const isAtPeak = drawdownPct != null && drawdownPct > -5
  const barFill = drawdownPct != null ? Math.min(100, Math.max(0, 100 + drawdownPct)) : 0
  const barCol = isAtPeak ? v.red : drawdownPct != null && drawdownPct < -40 ? v.green : v.yellow

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #0a2a2a 0%, #0d5c5c 60%, #0891b2 100%)', padding: '20px 22px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <Watermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>Peak Distance</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CardImg src={card.image_url} cardSlug={card.card_slug} w={50} h={70} radius={6} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3, overflow: 'hidden' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.set_name}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 46, fontWeight: 900, color: barCol, letterSpacing: -2 }}>
            {drawdownPct != null ? (isAtPeak ? 'At Peak' : `${drawdownPct.toFixed(0)}%`) : '-'}
          </div>
          <div style={{ fontSize: 12, color: v.mu, marginTop: 4 }}>
            {isAtPeak ? 'Trading near its recent high' : 'below recent high'}
          </div>
        </div>

        <div style={{ height: 10, background: v.dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ height: '100%', width: `${barFill}%`, background: `linear-gradient(to right, ${v.green}, ${barCol})`, borderRadius: 99, transition: 'width 0.8s ease' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Current Raw', val: fmt(rawNow),    gbp: fmtGbp(rawNow)    },
            { label: 'Recent Peak', val: fmt(peakPrice), gbp: fmtGbp(peakPrice) },
          ].map(s => (
            <div key={s.label} style={{ background: v.dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '12px 14px', border: `1px solid ${v.br}` }}>
              <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: v.tx }}>{s.val}</div>
              <div style={{ fontSize: 10, color: v.mu, marginTop: 2 }}>{s.gbp}</div>
            </div>
          ))}
        </div>
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 4: Market Temperature ----------------------------------------------

function MarketTemperature({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const p30 = card.raw_pct_30d
  const temp = p30 == null ? 50 : Math.min(100, Math.max(0, 50 + p30 * 2))
  const label = p30 == null ? 'Neutral' : p30 > 30 ? 'Very Hot' : p30 > 10 ? 'Heating Up' : p30 < -30 ? 'Very Cold' : p30 < -10 ? 'Cooling Down' : ' Neutral'
  const col = p30 == null ? v.yellow : p30 > 10 ? '#f97316' : p30 < -10 ? '#60a5fa' : v.yellow
  const gradFill = `linear-gradient(to right, #60a5fa 0%, #22c55e 30%, ${v.yellow} 50%, #f97316 70%, #ef4444 100%)`

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #2a0a00 0%, #7c2d12 60%, #c2410c 100%)', padding: '20px 22px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <Watermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>Market Temperature</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CardImg src={card.image_url} cardSlug={card.card_slug} w={50} h={70} radius={6} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3, overflow: 'hidden' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.set_name}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: col }}>{label}</div>
          {p30 != null && <div style={{ fontSize: 14, color: v.mu, marginTop: 6 }}>{pct(p30)} in 30 days</div>}
        </div>

        <div style={{ position: 'relative', height: 14, borderRadius: 99, overflow: 'hidden', marginBottom: 10, background: gradFill }}>
          <div style={{ position: 'absolute', top: 0, left: `${temp}%`, transform: 'translateX(-50%)', width: 4, height: '100%', background: '#fff', borderRadius: 2, boxShadow: '0 0 6px rgba(0,0,0,0.5)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700 }}>Cold</span>
          <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700 }}>Hot</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: '7d',  val: pct(card.raw_pct_7d),  col: pctCol(card.raw_pct_7d,  v) },
            { label: '30d', val: pct(card.raw_pct_30d), col: pctCol(card.raw_pct_30d, v) },
            { label: '90d', val: pct(card.raw_pct_90d), col: pctCol(card.raw_pct_90d, v) },
            { label: 'Raw', val: fmt(card.current_raw), col: v.tx },
          ].map(s => (
            <div key={s.label} style={{ background: v.dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '10px 12px', border: `1px solid ${v.br}` }}>
              <div style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: s.col }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 5: Grade Compare ---------------------------------------------------

function GradeCompare({ card, theme }: { card: CardData; theme: Theme }) {
  const v = getThemeVars(theme)
  const grades = [
    { label: 'Raw',    val: card.current_raw,   col: '#60a5fa' },
    { label: 'PSA 9',  val: card.current_psa9,  col: '#34d399' },
    { label: 'PSA 10', val: card.current_psa10, col: '#a78bfa' },
  ].filter(g => g.val && g.val > 0)
  const maxVal = Math.max(...grades.map(g => g.val || 0))

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ background: 'linear-gradient(135deg, #052010 0%, #065f46 60%, #059669 100%)', padding: '20px 22px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, position: 'relative' }}>
          <Watermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: 0.5 }}>Grade Breakdown</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <CardImg src={card.image_url} cardSlug={card.card_slug} w={50} h={70} radius={6} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: "'Outfit', sans-serif", letterSpacing: -0.3, overflow: 'hidden' }}>{card.card_name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.set_name}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '22px 24px 16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {grades.map(g => {
            const barW = maxVal > 0 ? Math.round((g.val! / maxVal) * 100) : 0
            const multiple = card.current_raw && g.label !== 'Raw' ? (g.val! / card.current_raw).toFixed(1) : null
            return (
              <div key={g.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: g.col, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: v.tx }}>{g.label}</span>
                    {multiple && <span style={{ fontSize: 11, color: v.mu }}>({multiple}x raw)</span>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: v.tx }}>{fmt(g.val)}</div>
                    <div style={{ fontSize: 10, color: v.mu }}>{fmtGbp(g.val)}</div>
                  </div>
                </div>
                <div style={{ height: 10, background: v.dk ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barW}%`, background: g.col, borderRadius: 99, transition: 'width 0.8s ease' }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 6: Market Movers ---------------------------------------------------

function MarketMovers({ movers, theme, period, direction }: { movers: Mover[]; theme: Theme; period: MoversPeriod; direction: MoversDirection }) {
  const v = getThemeVars(theme)
  const periodLabel = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' }[period]
  const isRising = direction === 'rising'
  const accentCol = isRising ? v.green : v.red
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const top5 = movers.slice(0, 5)

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif", width: '100%' }}>
      {/* Fun gradient header */}
      <div style={{
        background: isRising
          ? 'linear-gradient(135deg, #051a0a 0%, #0a3015 40%, #0f4520 100%)'
          : 'linear-gradient(135deg, #1a0505 0%, #300a0a 40%, #451010 100%)',
        padding: '20px 24px 18px', position: 'relative', overflow: 'hidden', minHeight: 110,
      }}>
        {/* Decorative circles via SVG - no negative coords */}
        <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }} viewBox="0 0 520 130">
          <circle cx="520" cy="10" r="80" fill="rgba(255,255,255,0.07)"/>
          <circle cx="460" cy="20" r="45" fill="rgba(255,255,255,0.04)"/>
          <circle cx="40" cy="110" r="55" fill="rgba(255,255,255,0.03)"/>
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 2 }}>
          <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(255,255,255,0.85)' }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.7)', letterSpacing: 1.4, textTransform: 'uppercase' }}>PokePrices.io</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: -0.5, lineHeight: 1, fontFamily: "'Outfit', sans-serif" }}>
              Top 5 {isRising ? 'Risers' : 'Fallers'}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6, fontWeight: 600 }}>
              Past {periodLabel} . Volume-verified
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 800, color: accentCol,
              background: `${accentCol}20`, border: `1px solid ${accentCol}40`,
              borderRadius: 20, padding: '4px 12px', marginBottom: 6, whiteSpace: 'nowrap',
            }}>{isRising ? '+ Rising' : '- Falling'}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{today}</div>
          </div>
        </div>
      </div>

      {/* Card rows */}
      <div>
        {top5.map((m, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 20px',
            borderBottom: i < top5.length - 1 ? `1px solid ${v.br}` : 'none',
          }}>
            <div style={{ width: 20, flexShrink: 0, fontSize: 11, fontWeight: 900, color: v.mu, textAlign: 'center', fontFamily: "'Outfit', sans-serif" }}>{i + 1}</div>
            <div style={{ flexShrink: 0 }}>
              {m.image_url
                ? <img key={m.image_url} crossOrigin="anonymous" src={proxyImg(m.image_url, m.card_slug) || m.image_url || ''} alt={m.card_name} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 5, display: 'block' }} loading="lazy" />
                : <div style={{ width: 44, height: 62, background: v.dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: v.mu }}>?</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: v.tx, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{m.card_name}</div>
              <div style={{ fontSize: 12, color: v.mu, fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.set_name}</div>
              {m.volume_label && <div style={{ fontSize: 11, color: v.green, fontWeight: 700, marginTop: 3 }}>{m.volume_label}</div>}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: v.tx, fontFamily: "'Outfit', sans-serif" }}>
                {m.current_price > 0 ? fmt(m.current_price) : '-'}
              </div>
              <div style={{ fontSize: 11, color: v.mu, marginTop: 1 }}>
                {m.current_price > 0 ? fmtGbp(m.current_price) : ''}
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: accentCol, marginTop: 4, letterSpacing: -0.5, fontFamily: "'Outfit', sans-serif" }}>
                {pct(m.pct_change)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <BrandingBar v={v} />
    </div>
  )
}

// -- VISUAL 7: Set Report ------------------------------------------------------

function SetSparkline({ data, v }: { data: number[]; v: ReturnType<typeof getThemeVars> }) {
  if (data.length < 2) return null
  const W = 480; const H = 60; const pad = 8
  const min = Math.min(...data); const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((val, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2)
    const y = H - pad - ((val - min) / range) * (H - pad * 2)
    return `${x},${y}`
  })
  const col = data[data.length - 1] >= data[0] ? '#22c55e' : '#ef4444'
  const polyline = pts.join(' ')
  const areaPath = `M${pts[0]} ` + pts.slice(1).map(p => `L${p}`).join(' ') + ` L${W - pad},${H - pad} L${pad},${H - pad} Z`
  const labels = ['180d', '90d', '30d', 'Now']
  return (
    <div style={{ padding: '14px 20px 6px' }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>Avg Card Price Trend</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="sgfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.25"/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sgfill)"/>
        <polyline points={polyline} fill="none" stroke={col} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        {data.map((val, i) => {
          const x = pad + (i / (data.length - 1)) * (W - pad * 2)
          const y = H - pad - ((val - min) / range) * (H - pad * 2)
          return <circle key={i} cx={x} cy={y} r="4" fill={col} stroke={v.bg} strokeWidth="2"/>
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 8px', marginTop: 2 }}>
        {labels.slice(0, data.length).map((l, i) => (
          <span key={i} style={{ fontSize: 9, color: v.mu, fontWeight: 600 }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

function SetReport({ setData, theme }: { setData: SetData; theme: Theme }) {
  const v = getThemeVars(theme)
  const pct30col = pctCol(setData.set_pct_30d, v)
  const pct90col = pctCol(setData.set_pct_90d, v)
  const pct7col  = pctCol(setData.set_pct_7d, v)
  const maxVal   = Math.max(...setData.top_cards.map(c => c.current_raw), 1)

  return (
    <div style={{ background: v.bg, borderRadius: 22, overflow: 'hidden', border: `1px solid ${v.br}`, boxShadow: v.shadow, fontFamily: "'Figtree', sans-serif" }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #3730a3 60%, #4f46e5 100%)', padding: '20px 24px 18px', position: 'relative', overflow: 'hidden' }}>
        <PokeBgDecor v={v} />
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Watermark />
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>Set Report{setData.release_year ? ` - ${setData.release_year}` : ''}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <img
              src={setData.logo_url}
              alt={setData.set_name}
              style={{ height: 32, maxWidth: 140, objectFit: 'contain', display: 'block', flexShrink: 0 }}
            />
            <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: 0.3, fontFamily: "'Outfit', sans-serif", lineHeight: 1.1, whiteSpace: 'nowrap' }}>
              {setData.set_name}
            </div>
          </div>
          {setData.release_year && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>{setData.release_year}</span>
          )}
        </div>
      </div>

      {/* Stats - 4 cols */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Top 5 Value', val: fmt(setData.top_cards.reduce((s, c) => s + c.current_raw, 0)), sub: 'raw combined' },
          { label: '7D Avg',      val: pct(setData.set_pct_7d),  sub: 'all cards', col: pct7col  },
          { label: '30D Avg',     val: pct(setData.set_pct_30d), sub: 'all cards', col: pct30col },
          { label: '90D Avg',     val: pct(setData.set_pct_90d), sub: 'all cards', col: pct90col },
        ].map((s, i) => (
          <div key={s.label} style={{ padding: '12px 14px', borderRight: i < 3 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ fontSize: 8, color: v.mu, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: (s as any).col || v.tx, letterSpacing: -0.5 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: v.mu, marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Sparkline */}
      {setData.sparkline.length >= 2 && (
        <div style={{ borderBottom: `1px solid ${v.br}` }}>
          <SetSparkline data={setData.sparkline} v={v} />
        </div>
      )}

      {/* Top 5 cards */}
      <div style={{ padding: '10px 0' }}>
        <div style={{ padding: '0 20px 8px', fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1.5 }}>Top 5 by Value</div>
        {setData.top_cards.map((card, i) => (
          <div key={i} style={{ padding: '9px 20px', borderBottom: i < setData.top_cards.length - 1 ? `1px solid ${v.br}` : 'none', display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ fontSize: 10, color: v.mu, fontWeight: 800, width: 14, flexShrink: 0, textAlign: 'center' }}>{i + 1}</span>
            <div style={{ width: 34, height: 48, flexShrink: 0, borderRadius: 4, overflow: 'hidden', background: v.br }}>
              {card.image_url ? (
                <img key={card.card_slug} crossOrigin="anonymous" src={proxyImg(card.image_url, card.card_slug) || ''} alt={card.card_name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : <div style={{ width: '100%', height: '100%', background: v.br }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: v.tx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.card_name}</div>
              <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: v.br, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((card.current_raw / maxVal) * 100)}%`, background: 'linear-gradient(to right, #3730a3, #4f46e5)', borderRadius: 2 }} />
              </div>
              {(card.current_psa9 || card.current_psa10) && (
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {card.current_psa9 && <span style={{ fontSize: 9, color: v.mu }}>PSA9: <span style={{ color: v.tx, fontWeight: 700 }}>{fmt(card.current_psa9)}</span></span>}
                  {card.current_psa10 && <span style={{ fontSize: 9, color: v.mu }}>PSA10: <span style={{ color: '#a78bfa', fontWeight: 700 }}>{fmt(card.current_psa10)}</span></span>}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: v.tx }}>{fmt(card.current_raw)}</div>
              <div style={{ fontSize: 10, color: v.mu, marginTop: 1 }}>{fmtGbp(card.current_raw)}</div>
              {card.pct_30d != null && (
                <div style={{ fontSize: 11, fontWeight: 800, color: pctCol(card.pct_30d, v), marginTop: 2 }}>{pct(card.pct_30d)}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <BrandingBar v={v} />
    </div>
  )
}


// -- Placeholder ---------------------------------------------------------------

function Placeholder({ message = 'Search for a card above to get started' }: { message?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", gap: 12, padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 40, opacity: 0.3 }}>*</div>
      <div style={{ fontSize: 14 }}>{message}</div>
    </div>
  )
}

// -- Main component ------------------------------------------------------------

export default function StudioPageClient() {
  const [visualType,   setVisualType]   = useState<VisualType>('insight')
  const [theme,        setTheme]        = useState<Theme>('dark')
  const [gradeView,    setGradeView]    = useState<GradeView>('raw')
  const [cardLayout,   setCardLayout]   = useState<CardLayout>('compact')
  const [card,         setCard]         = useState<CardData | null>(null)
  const [movers,       setMovers]       = useState<Mover[]>([])
  const [setData,      setSetData]      = useState<SetData | null>(null)
  const [moversPeriod, setMoversPeriod] = useState<MoversPeriod>('30d')
  const [moversDir,    setMoversDir]    = useState<MoversDirection>('rising')
  const [setInput,     setSetInput]     = useState('')
  const [cardSearch,   setCardSearch]   = useState('')
  const [suggestions,  setSuggestions]  = useState<{card_slug: string; card_name: string; set_name: string; card_number?: string | null; image_url?: string | null; needs_slug_lookup?: boolean; card_url_slug?: string}[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const debouncedSearch = useDebounce(cardSearch, 200)

  useEffect(() => {
    if (debouncedSearch.length >= 2) fetchSuggestions(debouncedSearch)
    else { setSuggestions([]); setShowSuggestions(false) }
  }, [debouncedSearch])
  const [loading,      setLoading]      = useState(false)
  const [exporting,    setExporting]    = useState(false)
  const [isMobile,     setIsMobile]     = useState(false)
  const [quickRisers,  setQuickRisers]  = useState<Mover[]>([])

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 900)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Load quick risers for sidebar
  useEffect(() => {
    fetchMovers('rising', '30d').then(setQuickRisers)
  }, [])

  // Auto-load movers when on movers visual
  useEffect(() => {
    if (visualType === 'movers') {
      setLoading(true)
      fetchMovers(moversDir, moversPeriod).then(data => { setMovers(data); setLoading(false) })
    }
  }, [visualType, moversDir, moversPeriod])

  // -- Search - mirrors main site SearchBar logic ----------------------------
  function parseSearchQuery(raw: string): { namePart: string; numberPart: string | null } {
    let q = raw.trim()
    const numberFull  = q.match(/\b(\d{1,3})\/\d+\b/)   // 6/102, 086/123
    const numberHash  = q.match(/#(\d{1,3})\b/)           // #4, #215
    const numberTrail = q.split(/\s+/).length > 1 ? q.match(/\b(\d{1,3})\s*$/) : null

    let numberPart: string | null = null
    if (numberFull)        { numberPart = numberFull[1];  q = q.replace(numberFull[0],  '').trim() }
    else if (numberHash)   { numberPart = numberHash[1];  q = q.replace(numberHash[0],  '').trim() }
    else if (numberTrail)  { numberPart = numberTrail[1]; q = q.replace(/\s+\d{1,3}\s*$/, '').trim() }

    return { namePart: q, numberPart }
  }

  async function buildSuggestionQuery(raw: string) {
    const q = raw.trim()
    if (q.length < 2) return []

    // Strategy 1: search_global RPC (same as main search bar)
    const { data: rpcData } = await supabase.rpc('search_global', { query: q })
    if (rpcData && rpcData.length > 0) {
      return rpcData
        .filter((r: any) => r.result_type === 'card' && r.url_slug)
        .map((r: any) => ({
          card_slug: r.url_slug,  // card_url_slug in this context
          card_name: r.name,
          set_name: r.subtitle || '',
          card_number: r.card_number_display || null,
          image_url: r.image_url || null,
          needs_slug_lookup: true,  // flag: url_slug here is card_url_slug not card_slug
          card_url_slug: r.url_slug,
        }))
        .slice(0, 8)
    }

    // Strategy 2: fallback direct search
    const { namePart, numberPart } = parseSearchQuery(q)
    const results: any[] = []

    if (numberPart && namePart) {
      const num = parseInt(numberPart, 10).toString()
      const { data } = await supabase.from('cards')
        .select('card_slug, card_name, set_name, card_number, image_url')
        .ilike('set_name', `%${namePart}%`)
        .in('card_number', [num, num.padStart(3, '0')])
        .not('card_slug', 'is', null).limit(8)
      if (data?.length) return data
    }

    if (numberPart && !namePart) {
      const num = parseInt(numberPart, 10).toString()
      const { data } = await supabase.from('cards')
        .select('card_slug, card_name, set_name, card_number, image_url')
        .in('card_number', [num, num.padStart(3, '0')])
        .not('card_slug', 'is', null).limit(8)
      if (data?.length) return data
    }

    // Name search - try full query OR name tokens against card_name OR set_name
    const [byName, bySet, byFullQ] = await Promise.all([
      supabase.from('cards').select('card_slug, card_name, set_name, card_number, image_url')
        .ilike('card_name', `%${namePart || q}%`).not('card_slug', 'is', null).limit(6),
      supabase.from('cards').select('card_slug, card_name, set_name, card_number, image_url')
        .ilike('set_name', `%${namePart || q}%`).not('card_slug', 'is', null).limit(4),
      namePart !== q ? supabase.from('cards').select('card_slug, card_name, set_name, card_number, image_url')
        .ilike('card_name', `%${q}%`).not('card_slug', 'is', null).limit(4)
        : Promise.resolve({ data: [] }),
    ])

    const seen = new Set<string>()
    for (const row of [...(byName.data || []), ...(byFullQ.data || []), ...(bySet.data || [])]) {
      if (!seen.has(row.card_slug)) { seen.add(row.card_slug); results.push(row) }
      if (results.length >= 8) break
    }

    // Sort by price descending using card_trends
    if (results.length > 1) {
      const slugs = results.map((r: any) => r.card_slug)
      const { data: trendData } = await supabase.from('card_trends')
        .select('card_slug, current_raw').in('card_slug', slugs).not('current_raw', 'is', null)
      const priceMap: Record<string, number> = {}
      ;(trendData || []).forEach((t: any) => { priceMap[t.card_slug] = t.current_raw })
      results.sort((a, b) => (priceMap[b.card_slug] || 0) - (priceMap[a.card_slug] || 0))
    }

    return results.slice(0, 8)
  }

  async function selectSuggestion(s: any) {
    setShowSuggestions(false)
    setCardSearch(`${s.card_name}${s.card_number ? ` #${s.card_number}` : ''} - ${s.set_name}`)
    setLoading(true)

    let cardSlug = s.card_slug
    // If result came from search_global, card_slug is actually a card_url_slug - look up real slug
    if (s.needs_slug_lookup) {
      const { data } = await supabase.from('cards')
        .select('card_slug').eq('card_url_slug', s.card_url_slug)
        .eq('set_name', s.set_name).single()
      if (data?.card_slug) cardSlug = data.card_slug
    }

    const result = await fetchCard(cardSlug)
    if (result) {
      setCard(result)
      if (['movers', 'set-report'].includes(visualType)) setVisualType('insight')
    }
    setLoading(false)
  }

  async function searchCard(query: string) {
    if (!query.trim()) return
    const suggestions = await buildSuggestionQuery(query)
    if (suggestions.length) await selectSuggestion(suggestions[0])
  }

  async function fetchSuggestions(query: string) {
    if (query.length < 2) { setSuggestions([]); setShowSuggestions(false); return }
    const results = await buildSuggestionQuery(query)
    if (results.length) { setSuggestions(results); setShowSuggestions(true) }
    else { setSuggestions([]); setShowSuggestions(false) }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowSuggestions(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadSetReport() {
    if (!setInput.trim()) return
    setLoading(true)
    const data = await fetchSetData(setInput.trim())
    if (data) { setSetData(data); setVisualType('set-report') }
    setLoading(false)
  }

  async function selectMoverAsCard(m: Mover) {
    if (!m.card_slug) return
    setLoading(true)
    const data = await fetchCard(m.card_slug)
    if (data) {
      setCard(data)
      if (['movers', 'set-report'].includes(visualType)) setVisualType('insight')
    }
    setLoading(false)
  }

  async function exportPng() {
    if (exporting) return
    setExporting(true)
    try {
      const el = document.getElementById('studio-preview')
      if (!el) throw new Error('Preview not found')

      // Load html-to-image from CDN
      if (!(window as any).htmlToImage) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js'
          s.onload = () => resolve()
          s.onerror = () => reject(new Error('Failed to load export library'))
          document.head.appendChild(s)
        })
      }

      // Convert all non-silhouette card images to base64 inline data URLs BEFORE capture.
      // This is the only reliable fix for browser image caching - once an image is a
      // data URL, html-to-image uses the pixel data directly and never fetches anything.
      const cardImgs = Array.from(
        el.querySelectorAll('img:not([data-bg-pokemon])')
      ) as HTMLImageElement[]

      const origSrcs: string[] = []
      await Promise.all(cardImgs.map(async (img, i) => {
        origSrcs[i] = img.src
        try {
          const ts = Date.now()
          // Same-origin assets (set logos) fetch directly; external images go through proxy
          const isSameOrigin = img.src.startsWith(window.location.origin) || img.src.startsWith('/')
          const src = isSameOrigin
            ? img.src
            : img.src.includes('/api/imgproxy')
              ? img.src.split('&b=')[0] + '&b=export_' + ts
              : '/api/imgproxy?url=' + encodeURIComponent(img.src) + '&b=export_' + ts
          const res = await fetch(src, { cache: 'no-store' })
          const blob = await res.blob()
          const dataUrl = await new Promise<string>(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          img.src = dataUrl
        } catch {
          // leave original src if fetch fails
        }
      }))

      // Small delay for browser to paint the new data URLs
      await new Promise(r => setTimeout(r, 150))

      const { toPng } = (window as any).htmlToImage
      const dataUrl = await toPng(el, { pixelRatio: 2 })

      // Restore original srcs
      cardImgs.forEach((img, i) => { img.src = origSrcs[i] })

      const link = document.createElement('a')
      const safeCardName = card ? card.card_name.replace(/[^a-z0-9]/gi, '-').toLowerCase() : ''
      const fileName = card
        ? `pokeprices-${safeCardName}-${visualType}-${cardLayout}.png`
        : `pokeprices-${visualType}-${moversPeriod}.png`
      link.download = fileName
      link.href = dataUrl
      link.click()
    } catch (e: any) {
      console.error('Export failed:', e)
      alert(`Export failed: ${e.message || 'please try again'}`)
    }
    setExporting(false)
  }

  const needsCard   = ['insight', 'peak-distance', 'temperature', 'grade-compare'].includes(visualType)
  const needsMovers = visualType === 'movers'
  const needsSet    = visualType === 'set-report'
  const canExport   = (needsCard && !!card) || (needsMovers && movers.length > 0) || (needsSet && !!setData)
  const isCardVisual = needsCard
  const categories  = ['Card', 'Market', 'Set']

  function renderVisual() {
    if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)', fontFamily: "'Figtree',sans-serif", fontSize: 14 }}>Loading...</div>
    if (needsCard && !card) return <Placeholder />
    if (needsMovers) {
      if (!movers.length) return <Placeholder message="Loading market data..." />
      return <MarketMovers movers={movers} theme={theme} period={moversPeriod} direction={moversDir} />
    }
    if (needsSet) {
      if (!setData) return <Placeholder message="Type a set name on the left to load" />
      return <SetReport setData={setData} theme={theme} />
    }
    switch (visualType) {
      case 'insight':       return <InsightCard       card={card!} theme={theme} gradeView={gradeView} layout={cardLayout} />
      case 'peak-distance': return <PeakDistance      card={card!} theme={theme} />
      case 'temperature':   return <MarketTemperature card={card!} theme={theme} />
      case 'grade-compare': return <GradeCompare      card={card!} theme={theme} />
    }
  }

  const panelStyle:  React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 16 }
  const labelStyle:  React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10, fontFamily: "'Figtree',sans-serif", display: 'block' }
  const inputStyle:  React.CSSProperties = { width: '100%', padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree',sans-serif", outline: 'none', boxSizing: 'border-box' }
  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)',
    background: active ? 'var(--primary)' : 'var(--bg-light)',
    color: active ? '#fff' : 'var(--text)',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Figtree',sans-serif",
    transition: 'all 0.15s',
  })

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: isMobile ? '20px 14px 110px' : '32px 24px' }}>
      <BreadcrumbSchema items={[{ name: 'Studio' }]} />
      {/* SoftwareApplication: free Pokémon TCG visual generator */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        '@id': 'https://www.pokeprices.io/studio#app',
        name: 'PokePrices Studio',
        description: 'Free web tool that turns Pokémon TCG market data into shareable PNG visuals — PSA gauges, market temperature, peak distance and chase-card graphics for any of 40,000+ tracked cards.',
        url: 'https://www.pokeprices.io/studio',
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web',
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        isAccessibleForFree: true,
      }) }} />

      <div style={{ marginBottom: isMobile ? 18 : 28 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: isMobile ? 24 : 30, margin: '0 0 4px', color: 'var(--text)', fontWeight: 900 }}>PokePrices Studio</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree',sans-serif" }}>
          Create shareable market intelligence visuals for Twitter, Reddit, and Discord.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr 240px', gap: isMobile ? 14 : 24, alignItems: 'start' }}>

        {/* LEFT: Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Visual type selector */}
          <div style={panelStyle}>
            <span style={labelStyle}>Visual Type</span>
            {categories.map(cat => (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 5, fontFamily: "'Figtree',sans-serif" }}>{cat}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {VISUAL_TYPES.filter(v => v.category === cat).map(vt => (
                    <button key={vt.id} onClick={() => setVisualType(vt.id)} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 10,
                      border: `1px solid ${visualType === vt.id ? 'var(--primary)' : 'var(--border)'}`,
                      background: visualType === vt.id ? 'rgba(26,95,173,0.08)' : 'transparent',
                      color: visualType === vt.id ? 'var(--primary)' : 'var(--text)',
                      cursor: 'pointer', textAlign: 'left', width: '100%',
                      fontFamily: "'Figtree',sans-serif", transition: 'all 0.15s',
                    }}>
                      <span style={{ fontSize: 13 }}>{vt.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.2 }}>{vt.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{vt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Card search with autocomplete */}
          {(needsCard || (!needsMovers && !needsSet)) && (
            <div style={panelStyle}>
              <span style={labelStyle}>Search Card</span>
              <div ref={searchRef} style={{ position: 'relative' }}>
                <input
                  style={inputStyle}
                  placeholder="e.g. Charizard, 6/102, Umbreon VMAX, Base Set..."
                  value={cardSearch}
                  onChange={e => setCardSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { searchCard(cardSearch) } if (e.key === 'Escape') setShowSuggestions(false) }}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'var(--card)', border: '1px solid var(--primary)', borderRadius: 10, marginTop: 4, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
                    {suggestions.map((s, i) => (
                      <button key={i} onMouseDown={() => selectSuggestion(s)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left', fontFamily: "'Figtree', sans-serif", transition: 'background 0.1s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-light)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
                        {s.image_url
                          ? <img src={s.image_url} alt="" style={{ width: 24, height: 34, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                          : <div style={{ width: 24, height: 34, background: 'var(--bg)', borderRadius: 3, flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {s.card_name}{s.card_number ? ` #${s.card_number}` : ''}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{s.set_name}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Set report search */}
          {needsSet && (
            <div style={panelStyle}>
              <span style={labelStyle}>Set Name</span>
              <input
                style={inputStyle}
                placeholder="e.g. Evolving Skies"
                value={setInput}
                onChange={e => setSetInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && loadSetReport()}
              />
              <button onClick={loadSetReport} style={{ ...btnStyle(false), width: '100%', marginTop: 8, justifyContent: 'center', display: 'flex' }}>
                Load Set
              </button>
            </div>
          )}

          {/* Movers controls */}
          {needsMovers && (
            <div style={panelStyle}>
              <span style={labelStyle}>Direction</span>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(['rising', 'falling'] as MoversDirection[]).map(d => (
                  <button key={d} onClick={() => setMoversDir(d)} style={btnStyle(moversDir === d)}>
                    {d === 'rising' ? '+  Rising' : '-  Falling'}
                  </button>
                ))}
              </div>
              <span style={labelStyle}>Period</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['7d', '30d', '90d'] as MoversPeriod[]).map(p => (
                  <button key={p} onClick={() => setMoversPeriod(p)} style={btnStyle(moversPeriod === p)}>{p}</button>
                ))}
              </div>
            </div>
          )}

          {/* Appearance */}
          <div style={panelStyle}>
            <span style={labelStyle}>Appearance</span>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, fontFamily: "'Figtree',sans-serif" }}>Theme</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['dark', 'light'] as Theme[]).map(t => (
                  <button key={t} onClick={() => setTheme(t)} style={btnStyle(theme === t)}>
                    {t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout variants - only for insight card */}
            {visualType === 'insight' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, fontFamily: "'Figtree',sans-serif" }}>Layout</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {([
                    ['compact',  'Compact',  'Classic - prices + trend in one card'],
                    ['showcase', 'Showcase', 'Large image hero - great for sharing'],
                    ['minimal',  'Minimal',  'Clean text-forward layout'],
                    ['hero',     'Hero',     'Big centered card + data beneath'],
                  ] as [CardLayout, string, string][]).map(([val, label, desc]) => (
                    <button key={val} onClick={() => setCardLayout(val)} style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                      padding: '8px 12px', borderRadius: 8,
                      border: `1px solid ${cardLayout === val ? 'var(--primary)' : 'var(--border)'}`,
                      background: cardLayout === val ? 'rgba(26,95,173,0.08)' : 'transparent',
                      color: cardLayout === val ? 'var(--primary)' : 'var(--text)',
                      cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: "'Figtree',sans-serif",
                    }}>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grade view */}
            {isCardVisual && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, fontFamily: "'Figtree',sans-serif" }}>Grade Focus</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(['raw', 'psa9', 'psa10'] as GradeView[]).map(g => (
                    <button key={g} onClick={() => setGradeView(g)} style={btnStyle(gradeView === g)}>
                      {g === 'raw' ? 'Raw' : g === 'psa9' ? 'PSA 9' : 'PSA 10'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CENTRE: Preview */}
        <div>
          <div id="studio-preview" style={{ width: 520, maxWidth: '100%' }}>
            {renderVisual()}
          </div>
          {/* Download button below preview */}
          <button
            onClick={exportPng}
            disabled={!canExport || exporting}
            style={{
              marginTop: 16, padding: '14px 28px', borderRadius: 12,
              background: canExport ? 'linear-gradient(135deg, #1a5fad, #2874c8)' : 'var(--bg-light)',
              color: canExport ? '#fff' : 'var(--text-muted)',
              border: 'none', cursor: canExport ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 800, fontFamily: "'Figtree',sans-serif",
              transition: 'opacity 0.15s', opacity: exporting ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: canExport ? '0 4px 16px rgba(26,95,173,0.35)' : 'none',
            }}
          >
            <span style={{ fontSize: 16 }}>v</span>
            {exporting ? 'Generating PNG...' : 'Download PNG'}
          </button>
        </div>

        {/* RIGHT: Quick Risers */}
        {!isMobile && (
          <div style={{ ...panelStyle, position: 'sticky', top: 24 }}>
            <span style={labelStyle}>Quick Risers</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {quickRisers.slice(0, 8).map((m, i) => (
                <button key={i} onClick={() => selectMoverAsCard(m)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 8, border: '1px solid var(--border)',
                  background: 'transparent', cursor: 'pointer', textAlign: 'left', width: '100%',
                  fontFamily: "'Figtree',sans-serif", transition: 'background 0.15s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-light)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  {m.image_url && (
                    <img key={m.image_url} crossOrigin="anonymous" src={proxyImg(m.image_url, m.card_slug) || m.image_url || ''} alt="" style={{ width: 28, height: 39, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.card_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.set_name}</div>
                    {m.volume_label && <div style={{ fontSize: 9, color: '#22c55e', fontWeight: 700 }}>{m.volume_label}</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#22c55e', flexShrink: 0 }}>{pct(m.pct_change)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* FAQ — visible content + FAQPage schema */}
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <FAQ items={getStudioFaqItems()} />
      </div>
    </div>
  )
}