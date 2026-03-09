// app/browse/BrowsePageClient.tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice } from '@/lib/supabase'
import { getSetAssets } from '@/lib/setAssets'

interface SetInfo {
  set_name: string
  card_count: number
  avg_raw_usd: number | null
  set_image_url: string | null
  set_release_date: string | null
}

interface TrendingSet {
  set_name: string
  card_count: number
  avg_raw_usd: number
  total_raw_usd: number
  avg_pct_30d: number
  avg_pct_90d: number
  total_pct_30d: number
  total_pct_90d: number
}

type SortOption = 'release_desc' | 'release_asc' | 'az' | 'za' | 'price_desc' | 'price_asc' | 'cards_desc'

function TrendingRow({ set, isRising }: { set: TrendingSet; isRising: boolean }) {
  const color30 = isRising ? '#22c55e' : '#ef4444'
  const color90 = (set.avg_pct_90d ?? 0) >= 0 ? '#22c55e' : '#ef4444'
  const totalUsd = set.total_raw_usd >= 1000
    ? `$${(set.total_raw_usd / 1000).toFixed(1)}k`
    : `$${set.total_raw_usd.toFixed(0)}`
  const { symbolUrl } = getSetAssets(set.set_name)

  return (
    <Link href={`/set/${encodeURIComponent(set.set_name)}`} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'grid', gridTemplateColumns: '28px 1fr 64px 64px 72px',
          gap: 8, alignItems: 'center', padding: '9px 12px', borderRadius: 10,
          background: 'var(--card)', border: '1px solid var(--border)',
          cursor: 'pointer', transition: 'transform 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = 'translateX(3px)'}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = ''}
      >
        <div style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {symbolUrl
            ? <img src={symbolUrl} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} loading="lazy" />
            : <span style={{ fontSize: 12, color: 'var(--border)' }}>◆</span>}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {set.set_name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {set.card_count} cards · {totalUsd} total
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: color30, fontFamily: "'Figtree', sans-serif" }}>
            {set.avg_pct_30d > 0 ? '+' : ''}{set.avg_pct_30d?.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>avg 30d</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: color90, fontFamily: "'Figtree', sans-serif" }}>
            {(set.avg_pct_90d ?? 0) > 0 ? '+' : ''}{set.avg_pct_90d?.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>avg 90d</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: isRising ? '#22c55e' : '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
            {(set.total_pct_30d ?? 0) > 0 ? '+' : ''}{set.total_pct_30d?.toFixed(1)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>set value</div>
        </div>
      </div>
    </Link>
  )
}

function TrendingSetsPanel({ data }: { data: { rising: TrendingSet[]; falling: TrendingSet[] } }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px', marginBottom: 28 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px', fontFamily: "'Playfair Display', serif", color: 'var(--text)' }}>Set Momentum</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          Which sets are gaining or losing value — averaged across all cards in the set
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#22c55e', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>📈 Gaining</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.rising.map(s => <TrendingRow key={s.set_name} set={s} isRising={true} />)}
            {data.rising.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>No data yet</p>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase', color: '#ef4444', marginBottom: 10, fontFamily: "'Figtree', sans-serif" }}>📉 Cooling</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.falling.map(s => <TrendingRow key={s.set_name} set={s} isRising={false} />)}
            {data.falling.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>No data yet</p>}
          </div>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 0', fontFamily: "'Figtree', sans-serif", borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        Avg % = mean price change across all cards in set with 30d+ history · Set value % = total raw value change
      </p>
    </div>
  )
}

function SetInsightsBar({ sets }: { sets: SetInfo[] }) {
  if (!sets.length) return null
  const withPrice = sets.filter(s => s.avg_raw_usd && s.avg_raw_usd > 0)
  const byTotalValue = [...withPrice].sort((a, b) => (b.avg_raw_usd! * b.card_count) - (a.avg_raw_usd! * a.card_count))
  const byAvgPrice = [...withPrice].sort((a, b) => b.avg_raw_usd! - a.avg_raw_usd!)
  const byCardCount = [...sets].sort((a, b) => b.card_count - a.card_count)
  const topValue = byTotalValue[0]
  const topAvg = byAvgPrice[0]
  const biggest = byCardCount[0]
  const totalMarket = withPrice.reduce((sum, s) => sum + (s.avg_raw_usd! * s.card_count), 0)

  const stats = [
    { icon: '👑', label: 'Most Valuable Set', value: topValue?.set_name ?? '—', sub: topValue ? `$${((topValue.avg_raw_usd! * topValue.card_count) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })} total raw value` : '', href: topValue ? `/set/${encodeURIComponent(topValue.set_name)}` : null },
    { icon: '💰', label: 'Highest Avg Card Price', value: topAvg?.set_name ?? '—', sub: topAvg ? `$${(topAvg.avg_raw_usd! / 100).toFixed(2)} avg per card` : '', href: topAvg ? `/set/${encodeURIComponent(topAvg.set_name)}` : null },
    { icon: '📦', label: 'Largest Set', value: biggest?.set_name ?? '—', sub: biggest ? `${biggest.card_count.toLocaleString()} cards` : '', href: biggest ? `/set/${encodeURIComponent(biggest.set_name)}` : null },
    { icon: '📊', label: 'Total Tracked Value', value: `$${(totalMarket / 100 / 1000000).toFixed(1)}M`, sub: `across ${withPrice.length} sets`, href: null },
  ]

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))', border: '1px solid rgba(26,95,173,0.15)', borderRadius: 16, padding: '20px 24px', marginBottom: 28 }}>
      <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 14px', fontFamily: "'Figtree', sans-serif" }}>Set Insights</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {stats.map(stat => {
          const inner = (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 16 }}>{stat.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: "'Figtree', sans-serif" }}>{stat.label}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: stat.href ? 'var(--primary)' : 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{stat.sub}</div>
            </div>
          )
          return stat.href
            ? <Link key={stat.label} href={stat.href} style={{ textDecoration: 'none' }}>{inner}</Link>
            : <div key={stat.label}>{inner}</div>
        })}
      </div>
    </div>
  )
}

