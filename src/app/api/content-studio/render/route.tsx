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

const GBP_RATE = 0.79

function fmtUsd(cents: number | null): string {
  if (!cents || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${Math.round(v).toLocaleString('en-US')}`
  return `$${v.toFixed(2)}`
}

function fmtGbp(cents: number | null): string {
  if (!cents || cents <= 0) return ''
  const v = (cents / 100) * GBP_RATE
  if (v >= 1000) return `£${Math.round(v).toLocaleString('en-GB')}`
  return `£${v.toFixed(0)}`
}

// Combined display: "$X (£Y)" — used across every template.
function fmtPrice(cents: number | null): string {
  if (!cents || cents <= 0) return '—'
  const gbp = fmtGbp(cents)
  return gbp ? `${fmtUsd(cents)} (${gbp})` : fmtUsd(cents)
}

// "123/165" when set has a printed total > 1, else "#123" — same logic
// used on the live card pages (formatCardNumber helper).
function fmtCardNumber(num: any, display: any, total: any): string {
  const t = total ? Number(total) : 0
  if (display && t > 1) return String(display)
  if (num != null && num !== '') return `#${num}`
  return ''
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

// Layered patterns for backgrounds. Small dots (24px) + wider soft circles
// (96px) layered with radial highlights. Two intensities — DARK is used on
// light backgrounds, LIGHT on dark / blue.
const DOTS_DARK = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="2" cy="2" r="1" fill="rgba(15,23,42,0.10)"/></svg>`
)}`
const DOTS_LIGHT = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="2" cy="2" r="1" fill="rgba(255,255,255,0.12)"/></svg>`
)}`
const RINGS_DARK = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="28" fill="none" stroke="rgba(15,23,42,0.05)" stroke-width="1"/></svg>`
)}`
const RINGS_LIGHT = `data:image/svg+xml;base64,${btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="28" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/></svg>`
)}`

// Background palette by visual style. Layers (front to back):
//   1. small dot grid
//   2. softer wider ring pattern
//   3. radial accent highlight (top right)
//   4. base linear gradient
const PALETTE: Record<string, { bg: string; text: string; muted: string; accent: string; border: string; tileBg: string }> = {
  light: {
    bg: `url("${DOTS_DARK}"), url("${RINGS_DARK}"), radial-gradient(circle at 78% -10%, rgba(26,95,173,0.14), transparent 50%), radial-gradient(circle at 0% 100%, rgba(255,203,5,0.08), transparent 45%), linear-gradient(135deg, #ffffff 0%, #eef3fa 100%)`,
    text: '#0f172a', muted: '#64748b', accent: '#1a5fad', border: '#e2e8f0',
    tileBg: 'rgba(15,23,42,0.04)',
  },
  dark: {
    bg: `url("${DOTS_LIGHT}"), url("${RINGS_LIGHT}"), radial-gradient(circle at 78% -10%, rgba(255,203,5,0.14), transparent 50%), radial-gradient(circle at 0% 100%, rgba(26,95,173,0.20), transparent 45%), linear-gradient(160deg, #0f172a 0%, #1e293b 100%)`,
    text: '#f8fafc', muted: '#94a3b8', accent: '#ffcb05', border: '#1e293b',
    tileBg: 'rgba(255,255,255,0.06)',
  },
  blue: {
    bg: `url("${DOTS_LIGHT}"), url("${RINGS_LIGHT}"), radial-gradient(circle at 78% -10%, rgba(255,203,5,0.20), transparent 50%), linear-gradient(160deg, #1a5fad 0%, #2874c8 100%)`,
    text: '#ffffff', muted: 'rgba(255,255,255,0.75)', accent: '#ffcb05', border: 'rgba(255,255,255,0.18)',
    tileBg: 'rgba(255,255,255,0.08)',
  },
  yellow: {
    bg: `url("${DOTS_DARK}"), url("${RINGS_DARK}"), radial-gradient(circle at 78% -10%, rgba(26,95,173,0.18), transparent 50%), linear-gradient(135deg, #ffcb05 0%, #ffd84a 100%)`,
    text: '#0f172a', muted: 'rgba(15,23,42,0.7)', accent: '#1a5fad', border: 'rgba(15,23,42,0.12)',
    tileBg: 'rgba(15,23,42,0.06)',
  },
}

