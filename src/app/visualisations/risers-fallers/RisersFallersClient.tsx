'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Period = '7d' | '30d' | '90d' | '365d'

type Mover = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  image_url: string | null
  current_price: number   // cents
  pct_change: number
  volume_label?: string | null
}

type SetMover = {
  set_name: string
  card_count: number
  avg_pct_30d: number
  avg_pct_90d: number
  total_pct_30d: number
  total_pct_90d: number
  avg_raw_usd: number     // cents
  total_raw_usd: number   // cents
}

// Sealed-product noise filter — these patterns are how we identify sealed
// products in the card list. Switching the boolean flips the filter from
// "card singles only" → "sealed only".
const SEALED_PATTERNS = [
  /booster box/i, /booster pack/i, /elite trainer/i, /\betb\b/i,
  /collection box/i, /\btin\b/i, /topps/i, /display box/i,
  /stadium/i, /build.*battle/i,
]
function isSealed(name: string, setName: string) {
  return SEALED_PATTERNS.some(p => p.test(name || '') || p.test(setName || ''))
}

async function fetchMovers(direction: 'rising' | 'falling', period: Period, mode: 'singles' | 'sealed'): Promise<Mover[]> {
  const fnName = direction === 'rising' ? 'get_top_risers_filtered' : 'get_top_fallers'
  const { data } = await supabase.rpc(fnName, { time_period: period, min_price: 3000 })
  if (!data) return []
  const parsed = typeof data === 'string' ? JSON.parse(data) : data
  const results: any[] = parsed?.results || []

  const filtered = results
    .filter(r => mode === 'sealed' ? isSealed(r.card_name, r.set_name) : !isSealed(r.card_name, r.set_name))
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
    // The RPC parameterises by time_period; pct_change is the period-specific
    // value. pct_30d is the fallback snapshot column the older code path used.
    const rawPct = r.pct_change ?? r.pct_30d ?? 0
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

async function fetchSetMovers(): Promise<{ rising: SetMover[]; falling: SetMover[] }> {
  const { data } = await supabase.rpc('get_trending_sets', { lim: 8 })
  return {
    rising: (data?.rising ?? []) as SetMover[],
    falling: (data?.falling ?? []) as SetMover[],
  }
}

function fmtUsd(cents: number): string {
  const d = cents / 100
  if (d >= 1000) return `$${d.toFixed(0)}`
  if (d >= 100)  return `$${d.toFixed(0)}`
  return `$${d.toFixed(2)}`
}

function periodLabel(p: Period): string {
  return p === '7d' ? '7 days' : p === '30d' ? '30 days' : p === '90d' ? '90 days' : '365 days'
}

export default function RisersFallersClient() {
  const [period, setPeriod] = useState<Period>('30d')

  const [singlesRisers, setSinglesRisers]   = useState<Mover[]>([])
  const [singlesFallers, setSinglesFallers] = useState<Mover[]>([])
  const [sealedRisers, setSealedRisers]     = useState<Mover[]>([])
  const [sealedFallers, setSealedFallers]   = useState<Mover[]>([])
  const [setRisers, setSetRisers]           = useState<SetMover[]>([])
  const [setFallers, setSetFallers]         = useState<SetMover[]>([])
  const [loadingCards,  setLoadingCards]  = useState(true)
  const [loadingSealed, setLoadingSealed] = useState(true)
  const [loadingSets,   setLoadingSets]   = useState(true)

  // Cards + sealed re-fetch when the period changes
  useEffect(() => {
    setLoadingCards(true)
    setLoadingSealed(true)
    let cancelled = false
    Promise.all([
      fetchMovers('rising',  period, 'singles'),
      fetchMovers('falling', period, 'singles'),
    ]).then(([r, f]) => {
      if (cancelled) return
      setSinglesRisers(r); setSinglesFallers(f); setLoadingCards(false)
    })
    Promise.all([
      fetchMovers('rising',  period, 'sealed'),
      fetchMovers('falling', period, 'sealed'),
    ]).then(([r, f]) => {
      if (cancelled) return
      setSealedRisers(r); setSealedFallers(f); setLoadingSealed(false)
    })
    return () => { cancelled = true }
  }, [period])

  // Sets only load once — RPC is 30d/90d fixed, doesn't follow the toggle
  useEffect(() => {
    let cancelled = false
    fetchSetMovers().then(d => {
      if (cancelled) return
      setSetRisers(d.rising); setSetFallers(d.falling); setLoadingSets(false)
    })
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <Link href="/visualisations" style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textDecoration: 'none',
        textTransform: 'uppercase', letterSpacing: 1.5,
      }}>
        ← All visualisations
      </Link>

      {/* Header */}
      <div style={{ marginTop: 12, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px' }}>
            Risers & Fallers
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            The biggest sold-listing moves over the last {periodLabel(period)}
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border)' }}>
          {(['7d', '30d', '90d', '365d'] as Period[]).map(p => (
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

      {/* Quality-filter notice */}
      <div style={{
        background: 'rgba(26,95,173,0.06)', border: '1px solid rgba(26,95,173,0.18)', borderRadius: 12,
        padding: '10px 14px', marginBottom: 26,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 16 }}>✓</span>
        <p style={{ fontSize: 12.5, color: 'var(--text)', margin: 0, lineHeight: 1.55, flex: 1, minWidth: 200 }}>
          <strong>Filtered for high sales quality.</strong> We only include cards with confirmed multi-sale volume in the period. Low-traffic listings and asking-price noise are excluded — every move you see is backed by real, repeated sold listings.
        </p>
      </div>

      {/* CARDS */}
      <SectionHeader title="Card Singles" subtitle={`Most-traded singles · 30-day, 90-day or 365-day window`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginBottom: 36 }}>
        <Leaderboard title="Top Risers" emoji="📈" tone="up"   rows={singlesRisers}  loading={loadingCards} />
        <Leaderboard title="Top Fallers" emoji="📉" tone="down" rows={singlesFallers} loading={loadingCards} />
      </div>

      {/* SEALED */}
      <SectionHeader title="Sealed Product" subtitle="Booster boxes, ETBs, tins, collections and bundle products" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginBottom: 36 }}>
        <Leaderboard title="Top Risers" emoji="📦" tone="up"   rows={sealedRisers}  loading={loadingSealed} />
        <Leaderboard title="Top Fallers" emoji="📦" tone="down" rows={sealedFallers} loading={loadingSealed} />
      </div>

      {/* SETS */}
      <SectionHeader title="Sets" subtitle="Average single-card movement across each set's tracked cards · 30-day window" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        <SetLeaderboard title="Top Risers" emoji="🧩" tone="up"   rows={setRisers}  loading={loadingSets} />
        <SetLeaderboard title="Top Fallers" emoji="🧩" tone="down" rows={setFallers} loading={loadingSets} />
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 36, lineHeight: 1.6 }}>
        Built on real sold-listing data — no asking prices, no guesses.
      </p>
    </div>
  )
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 2px' }}>{title}</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>
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
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: 0 }}>{title}</h3>
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

function SetLeaderboard({ title, emoji, tone, rows, loading }: {
  title: string; emoji: string; tone: 'up' | 'down'; rows: SetMover[]; loading: boolean
}) {
  const accent = tone === 'up' ? '#22c55e' : '#ef4444'
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: 0 }}>{title}</h3>
      </div>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton" style={{ height: 60, borderRadius: 12 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
          No set-level moves for this period yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.slice(0, 8).map((row, idx) => (
            <Link key={row.set_name}
              href={`/set/${encodeURIComponent(row.set_name)}`}
              style={{ textDecoration: 'none' }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                padding: '10px 14px', transition: 'transform 0.12s, border-color 0.12s',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-1px)'; el.style.borderColor = accent }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.borderColor = 'var(--border)' }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', width: 18, textAlign: 'center', flexShrink: 0 }}>
                  {idx + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.set_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {row.card_count} cards tracked
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                    {fmtUsd(row.avg_raw_usd)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    avg single
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: accent }}>
                    {row.avg_pct_30d > 0 ? '+' : ''}{row.avg_pct_30d.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 1 }}>
                    30d avg
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
