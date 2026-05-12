'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type HeatmapCard = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  price_usd: number | null
  pct_change: number | null
  color_band: string
  is_recovery: boolean
}

function heatColor(band: string) {
  switch (band) {
    case 'strong_up':   return { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.3)',   text: '#16a34a' }
    case 'up':          return { bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.18)',  text: '#22c55e' }
    case 'strong_down': return { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.3)',   text: '#dc2626' }
    case 'down':        return { bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.18)',  text: '#ef4444' }
    default:            return { bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.18)',text: '#94a3b8' }
  }
}

export default function HeatmapClient() {
  const [heatmap, setHeatmap] = useState<HeatmapCard[]>([])
  const [updated, setUpdated] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res = await supabase.rpc('get_heatmap_top_cards', { lim: 60 })
      const rows = res.data?.results ?? res.data
      if (rows && rows.length > 0) {
        setHeatmap(rows)
        setUpdated(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ marginBottom: 6 }}>
        <Link href="/visualisations" style={{
          fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none',
          textTransform: 'uppercase', letterSpacing: 1.5,
        }}>
          ← All visualisations
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px' }}>
            Market heatmap
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            High-value, actively-traded cards — colour shows 30-day price movement · min 3 confirmed sales
          </p>
        </div>
        {updated && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Updated {updated}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          Loading heatmap…
        </div>
      ) : heatmap.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          No heatmap data available right now.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            {heatmap.map(card => {
              const { bg, border, text } = heatColor(card.color_band)
              return (
                <Link
                  key={card.card_slug}
                  href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug || card.card_slug}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div style={{
                    background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 10px 8px',
                    cursor: 'pointer', transition: 'opacity 0.12s',
                  }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '0.75'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                  >
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 3,
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>
                      {card.card_name}
                    </div>
                    <div style={{
                      fontSize: 10, color: 'var(--text-muted)', marginBottom: 5,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {card.set_name}
                    </div>
                    {card.is_recovery && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', letterSpacing: 0.3, marginBottom: 4 }}>
                        ↩ RECOVERY
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)' }}>
                          {card.price_usd != null ? `$${card.price_usd >= 100 ? Math.round(card.price_usd) : Number(card.price_usd).toFixed(2)}` : '—'}
                        </span>
                        <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', opacity: 0.7, letterSpacing: 0.3 }}>RAW</span>
                      </div>
                      {card.pct_change != null && (
                        <span style={{ fontSize: 12, fontWeight: 800, color: text }}>
                          {card.pct_change > 0 ? '+' : ''}{Number(card.pct_change).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { band: 'strong_up',   label: '+10% or more' },
              { band: 'up',          label: '+2% to +10%'  },
              { band: 'flat',        label: 'Flat (±2%)'   },
              { band: 'down',        label: '-2% to -10%'  },
              { band: 'strong_down', label: '-10% or more' },
            ].map(({ band, label }) => {
              const { bg, border } = heatColor(band)
              return (
                <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${border}` }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
        Built on real sold-listing data — no asking prices, no guesses.
      </p>
    </div>
  )
}
