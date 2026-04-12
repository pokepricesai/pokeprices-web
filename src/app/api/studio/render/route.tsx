// src/app/api/studio/render/route.ts
// Server-side PNG generation using @vercel/og
// Produces crisp 2x images with embedded fonts — no html2canvas issues

import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const USD_TO_GBP = 0.79

function fmt(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 10000) return '$' + (v / 1000).toFixed(1) + 'k'
  if (v >= 1000) return '$' + Math.round(v).toLocaleString()
  return '$' + v.toFixed(2)
}

function fmtGbp(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return '—'
  const v = (cents / 100) * USD_TO_GBP
  if (v >= 10000) return '£' + (v / 1000).toFixed(1) + 'k'
  if (v >= 1000) return '£' + Math.round(v).toLocaleString()
  return '£' + v.toFixed(2)
}

function pctStr(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%'
}

function pctColor(n: number | null | undefined): string {
  if (n == null) return '#64748b'
  return n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : '#64748b'
}

// ── Fetch data ────────────────────────────────────────────────────────────────

async function getCardData(slug: string) {
  const [{ data: trend }, { data: meta }] = await Promise.all([
    supabase.from('card_trends')
      .select('card_slug,card_name,set_name,current_raw,current_psa9,current_psa10,raw_pct_7d,raw_pct_30d,raw_pct_90d,raw_30d_ago,raw_90d_ago,raw_180d_ago')
      .eq('card_slug', slug).single(),
    supabase.from('cards').select('card_url_slug,image_url').eq('card_slug', slug).single(),
  ])
  if (!trend) return null
  return { ...trend, image_url: meta?.image_url || null }
}

async function getMovers(period: string, direction: string) {
  const col = `raw_pct_${period}`
  const { data } = await supabase.from('card_trends')
    .select(`card_slug,card_name,set_name,current_raw,${col}`)
    .not('current_raw', 'is', null)
    .not(col, 'is', null)
    .gt('current_raw', 2000)
    .order(col, { ascending: direction === 'falling' })
    .limit(20)
  return data || []
}

async function getSetData(setName: string) {
  const { data } = await supabase.from('card_trends')
    .select('card_slug,card_name,set_name,current_raw,raw_pct_30d,raw_pct_90d')
    .ilike('set_name', `%${setName}%`)
    .not('current_raw', 'is', null)
    .order('current_raw', { ascending: false })
    .limit(50)
  return data || []
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function getTheme(theme: string) {
  const dk = theme === 'dark'
  return {
    dk,
    bg:     dk ? '#0d1520' : '#ffffff',
    header: dk ? '#0d2040' : '#0d2040',
    tx:     dk ? '#f1f5f9' : '#0f172a',
    mu:     dk ? '#4a5e78' : '#94a3b8',
    br:     dk ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    green:  '#22c55e',
    red:    '#ef4444',
    yellow: '#f59e0b',
    blue:   '#1a5fad',
  }
}

// ── Image sizes ───────────────────────────────────────────────────────────────

const SIZES: Record<string, { width: number; height: number }> = {
  'insight':       { width: 560, height: 340 },
  'psa-gauge':     { width: 560, height: 400 },
  'peak-distance': { width: 560, height: 380 },
  'temperature':   { width: 560, height: 380 },
  'grade-compare': { width: 560, height: 400 },
  'movers':        { width: 680, height: 900 },
  'set-report':    { width: 600, height: 700 },
}

// ── OG image renders ──────────────────────────────────────────────────────────

function renderInsightCard(card: any, v: ReturnType<typeof getTheme>) {
  const psa10x = card.current_raw && card.current_psa10 ? (card.current_psa10 / card.current_raw).toFixed(1) : null
  const pct30  = card.raw_pct_30d
  const sigLabel = pct30 != null ? pct30 > 15 ? '▲ Trending Up' : pct30 < -15 ? '▼ Cooling' : '— Stable' : '— Stable'
  const sigCol   = pct30 != null ? pct30 > 15 ? v.green : pct30 < -15 ? v.red : v.yellow : v.yellow

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: v.bg, borderRadius: 22, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0d2b5e, #1a5fad, #2874c8)', padding: '22px 24px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, textTransform: 'uppercase' }}>pokeprices.io</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: sigCol, background: 'rgba(0,0,0,0.3)', padding: '3px 12px', borderRadius: 20 }}>{sigLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {card.image_url && <img src={card.image_url} width={58} height={80} style={{ objectFit: 'contain', borderRadius: 6 }} />}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1.15 }}>{card.card_name}</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{card.set_name}</span>
          </div>
        </div>
      </div>

      {/* Prices row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Raw',    usd: fmt(card.current_raw),   gbp: fmtGbp(card.current_raw)   },
          { label: 'PSA 9',  usd: fmt(card.current_psa9),  gbp: fmtGbp(card.current_psa9)  },
          { label: 'PSA 10', usd: fmt(card.current_psa10), gbp: fmtGbp(card.current_psa10) },
        ].map((p, i) => (
          <div key={p.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '16px 18px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{p.label}</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: v.tx }}>{p.usd}</span>
            <span style={{ fontSize: 11, color: v.mu, marginTop: 3 }}>{p.gbp}</span>
          </div>
        ))}
      </div>

      {/* Trend row */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: '7d Move',  val: pctStr(card.raw_pct_7d),  col: pctColor(card.raw_pct_7d)  },
          { label: '30d Move', val: pctStr(card.raw_pct_30d), col: pctColor(card.raw_pct_30d) },
          ...(psa10x ? [{ label: 'Grade ×', val: psa10x + '×', col: '#a78bfa' }] : [{ label: '90d Move', val: pctStr(card.raw_pct_90d), col: pctColor(card.raw_pct_90d) }]),
        ].map((s, i, arr) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '14px 18px', borderRight: i < arr.length - 1 ? `1px solid ${v.br}` : 'none' }}>
            <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>{s.label}</span>
            <span style={{ fontSize: 24, fontWeight: 900, color: s.col }}>{s.val}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 18px' }}>
        <span style={{ fontSize: 9, color: v.mu }}>Not financial advice</span>
      </div>
    </div>
  )
}

