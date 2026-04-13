// app/api/studio/export/route.ts
// Server-side PNG generation using @vercel/og (Satori)
// No html2canvas, no CORS issues, pixel-perfect fonts and images

import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Types (mirrored from StudioPageClient) ────────────────────────────────────

type Theme = 'dark' | 'light'
type GradeView = 'raw' | 'psa9' | 'psa10'
type CardLayout = 'compact' | 'showcase' | 'minimal'
type MoversDirection = 'rising' | 'falling'

interface CardData {
  card_name: string
  set_name: string
  image_url: string | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  raw_pct_7d: number | null
  raw_pct_30d: number | null
  raw_pct_90d: number | null
}

interface Mover {
  card_name: string
  set_name: string
  current_price: number
  pct_change: number
  image_url?: string | null
  volume_label?: string | null
}

interface SetData {
  set_name: string
  top_cards: { card_name: string; current_raw: number; pct_30d: number | null }[]
  set_pct_30d: number | null
  set_pct_90d: number | null
  total_value: number
  card_count: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const GBP = 0.79

function fmt(cents: number | null): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

function fmtGbp(cents: number | null): string {
  if (!cents || cents <= 0) return '—'
  const v = (cents / 100) * GBP
  if (v >= 1000) return `£${Math.round(v).toLocaleString('en-GB')}`
  return `£${v.toFixed(2)}`
}

function pct(v: number | null): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function pctCol(v: number | null, dk: boolean): string {
  if (v == null) return dk ? '#4a5e78' : '#94a3b8'
  return v > 0 ? '#22c55e' : '#ef4444'
}

function tv(theme: Theme) {
  const dk = theme === 'dark'
  return {
    dk,
    bg:   dk ? '#0d1520' : '#ffffff',
    tx:   dk ? '#f1f5f9' : '#0f172a',
    mu:   dk ? '#4a5e78' : '#94a3b8',
    br:   dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    green: '#22c55e',
    red:   '#ef4444',
    yellow:'#f59e0b',
  }
}

// ── Font loader ───────────────────────────────────────────────────────────────

// Fetch a font file URL from the Google Fonts CSS API
// This is more reliable than hardcoding gstatic URLs which change
async function fetchGoogleFontBuffer(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`
    const css = await fetch(cssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    }).then(r => r.text())
    // Extract the woff2 URL from the CSS
    const match = css.match(/src: url\(([^)]+)\) format\('woff2'\)/)
    if (!match) return null
    const fontUrl = match[1]
    return await fetch(fontUrl).then(r => r.arrayBuffer())
  } catch {
    return null
  }
}

async function loadFonts() {
  const [outfitBold, outfitBlack, figtreeBold, figtreeExtraBold] = await Promise.all([
    fetchGoogleFontBuffer('Outfit', 700),
    fetchGoogleFontBuffer('Outfit', 900),
    fetchGoogleFontBuffer('Figtree', 700),
    fetchGoogleFontBuffer('Figtree', 800),
  ])

  const fonts: { name: string; data: ArrayBuffer; weight: 100|200|300|400|500|600|700|800|900; style: 'normal' }[] = []
  if (outfitBold)       fonts.push({ name: 'Outfit',  data: outfitBold,       weight: 700, style: 'normal' })
  if (outfitBlack)      fonts.push({ name: 'Outfit',  data: outfitBlack,      weight: 900, style: 'normal' })
  if (figtreeBold)      fonts.push({ name: 'Figtree', data: figtreeBold,      weight: 700, style: 'normal' })
  if (figtreeExtraBold) fonts.push({ name: 'Figtree', data: figtreeExtraBold, weight: 800, style: 'normal' })
  return fonts
}

// Fetch image as data URL — Edge runtime compatible (no Buffer)
async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || 'image/jpeg'
    // Edge-compatible base64 encoding
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    return `data:${ct};base64,${base64}`
  } catch {
    return null
  }
}

// ── Shared visual primitives ──────────────────────────────────────────────────
// Satori requires all elements to be display:flex
// No overflow:hidden on elements with border-radius (use nested wrappers)
// No box-shadow, no text-shadow

function BrandingFooter({ v }: { v: ReturnType<typeof tv> }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderTop: `1px solid ${v.br}`, background: v.dk ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)', minHeight: 38 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: 'linear-gradient(135deg, #1a5fad, #2874c8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 7, height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.9)', display: 'flex' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: v.tx, opacity: 0.5, fontFamily: 'Figtree', letterSpacing: 0.3 }}>Powered by PokePrices.io</span>
      </div>
      <span style={{ fontSize: 10, color: v.mu, fontWeight: 700, fontFamily: 'Figtree' }}>Not financial advice</span>
    </div>
  )
}

function HeaderWatermark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 6, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.85)', display: 'flex' }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.8)', fontFamily: 'Figtree', letterSpacing: 1.4, textTransform: 'uppercase' }}>PokePrices.io</span>
    </div>
  )
}

function SignalBadge({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.35)', padding: '4px 12px', borderRadius: 20, border: `1px solid ${color}50` }}>
      <span style={{ fontSize: 10, fontWeight: 800, color, fontFamily: 'Figtree', letterSpacing: 0.5 }}>{label}</span>
    </div>
  )
}

function GradeCell({ label, usd, gbp, active, v, borderRight }: { label: string; usd: string; gbp: string; active: boolean; v: ReturnType<typeof tv>; borderRight?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flex: 1,
      padding: '13px 14px',
      background: active ? (v.dk ? 'rgba(26,95,173,0.1)' : 'rgba(26,95,173,0.05)') : 'transparent',
      borderRight: borderRight ? `1px solid ${v.br}` : 'none',
    }}>
      <span style={{ fontSize: 9, color: active ? '#3b82f6' : v.mu, fontWeight: 800, fontFamily: 'Figtree', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 5 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 900, color: v.tx, fontFamily: 'Outfit', letterSpacing: -0.3 }}>{usd}</span>
      <span style={{ fontSize: 10, color: v.mu, fontFamily: 'Figtree', marginTop: 2 }}>{gbp}</span>
    </div>
  )
}

function TrendCell({ label, val, col, v, borderRight }: { label: string; val: string; col: string; v: ReturnType<typeof tv>; borderRight?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '12px 14px', borderRight: borderRight ? `1px solid ${v.br}` : 'none' }}>
      <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, fontFamily: 'Figtree', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 900, color: col, fontFamily: 'Outfit', letterSpacing: -0.5 }}>{val}</span>
    </div>
  )
}

// ── VISUAL: Insight Card Compact ──────────────────────────────────────────────

function renderInsightCompact(card: CardData, theme: Theme, gradeView: GradeView, imageDataUrl: string | null) {
  const v = tv(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15  ? { label: '▲ Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: '▼ Cooling',     col: v.red   }
    : { label: '— Stable', col: v.yellow }
    : { label: '— Stable', col: v.yellow }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: v.bg, width: 520, borderRadius: 22, border: `1px solid ${v.br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)', padding: '20px 22px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <HeaderWatermark />
          <SignalBadge label={sig.label} color={sig.col} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {imageDataUrl && (
            <img src={imageDataUrl} width={58} height={80} style={{ objectFit: 'contain', borderRadius: 8 }} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.15 }}>{card.card_name}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4, fontWeight: 700 }}>{card.set_name}</span>
          </div>
        </div>
      </div>

      {/* Featured price */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 22px', borderBottom: `1px solid ${v.br}`, background: v.dk ? 'rgba(26,95,173,0.06)' : 'rgba(26,95,173,0.03)' }}>
        <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 36, fontWeight: 900, color: v.tx, letterSpacing: -1, fontFamily: 'Outfit' }}>{fmt(focusPrice)}</span>
          <span style={{ fontSize: 16, color: v.mu, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
        </div>
      </div>

      {/* Grade grid */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <GradeCell label="Raw"    usd={fmt(card.current_raw)}   gbp={fmtGbp(card.current_raw)}   active={gradeView==='raw'}   v={v} borderRight />
        <GradeCell label="PSA 9"  usd={fmt(card.current_psa9)}  gbp={fmtGbp(card.current_psa9)}  active={gradeView==='psa9'}  v={v} borderRight />
        <GradeCell label="PSA 10" usd={fmt(card.current_psa10)} gbp={fmtGbp(card.current_psa10)} active={gradeView==='psa10'} v={v} />
      </div>

      {/* Trend row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <TrendCell label="7d"  val={pct(card.raw_pct_7d)}  col={pctCol(card.raw_pct_7d,  v.dk)} v={v} borderRight />
        <TrendCell label="30d" val={pct(card.raw_pct_30d)} col={pctCol(card.raw_pct_30d, v.dk)} v={v} borderRight={!!psa10x} />
        {psa10x && <TrendCell label="Grade ×" val={`${psa10x}×`} col="#a78bfa" v={v} />}
      </div>

      <BrandingFooter v={v} />
    </div>
  )
}

// ── VISUAL: Insight Card Showcase ─────────────────────────────────────────────

function renderInsightShowcase(card: CardData, theme: Theme, gradeView: GradeView, imageDataUrl: string | null) {
  const v = tv(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const sig = card.raw_pct_30d != null
    ? card.raw_pct_30d > 15  ? { label: '▲ Trending Up', col: v.green }
    : card.raw_pct_30d < -15 ? { label: '▼ Cooling',     col: v.red   }
    : { label: '— Stable', col: v.yellow }
    : { label: '— Stable', col: v.yellow }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: v.bg, width: 520, borderRadius: 22, border: `1px solid ${v.br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(160deg, #0d2b5e 0%, #1a5fad 50%, #2874c8 100%)', padding: '14px 22px' }}>
        <HeaderWatermark />
        <SignalBadge label={sig.label} color={sig.col} />
      </div>

      {/* Hero */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, background: 'linear-gradient(160deg, #0d2b5e 0%, #1a5fad 50%, #2874c8 100%)', padding: '0 22px 24px' }}>
        {imageDataUrl && (
          <div style={{ display: 'flex', flexShrink: 0, marginTop: -10 }}>
            <img src={imageDataUrl} width={130} height={182} style={{ objectFit: 'contain', borderRadius: 12 }} />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingBottom: 4 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700, marginBottom: 4, fontFamily: 'Figtree' }}>{card.set_name}</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 14 }}>{card.card_name}</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 40, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -1.5, lineHeight: 1 }}>{fmt(focusPrice)}</span>
            <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', fontWeight: 700, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
          </div>
        </div>
      </div>

      {/* Grade grid */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <GradeCell label="Raw"    usd={fmt(card.current_raw)}   gbp={fmtGbp(card.current_raw)}   active={gradeView==='raw'}   v={v} borderRight />
        <GradeCell label="PSA 9"  usd={fmt(card.current_psa9)}  gbp={fmtGbp(card.current_psa9)}  active={gradeView==='psa9'}  v={v} borderRight />
        <GradeCell label="PSA 10" usd={fmt(card.current_psa10)} gbp={fmtGbp(card.current_psa10)} active={gradeView==='psa10'} v={v} />
      </div>

      {/* Trend row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <TrendCell label="7d"  val={pct(card.raw_pct_7d)}  col={pctCol(card.raw_pct_7d,  v.dk)} v={v} borderRight />
        <TrendCell label="30d" val={pct(card.raw_pct_30d)} col={pctCol(card.raw_pct_30d, v.dk)} v={v} borderRight={!!psa10x} />
        {psa10x && <TrendCell label="Grade ×" val={`${psa10x}×`} col="#a78bfa" v={v} />}
      </div>

      <BrandingFooter v={v} />
    </div>
  )
}

// ── VISUAL: Insight Card Minimal ──────────────────────────────────────────────

function renderInsightMinimal(card: CardData, theme: Theme, gradeView: GradeView, imageDataUrl: string | null) {
  const v = tv(theme)
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
  const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
  const trendCol = card.raw_pct_30d != null ? (card.raw_pct_30d > 0 ? v.green : v.red) : v.mu

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: v.bg, width: 520, borderRadius: 22, border: `1px solid ${v.br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 24px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 10, color: v.mu, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, fontFamily: 'Figtree' }}>{card.set_name}</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: v.tx, fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1 }}>{card.card_name}</span>
        </div>
        {imageDataUrl && (
          <img src={imageDataUrl} width={56} height={78} style={{ objectFit: 'contain', borderRadius: 6, marginLeft: 16 }} />
        )}
      </div>

      {/* Big price */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', borderBottom: `1px solid ${v.br}` }}>
        <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 48, fontWeight: 900, color: v.tx, fontFamily: 'Outfit', letterSpacing: -2, lineHeight: 1 }}>{fmt(focusPrice)}</span>
          <span style={{ fontSize: 22, color: v.mu, fontWeight: 700, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
        </div>
        {card.raw_pct_30d != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: trendCol, fontFamily: 'Figtree' }}>{pct(card.raw_pct_30d)}</span>
            <span style={{ fontSize: 11, color: v.mu, fontFamily: 'Figtree' }}>past 30 days</span>
          </div>
        )}
      </div>

      {/* Grade grid */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        <GradeCell label="Raw"    usd={fmt(card.current_raw)}   gbp={fmtGbp(card.current_raw)}   active={gradeView==='raw'}   v={v} borderRight />
        <GradeCell label="PSA 9"  usd={fmt(card.current_psa9)}  gbp={fmtGbp(card.current_psa9)}  active={gradeView==='psa9'}  v={v} borderRight />
        <GradeCell label="PSA 10" usd={fmt(card.current_psa10)} gbp={fmtGbp(card.current_psa10)} active={gradeView==='psa10'} v={v} />
      </div>

      {psa10x && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', borderBottom: `1px solid ${v.br}` }}>
          <span style={{ fontSize: 12, color: v.mu, fontFamily: 'Figtree' }}>Grade multiple:  </span>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#a78bfa', fontFamily: 'Outfit' }}>{psa10x}× raw</span>
        </div>
      )}

      <BrandingFooter v={v} />
    </div>
  )
}

