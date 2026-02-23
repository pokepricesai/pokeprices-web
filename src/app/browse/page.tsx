'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice } from '@/lib/supabase'

interface SetInfo {
  set_name: string
  card_count: number
  avg_price: number | null
}

export default function BrowsePage() {
  const [search, setSearch] = useState('')
  const [sets, setSets] = useState<SetInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSets() {
      const { data } = await supabase
        .from('cards')
        .select('set_name')
      if (data) {
        const counts: Record<string, number> = {}
        data.forEach((row: any) => {
          counts[row.set_name] = (counts[row.set_name] || 0) + 1
        })
        const setList = Object.entries(counts)
          .map(([name, count]) => ({ set_name: name, card_count: count, avg_price: null }))
          .sort((a, b) => a.set_name.localeCompare(b.set_name))
        setSets(setList)
      }
      setLoading(false)
    }
    loadSets()
  }, [])

  const filtered = sets.filter((s) =>
    s.set_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 32,
        margin: '0 0 8px', color: 'var(--text)',
      }}>Cards & Sets</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 28px' }}>
        Browse all 156 sets in our database. Click any set to see its cards.
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search sets..."
        style={{
          width: '100%', padding: '12px 18px', fontSize: 15,
          border: '1px solid var(--border)', borderRadius: 10,
          background: 'var(--card)', color: 'var(--text)',
          fontFamily: 'inherit', marginBottom: 24, outline: 'none',
        }}
      />

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading sets...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map((s) => (
            <Link
              key={s.set_name}
              href={`/set/${encodeURIComponent(s.set_name)}`}
              style={{
                background: 'var(--card)', borderRadius: 12,
                border: '1px solid var(--border)', padding: '18px 20px',
                textDecoration: 'none', color: 'var(--text)',
                transition: 'box-shadow 0.2s, transform 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                (e.currentTarget as HTMLElement).style.transform = 'none';
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{s.set_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{s.card_count} cards</div>
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
