// app/api/content-studio/render/route.tsx
// 1080x1080 PNG renderer for a single social_content_posts row.
// Dispatches to a per-template Satori JSX block based on template_type.

import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(cents: number | null): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

function pctColor(v: number | null | undefined, fallback: string): string {
  if (v == null) return fallback
  return v > 0 ? '#22c55e' : '#ef4444'
}

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
      b += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
    }
    return `data:${ct};base64,${btoa(b)}`
  } catch { return null }
}

async function loadFont(filename: string): Promise<ArrayBuffer | null> {
  try {
    const u = new URL(`./${filename}`, import.meta.url)
    const r = await fetch(u)
    if (!r.ok) return null
    return await r.arrayBuffer()
  } catch { return null }
}

// Background palette by visual style — kept in sync with src/lib/contentStudio.ts
const PALETTE: Record<string, { bg: string; text: string; muted: string; accent: string; border: string }> = {
  light:  { bg: '#ffffff', text: '#0f172a', muted: '#64748b',          accent: '#1a5fad', border: '#e2e8f0' },
  dark:   { bg: '#0f172a', text: '#f8fafc', muted: '#94a3b8',          accent: '#ffcb05', border: '#1e293b' },
  blue:   { bg: '#1a5fad', text: '#ffffff', muted: 'rgba(255,255,255,0.7)', accent: '#ffcb05', border: 'rgba(255,255,255,0.18)' },
  yellow: { bg: '#ffcb05', text: '#0f172a', muted: 'rgba(15,23,42,0.65)',   accent: '#1a5fad', border: 'rgba(15,23,42,0.12)' },
}

// ── Template: Card Battle ───────────────────────────────────────────────────

async function renderCardBattle(post: any, p: typeof PALETTE['light']): Promise<JSX.Element> {
  const left  = post.data_payload?.left  || {}
  const right = post.data_payload?.right || {}
  const [leftImg, rightImg] = await Promise.all([
    left.image_url  ? toDataUrl(left.image_url)  : null,
    right.image_url ? toDataUrl(right.image_url) : null,
  ])

  const StatRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%' }}>
      <span style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree' }}>{label}</span>
      <span style={{ fontSize: 24, fontWeight: 700, color: color ?? p.text, fontFamily: 'Outfit' }}>{value}</span>
    </div>
  )

  const Side = ({ card, img }: { card: any; img: string | null }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 460, gap: 18 }}>
      {img
        ? <img src={img} width={320} height={448} style={{ borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }} />
        : <div style={{ width: 320, height: 448, background: p.border, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80 }}>🃏</div>}
      <div style={{ fontSize: 26, fontWeight: 700, color: p.text, textAlign: 'center', fontFamily: 'Outfit', lineHeight: 1.1, maxWidth: 420, display: 'flex', justifyContent: 'center' }}>
        {card.card_name}
      </div>
      <div style={{ fontSize: 14, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 2, display: 'flex' }}>
        {card.set_name}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', padding: '0 30px' }}>
        <StatRow label="Raw"   value={fmtUsd(card.raw_usd)} />
        <StatRow label="PSA 10" value={fmtUsd(card.psa10_usd)} color={p.accent} />
        <StatRow label="30d"   value={pct(card.raw_pct_30d)}  color={pctColor(card.raw_pct_30d, p.text)} />
        <StatRow label="1y"    value={pct(card.raw_pct_365d)} color={pctColor(card.raw_pct_365d, p.text)} />
      </div>
    </div>
  )

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: p.accent, fontFamily: 'Figtree', letterSpacing: 2, textTransform: 'uppercase', display: 'flex' }}>
          Card Battle
        </div>
        <div style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>
          PokePrices.io
        </div>
      </div>

      {/* Battle */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 30 }}>
        <Side card={left}  img={leftImg} />
        <div style={{ fontSize: 90, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', display: 'flex' }}>
          VS
        </div>
        <Side card={right} img={rightImg} />
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Which are you taking?'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Market Mover ──────────────────────────────────────────────────

async function renderMarketMover(post: any, p: typeof PALETTE['light']): Promise<JSX.Element> {
  const card = post.data_payload?.card || {}
  const img  = card.image_url ? await toDataUrl(card.image_url) : null
  const move = post.data_payload?.move_pct as number | undefined
  const windowLabel: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year' }
  const wl = windowLabel[post.data_payload?.time_window || '30d']
  const moveText = move != null ? `${move > 0 ? '+' : ''}${move.toFixed(0)}%` : '—'

  const TimeStat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 140 }}>
      <span style={{ fontSize: 38, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', display: 'flex' }}>{value}</span>
      <span style={{ fontSize: 16, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex' }}>{label}</span>
    </div>
  )

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: p.accent, fontFamily: 'Figtree', letterSpacing: 2, textTransform: 'uppercase', display: 'flex' }}>
          Market Mover
        </div>
        <div style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>
          PokePrices.io
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 50, marginTop: 30 }}>
        {img
          ? <img src={img} width={360} height={504} style={{ borderRadius: 14, boxShadow: '0 18px 60px rgba(0,0,0,0.28)', flexShrink: 0 }} />
          : <div style={{ width: 360, height: 504, background: p.border, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100, flexShrink: 0 }}>🃏</div>}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 30, fontWeight: 700, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 2, display: 'flex' }}>
            {wl}
          </div>
          <div style={{ fontSize: 140, fontWeight: 900, color: pctColor(move ?? null, p.accent), fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>
            {moveText}
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: p.text, fontFamily: 'Outfit', maxWidth: 540, lineHeight: 1.2, display: 'flex' }}>
            {card.card_name}
          </div>
          <div style={{ fontSize: 20, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>
            {card.set_name}  ·  raw {fmtUsd(card.raw_usd)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: 30 }}>
        <TimeStat label="7d"  value={pct(card.raw_pct_7d)} />
        <TimeStat label="30d" value={pct(card.raw_pct_30d)} />
        <TimeStat label="90d" value={pct(card.raw_pct_90d)} />
        <TimeStat label="1y"  value={pct(card.raw_pct_365d)} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Still room to run?'}
        </div>
      </div>
    </div>
  )
}

// ── Main route handler ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('Missing id', { status: 400 })

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)
  const { data: post, error } = await supabase
    .from('social_content_posts').select('*').eq('id', id).maybeSingle()

  if (error || !post) return new Response('Post not found', { status: 404 })

  const style = post.generated_options?.visual_style || 'light'
  const p = PALETTE[style] || PALETTE.light

  let element: JSX.Element
  try {
    if (post.template_type === 'card_battle')        element = await renderCardBattle(post, p)
    else if (post.template_type === 'market_mover')  element = await renderMarketMover(post, p)
    else return new Response(`Template '${post.template_type}' has no PNG renderer yet`, { status: 400 })
  } catch (e: any) {
    return new Response(`Render error: ${e?.message || e}`, { status: 500 })
  }

  const [figtree, outfit, outfitBlack] = await Promise.all([
    loadFont('figtree-700.ttf'),
    loadFont('outfit-700.ttf'),
    loadFont('outfit-900.ttf'),
  ])
  const fonts: any[] = []
  if (figtree)     fonts.push({ name: 'Figtree', data: figtree,     weight: 700, style: 'normal' })
  if (outfit)      fonts.push({ name: 'Outfit',  data: outfit,      weight: 700, style: 'normal' })
  if (outfitBlack) fonts.push({ name: 'Outfit',  data: outfitBlack, weight: 900, style: 'normal' })

  return new ImageResponse(element, { width: 1080, height: 1080, fonts })
}