// ── VISUAL: Market Movers ─────────────────────────────────────────────────────

function renderMovers(movers: Mover[], theme: Theme, direction: MoversDirection, period: string) {
  const v = tv(theme)
  const accentCol = direction === 'rising' ? v.green : v.red
  const arrow = direction === 'rising' ? '▲' : '▼'
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const periodLabel = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' }[period] || period

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: v.bg, width: 680, borderRadius: 22, border: `1px solid ${v.br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#0d2040', padding: '20px 24px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <HeaderWatermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'Figtree' }}>{today}</span>
        </div>
        <span style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5 }}>
          {arrow} Top {movers.length} {direction === 'rising' ? 'Risers' : 'Fallers'}
        </span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: 700, fontFamily: 'Figtree' }}>
          Past {periodLabel} · Volume-verified signals
        </span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 20px 6px', borderBottom: `1px solid ${v.br}` }}>
        <span style={{ width: 28, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center', fontFamily: 'Figtree' }}>#</span>
        <span style={{ flex: 1, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 8, fontFamily: 'Figtree' }}>Card</span>
        <span style={{ width: 90, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'Figtree' }}>Price</span>
        <span style={{ width: 76, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right', fontFamily: 'Figtree' }}>Change</span>
      </div>

      {/* Rows */}
      {movers.slice(0, 10).map((m, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', padding: '13px 20px',
          borderBottom: i < movers.length - 1 ? `1px solid ${v.br}` : 'none',
          background: i % 2 === 0 ? 'transparent' : v.dk ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.012)',
        }}>
          <span style={{ width: 28, fontSize: 12, fontWeight: 900, color: v.mu, textAlign: 'center', fontFamily: 'Outfit' }}>{i + 1}</span>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: v.tx, fontFamily: 'Figtree' }}>{m.card_name}</span>
            <span style={{ fontSize: 11, color: v.mu, fontWeight: 600, marginTop: 2, fontFamily: 'Figtree' }}>{m.set_name}</span>
            {m.volume_label && <span style={{ fontSize: 10, color: v.green, fontWeight: 700, marginTop: 2, fontFamily: 'Figtree' }}>{m.volume_label}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', width: 90 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: v.tx, fontFamily: 'Outfit' }}>{fmt(m.current_price)}</span>
            <span style={{ fontSize: 11, color: v.mu, marginTop: 2, fontFamily: 'Figtree' }}>{fmtGbp(m.current_price)}</span>
          </div>
          <span style={{ width: 76, fontSize: 16, fontWeight: 900, color: accentCol, textAlign: 'right', fontFamily: 'Outfit', letterSpacing: -0.3 }}>
            {pct(m.pct_change)}
          </span>
        </div>
      ))}

      <BrandingFooter v={v} />
    </div>
  )
}

// ── VISUAL: Set Report ────────────────────────────────────────────────────────

function renderSetReport(setData: SetData, theme: Theme) {
  const v = tv(theme)
  const pct30col = pctCol(setData.set_pct_30d, v.dk)
  const pct90col = pctCol(setData.set_pct_90d, v.dk)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: v.bg, width: 520, borderRadius: 22, border: `1px solid ${v.br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)', padding: '22px 24px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <HeaderWatermark />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'Figtree' }}>Set Performance Report</span>
        </div>
        <span style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1 }}>{setData.set_name}</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6, fontWeight: 700, fontFamily: 'Figtree' }}>{setData.card_count} cards tracked</span>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Set Value', val: fmtGbp(setData.total_value), sub: fmt(setData.total_value), col: v.tx },
          { label: 'Avg 30d',   val: pct(setData.set_pct_30d),    sub: 'all cards',              col: pct30col },
          { label: 'Avg 90d',   val: pct(setData.set_pct_90d),    sub: 'all cards',              col: pct90col },
        ].map((s, i) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '16px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5, fontFamily: 'Figtree' }}>{s.label}</span>
            <span style={{ fontSize: 22, fontWeight: 900, color: s.col, letterSpacing: -0.5, fontFamily: 'Outfit' }}>{s.val}</span>
            <span style={{ fontSize: 10, color: v.mu, marginTop: 2, fontFamily: 'Figtree' }}>{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Card list header */}
      <div style={{ display: 'flex', padding: '12px 20px 8px' }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1.5, fontFamily: 'Figtree' }}>Top Cards by Value</span>
      </div>

      {/* Cards */}
      {setData.top_cards.slice(0, 10).map((c, i) => {
        const sharePct = setData.total_value > 0 ? (c.current_raw / setData.total_value) * 100 : 0
        const barW = Math.min(100, sharePct * 3)
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', padding: '12px 20px', borderBottom: i < setData.top_cards.length - 1 ? `1px solid ${v.br}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: v.mu, fontWeight: 800, width: 20, fontFamily: 'Figtree' }}>{i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: v.tx, flex: 1, fontFamily: 'Figtree' }}>{c.card_name}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: v.tx, marginRight: 16, fontFamily: 'Outfit' }}>{fmt(c.current_raw)}</span>
              {c.pct_30d != null && (
                <span style={{ fontSize: 12, fontWeight: 800, color: pctCol(c.pct_30d, v.dk), width: 54, textAlign: 'right', fontFamily: 'Figtree' }}>{pct(c.pct_30d)}</span>
              )}
            </div>
            {/* Bar */}
            <div style={{ display: 'flex', marginLeft: 20, marginTop: 6, height: 3, background: v.br, borderRadius: 2 }}>
              <div style={{ width: `${barW}%`, height: 3, background: 'linear-gradient(to right, #1a5fad, #2874c8)', borderRadius: 2 }} />
            </div>
          </div>
        )
      })}

      <BrandingFooter v={v} />
    </div>
  )
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { visualType, theme = 'dark', gradeView = 'raw', cardLayout = 'compact', period = '30d', direction = 'rising', card, movers, setData } = body

    // Load fonts with a timeout — if fonts fail, Satori uses system fallback
    const fonts = await Promise.race([
      loadFonts(),
      new Promise<[]>(r => setTimeout(() => r([]), 8000)),
    ])

    // Determine canvas size
    const width  = (visualType === 'movers') ? 680 : 520
    const height = (visualType === 'movers') ? 800 : 600

    // Pre-fetch card image server-side (no CORS issues)
    let imageDataUrl: string | null = null
    if (card?.image_url) {
      imageDataUrl = await fetchImageAsDataUrl(card.image_url)
    }

    let element: JSX.Element

    if (visualType === 'movers' && movers) {
      element = renderMovers(movers, theme, direction, period)
    } else if (visualType === 'set-report' && setData) {
      element = renderSetReport(setData, theme)
    } else if (card) {
      if (visualType === 'insight') {
        if (cardLayout === 'showcase') {
          element = renderInsightShowcase(card, theme, gradeView, imageDataUrl)
        } else if (cardLayout === 'minimal') {
          element = renderInsightMinimal(card, theme, gradeView, imageDataUrl)
        } else {
          element = renderInsightCompact(card, theme, gradeView, imageDataUrl)
        }
      } else {
        element = renderInsightCompact(card, theme, gradeView, imageDataUrl)
      }
    } else {
      return new Response(JSON.stringify({ error: 'No data provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new ImageResponse(element, { width, height, fonts })

  } catch (err: any) {
    console.error('Studio export error:', err)
    return new Response(
      JSON.stringify({ error: err.message || 'Unknown error', stack: err.stack }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}