// app/api/newsletter/render/route.tsx
//
// Satori-rendered weekly-newsletter infographics. One endpoint, several
// section templates (intro / movers / fallers / insight / grading / focus /
// trending). All 1200×675, matched colour palette, PokePrices footer.

import { ImageResponse } from '@vercel/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ── Edge-safe utilities (no Buffer) ──────────────────────────────────────

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || 'image/jpeg'
    if (ct.includes('webp')) return null   // Satori cannot render webp; fail soft
    const bytes = new Uint8Array(buf)
    let b = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      b += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)))
    }
    return `data:${ct};base64,${btoa(b)}`
  } catch {
    return null
  }
}

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

function fmtCents(cents: number, includeFractional = false): string {
  if (cents == null) return '—'
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}k`
  if (d >= 100) return `$${Math.round(d).toLocaleString('en-US')}`
  return includeFractional ? `$${d.toFixed(2)}` : `$${Math.round(d)}`
}

function fmtPctSigned(v: number | null): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`
}

// ── Section-shared chrome ────────────────────────────────────────────────

const W = 1200
const H = 675
const BG = '#0d1520'
const PANEL = 'rgba(255,255,255,0.05)'
const TX = '#f1f5f9'
const MU = '#94a3b8'
const PRIMARY = '#1a5fad'
const ACCENT = '#ffcb05'
const GREEN = '#22c55e'
const RED = '#ef4444'

type FooterProps = { weekLabel: string; subline?: string }
function Footer({ weekLabel, subline }: FooterProps) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '18px 50px', borderTop: '1px solid rgba(255,255,255,0.10)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 14, background: PRIMARY, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 12, height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.92)' }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: TX, fontFamily: 'Figtree', letterSpacing: 0.5 }}>PokePrices.io</div>
          <div style={{ fontSize: 11, color: MU, fontFamily: 'Figtree', letterSpacing: 1.4, textTransform: 'uppercase' }}>{subline || 'Free · No login'}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: MU, fontFamily: 'Figtree', letterSpacing: 1.2, textTransform: 'uppercase' }}>{weekLabel}</div>
    </div>
  )
}

function SectionBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start',
      background: `${accent}22`, color: accent,
      padding: '8px 18px', borderRadius: 24,
      fontSize: 14, fontWeight: 700, fontFamily: 'Figtree',
      letterSpacing: 2, textTransform: 'uppercase',
      border: `1px solid ${accent}44`,
    }}>
      {label}
    </div>
  )
}

// ── Templates ────────────────────────────────────────────────────────────

function IntroTemplate({ totalMarketUsd, cardsTracked, pct30d, weekLabel }: {
  totalMarketUsd: number; cardsTracked: number; pct30d: number | null; weekLabel: string
}) {
  const up = (pct30d ?? 0) >= 0
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '54px 50px 32px', display: 'flex', flexDirection: 'column' }}>
        <SectionBadge label="Weekly Digest" accent={PRIMARY} />
        <div style={{ fontFamily: 'Outfit', fontSize: 64, fontWeight: 900, lineHeight: 1.05, marginTop: 24, letterSpacing: -1 }}>
          The market this week.
        </div>

        <div style={{ display: 'flex', gap: 24, marginTop: 40 }}>
          {/* Big market value */}
          <div style={{ flex: 1, background: PANEL, borderRadius: 22, padding: '24px 28px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 13, color: MU, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 }}>Market Tracked</div>
            <div style={{ fontFamily: 'Outfit', fontSize: 52, fontWeight: 900, marginTop: 6, letterSpacing: -1.2 }}>{fmtCents(totalMarketUsd)}</div>
            <div style={{ fontSize: 14, color: MU, marginTop: 4 }}>
              Across {cardsTracked > 0 ? cardsTracked.toLocaleString('en-US') : 'tens of thousands of'} cards
            </div>
          </div>

          {/* 30d direction */}
          <div style={{ flex: 1, background: PANEL, borderRadius: 22, padding: '24px 28px', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 13, color: MU, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 }}>30-Day Move</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 6 }}>
              <div style={{ fontFamily: 'Outfit', fontSize: 52, fontWeight: 900, color: up ? GREEN : RED, letterSpacing: -1.2 }}>
                {fmtPctSigned(pct30d)}
              </div>
            </div>
            <div style={{ fontSize: 14, color: MU, marginTop: 4 }}>{up ? 'Net positive' : 'Cooling pattern'}</div>
          </div>
        </div>
      </div>
      <Footer weekLabel={weekLabel} />
    </div>
  )
}

