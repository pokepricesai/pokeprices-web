// app/api/studio/og/route.ts
// Generates PNG exports for PokePrices Studio
// Uses next/og which is built into Next.js 13+ — no new packages needed

import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cardSlug  = searchParams.get('card') || ''
  const visual    = searchParams.get('visual') || 'insight'
  const theme     = searchParams.get('theme') || 'dark'
  const ratio     = searchParams.get('ratio') || 'portrait'

  // Fetch card data
  const { data: card } = await supabase
    .from('card_trends')
    .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10, raw_pct_30d, raw_pct_90d, high_12m, drawdown_pct')
    .eq('card_slug', cardSlug)
    .single()

  const { data: cardMeta } = await supabase
    .from('cards')
    .select('image_url')
    .eq('card_slug', cardSlug)
    .single()

  // Dimensions by ratio
  const dims = ratio === 'square'
    ? { width: 800,  height: 800  }
    : ratio === 'landscape'
    ? { width: 1200, height: 675  }
    : { width: 800,  height: 1000 } // portrait

  const dark   = theme === 'dark'
  const bg     = dark ? '#0f1923' : '#ffffff'
  const text   = dark ? '#f1f5f9' : '#0f172a'
  const muted  = dark ? '#64748b' : '#94a3b8'
  const border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const cardName = card?.card_name || 'Unknown Card'
  const setName  = card?.set_name  || ''

  // ── Insight Card visual ──────────────────────────────────────────────────
  if (visual === 'insight' || !['psa-gauge','peak-distance','temperature'].includes(visual)) {
    const signal =
      (card?.raw_pct_30d ?? 0) > 15  ? { label: 'Trending Up', color: '#22c55e' } :
      (card?.raw_pct_30d ?? 0) < -15 ? { label: 'Cooling',     color: '#ef4444' } :
                                        { label: 'Stable',      color: '#f59e0b' }

    const psa10x = card?.current_raw && card?.current_psa10
      ? (card.current_psa10 / card.current_raw).toFixed(1) + 'x raw'
      : null

    const imgOptions = { ...dims, headers: { 'Content-Disposition': `attachment; filename="pokeprices-${cardSlug}-${visual}.png"` } }

  return new ImageResponse(
      <div style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: bg, fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header gradient */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
          padding: '32px 40px 28px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' }}>
              Market Insight
            </span>
            <span style={{ fontSize: 14, fontWeight: 800, color: signal.color, background: 'rgba(0,0,0,0.25)', padding: '4px 14px', borderRadius: 20 }}>
              {signal.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
            {cardMeta?.image_url && (
              <img src={cardMeta.image_url} width={80} height={112} style={{ objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#fff', lineHeight: 1.2 }}>{cardName}</div>
              <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{setName}</div>
            </div>
          </div>
        </div>

        {/* Prices grid */}
        <div style={{
          display: 'flex', padding: '24px 40px',
          borderBottom: `1px solid ${border}`,
          gap: 32,
        }}>
          {[
            { label: 'Raw',    usd: fmt(card?.current_raw),   gbp: fmtGbp(card?.current_raw)   },
            { label: 'PSA 9',  usd: fmt(card?.current_psa9),  gbp: fmtGbp(card?.current_psa9)  },
            { label: 'PSA 10', usd: fmt(card?.current_psa10), gbp: fmtGbp(card?.current_psa10) },
          ].map(p => (
            <div key={p.label} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{p.label}</span>
              <span style={{ fontSize: 22, fontWeight: 900, color: text }}>{p.usd}</span>
              <span style={{ fontSize: 13, color: muted, marginTop: 2 }}>{p.gbp}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', padding: '24px 40px', gap: 32, borderBottom: `1px solid ${border}` }}>
          {[
            { label: '30d Move', val: pct(card?.raw_pct_30d), color: pctColor(card?.raw_pct_30d) },
            { label: '90d Move', val: pct(card?.raw_pct_90d), color: pctColor(card?.raw_pct_90d) },
            ...(psa10x ? [{ label: 'PSA 10 Premium', val: psa10x, color: text }] : []),
            ...(card?.drawdown_pct ? [{ label: 'From Peak', val: pct(card.drawdown_pct), color: pctColor(card.drawdown_pct) }] : []),
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</span>
              <span style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.val}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 40px', marginTop: 'auto' }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: muted }}>pokeprices.io</span>
          <span style={{ fontSize: 12, color: muted }}>Not financial advice</span>
        </div>
      </div>,
      imgOptions
    )
  }

  // ── Temperature visual ────────────────────────────────────────────────────
  if (visual === 'temperature') {
    const score = ((card?.raw_pct_30d ?? 0) * 0.6 + (card?.raw_pct_90d ?? 0) * 0.4)
    const temp =
      score > 30 ? 'Overheated' :
      score > 10 ? 'Hot'        :
      score > 0  ? 'Warming'    :
      score > -10 ? 'Cooling'   : 'Cold'
    const tempColor =
      score > 30 ? '#ef4444' :
      score > 10 ? '#f97316' :
      score > 0  ? '#f59e0b' :
      score > -10 ? '#3b82f6' : '#60a5fa'
    const tempEmoji =
      score > 30 ? '🔥' : score > 10 ? '♨️' : score > 0 ? '↑' : score > -10 ? '↓' : '❄️'

    return new ImageResponse(
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%',
        background: bg, fontFamily: 'system-ui, sans-serif', padding: 60,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: muted, textTransform: 'uppercase', marginBottom: 8 }}>Market Temperature</div>
        <div style={{ fontSize: 28, fontWeight: 900, color: text, marginBottom: 4 }}>{cardName}</div>
        <div style={{ fontSize: 15, color: muted, marginBottom: 48 }}>{setName}</div>
        <div style={{ fontSize: 100, marginBottom: 16 }}>{tempEmoji}</div>
        <div style={{ fontSize: 56, fontWeight: 900, color: tempColor, marginBottom: 8 }}>{temp}</div>
        <div style={{ fontSize: 14, color: muted, marginBottom: 48 }}>Based on 30d + 90d momentum</div>
        <div style={{ display: 'flex', gap: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>30d</span>
            <span style={{ fontSize: 28, fontWeight: 900, color: pctColor(card?.raw_pct_30d) }}>{pct(card?.raw_pct_30d)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>90d</span>
            <span style={{ fontSize: 28, fontWeight: 900, color: pctColor(card?.raw_pct_90d) }}>{pct(card?.raw_pct_90d)}</span>
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 24, fontSize: 14, fontWeight: 800, color: muted }}>pokeprices.io</div>
      </div>,
      imgOptions
    )
  }

  // ── Peak Distance visual ──────────────────────────────────────────────────
  const drawdown = card?.drawdown_pct ?? 0
  const stateLabel = drawdown > -10 ? 'Near Peak' : drawdown > -40 ? 'Recovering' : 'Deeply Off Highs'
  const stateColor = drawdown > -10 ? '#ef4444' : drawdown > -40 ? '#f59e0b' : '#3b82f6'

  return new ImageResponse(
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
      background: bg, fontFamily: 'system-ui, sans-serif', padding: 60,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 3, color: muted, textTransform: 'uppercase', marginBottom: 8 }}>Peak vs Current</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: text, marginBottom: 4 }}>{cardName}</div>
      <div style={{ fontSize: 15, color: muted, marginBottom: 40 }}>{setName}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 24, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>12m Peak</span>
          <span style={{ fontSize: 36, fontWeight: 900, color: text }}>{fmt(card?.high_12m)}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 24, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Drawdown</span>
          <span style={{ fontSize: 48, fontWeight: 900, color: stateColor }}>{pct(drawdown)}</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: stateColor, marginTop: 4 }}>{stateLabel}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: 24, background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', borderRadius: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Current</span>
          <span style={{ fontSize: 36, fontWeight: 900, color: text }}>{fmt(card?.current_raw)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: muted }}>pokeprices.io</span>
        <span style={{ fontSize: 12, color: muted }}>Not financial advice</span>
      </div>
    </div>,
    { ...dims }
  )
}