function renderMovers(movers: any[], period: string, direction: string, v: ReturnType<typeof getTheme>) {
  const periodLabel = { '7d': '7 Days', '30d': '30 Days', '90d': '90 Days' }[period] || period
  const accentCol = direction === 'rising' ? v.green : v.red
  const arrow = direction === 'rising' ? '▲' : '▼'
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const col = `raw_pct_${period}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: v.bg, borderRadius: 22, overflow: 'hidden', fontFamily: 'Figtree' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#0d2040', padding: '20px 24px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.35)', letterSpacing: 2, textTransform: 'uppercase' }}>pokeprices.io</span>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', fontWeight: 700 }}>{today}</span>
        </div>
        <span style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{arrow} Top {movers.length} {direction === 'rising' ? 'Risers' : 'Fallers'}</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>Past {periodLabel} · Raw price movement · Min $20</span>
      </div>

      {/* Column headers */}
      <div style={{ display: 'flex', padding: '8px 20px', borderBottom: `1px solid ${v.br}` }}>
        <span style={{ width: 30, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1 }}>#</span>
        <span style={{ flex: 1, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1 }}>Card</span>
        <span style={{ width: 90, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1 }}>Price</span>
        <span style={{ width: 70, fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'right' }}>Change</span>
      </div>

      {/* Rows */}
      {movers.slice(0, 20).map((m: any, i: number) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '8px 20px', borderBottom: i < movers.length - 1 ? `1px solid ${v.br}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
          <span style={{ width: 30, fontSize: 12, fontWeight: 900, color: v.mu }}>{i + 1}</span>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: v.tx, overflow: 'hidden' }}>{m.card_name.length > 30 ? m.card_name.slice(0, 30) + '…' : m.card_name}</span>
            <span style={{ fontSize: 10, color: v.mu }}>{m.set_name.length > 30 ? m.set_name.slice(0, 30) + '…' : m.set_name}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', width: 90 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: v.tx }}>{fmt(m.current_raw)}</span>
            <span style={{ fontSize: 10, color: v.mu }}>{fmtGbp(m.current_raw)}</span>
          </div>
          <span style={{ width: 70, fontSize: 14, fontWeight: 900, color: accentCol, textAlign: 'right' }}>
            {pctStr(m[col])}
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderTop: `1px solid ${v.br}`, marginTop: 'auto' }}>
        <span style={{ fontSize: 9, color: v.mu }}>Data: PriceCharting</span>
        <span style={{ fontSize: 9, color: v.mu }}>Not financial advice</span>
      </div>
    </div>
  )
}

