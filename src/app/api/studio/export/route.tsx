// app/api/studio/export/route.tsx
import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

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

function pctColor(v: number | null): string {
  if (v == null) return '#4a5e78'
  return v > 0 ? '#22c55e' : '#ef4444'
}

// Edge-safe base64 — no Buffer
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || 'image/jpeg'
    const bytes = new Uint8Array(buf)
    let b = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      b += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return `data:${ct};base64,${btoa(b)}`
  } catch {
    return null
  }
}

// Load fonts from files bundled alongside this route
// import.meta.url points to the route file, so relative paths resolve correctly
async function loadFont(filename: string): Promise<ArrayBuffer | null> {
  try {
    const fontUrl = new URL(`./${filename}`, import.meta.url)
    const res = await fetch(fontUrl)
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      visualType = 'insight',
      theme = 'dark',
      gradeView = 'raw',
      cardLayout = 'compact',
      period = '30d',
      direction = 'rising',
      card,
      movers,
      setData,
    } = body

    const dk = theme === 'dark'
    const bg   = dk ? '#0d1520' : '#ffffff'
    const tx   = dk ? '#f1f5f9' : '#0f172a'
    const mu   = dk ? '#4a5e78' : '#94a3b8'
    const br   = dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'
    const hdGrad = 'linear-gradient(135deg, #0d2b5e 0%, #1a5fad 60%, #2874c8 100%)'

    // Load fonts from bundled files
    const [outfitHeavy, outfitBold, figtreeReg] = await Promise.all([
      loadFont('outfit-900.ttf'),
      loadFont('outfit-700.ttf'),
      loadFont('figtree-700.ttf'),
    ])
    const fonts: any[] = []
    if (outfitHeavy) fonts.push({ name: 'Outfit',  data: outfitHeavy, weight: 900, style: 'normal' })
    if (outfitBold)  fonts.push({ name: 'Outfit',  data: outfitBold,  weight: 700, style: 'normal' })
    if (figtreeReg)  fonts.push({ name: 'Figtree', data: figtreeReg,  weight: 700, style: 'normal' })

    // Canvas dimensions
    const isWide = visualType === 'movers'
    const width  = isWide ? 680 : 520

    // Pre-fetch card image
    let imgSrc: string | null = null
    if (card?.image_url) imgSrc = await toDataUrl(card.image_url)

    // ── Helpers for JSX ────────────────────────────────────────────────────────

    function Watermark() {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.85)', display: 'flex' }} />
          </div>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.8)', fontFamily: 'Figtree', letterSpacing: 1 }}>POKEPRICES.IO</span>
        </div>
      )
    }

    function Footer() {
      return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderTop: `1px solid ${br}`, background: dk ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#1a5fad', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 7, height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.9)', display: 'flex' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: tx, opacity: 0.55, fontFamily: 'Figtree' }}>Powered by PokePrices.io</span>
          </div>
          <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree' }}>Not financial advice</span>
        </div>
      )
    }

    // ── CARD VISUALS ───────────────────────────────────────────────────────────

    if (card && (visualType === 'insight' || visualType === 'psa-gauge' || visualType === 'peak-distance' || visualType === 'temperature' || visualType === 'grade-compare')) {
      const focusPrice = gradeView === 'psa10' ? card.current_psa10 : gradeView === 'psa9' ? card.current_psa9 : card.current_raw
      const focusLabel = gradeView === 'psa10' ? 'PSA 10' : gradeView === 'psa9' ? 'PSA 9' : 'Raw'
      const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
      const sig = card.raw_pct_30d != null
        ? card.raw_pct_30d > 15  ? { label: '▲ Trending Up', col: '#22c55e' }
        : card.raw_pct_30d < -15 ? { label: '▼ Cooling',     col: '#ef4444' }
        : { label: '— Stable', col: '#f59e0b' }
        : { label: '— Stable', col: '#f59e0b' }

      // ── SHOWCASE layout ──
      if (cardLayout === 'showcase') {
        return new ImageResponse((
          <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
            {/* Top bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: hdGrad, padding: '14px 22px' }}>
              <Watermark />
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.35)', padding: '4px 12px', borderRadius: 20, border: `1px solid ${sig.col}50` }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: sig.col, fontFamily: 'Figtree' }}>{sig.label}</span>
              </div>
            </div>
            {/* Hero */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, background: hdGrad, padding: '0 22px 24px' }}>
              {imgSrc && <img src={imgSrc} width={130} height={182} style={{ objectFit: 'contain', borderRadius: 12 }} />}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, paddingBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 700, marginBottom: 4, fontFamily: 'Figtree' }}>{card.set_name}</span>
                <span style={{ fontSize: 24, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 14 }}>{card.card_name}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 40, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -1.5, lineHeight: 1 }}>{fmt(focusPrice)}</span>
                  <span style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', fontWeight: 700, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
                </div>
              </div>
            </div>
            {/* Grade grid */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
              {[['Raw', card.current_raw], ['PSA 9', card.current_psa9], ['PSA 10', card.current_psa10]].map(([label, val], i) => (
                <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '13px 14px', borderRight: i < 2 ? `1px solid ${br}` : 'none', background: (gradeView === 'raw' && i===0)||(gradeView==='psa9'&&i===1)||(gradeView==='psa10'&&i===2) ? (dk?'rgba(26,95,173,0.1)':'rgba(26,95,173,0.05)') : 'transparent' }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>{String(label)}</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                  <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree', marginTop: 2 }}>{fmtGbp(val as number)}</span>
                </div>
              ))}
            </div>
            {/* Trend */}
            <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
              {[['7d', card.raw_pct_7d], ['30d', card.raw_pct_30d], ...(psa10x ? [['Grade ×', null]] : [])].map(([label, val], i, arr) => (
                <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '12px 14px', borderRight: i < arr.length-1 ? `1px solid ${br}` : 'none' }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>{String(label)}</span>
                  <span style={{ fontSize: 20, fontWeight: 900, color: label === 'Grade ×' ? '#a78bfa' : pctColor(val as number), fontFamily: 'Outfit' }}>{label === 'Grade ×' ? `${psa10x}×` : pct(val as number)}</span>
                </div>
              ))}
            </div>
            <Footer />
          </div>
        ), { width, height: 700, fonts })
      }

      // ── MINIMAL layout ──
      if (cardLayout === 'minimal') {
        return new ImageResponse((
          <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 24px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 10, color: mu, fontWeight: 700, marginBottom: 4, fontFamily: 'Figtree' }}>{card.set_name}</span>
                <span style={{ fontSize: 26, fontWeight: 900, color: tx, fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1 }}>{card.card_name}</span>
              </div>
              {imgSrc && <img src={imgSrc} width={56} height={78} style={{ objectFit: 'contain', borderRadius: 6, marginLeft: 16 }} />}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '20px 24px', borderBottom: `1px solid ${br}` }}>
              <span style={{ fontSize: 9, color: mu, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontSize: 48, fontWeight: 900, color: tx, fontFamily: 'Outfit', letterSpacing: -2, lineHeight: 1 }}>{fmt(focusPrice)}</span>
                <span style={{ fontSize: 22, color: mu, fontWeight: 700, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
              </div>
              {card.raw_pct_30d != null && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: pctColor(card.raw_pct_30d), fontFamily: 'Figtree' }}>{pct(card.raw_pct_30d)}</span>
                  <span style={{ fontSize: 11, color: mu, fontFamily: 'Figtree' }}>past 30 days</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
              {[['Raw', card.current_raw], ['PSA 9', card.current_psa9], ['PSA 10', card.current_psa10]].map(([label, val], i) => (
                <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '13px 16px', borderRight: i < 2 ? `1px solid ${br}` : 'none' }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{String(label)}</span>
                  <span style={{ fontSize: 15, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                  <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree', marginTop: 2 }}>{fmtGbp(val as number)}</span>
                </div>
              ))}
            </div>
            {psa10x && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 24px', borderBottom: `1px solid ${br}`, gap: 6 }}>
                <span style={{ fontSize: 12, color: mu, fontFamily: 'Figtree' }}>Grade multiple: </span>
                <span style={{ fontSize: 15, fontWeight: 900, color: '#a78bfa', fontFamily: 'Outfit' }}>{psa10x}× raw</span>
              </div>
            )}
            <Footer />
          </div>
        ), { width, height: 500, fonts })
      }

      // ── HERO layout ──
      if (cardLayout === 'hero') {
        return new ImageResponse((
          <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: hdGrad, padding: '14px 22px' }}>
              <Watermark />
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.35)', padding: '4px 12px', borderRadius: 20, border: `1px solid ${sig.col}50` }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: sig.col, fontFamily: 'Figtree' }}>{sig.label}</span>
              </div>
            </div>
            {/* Card name + large centered image */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: hdGrad, padding: '16px 22px 60px' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 700, marginBottom: 6, fontFamily: 'Figtree' }}>{card.set_name}</span>
              <span style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.1, marginBottom: 24, textAlign: 'center' }}>{card.card_name}</span>
              {imgSrc && <img src={imgSrc} width={200} height={280} style={{ objectFit: 'contain', borderRadius: 14 }} />}
            </div>
            {/* Data section */}
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: -50, background: bg }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 24px', borderBottom: `1px solid ${br}` }}>
                <span style={{ fontSize: 9, color: mu, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 44, fontWeight: 900, color: tx, fontFamily: 'Outfit', letterSpacing: -2, lineHeight: 1 }}>{fmt(focusPrice)}</span>
                  <span style={{ fontSize: 20, color: mu, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
                {[['Raw', card.current_raw], ['PSA 9', card.current_psa9], ['PSA 10', card.current_psa10]].map(([label, val], i) => (
                  <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '13px 14px', borderRight: i < 2 ? `1px solid ${br}` : 'none', alignItems: 'center', background: (gradeView==='raw'&&i===0)||(gradeView==='psa9'&&i===1)||(gradeView==='psa10'&&i===2) ? (dk?'rgba(26,95,173,0.1)':'rgba(26,95,173,0.05)') : 'transparent' }}>
                    <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{String(label)}</span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                    <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree', marginTop: 2 }}>{fmtGbp(val as number)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
                {[['7d', card.raw_pct_7d], ['30d', card.raw_pct_30d], ...(psa10x ? [['Grade ×', null]] : [])].map(([label, val], i, arr) => (
                  <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '12px 14px', borderRight: i < arr.length-1 ? `1px solid ${br}` : 'none', alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{String(label)}</span>
                    <span style={{ fontSize: 20, fontWeight: 900, color: label === 'Grade ×' ? '#a78bfa' : pctColor(val as number), fontFamily: 'Outfit' }}>{label === 'Grade ×' ? `${psa10x}×` : pct(val as number)}</span>
                  </div>
                ))}
              </div>
            </div>
            <Footer />
          </div>
        ), { width, height: 800, fonts })
      }

      // ── COMPACT layout (default) ──
      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '20px 22px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Watermark />
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.35)', padding: '4px 12px', borderRadius: 20, border: `1px solid ${sig.col}50` }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: sig.col, fontFamily: 'Figtree' }}>{sig.label}</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {imgSrc && <img src={imgSrc} width={58} height={80} style={{ objectFit: 'contain', borderRadius: 8 }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5, lineHeight: 1.15 }}>{card.card_name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4, fontWeight: 700, fontFamily: 'Figtree' }}>{card.set_name}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '16px 22px', borderBottom: `1px solid ${br}`, background: dk ? 'rgba(26,95,173,0.06)' : 'rgba(26,95,173,0.03)' }}>
            <span style={{ fontSize: 9, color: mu, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontFamily: 'Figtree' }}>{focusLabel} Price</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: tx, fontFamily: 'Outfit', letterSpacing: -1 }}>{fmt(focusPrice)}</span>
              <span style={{ fontSize: 16, color: mu, fontFamily: 'Figtree' }}>{fmtGbp(focusPrice)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
            {[['Raw', card.current_raw], ['PSA 9', card.current_psa9], ['PSA 10', card.current_psa10]].map(([label, val], i) => (
              <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '13px 14px', borderRight: i < 2 ? `1px solid ${br}` : 'none', background: (gradeView==='raw'&&i===0)||(gradeView==='psa9'&&i===1)||(gradeView==='psa10'&&i===2) ? (dk?'rgba(26,95,173,0.1)':'rgba(26,95,173,0.05)') : 'transparent' }}>
                <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{String(label)}</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree', marginTop: 2 }}>{fmtGbp(val as number)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
            {[['7d', card.raw_pct_7d], ['30d', card.raw_pct_30d], ...(psa10x ? [['Grade ×', null]] : [])].map(([label, val], i, arr) => (
              <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '12px 14px', borderRight: i < arr.length-1 ? `1px solid ${br}` : 'none' }}>
                <span style={{ fontSize: 9, color: mu, fontWeight: 700, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{String(label)}</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: label === 'Grade ×' ? '#a78bfa' : pctColor(val as number), fontFamily: 'Outfit' }}>{label === 'Grade ×' ? `${psa10x}×` : pct(val as number)}</span>
              </div>
            ))}
          </div>
          <Footer />
        </div>
      ), { width, height: 560, fonts })
    }

    // ── PSA GAUGE ──────────────────────────────────────────────────────────────

    if (visualType === 'psa-gauge' && card) {
      const multiple = card.current_raw && card.current_psa10 ? card.current_psa10 / card.current_raw : null
      const maxMultiple = 20
      const fillPct = multiple ? Math.min(100, (multiple / maxMultiple) * 100) : 0
      const gaugeCol = !multiple ? mu : multiple < 3 ? '#22c55e' : multiple < 8 ? '#f59e0b' : '#ef4444'
      const gaugeLabel = !multiple ? 'No data' : multiple < 3 ? 'Low premium — consider grading' : multiple < 8 ? 'Meaningful premium' : 'Very high premium — high risk'

      // SVG arc: semicircle from left (-180deg) to right (0deg)
      // fillPct 0-100 maps to 0-180 degrees of arc
      const r = 90, cx = 150, cy = 130
      const startAngle = Math.PI        // left side = 180deg in radians
      const sweepAngle = Math.PI * (fillPct / 100)  // 0 to PI
      const endAngle = startAngle - sweepAngle       // goes counter-clockwise left to right across top

      const sx = cx + r * Math.cos(startAngle)
      const sy = cy + r * Math.sin(startAngle)
      const ex = cx + r * Math.cos(endAngle)
      const ey = cy + r * Math.sin(endAngle)
      const largeArc = sweepAngle > Math.PI ? 1 : 0

      // Track (full semicircle)
      const trackEx = cx + r * Math.cos(0)
      const trackEy = cy + r * Math.sin(0)
      const trackPath = `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${trackEx} ${trackEy}`
      const fillPath = fillPct > 0 ? `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}` : ''

      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '20px 22px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', fontFamily: 'Figtree' }}>Grade Premium</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {imgSrc && <img src={imgSrc} width={50} height={70} style={{ objectFit: 'contain', borderRadius: 6 }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.3 }}>{card.card_name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, fontFamily: 'Figtree' }}>{card.set_name}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 28px 16px' }}>
            {/* SVG Gauge */}
            <svg width="300" height="150" viewBox="0 0 300 145">
              <path d={trackPath} fill="none" stroke={dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'} strokeWidth="16" strokeLinecap="round" />
              {fillPath && <path d={fillPath} fill="none" stroke={gaugeCol} strokeWidth="16" strokeLinecap="round" />}
              <text x="150" y="108" textAnchor="middle" fill={tx} fontSize="30" fontWeight="900" fontFamily="Outfit">{multiple ? `${multiple.toFixed(1)}×` : '—'}</text>
              <text x="150" y="126" textAnchor="middle" fill={mu} fontSize="10" fontWeight="700" fontFamily="Figtree">Raw → PSA 10</text>
              <text x="62" y="140" textAnchor="middle" fill={mu} fontSize="9" fontWeight="700" fontFamily="Figtree">1×</text>
              <text x="238" y="140" textAnchor="middle" fill={mu} fontSize="9" fontWeight="700" fontFamily="Figtree">20×</text>
            </svg>
            <span style={{ fontSize: 13, color: gaugeCol, fontWeight: 800, fontFamily: 'Figtree', marginTop: 8 }}>{gaugeLabel}</span>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, width: '100%' }}>
              {[['Raw', card.current_raw], ['PSA 10', card.current_psa10]].map(([label, val]) => (
                <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '12px 14px', border: `1px solid ${br}` }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 5, fontFamily: 'Figtree' }}>{String(label)}</span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                  <span style={{ fontSize: 10, color: mu, marginTop: 2, fontFamily: 'Figtree' }}>{fmtGbp(val as number)}</span>
                </div>
              ))}
            </div>
          </div>
          <Footer />
        </div>
      ), { width, height: 520, fonts })
    }

    // ── PEAK DISTANCE ──────────────────────────────────────────────────────────

    if (visualType === 'peak-distance' && card) {
      const rawNow = card.current_raw
      const peaks = [card.raw_30d_ago, card.raw_90d_ago, card.raw_180d_ago].filter(Boolean) as number[]
      const peakPrice = peaks.length ? Math.max(...peaks) : null
      const drawdownPct = rawNow && peakPrice ? ((rawNow - peakPrice) / peakPrice) * 100 : null
      const isAtPeak = drawdownPct != null && drawdownPct > -5
      const barFill = drawdownPct != null ? Math.min(100, Math.max(0, 100 + drawdownPct)) : 0
      const barCol = isAtPeak ? '#ef4444' : drawdownPct != null && drawdownPct < -40 ? '#22c55e' : '#f59e0b'

      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '20px 22px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', fontFamily: 'Figtree' }}>Peak Distance</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {imgSrc && <img src={imgSrc} width={50} height={70} style={{ objectFit: 'contain', borderRadius: 6 }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.3 }}>{card.card_name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, fontFamily: 'Figtree' }}>{card.set_name}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 28px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 48, fontWeight: 900, color: barCol, fontFamily: 'Outfit', letterSpacing: -2, lineHeight: 1 }}>
                {drawdownPct != null ? (isAtPeak ? 'At Peak' : `${drawdownPct.toFixed(0)}%`) : '—'}
              </span>
              <span style={{ fontSize: 12, color: mu, marginTop: 6, fontFamily: 'Figtree' }}>
                {isAtPeak ? 'Trading near its recent high' : 'below recent high'}
              </span>
            </div>
            <div style={{ display: 'flex', height: 10, background: dk ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ height: '100%', width: `${barFill}%`, background: barCol, borderRadius: 99 }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['Current Raw', rawNow], ['Recent Peak', peakPrice]].map(([label, val]) => (
                <div key={String(label)} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '12px 14px', border: `1px solid ${br}` }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 5, fontFamily: 'Figtree' }}>{String(label)}</span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(val as number)}</span>
                  <span style={{ fontSize: 10, color: mu, marginTop: 2, fontFamily: 'Figtree' }}>{fmtGbp(val as number)}</span>
                </div>
              ))}
            </div>
          </div>
          <Footer />
        </div>
      ), { width, height: 480, fonts })
    }

    // ── TEMPERATURE ────────────────────────────────────────────────────────────

    if (visualType === 'temperature' && card) {
      const p30 = card.raw_pct_30d
      const temp = p30 == null ? 50 : Math.min(100, Math.max(0, 50 + p30 * 2))
      const label = p30 == null ? 'Neutral' : p30 > 30 ? '🔥 Very Hot' : p30 > 10 ? '📈 Heating Up' : p30 < -30 ? '🧊 Very Cold' : p30 < -10 ? '📉 Cooling Down' : '➡ Neutral'
      const col = p30 == null ? '#f59e0b' : p30 > 10 ? '#f97316' : p30 < -10 ? '#60a5fa' : '#f59e0b'

      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '20px 22px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', fontFamily: 'Figtree' }}>Market Temperature</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {imgSrc && <img src={imgSrc} width={50} height={70} style={{ objectFit: 'contain', borderRadius: 6 }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.3 }}>{card.card_name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, fontFamily: 'Figtree' }}>{card.set_name}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 28px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: col, fontFamily: 'Outfit' }}>{label}</span>
              {p30 != null && <span style={{ fontSize: 14, color: mu, marginTop: 6, fontFamily: 'Figtree' }}>{pct(p30)} in 30 days</span>}
            </div>
            {/* Temperature bar */}
            <div style={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', marginBottom: 10, background: '#60a5fa', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: '33%', height: '100%', background: '#60a5fa' }} />
              <div style={{ position: 'absolute', left: '33%', top: 0, width: '34%', height: '100%', background: '#22c55e' }} />
              <div style={{ position: 'absolute', left: '67%', top: 0, width: '33%', height: '100%', background: '#ef4444' }} />
              <div style={{ position: 'absolute', left: `calc(${temp}% - 2px)`, top: 0, width: 4, height: '100%', background: '#fff' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
              <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, fontFamily: 'Figtree' }}>Cold</span>
              <span style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, fontFamily: 'Figtree' }}>Hot</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[['7d', card.raw_pct_7d], ['30d', card.raw_pct_30d], ['90d', card.raw_pct_90d], ['Raw', card.current_raw]].map(([label, val], i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: dk ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', borderRadius: 10, padding: '10px 12px', border: `1px solid ${br}` }}>
                  <span style={{ fontSize: 9, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4, fontFamily: 'Figtree' }}>{String(label)}</span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: i < 3 ? pctColor(val as number) : tx, fontFamily: 'Outfit' }}>{i < 3 ? pct(val as number) : fmt(val as number)}</span>
                </div>
              ))}
            </div>
          </div>
          <Footer />
        </div>
      ), { width, height: 500, fonts })
    }

    // ── GRADE COMPARE ──────────────────────────────────────────────────────────

    if (visualType === 'grade-compare' && card) {
      const grades = [
        { label: 'Raw',    val: card.current_raw,   col: '#60a5fa' },
        { label: 'PSA 9',  val: card.current_psa9,  col: '#34d399' },
        { label: 'PSA 10', val: card.current_psa10, col: '#a78bfa' },
      ].filter(g => g.val && g.val > 0)
      const maxVal = Math.max(...grades.map(g => g.val || 0))

      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '20px 22px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', fontFamily: 'Figtree' }}>Grade Breakdown</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {imgSrc && <img src={imgSrc} width={50} height={70} style={{ objectFit: 'contain', borderRadius: 6 }} />}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.3 }}>{card.card_name}</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 3, fontFamily: 'Figtree' }}>{card.set_name}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '22px 24px 16px', gap: 14 }}>
            {grades.map(g => {
              const barW = maxVal > 0 ? Math.round((g.val! / maxVal) * 100) : 0
              const multiple = card.current_raw && g.label !== 'Raw' ? (g.val! / card.current_raw).toFixed(1) : null
              return (
                <div key={g.label} style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: g.col }} />
                      <span style={{ fontSize: 13, fontWeight: 800, color: tx, fontFamily: 'Figtree' }}>{g.label}</span>
                      {multiple && <span style={{ fontSize: 11, color: mu, fontFamily: 'Figtree' }}>({multiple}× raw)</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <span style={{ fontSize: 16, fontWeight: 900, color: tx, fontFamily: 'Outfit' }}>{fmt(g.val)}</span>
                      <span style={{ fontSize: 10, color: mu, fontFamily: 'Figtree' }}>{fmtGbp(g.val)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', height: 10, background: dk ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${barW}%`, height: '100%', background: g.col, borderRadius: 99 }} />
                  </div>
                </div>
              )
            })}
          </div>
          <Footer />
        </div>
      ), { width, height: 400 + grades.length * 70, fonts })
    }

    // ── MOVERS ─────────────────────────────────────────────────────────────────

    if (visualType === 'movers' && movers?.length) {
      const accentCol = direction === 'rising' ? '#22c55e' : '#ef4444'
      const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      const periodLabel = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' }[period as string] || period

      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 680, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: '#0d2040', padding: '20px 24px 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.35)', fontFamily: 'Figtree' }}>{today}</span>
            </div>
            <span style={{ fontSize: 26, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5 }}>
              {direction === 'rising' ? '▲' : '▼'} Top {Math.min(movers.length, 10)} {direction === 'rising' ? 'Risers' : 'Fallers'}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontWeight: 700, fontFamily: 'Figtree' }}>
              Past {periodLabel} · Volume-verified signals
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 20px 6px', borderBottom: `1px solid ${br}` }}>
            <span style={{ width: 28, fontSize: 9, fontWeight: 700, color: mu, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'Figtree' }}>#</span>
            <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: mu, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 8, fontFamily: 'Figtree' }}>Card</span>
            <span style={{ width: 90, fontSize: 9, fontWeight: 700, color: mu, textTransform: 'uppercase', letterSpacing: 1, fontFamily: 'Figtree' }}>Price</span>
            <span style={{ width: 76, fontSize: 9, fontWeight: 700, color: mu, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right', fontFamily: 'Figtree' }}>Change</span>
          </div>
          {movers.slice(0, 10).map((m: any, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: i < movers.length - 1 ? `1px solid ${br}` : 'none', background: i % 2 === 0 ? 'transparent' : dk ? 'rgba(255,255,255,0.012)' : 'rgba(0,0,0,0.012)' }}>
              <span style={{ width: 28, fontSize: 12, fontWeight: 900, color: mu, fontFamily: 'Outfit' }}>{i + 1}</span>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginLeft: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: tx, fontFamily: 'Figtree' }}>{m.card_name}</span>
                <span style={{ fontSize: 11, color: mu, fontWeight: 600, marginTop: 2, fontFamily: 'Figtree' }}>{m.set_name}</span>
                {m.volume_label && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700, marginTop: 2, fontFamily: 'Figtree' }}>{m.volume_label}</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', width: 90 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: tx, fontFamily: 'Outfit' }}>{fmt(m.current_price)}</span>
                <span style={{ fontSize: 11, color: mu, marginTop: 2, fontFamily: 'Figtree' }}>{fmtGbp(m.current_price)}</span>
              </div>
              <span style={{ width: 76, fontSize: 16, fontWeight: 900, color: accentCol, textAlign: 'right', fontFamily: 'Outfit' }}>
                {pct(m.pct_change)}
              </span>
            </div>
          ))}
          <Footer />
        </div>
      ), { width: 680, height: 120 + movers.slice(0, 10).length * 62, fonts })
    }

    // ── SET REPORT ─────────────────────────────────────────────────────────────

    if (visualType === 'set-report' && setData) {
      return new ImageResponse((
        <div style={{ display: 'flex', flexDirection: 'column', background: bg, width: 520, borderRadius: 22, border: `1px solid ${br}`, overflow: 'hidden', fontFamily: 'Figtree' }}>
          <div style={{ display: 'flex', flexDirection: 'column', background: hdGrad, padding: '22px 24px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Watermark />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.4)', fontFamily: 'Figtree' }}>Set Performance Report</span>
            </div>
            <span style={{ fontSize: 28, fontWeight: 900, color: '#fff', fontFamily: 'Outfit', letterSpacing: -0.5 }}>{setData.set_name}</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 6, fontWeight: 700, fontFamily: 'Figtree' }}>{setData.card_count} cards tracked</span>
          </div>
          <div style={{ display: 'flex', borderBottom: `1px solid ${br}` }}>
            {[
              { label: 'Set Value', val: fmtGbp(setData.total_value), sub: fmt(setData.total_value), col: tx },
              { label: 'Avg 30d',   val: pct(setData.set_pct_30d),    sub: 'all cards', col: pctColor(setData.set_pct_30d) },
              { label: 'Avg 90d',   val: pct(setData.set_pct_90d),    sub: 'all cards', col: pctColor(setData.set_pct_90d) },
            ].map((s, i) => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '16px', borderRight: i < 2 ? `1px solid ${br}` : 'none' }}>
                <span style={{ fontSize: 9, color: mu, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5, fontFamily: 'Figtree' }}>{s.label}</span>
                <span style={{ fontSize: 22, fontWeight: 900, color: s.col, letterSpacing: -0.5, fontFamily: 'Outfit' }}>{s.val}</span>
                <span style={{ fontSize: 10, color: mu, marginTop: 2, fontFamily: 'Figtree' }}>{s.sub}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', padding: '12px 20px 8px' }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: mu, textTransform: 'uppercase', letterSpacing: 1.5, fontFamily: 'Figtree' }}>Top Cards by Value</span>
          </div>
          {setData.top_cards.slice(0, 10).map((c: any, i: number) => {
            const barW = setData.total_value > 0 ? Math.min(100, (c.current_raw / setData.total_value) * 300) : 0
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', padding: '11px 20px', borderBottom: i < setData.top_cards.length - 1 ? `1px solid ${br}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: mu, fontWeight: 700, width: 20, fontFamily: 'Figtree' }}>{i + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: tx, flex: 1, fontFamily: 'Figtree' }}>{c.card_name}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: tx, marginRight: 16, fontFamily: 'Outfit' }}>{fmt(c.current_raw)}</span>
                  {c.pct_30d != null && <span style={{ fontSize: 12, fontWeight: 800, color: pctColor(c.pct_30d), width: 54, textAlign: 'right', fontFamily: 'Figtree' }}>{pct(c.pct_30d)}</span>}
                </div>
                <div style={{ display: 'flex', marginLeft: 20, marginTop: 5, height: 3, background: br, borderRadius: 2 }}>
                  <div style={{ width: `${barW}%`, height: 3, background: '#1a5fad', borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
          <Footer />
        </div>
      ), { width: 520, height: 200 + setData.top_cards.slice(0, 10).length * 52, fonts })
    }

    return new Response(JSON.stringify({ error: 'Nothing to render' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('[studio/export] error:', err?.message, err?.stack)
    return new Response(
      JSON.stringify({ error: err?.message || 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}