function MoversTemplate({ direction, items, weekLabel }: {
  direction: 'rising' | 'falling';
  items: { card_name: string; set_name: string; current_price: number; pct_change: number; image_url: string | null }[];
  weekLabel: string
}) {
  const top = items.slice(0, 5)
  const accent = direction === 'rising' ? GREEN : RED
  const titleLabel = direction === 'rising' ? 'Top Risers' : 'Top Fallers'
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '40px 50px 24px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionBadge label={`${titleLabel} · 30d`} accent={accent} />
          <div style={{ fontSize: 13, color: MU, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 }}>Min $30 · Sealed filtered</div>
        </div>
        <div style={{ fontFamily: 'Outfit', fontSize: 44, fontWeight: 900, lineHeight: 1.05, marginTop: 20, letterSpacing: -0.8 }}>
          {direction === 'rising' ? 'Where the money flowed' : 'Where it bled out'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
          {top.map((r, i) => {
            const sign = r.pct_change >= 0 ? '+' : ''
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 18,
                background: PANEL, borderRadius: 14, padding: '12px 18px',
                border: '1px solid rgba(255,255,255,0.07)',
              }}>
                <div style={{ width: 28, fontSize: 18, fontWeight: 900, color: MU, fontFamily: 'Outfit' }}>{i + 1}</div>
                {r.image_url ? (
                  <img src={r.image_url} alt="" width={44} height={62} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 4 }} />
                ) : (
                  <div style={{ width: 44, height: 62, background: 'rgba(255,255,255,0.06)', borderRadius: 4 }} />
                )}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Figtree', color: TX }}>{r.card_name}</div>
                  <div style={{ fontSize: 13, color: MU, fontFamily: 'Figtree' }}>{r.set_name}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 900, color: TX, letterSpacing: -0.4 }}>{fmtCents(r.current_price)}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: accent, fontFamily: 'Figtree', letterSpacing: 0.3 }}>{sign}{r.pct_change.toFixed(1)}%</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <Footer weekLabel={weekLabel} subline={direction === 'rising' ? 'Risers · 30 days' : 'Fallers · 30 days'} />
    </div>
  )
}

function InsightTemplate({ text, weekLabel }: { text: string; weekLabel: string }) {
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '60px 60px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <SectionBadge label="Market Insight" accent={ACCENT} />
        <div style={{
          fontFamily: 'Outfit', fontSize: 38, fontWeight: 900, lineHeight: 1.25, marginTop: 28,
          letterSpacing: -0.5, color: TX, maxWidth: 1080,
        }}>
          “{text}”
        </div>
        <div style={{ fontSize: 14, color: MU, marginTop: 32, fontFamily: 'Figtree', letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 700 }}>
          Derived from live PokePrices data
        </div>
      </div>
      <Footer weekLabel={weekLabel} subline="Market insight" />
    </div>
  )
}