// Set logo lookup. Most sets follow "${set_name}.webp"; a few have exception
// filenames that don't match the DB set_name 1:1.
const SET_LOGO_OVERRIDES: Record<string, string> = {
  'Neo Revelation':         'Neo Revelatio.webp',
  'Fire Red & Leaf Green':  'FireRed & LeafGreen.webp',
  'Team Magma & Team Aqua': 'Team Magma vs Team Aqua.webp',
}
async function fetchSetLogo(setName: string | null | undefined, origin: string): Promise<string | null> {
  if (!setName) return null
  const file = SET_LOGO_OVERRIDES[setName] || `${setName}.webp`
  return await toDataUrl(`${origin}/set-assets/logos/${encodeURIComponent(file)}`)
}

// Logo cached at module scope — single fetch per cold start.
let cachedLogoUrl: string | null | undefined = undefined
async function getLogoDataUrl(): Promise<string | null> {
  if (cachedLogoUrl !== undefined) return cachedLogoUrl
  try {
    const u = new URL('./logo.png', import.meta.url)
    const r = await fetch(u)
    if (!r.ok) { cachedLogoUrl = null; return null }
    const buf = await r.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let b = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      b += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
    }
    cachedLogoUrl = `data:image/png;base64,${btoa(b)}`
    return cachedLogoUrl
  } catch { cachedLogoUrl = null; return null }
}

// Top-of-card header used by every template — kind label on the left,
// favicon + brand on the right.
function TemplateHeader({ kind, p, logo }: { kind: string; p: typeof PALETTE['light']; logo: string | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: p.accent, fontFamily: 'Figtree', letterSpacing: 2, textTransform: 'uppercase', display: 'flex' }}>
        {kind}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {logo && <img src={logo} width={26} height={26} style={{ borderRadius: 6 }} />}
        <div style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>PokePrices.io</div>
      </div>
    </div>
  )
}

// Small "verified by X sales" pill that surfaces volume on a tile.
function VolumePill({ sales, p }: { sales: number; p: typeof PALETTE['light'] }) {
  if (!sales || sales < 1) return null
  const label = sales >= 100 ? `${sales}+ sales / 30d` : `${sales} sales / 30d`
  return (
    <span style={{
      fontSize: 13, fontWeight: 700, color: p.accent,
      background: p.bg === 'linear-gradient(135deg, #ffcb05 0%, #ffd84a 100%)' ? 'rgba(15,23,42,0.10)' : 'rgba(26,95,173,0.10)',
      padding: '3px 10px', borderRadius: 14, fontFamily: 'Figtree',
      letterSpacing: 0.6, textTransform: 'uppercase', display: 'flex',
    }}>{label}</span>
  )
}

// ── Template: Card Battle ───────────────────────────────────────────────────