export default function BrowsePageClient() {
  const [search, setSearch] = useState('')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('release_desc')
  const [trendingSets, setTrendingSets] = useState<{ rising: TrendingSet[]; falling: TrendingSet[] } | null>(null)

  useEffect(() => {
    async function loadSets() {
      const [setsRes, trendRes] = await Promise.all([
        supabase.rpc('get_set_list_v2'),
        supabase.rpc('get_trending_sets', { lim: 8 }),
      ])
      if (setsRes.data && !setsRes.error) setSets(setsRes.data)
      if (trendRes.data) {
        const d = trendRes.data
        setTrendingSets({ rising: d.rising ?? [], falling: d.falling ?? [] })
      }
      setLoading(false)
    }
    loadSets()
  }, [])

  const filtered = sets
    .filter(s => s.set_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      switch (sort) {
        case 'release_desc': return new Date(b.set_release_date || '1900-01-01').getTime() - new Date(a.set_release_date || '1900-01-01').getTime()
        case 'release_asc':  return new Date(a.set_release_date || '1900-01-01').getTime() - new Date(b.set_release_date || '1900-01-01').getTime()
        case 'az':           return a.set_name.localeCompare(b.set_name)
        case 'za':           return b.set_name.localeCompare(a.set_name)
        case 'price_desc':   return (b.avg_raw_usd || 0) - (a.avg_raw_usd || 0)
        case 'price_asc':    return (a.avg_raw_usd || 0) - (b.avg_raw_usd || 0)
        case 'cards_desc':   return b.card_count - a.card_count
        default: return 0
      }
    })

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: '0 0 6px', color: 'var(--text)' }}>Pokemon Card Sets</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px', fontFamily: "'Figtree', sans-serif" }}>
        Browse all {sets.length} sets in our database. Click any set to see prices, trends and grading data.
      </p>

      <a href="#set-list" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '6px 16px', textDecoration: 'none', color: 'var(--text)', fontSize: 12, fontFamily: "'Figtree', sans-serif", fontWeight: 600, marginBottom: 28, transition: 'border-color 0.15s' }}
        onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--primary)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)' }}>
        🃏 Jump to Set List
      </a>

      {!loading && trendingSets && (trendingSets.rising.length > 0 || trendingSets.falling.length > 0) && (
        <TrendingSetsPanel data={trendingSets} />
      )}
      {!loading && <SetInsightsBar sets={sets} />}

      <div id="set-list" style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sets..."
          style={{ flex: 1, minWidth: 200, padding: '10px 16px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['release_desc', 'Newest First'], ['release_asc', 'Oldest First'], ['az', 'A-Z'], ['za', 'Z-A'], ['price_desc', 'Highest Avg'], ['price_asc', 'Lowest Avg'], ['cards_desc', 'Most Cards']) && (
            ([
              ['release_desc', 'Newest First'],
              ['release_asc', 'Oldest First'],
              ['az', 'A-Z'],
              ['za', 'Z-A'],
              ['price_desc', 'Highest Avg'],
              ['price_asc', 'Lowest Avg'],
              ['cards_desc', 'Most Cards'],
            ] as [SortOption, string][]).map(([val, label]) => (
              <button key={val} className={`sort-btn ${sort === val ? 'active' : ''}`} onClick={() => setSort(val)} style={{ fontFamily: "'Figtree', sans-serif" }}>{label}</button>
            ))
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 12 }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {filtered.map(s => {
            const { logoUrl, symbolUrl } = getSetAssets(s.set_name)
            // Prefer set logo asset; fall back to a card image from DB; then show symbol or emoji
            const thumbSrc = logoUrl || s.set_image_url

            return (
              <Link
                key={s.set_name}
                href={`/set/${encodeURIComponent(s.set_name)}`}
                className="card-hover holo-shimmer"
                style={{ background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)', padding: '16px', textDecoration: 'none', color: 'var(--text)', display: 'flex', gap: 14, alignItems: 'center' }}
              >
                {/* Thumbnail */}
                <div style={{ flexShrink: 0, width: 72, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {thumbSrc ? (
                    <img src={thumbSrc} alt={s.set_name} style={{ width: 72, height: 52, objectFit: 'contain' }} loading="lazy" />
                  ) : symbolUrl ? (
                    <img src={symbolUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', opacity: 0.6 }} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: 24, color: 'var(--border)' }}>🃏</span>
                  )}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: "'Figtree', sans-serif" }}>
                    {s.set_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>
                    {s.card_count} cards
                  </div>
                  {s.avg_raw_usd !== null && s.avg_raw_usd > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, fontFamily: "'Figtree', sans-serif" }}>
                      Avg: {formatPrice(s.avg_raw_usd)}
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, fontFamily: "'Figtree', sans-serif" }}>
          No sets found matching &ldquo;{search}&rdquo;
        </p>
      )}
    </div>
  )
}
