// app/browse/BrowsePageClient.tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice } from '@/lib/supabase'

interface SetInfo {
  set_name: string
  card_count: number
  avg_raw_usd: number | null
  set_image_url: string | null
}

type SortOption = 'az' | 'za' | 'price_desc' | 'price_asc' | 'cards_desc'


// ── Set Insights Bar ─────────────────────────────────────────
function SetInsightsBar({ sets }: { sets: SetInfo[] }) {
  if (!sets.length) return null

  const withPrice = sets.filter(s => s.avg_raw_usd && s.avg_raw_usd > 0)

  // Total set value = avg_raw_usd (in cents) * card_count
  const byTotalValue = [...withPrice].sort((a, b) =>
    (b.avg_raw_usd! * b.card_count) - (a.avg_raw_usd! * a.card_count)
  )
  const byAvgPrice = [...withPrice].sort((a, b) => b.avg_raw_usd! - a.avg_raw_usd!)
  const byCardCount = [...sets].sort((a, b) => b.card_count - a.card_count)

  const topValue = byTotalValue[0]
  const topAvg = byAvgPrice[0]
  const biggest = byCardCount[0]

  const totalMarket = withPrice.reduce((sum, s) => sum + (s.avg_raw_usd! * s.card_count), 0)

  const stats = [
    {
      icon: '👑',
      label: 'Most Valuable Set',
      value: topValue?.set_name ?? '—',
      sub: topValue ? `$${((topValue.avg_raw_usd! * topValue.card_count) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })} total raw value` : '',
      href: topValue ? `/set/${encodeURIComponent(topValue.set_name)}` : null,
    },
    {
      icon: '💰',
      label: 'Highest Avg Card Price',
      value: topAvg?.set_name ?? '—',
      sub: topAvg ? `$${(topAvg.avg_raw_usd! / 100).toFixed(2)} avg per card` : '',
      href: topAvg ? `/set/${encodeURIComponent(topAvg.set_name)}` : null,
    },
    {
      icon: '📦',
      label: 'Largest Set',
      value: biggest?.set_name ?? '—',
      sub: biggest ? `${biggest.card_count.toLocaleString()} cards` : '',
      href: biggest ? `/set/${encodeURIComponent(biggest.set_name)}` : null,
    },
    {
      icon: '📊',
      label: 'Total Tracked Value',
      value: `$${(totalMarket / 100 / 1000000).toFixed(1)}M`,
      sub: `across ${withPrice.length} sets`,
      href: null,
    },
  ]

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))',
      border: '1px solid rgba(26,95,173,0.15)',
      borderRadius: 16, padding: '20px 24px', marginBottom: 28,
    }}>
      <p style={{
        fontSize: 11, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase',
        color: 'var(--text-muted)', margin: '0 0 14px', fontFamily: "'Figtree', sans-serif",
      }}>Set Insights</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {stats.map(stat => {
          const inner = (
            <div key={stat.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 16 }}>{stat.icon}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  fontFamily: "'Figtree', sans-serif",
                }}>{stat.label}</span>
              </div>
              <div style={{
                fontSize: 14, fontWeight: 800, color: stat.href ? 'var(--primary)' : 'var(--text)',
                fontFamily: "'Figtree', sans-serif", lineHeight: 1.3,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                {stat.sub}
              </div>
            </div>
          )
          return stat.href ? (
            <Link key={stat.label} href={stat.href} style={{ textDecoration: 'none' }}>
              {inner}
            </Link>
          ) : (
            <div key={stat.label}>{inner}</div>
          )
        })}
      </div>
    </div>
  )
}

export default function BrowsePageClient() {
  const [search, setSearch] = useState('')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('az')

  useEffect(() => {
    async function loadSets() {
      const { data, error } = await supabase.rpc('get_set_list_v2')
      if (data && !error) setSets(data)
      setLoading(false)
    }
    loadSets()
  }, [])

  const filtered = sets
    .filter((s) => s.set_name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      switch (sort) {
        case 'az': return a.set_name.localeCompare(b.set_name)
        case 'za': return b.set_name.localeCompare(a.set_name)
        case 'price_desc': return (b.avg_raw_usd || 0) - (a.avg_raw_usd || 0)
        case 'price_asc': return (a.avg_raw_usd || 0) - (b.avg_raw_usd || 0)
        case 'cards_desc': return b.card_count - a.card_count
        default: return 0
      }
    })

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      <h1 style={{
        fontFamily: "'Playfair Display', serif", fontSize: 30,
        margin: '0 0 6px', color: 'var(--text)',
      }}>Pokemon Card Sets</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 24px', fontFamily: "'Figtree', sans-serif" }}>
        Browse all {sets.length} sets in our database. Click any set to see prices, trends and grading data.
      </p>

      {/* Set Insights Bar */}
      {!loading && <SetInsightsBar sets={sets} />}

      {/* Search + Sort */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sets..."
          style={{
            flex: 1, minWidth: 200, padding: '10px 16px', fontSize: 14,
            border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--card)', color: 'var(--text)',
            fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([
            ['az', 'A-Z'],
            ['za', 'Z-A'],
            ['price_desc', 'Highest Avg'],
            ['price_asc', 'Lowest Avg'],
            ['cards_desc', 'Most Cards'],
          ] as [SortOption, string][]).map(([val, label]) => (
            <button
              key={val}
              className={`sort-btn ${sort === val ? 'active' : ''}`}
              onClick={() => setSort(val)}
              style={{ fontFamily: "'Figtree', sans-serif" }}
            >{label}</button>
          ))}
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
          {filtered.map((s) => (
            <Link
              key={s.set_name}
              href={`/set/${encodeURIComponent(s.set_name)}`}
              className="card-hover holo-shimmer"
              style={{
                background: 'var(--card)', borderRadius: 12,
                border: '1px solid var(--border)', padding: '16px',
                textDecoration: 'none', color: 'var(--text)',
                display: 'flex', gap: 14, alignItems: 'center',
              }}
            >
              {s.set_image_url ? (
                <img src={s.set_image_url} alt={s.set_name} style={{
                  width: 48, height: 67, objectFit: 'contain', borderRadius: 4, flexShrink: 0,
                }} loading="lazy" />
              ) : (
                <div style={{
                  width: 48, height: 67, background: 'var(--bg)', borderRadius: 4,
                  flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, color: 'var(--border)',
                }}>🃏</div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: 14, marginBottom: 3,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  fontFamily: "'Figtree', sans-serif",
                }}>{s.set_name}</div>
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
          ))}
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