async function renderCardBattle(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const left  = post.data_payload?.left  || {}
  const right = post.data_payload?.right || {}
  const [leftImg, rightImg] = await Promise.all([
    left.image_url  ? toDataUrl(left.image_url)  : null,
    right.image_url ? toDataUrl(right.image_url) : null,
  ])

  const StatRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%' }}>
      <span style={{ fontSize: 17, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>{label}</span>
      <span style={{ fontSize: 19, fontWeight: 700, color: color ?? p.text, fontFamily: 'Outfit', display: 'flex' }}>{value}</span>
    </div>
  )

  // Equal-width sides + fixed-width centre keeps the VS dead-centre regardless
  // of card name length.
  const Side = ({ card, img }: { card: any; img: string | null }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minWidth: 0 }}>
      {img
        ? <img src={img} width={300} height={420} style={{ objectFit: 'contain', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }} />
        : <div style={{ width: 300, height: 420, background: p.border, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80 }}>🃏</div>}
      <div style={{ fontSize: 24, fontWeight: 700, color: p.text, textAlign: 'center', fontFamily: 'Outfit', lineHeight: 1.1, maxWidth: 380, display: 'flex', justifyContent: 'center' }}>
        {card.card_name} {fmtCardNumber(card.card_number, card.card_number_display, card.set_printed_total)}
      </div>
      <div style={{ fontSize: 13, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex', textAlign: 'center' }}>
        {card.set_name}
      </div>
      {card.sales_30d > 0 && <VolumePill sales={card.sales_30d} p={p} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', padding: '0 24px', marginTop: 4 }}>
        <StatRow label="Raw"    value={fmtPrice(card.raw_usd)} />
        <StatRow label="PSA 10" value={fmtPrice(card.psa10_usd)} color={p.accent} />
        <StatRow label="30d"    value={pct(card.raw_pct_30d)}  color={pctColor(card.raw_pct_30d, p.text)} />
        <StatRow label="1y"     value={pct(card.raw_pct_365d)} color={pctColor(card.raw_pct_365d, p.text)} />
      </div>
    </div>
  )

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Card Battle" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', marginTop: 24 }}>
        <Side card={left}  img={leftImg} />
        <div style={{ width: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 96, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>VS</div>
        </div>
        <Side card={right} img={rightImg} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Which are you taking?'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Market Mover ──────────────────────────────────────────────────

async function renderMarketMover(post: any, p: typeof PALETTE['light'], logo: string | null, origin: string): Promise<JSX.Element> {
  const card = post.data_payload?.card || {}
  const [img, setLogo] = await Promise.all([
    card.image_url ? toDataUrl(card.image_url) : null,
    fetchSetLogo(card.set_name, origin),
  ])
  const move = post.data_payload?.move_pct as number | undefined
  const windowLabel: Record<string, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', '1y': '1 year' }
  const wl = windowLabel[post.data_payload?.time_window || '30d']
  const moveText = move != null ? `${move > 0 ? '+' : ''}${move.toFixed(0)}%` : '—'
  const numberLabel = fmtCardNumber(card.card_number, card.card_number_display, card.set_printed_total)

  const TimeStat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
      <span style={{ fontSize: 36, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', display: 'flex' }}>{value}</span>
      <span style={{ fontSize: 15, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex' }}>{label}</span>
    </div>
  )

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Market Mover" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, marginTop: 24 }}>
        {img
          ? <img src={img} width={340} height={476} style={{ objectFit: 'contain', borderRadius: 14, boxShadow: '0 18px 60px rgba(0,0,0,0.28)', flexShrink: 0 }} />
          : <div style={{ width: 340, height: 476, background: p.border, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100, flexShrink: 0 }}>🃏</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center', maxWidth: 560 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 2, display: 'flex' }}>
            {wl}
          </div>
          <div style={{ fontSize: 130, fontWeight: 900, color: pctColor(move ?? null, p.accent), fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>
            {moveText}
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, color: p.text, fontFamily: 'Outfit', lineHeight: 1.2, display: 'flex' }}>
            {card.card_name} {numberLabel}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {setLogo && <img src={setLogo} height={28} style={{ objectFit: 'contain', maxWidth: 120 }} />}
            <span style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>
              {card.set_name}  ·  Raw {fmtPrice(card.raw_usd)}
            </span>
          </div>
          {card.sales_30d > 0 && (
            <div style={{ display: 'flex', marginTop: 4 }}>
              <VolumePill sales={card.sales_30d} p={p} />
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', marginBottom: 24 }}>
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

// ── Template: Grading Gap ───────────────────────────────────────────────────

async function renderGradingGap(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const card = post.data_payload?.card || {}
  const img = card.image_url ? await toDataUrl(card.image_url) : null
  const grades: Record<string, number> = card.grades || {}
  const entries = Object.entries(grades).filter(([_, v]) => v != null && v > 0).slice(0, 8)
  const biggestTop    = post.data_payload?.biggest_gap?.top
  const biggestBottom = post.data_payload?.biggest_gap?.bottom

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Grading Gap" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 50, marginTop: 30 }}>
        {img
          ? <img src={img} width={360} height={504} style={{ objectFit: 'contain', borderRadius: 14, boxShadow: '0 18px 60px rgba(0,0,0,0.28)', flexShrink: 0 }} />
          : <div style={{ width: 360, height: 504, background: p.border, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100, flexShrink: 0 }}>🃏</div>}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: p.text, fontFamily: 'Outfit', lineHeight: 1.1, maxWidth: 560, display: 'flex' }}>
            {card.card_name} {fmtCardNumber(card.card_number, card.card_number_display, card.set_printed_total)}
          </div>
          <div style={{ fontSize: 16, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6, display: 'flex' }}>
            {card.set_name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {entries.map(([label, value]) => {
              const isHighlight = label === biggestTop || label === biggestBottom
              return (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '8px 14px', borderRadius: 8,
                  background: isHighlight ? (p.accent === '#ffcb05' ? 'rgba(255,203,5,0.15)' : 'rgba(26,95,173,0.1)') : 'transparent',
                  border: isHighlight ? `1px solid ${p.accent}` : `1px solid ${p.border}`,
                }}>
                  <span style={{ fontSize: 18, color: isHighlight ? p.accent : p.muted, fontFamily: 'Figtree', fontWeight: 700, display: 'flex' }}>{label}</span>
                  <span style={{ fontSize: 22, color: isHighlight ? p.accent : p.text, fontFamily: 'Outfit', fontWeight: 700, display: 'flex' }}>{fmtPrice(value as number)}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', maxWidth: 980, lineHeight: 1.15, display: 'flex' }}>
          {post.hook || 'Which grade would you buy?'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Then vs Now ───────────────────────────────────────────────────

async function renderThenVsNow(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const card = post.data_payload?.card || {}
  const img = card.image_url ? await toDataUrl(card.image_url) : null
  const monthYear = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  }
  const growth = card.growth_pct as number | null
  const growthText = growth != null ? `${growth > 0 ? '+' : ''}${growth.toFixed(0)}%` : '—'

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Then vs Now" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 20 }}>
        {img
          ? <img src={img} width={270} height={378} style={{ objectFit: 'contain', borderRadius: 14, boxShadow: '0 18px 60px rgba(0,0,0,0.28)' }} />
          : <div style={{ width: 270, height: 378, background: p.border, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100 }}>🃏</div>}

        <div style={{ fontSize: 28, fontWeight: 700, color: p.text, fontFamily: 'Outfit', textAlign: 'center', maxWidth: 800, display: 'flex' }}>
          {card.card_name} {fmtCardNumber(card.card_number, card.card_number_display, card.set_printed_total)}
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 32, marginTop: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: p.muted, fontFamily: 'Outfit', textTransform: 'uppercase', letterSpacing: 3, display: 'flex' }}>
              {monthYear(card.then_date)}
            </span>
            <span style={{ fontSize: 56, fontWeight: 900, color: p.text, fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>{fmtUsd(card.then_price)}</span>
            {card.then_price != null && (
              <span style={{ fontSize: 18, fontWeight: 700, color: p.muted, fontFamily: 'Outfit', display: 'flex' }}>{fmtGbp(card.then_price)}</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{
              fontSize: 36, fontWeight: 900, color: p.accent, fontFamily: 'Outfit',
              padding: '4px 14px', border: `3px solid ${p.accent}`, borderRadius: 14,
              letterSpacing: 2, display: 'flex',
            }}>VS NOW</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: p.accent, fontFamily: 'Outfit', textTransform: 'uppercase', letterSpacing: 3, display: 'flex' }}>
              {monthYear(card.now_date)}
            </span>
            <span style={{ fontSize: 56, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>{fmtUsd(card.now_price)}</span>
            {card.now_price != null && (
              <span style={{ fontSize: 18, fontWeight: 700, color: p.muted, fontFamily: 'Outfit', display: 'flex' }}>{fmtGbp(card.now_price)}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4 }}>
          <div style={{ fontSize: 64, fontWeight: 900, color: pctColor(growth, p.accent), fontFamily: 'Outfit', display: 'flex' }}>
            {growthText}
          </div>
          {card.sales_30d > 0 && <VolumePill sales={card.sales_30d} p={p} />}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
        <div style={{ fontSize: 36, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Would you have held?'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Budget Builder ────────────────────────────────────────────────

async function renderBudgetBuilder(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const cards = (post.data_payload?.cards || []) as any[]
  // Read either new USD or legacy GBP field for backwards compat with old posts
  const budget = post.data_payload?.budget_usd ?? (post.data_payload?.budget_gbp != null ? Math.round(post.data_payload.budget_gbp / 0.79) : null)
  const total = post.data_payload?.total_raw_usd_cents
  const images = await Promise.all(cards.map(c => c.image_url ? toDataUrl(c.image_url) : null))

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Budget Builder" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, marginTop: 10 }}>
        <div style={{ fontSize: 86, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', lineHeight: 1, display: 'flex' }}>
          ${budget}
        </div>
        <div style={{ fontSize: 24, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 2, display: 'flex' }}>
          What are you buying?
        </div>

        {/* 2x2 grid */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center', maxWidth: 820 }}>
          {cards.slice(0, 4).map((c, i) => (
            <div key={i} style={{ width: 380, display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: p.tileBg, borderRadius: 12, border: `1px solid ${p.border}` }}>
              {images[i]
                ? <img src={images[i] as string} width={70} height={98} style={{ objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
                : <div style={{ width: 70, height: 98, background: p.border, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 30 }}>🃏</div>}
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: p.text, fontFamily: 'Outfit', lineHeight: 1.2, display: 'flex' }}>
                  {c.card_name} {fmtCardNumber(c.card_number, c.card_number_display, c.set_printed_total)}
                </div>
                <div style={{ fontSize: 12, color: p.muted, fontFamily: 'Figtree', marginTop: 2, display: 'flex' }}>{c.set_name}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: p.accent, fontFamily: 'Outfit', marginTop: 4, display: 'flex' }}>{fmtUsd(c.raw_usd)} <span style={{ fontSize: 13, color: p.muted, fontWeight: 600, marginLeft: 6, display: 'flex' }}>{fmtGbp(c.raw_usd)}</span></div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 16, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>
          Total: {fmtPrice(total)} raw · pick your four
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Pick your four.'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Collector Pulse ───────────────────────────────────────────────

async function renderCollectorPulse(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const cards = (post.data_payload?.cards || []) as any[]
  const images = await Promise.all(cards.slice(0, 5).map(c => c.image_url ? toDataUrl(c.image_url) : null))
  const wt = (post.data_payload?.time_window || '7d') as string
  const windowLabel: Record<string, string> = { '7d': 'This week', '30d': 'This month', '90d': 'This quarter', '1y': 'This year' }

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      <TemplateHeader kind="Collector Pulse" p={p} logo={logo} />

      <div style={{ marginTop: 22, marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ fontSize: 30, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 2, display: 'flex' }}>
          {windowLabel[wt] || 'Trending'}
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, color: p.text, fontFamily: 'Outfit', lineHeight: 1.05, textAlign: 'center', marginTop: 6, display: 'flex' }}>
          What collectors are watching
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
        {cards.slice(0, 5).map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '14px 20px', background: p.tileBg, border: `1px solid ${p.border}`, borderRadius: 14 }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: p.muted, fontFamily: 'Outfit', width: 50, display: 'flex' }}>{i + 1}</div>
            {images[i]
              ? <img src={images[i] as string} width={66} height={92} style={{ objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
              : <div style={{ width: 66, height: 92, background: p.border, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🃏</div>}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: p.text, fontFamily: 'Outfit', display: 'flex' }}>
                {c.card_name} {fmtCardNumber(c.card_number, c.card_number_display, c.set_printed_total)}
              </div>
              <div style={{ fontSize: 14, color: p.muted, fontFamily: 'Figtree', marginTop: 2, display: 'flex' }}>{c.set_name}</div>
              {c.sales_30d > 0 && (
                <div style={{ fontSize: 11, color: p.accent, fontFamily: 'Figtree', marginTop: 3, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', display: 'flex' }}>
                  {c.sales_30d}+ sales / 30d
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              <span style={{ fontSize: 26, fontWeight: 900, color: pctColor(c.pct_change, p.accent), fontFamily: 'Outfit', display: 'flex' }}>{pct(c.pct_change)}</span>
              <span style={{ fontSize: 14, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>{fmtUsd(c.raw_usd)} <span style={{ marginLeft: 4, display: 'flex' }}>{fmtGbp(c.raw_usd)}</span></span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
        <div style={{ fontSize: 30, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'What are collectors watching?'}
        </div>
      </div>
    </div>
  )
}

// ── Type colour palette for Pokémon Battle / Guess the Pokémon ─────────────

const TYPE_COLOURS: Record<string, string> = {
  normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C',
  grass: '#7AC74C',  ice: '#96D9D6',  fighting: '#C22E28', poison: '#A33EA1',
  ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
  rock: '#B6A136',  ghost: '#735797', dragon: '#6F35FC', dark: '#705746',
  steel: '#B7B7CE', fairy: '#D685AD',
}

function typeChipBg(t: string): string { return TYPE_COLOURS[t] || '#94a3b8' }

// ── Template: Pokémon Battle ────────────────────────────────────────────────

async function renderPokemonBattle(post: any, p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const L = post.data_payload?.left  || {}
  const R = post.data_payload?.right || {}
  const lProb = post.data_payload?.left_prob ?? 50
  const rProb = post.data_payload?.right_prob ?? 50
  const [lImg, rImg] = await Promise.all([
    L.sprite ? toDataUrl(L.sprite) : null,
    R.sprite ? toDataUrl(R.sprite) : null,
  ])

  const TypeChip = ({ t }: { t: string }) => (
    <span style={{
      fontSize: 14, fontWeight: 700, color: '#fff', textTransform: 'uppercase',
      letterSpacing: 1, padding: '4px 12px', borderRadius: 14,
      background: typeChipBg(t), fontFamily: 'Figtree', display: 'flex',
    }}>{t}</span>
  )

  const StatBar = ({ label, value }: { label: string; value: number }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <span style={{ fontSize: 14, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1, display: 'flex' }}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: p.text, fontFamily: 'Outfit', display: 'flex' }}>{value}</span>
      </div>
      <div style={{ width: '100%', height: 6, background: p.border, borderRadius: 3, display: 'flex' }}>
        <div style={{ width: `${Math.min(100, (value / 200) * 100)}%`, height: 6, background: p.accent, borderRadius: 3 }} />
      </div>
    </div>
  )

  const Side = ({ poke, img }: { poke: any; img: string | null }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 460, gap: 14 }}>
      {img
        ? <img src={img} width={280} height={280} style={{ objectFit: 'contain' }} />
        : <div style={{ width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 100 }}>?</div>}
      <div style={{ fontSize: 30, fontWeight: 800, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
        {poke.name}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        {(poke.types || []).map((t: string) => <TypeChip key={t} t={t} />)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', padding: '0 30px' }}>
        <StatBar label="HP"  value={poke.stats?.hp ?? 0} />
        <StatBar label="Atk" value={poke.stats?.attack ?? 0} />
        <StatBar label="Def" value={poke.stats?.defense ?? 0} />
        <StatBar label="SpA" value={poke.stats?.['special-attack'] ?? 0} />
        <StatBar label="SpD" value={poke.stats?.['special-defense'] ?? 0} />
        <StatBar label="Spe" value={poke.stats?.speed ?? 0} />
      </div>
      <div style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex' }}>
        Total: <span style={{ color: p.text, fontWeight: 700, marginLeft: 6, display: 'flex' }}>{poke.total ?? '—'}</span>
      </div>
    </div>
  )

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '50px 40px' }}>
      <TemplateHeader kind="Pokémon Battle" p={p} logo={logo} />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <Side poke={L} img={lImg} />
        <div style={{ fontSize: 90, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', display: 'flex' }}>VS</div>
        <Side poke={R} img={rImg} />
      </div>

      {/* Probability split */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, width: '100%' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: p.text, fontFamily: 'Outfit', width: 60, textAlign: 'right', display: 'flex', justifyContent: 'flex-end' }}>{lProb}%</span>
        <div style={{ flex: 1, height: 10, borderRadius: 5, background: p.border, display: 'flex', overflow: 'hidden' }}>
          <div style={{ width: `${lProb}%`, height: '100%', background: p.accent }} />
          <div style={{ width: `${rProb}%`, height: '100%', background: p.muted, opacity: 0.6 }} />
        </div>
        <span style={{ fontSize: 18, fontWeight: 800, color: p.text, fontFamily: 'Outfit', width: 60, display: 'flex' }}>{rProb}%</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
        <div style={{ fontSize: 38, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Who wins?'}
        </div>
      </div>
    </div>
  )
}

// ── Template: Guess the Pokémon ─────────────────────────────────────────────

async function renderGuessThePokemon(post: any, _p: typeof PALETTE['light'], logo: string | null): Promise<JSX.Element> {
  const poke = post.data_payload?.pokemon || {}
  const clues: string[] = post.data_payload?.clues || []
  const difficulty = post.data_payload?.difficulty || 'silhouette'
  const img = poke.sprite ? await toDataUrl(poke.sprite) : null

  // Classic anime "Who's That Pokémon?" palette. Overrides the chosen
  // visual_style — this look is iconic and worth being canonical.
  const p = {
    bg: `radial-gradient(circle at 50% 38%, #fff8db 0%, #ffd84a 38%, #f59e0b 72%, #d97706 100%)`,
    text: '#1c2024',
    muted: 'rgba(28,32,36,0.7)',
    accent: '#1a5fad',
    border: 'rgba(28,32,36,0.18)',
    tileBg: 'rgba(255,255,255,0.55)',
  }

  const imgStyle: React.CSSProperties = difficulty === 'silhouette'
    ? { filter: 'brightness(0)', objectFit: 'contain' }
    : { filter: 'blur(28px)', objectFit: 'contain' }

  return (
    <div style={{ width: 1080, height: 1080, background: p.bg, display: 'flex', flexDirection: 'column', padding: '60px 50px' }}>
      {/* Custom header — the iconic anime title is the kind label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: p.text, fontFamily: 'Outfit', letterSpacing: 1, textTransform: 'uppercase', display: 'flex' }}>
          Who&apos;s That Pokémon?
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {logo && <img src={logo} width={26} height={26} style={{ borderRadius: 6 }} />}
          <div style={{ fontSize: 18, color: p.muted, fontFamily: 'Figtree', display: 'flex' }}>PokePrices.io</div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginTop: 20, marginBottom: 14 }}>
        {/* Soft cream halo behind the silhouette */}
        <div style={{
          position: 'absolute', width: 720, height: 720, borderRadius: 360,
          background: 'radial-gradient(circle, rgba(255,253,232,0.95) 0%, rgba(255,253,232,0.6) 50%, transparent 75%)',
          display: 'flex',
        }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {img
            ? <img src={img} width={560} height={560} style={imgStyle} />
            : <div style={{ width: 560, height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 220 }}>?</div>}
          <div style={{
            position: 'absolute', fontSize: 360, fontWeight: 900,
            color: '#1c2024', fontFamily: 'Outfit', opacity: 0.10, lineHeight: 1,
            display: 'flex',
          }}>?</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', marginBottom: 18 }}>
        {clues.slice(0, 3).map((c, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '10px 22px',
            background: p.tileBg,
            border: `1px solid ${p.border}`, borderRadius: 16, minWidth: 500,
          }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: p.accent, fontFamily: 'Outfit', width: 28, display: 'flex' }}>{i + 1}</span>
            <span style={{ fontSize: 20, fontWeight: 600, color: p.text, fontFamily: 'Figtree', display: 'flex' }}>{c}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 900, color: p.text, fontFamily: 'Outfit', textAlign: 'center', display: 'flex' }}>
          {post.hook || 'Who is it?'}
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

  const logo = await getLogoDataUrl()
  const origin = req.nextUrl.origin
  let element: JSX.Element
  try {
    if (post.template_type === 'card_battle')        element = await renderCardBattle(post, p, logo)
    else if (post.template_type === 'market_mover')  element = await renderMarketMover(post, p, logo, origin)
    else if (post.template_type === 'grading_gap')   element = await renderGradingGap(post, p, logo)
    else if (post.template_type === 'then_vs_now')   element = await renderThenVsNow(post, p, logo)
    else if (post.template_type === 'budget_builder') element = await renderBudgetBuilder(post, p, logo)
    else if (post.template_type === 'collector_pulse') element = await renderCollectorPulse(post, p, logo)
    else if (post.template_type === 'pokemon_battle')   element = await renderPokemonBattle(post, p, logo)
    else if (post.template_type === 'guess_the_pokemon') element = await renderGuessThePokemon(post, p, logo)
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
