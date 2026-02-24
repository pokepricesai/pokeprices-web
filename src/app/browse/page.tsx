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

export default function BrowsePage() {
  const [search, setSearch] = useState('')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('az')

  useEffect(() => {
    async function loadSets() {
      const { data, error } = await supabase.rpc('get_set_list_v2')
      if (data && !error) {
        setSets(data)
      }
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
        fontFamily: "'DM Serif Display', serif", fontSize: 30,
        margin: '0 0 6px', color: 'var(--text)',
      }}>Cards & Sets</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 24px' }}>
        Browse all {sets.length} sets in our database. Click any set to see its cards.
      </p>

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
            fontFamily: 'inherit', outline: 'none',
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
            >{label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
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
              {/* Set image thumbnail */}
              {s.set_image_url ? (
                <img src={s.set_image_url} alt="" style={{
                  width: 48, height: 67, objectFit: 'contain', borderRadius: 4,
                  flexShrink: 0,
                }} />
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
                }}>{s.set_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                  {s.card_count} cards
                </div>
                {s.avg_raw_usd !== null && s.avg_raw_usd > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>
                    Avg: {formatPrice(s.avg_raw_usd)}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          No sets found matching &ldquo;{search}&rdquo;
        </p>
      )}
    </div>
  )
}
