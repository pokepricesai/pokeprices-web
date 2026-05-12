'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Period = '30d' | '90d' | '365d'

type Mover = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_price: number // USD (already converted by RPC variants below)
  pct_change: number
  volume_label?: string | null
}

// Sealed-product noise filter — same patterns used elsewhere in the app.
const SEALED = [/booster box/i, /booster pack/i, /elite trainer/i, /\betb\b/i, /collection box/i, /\btin\b/i, /topps/i, /display box/i, /stadium/i, /build.*battle/i]

async function fetchMovers(direction: 'rising' | 'falling', period: Period): Promise<Mover[]> {
  const fnName = direction === 'rising' ? 'get_top_risers_filtered' : 'get_top_fallers'
  const { data } = await supabase.rpc(fnName, { time_period: period, min_price: 3000 })
  if (!data) return []
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const results: any[] = parsed?.results || []

  const filtered = results
    .filter(r => !SEALED.some(p => p.test(r.card_name || '') || p.test(r.set_name || '')))
    .slice(0, 20)

  const slugs = filtered.map((r: any) => r.card_slug).filter(Boolean)
  if (!slugs.length) return []

  const [{ data: imgData }, { data: volData }] = await Promise.all([
    supabase.from('cards').select('card_slug,image_url,card_url_slug').in('card_slug', slugs),
    supabase.from('card_volume').select('card_slug,volume_label,confidence').in('card_slug', slugs).eq('grade', 'Ungraded'),
  ])
  const imgMap: Record<string, any> = {}
  ;(imgData || []).forEach((c: any) => { imgMap[String(c.card_slug)] = c })
  const volMap: Record<string, any> = {}
  ;(volData || []).forEach((v: any) => { volMap[String(v.card_slug)] = v })

  return filtered.map((r: any) => {
    const rawPct = r.pct_30d ?? r.pct_change ?? 0
    return {
      card_slug:     r.card_slug,
      card_name:     r.card_name,
      set_name:      r.set_name,
      card_url_slug: imgMap[r.card_slug]?.card_url_slug ?? null,
      image_url:     imgMap[r.card_slug]?.image_url ?? null,
      current_price: r.current_price ?? r.current_raw ?? 0,
      pct_change:    direction === 'rising' ? rawPct : -Math.abs(rawPct),
      volume_label:  volMap[r.card_slug]?.volume_label ?? null,
    } as Mover
  })
}

function fmtUsd(cents: number): string {
  const d = cents / 100
  if (d >= 1000) return `$${d.toFixed(0)}`
  if (d >= 100)  return `$${d.toFixed(0)}`
  return `$${d.toFixed(2)}`
}

function periodLabel(p: Period): string {
  return p === '30d' ? '30 days' : p === '90d' ? '90 days' : '365 days'
}

export default function RisersFallersClient() {
  const [period, setPeriod] = useState<Period>('30d')
  const [risers, setRisers] = useState<Mover[]>([])
  const [fallers, setFallers] = useState<Mover[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let cancelled = false
    Promise.all([fetchMovers('rising', period), fetchMovers('falling', period)])
      .then(([r, f]) => {
        if (cancelled) return
        setRisers(r)
        setFallers(f)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [period])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <Link href="/visualisations" style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none',
        textTransform: 'uppercase', letterSpacing: 1.5,
      }}>
        ← All visualisations
      </Link>

      <div style={{ marginTop: 12, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px' }}>
            Risers & Fallers
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            The biggest sold-listing moves over the last {periodLabel(period)} · min price $30 · sealed product filtered out
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border)' }}>
          {(['30d', '90d', '365d'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: '6px 12px', borderRadius: 9,
                border: 'none',
                background: period === p ? 'var(--card)' : 'transparent',
                color: period === p ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 800, cursor: 'pointer',
                fontFamily: "'Figtree', sans-serif",
                boxShadow: period === p ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <Leaderboard title="Top Risers" emoji="📈" tone="up"   rows={risers}  loading={loading} />
        <Leaderboard title="Top Fallers" emoji="📉" tone="down" rows={fallers} loading={loading} />
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
        Built on real sold-listing data — no asking prices, no guesses. Cards with very low recent volume are filtered out.
      </p>
    </div>
  )
}

function Leaderboard({ title, emoji, tone, rows, loading }: {
  title: string; emoji: string; tone: 'up' | 'down'; rows: Mover[]; loading: boolean
}) {
  const accent = tone === 'up' ? '#22c55e' : '#ef4444'
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0 }}>{title}</h2>
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton" style={{ height: 64, borderRadius: 12 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          No volume-verified moves for this period yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((row, idx) => (
            <Link key={row.card_slug}
              href={`/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug || row.card_slug}`}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '10px 12px', transition: 'transform 0.12s, border-color 0.12s',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-1px)'; el.style.borderColor = accent }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = 'var(--border)' }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', width: 18, textAlign: 'center', flexShrink: 0 }}>
                  {idx + 1}
                </div>
                {row.image_url ? (
                  <img src={row.image_url} alt="" style={{ width: 36, height: 50, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 36, height: 50, background: 'var(--bg-light)', borderRadius: 3, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.card_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                    {row.set_name}
                    {row.volume_label ? <span style={{ marginLeft: 6, color: 'var(--primary)' }}>· {row.volume_label}</span> : null}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                    {fmtUsd(row.current_price)}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: accent, marginTop: 1 }}>
                    {row.pct_change > 0 ? '+' : ''}{row.pct_change.toFixed(1)}%
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