function GradingTemplate({ card, weekLabel }: {
  card: { card_name: string; set_name: string; current_raw: number; current_psa10: number; premium_multiple: number; image_url: string | null }
  weekLabel: string
}) {
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '50px 50px 32px', display: 'flex', flexDirection: 'row', gap: 40, alignItems: 'center' }}>
        {/* Card image side */}
        <div style={{ width: 280, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} width={280} height={392}
              style={{ width: 280, height: 392, objectFit: 'contain', borderRadius: 10 }} />
          ) : (
            <div style={{ width: 280, height: 392, background: PANEL, borderRadius: 10 }} />
          )}
        </div>

        {/* Stats side */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <SectionBadge label="Grading Watch" accent="#a78bfa" />
          <div style={{ fontFamily: 'Outfit', fontSize: 40, fontWeight: 900, marginTop: 20, lineHeight: 1.1, letterSpacing: -0.8 }}>
            {card.card_name}
          </div>
          <div style={{ fontSize: 18, color: MU, marginTop: 6, fontFamily: 'Figtree' }}>{card.set_name}</div>

          <div style={{ display: 'flex', gap: 18, marginTop: 32 }}>
            <div style={{ flex: 1, background: PANEL, borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 12, color: MU, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 }}>Raw</div>
              <div style={{ fontFamily: 'Outfit', fontSize: 36, fontWeight: 900, color: TX, marginTop: 4, letterSpacing: -0.8 }}>{fmtCents(card.current_raw)}</div>
            </div>
            <div style={{ flex: 1, background: PANEL, borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 12, color: MU, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700 }}>PSA 10</div>
              <div style={{ fontFamily: 'Outfit', fontSize: 36, fontWeight: 900, color: TX, marginTop: 4, letterSpacing: -0.8 }}>{fmtCents(card.current_psa10)}</div>
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 22,
            background: `${ACCENT}18`, padding: '14px 22px', borderRadius: 14,
            border: `1px solid ${ACCENT}44`, alignSelf: 'flex-start',
          }}>
            <div style={{ fontFamily: 'Outfit', fontSize: 28, fontWeight: 900, color: ACCENT, letterSpacing: -0.5 }}>{card.premium_multiple.toFixed(1)}×</div>
            <div style={{ fontSize: 14, color: TX, fontFamily: 'Figtree', letterSpacing: 0.4, textTransform: 'uppercase', fontWeight: 700 }}>PSA 10 premium</div>
          </div>
        </div>
      </div>
      <Footer weekLabel={weekLabel} subline="Grade play of the week" />
    </div>
  )
}