function renderSetReport(cards: any[], setName: string, v: ReturnType<typeof getTheme>) {
  const total = cards.reduce((s: number, c: any) => s + (c.current_raw || 0), 0)
  const avg30 = cards.filter((c: any) => c.raw_pct_30d != null).reduce((s: number, c: any) => s + c.raw_pct_30d, 0) / Math.max(1, cards.filter((c: any) => c.raw_pct_30d != null).length)
  const top10 = cards.slice(0, 10)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: v.bg, borderRadius: 22, overflow: 'hidden', fontFamily: 'Figtree' }}>
      <div style={{ display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, #0d2b5e, #1a5fad, #2874c8)', padding: '22px 24px 20px' }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: 'rgba(255,255,255,0.4)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>pokeprices.io · Set Performance Report</span>
        <span style={{ fontSize: 26, fontWeight: 900, color: '#fff' }}>{setName}</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>{cards.length} cards tracked</span>
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${v.br}` }}>
        {[
          { label: 'Set Value', val: fmtGbp(total) },
          { label: 'Avg 30d',   val: pctStr(avg30), col: pctColor(avg30) },
          { label: 'Top Card',  val: fmt(top10[0]?.current_raw) },
        ].map((s, i) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '14px 16px', borderRight: i < 2 ? `1px solid ${v.br}` : 'none' }}>
            <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>{s.label}</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: (s as any).col || v.tx }}>{s.val}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 0' }}>
        <span style={{ padding: '0 20px 8px', fontSize: 9, fontWeight: 800, color: v.mu, textTransform: 'uppercase', letterSpacing: 1.5 }}>Top Cards by Value</span>
        {top10.map((c: any, i: number) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '7px 20px', borderBottom: `1px solid ${v.br}` }}>
            <span style={{ fontSize: 9, color: v.mu, fontWeight: 800, width: 20 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: v.tx, overflow: 'hidden' }}>{c.card_name.length > 35 ? c.card_name.slice(0, 35) + '…' : c.card_name}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: v.tx, width: 70, textAlign: 'right' }}>{fmt(c.current_raw)}</span>
            {c.raw_pct_30d != null && (
              <span style={{ fontSize: 11, fontWeight: 800, color: pctColor(c.raw_pct_30d), width: 55, textAlign: 'right' }}>{pctStr(c.raw_pct_30d)}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', borderTop: `1px solid ${v.br}`, marginTop: 'auto' }}>
        <span style={{ fontSize: 9, color: v.mu }}>Data: PriceCharting · pokeprices.io</span>
        <span style={{ fontSize: 9, color: v.mu }}>Not financial advice</span>
      </div>
    </div>
  )
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type      = searchParams.get('type') || 'insight'
  const themeStr  = searchParams.get('theme') || 'dark'
  const cardSlug  = searchParams.get('card')
  const period    = searchParams.get('period') || '30d'
  const direction = searchParams.get('direction') || 'rising'
  const setName   = searchParams.get('set')

  const size = SIZES[type] || SIZES['insight']
  const v = getTheme(themeStr)

  try {
    let content: React.ReactNode = null

    if (type === 'movers') {
      const movers = await getMovers(period, direction)
      content = renderMovers(movers, period, direction, v)

    } else if (type === 'set-report' && setName) {
      const cards = await getSetData(setName)
      content = renderSetReport(cards, setName, v)

    } else if (cardSlug) {
      const card = await getCardData(cardSlug)
      if (!card) return new Response('Card not found', { status: 404 })

      switch (type) {
        case 'insight':
        default:
          content = renderInsightCard(card, v)
          break
        // Additional renders can be added here
      }
    } else {
      return new Response('Missing parameters', { status: 400 })
    }

    return new ImageResponse(content as any, {
      width: size.width,
      height: size.height,
    })

  } catch (err: any) {
    console.error('Studio render error:', err)
    return new Response('Render failed: ' + err.message, { status: 500 })
  }
}