function FocusTemplate({ card, weekLabel }: {
  card: { card_name: string; set_name: string; current_price: number; pct_30d: number | null; psa10_pop: number; image_url: string | null }
  weekLabel: string
}) {
  const up = (card.pct_30d ?? 0) >= 0
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '50px 50px 32px', display: 'flex', flexDirection: 'row', gap: 40, alignItems: 'center' }}>
        <div style={{ width: 280, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} width={280} height={392}
              style={{ width: 280, height: 392, objectFit: 'contain', borderRadius: 10 }} />
          ) : (
            <div style={{ width: 280, height: 392, background: PANEL, borderRadius: 10 }} />
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <SectionBadge label="Collector Focus" accent="#ec4899" />
          <div style={{ fontFamily: 'Outfit', fontSize: 44, fontWeight: 900, marginTop: 20, lineHeight: 1.05, letterSpacing: -1 }}>
            {card.card_name}
          </div>
          <div style={{ fontSize: 18, color: MU, marginTop: 6, fontFamily: 'Figtree' }}>{card.set_name}</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 36 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
              <div style={{ fontFamily: 'Outfit', fontSize: 54, fontWeight: 900, color: TX, letterSpacing: -1.2 }}>{fmtCents(card.current_price)}</div>
              {card.pct_30d != null && (
                <div style={{ fontSize: 22, fontWeight: 800, color: up ? GREEN : RED, fontFamily: 'Outfit', letterSpacing: -0.4 }}>{fmtPctSigned(card.pct_30d)}</div>
              )}
            </div>
            <div style={{ fontSize: 16, color: MU, fontFamily: 'Figtree' }}>
              Raw price · 30-day change
            </div>
            {card.psa10_pop > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <div style={{ background: PANEL, padding: '6px 14px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: TX, fontFamily: 'Figtree' }}>PSA 10 pop {card.psa10_pop}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer weekLabel={weekLabel} subline="Quiet rise · small pop" />
    </div>
  )
}

function TrendingTemplate({ sets, weekLabel }: {
  sets: { set_name: string; avg_pct_30d: number; card_count: number }[]
  weekLabel: string
}) {
  const top = sets.slice(0, 5)
  const maxPct = top.length > 0 ? Math.max(...top.map(s => Math.abs(s.avg_pct_30d)), 1) : 1
  return (
    <div style={{ width: W, height: H, display: 'flex', flexDirection: 'column', background: BG, color: TX, fontFamily: 'Figtree' }}>
      <div style={{ flex: 1, padding: '40px 50px 24px', display: 'flex', flexDirection: 'column' }}>
        <SectionBadge label="Trending Sets · 30d" accent="#0ea5e9" />
        <div style={{ fontFamily: 'Outfit', fontSize: 44, fontWeight: 900, lineHeight: 1.05, marginTop: 20, letterSpacing: -0.8 }}>
          What collectors circled.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32 }}>
          {top.map((s, i) => {
            const widthPct = Math.max(8, (Math.abs(s.avg_pct_30d) / maxPct) * 100)
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: MU, fontFamily: 'Outfit', width: 28 }}>{i + 1}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Figtree', color: TX }}>{s.set_name}</div>
                    <div style={{ fontSize: 13, color: MU, fontFamily: 'Figtree' }}>· {s.card_count} cards</div>
                  </div>
                  <div style={{ fontFamily: 'Outfit', fontSize: 22, fontWeight: 900, color: s.avg_pct_30d >= 0 ? GREEN : RED, letterSpacing: -0.4 }}>
                    {fmtPctSigned(s.avg_pct_30d)}
                  </div>
                </div>
                <div style={{ height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${widthPct}%`, height: '100%', background: s.avg_pct_30d >= 0 ? GREEN : RED, borderRadius: 4 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <Footer weekLabel={weekLabel} subline="Top set momentum" />
    </div>
  )
}

// ── Route handler ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { template, payload, weekLabel = 'This week' } = body || {}

    // Load fonts
    const [outfitHeavy, outfitBold, figtreeReg] = await Promise.all([
      loadFont('outfit-900.ttf'),
      loadFont('outfit-700.ttf'),
      loadFont('figtree-700.ttf'),
    ])
    const fonts: any[] = []
    if (outfitHeavy) fonts.push({ name: 'Outfit',  data: outfitHeavy, weight: 900, style: 'normal' })
    if (outfitBold)  fonts.push({ name: 'Outfit',  data: outfitBold,  weight: 700, style: 'normal' })
    if (figtreeReg)  fonts.push({ name: 'Figtree', data: figtreeReg,  weight: 700, style: 'normal' })

    let element: React.ReactElement

    switch (template) {
      case 'intro': {
        element = <IntroTemplate
          totalMarketUsd={payload.totalMarketUsd}
          cardsTracked={payload.cardsTracked}
          pct30d={payload.pct30d}
          weekLabel={weekLabel}
        />
        break
      }
      case 'movers':
      case 'fallers': {
        // Pre-fetch images for top items
        const rows = (payload.items || []).slice(0, 5)
        const hydrated = await Promise.all(rows.map(async (r: any) => ({
          ...r,
          image_url: r.image_url ? await toDataUrl(r.image_url) : null,
        })))
        element = <MoversTemplate
          direction={template === 'movers' ? 'rising' : 'falling'}
          items={hydrated}
          weekLabel={weekLabel}
        />
        break
      }
      case 'insight': {
        element = <InsightTemplate text={payload.text} weekLabel={weekLabel} />
        break
      }
      case 'grading': {
        const card = payload.card
        const imgDataUrl = card.image_url ? await toDataUrl(card.image_url) : null
        element = <GradingTemplate card={{ ...card, image_url: imgDataUrl }} weekLabel={weekLabel} />
        break
      }
      case 'focus': {
        const card = payload.card
        const imgDataUrl = card.image_url ? await toDataUrl(card.image_url) : null
        element = <FocusTemplate card={{ ...card, image_url: imgDataUrl }} weekLabel={weekLabel} />
        break
      }
      case 'trending': {
        element = <TrendingTemplate sets={payload.sets || []} weekLabel={weekLabel} />
        break
      }
      default:
        return new Response(JSON.stringify({ error: 'Unknown template' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
    }

    return new ImageResponse(element, { width: W, height: H, fonts })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Render failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
}
