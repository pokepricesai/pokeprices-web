'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatPrice } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  raw_usd: number | null
  psa10_usd: number | null
  psa9_usd: number | null
  image_url: string | null
}

type SortField = 'raw' | 'psa10' | 'psa9' | 'name'

export default function SetPage() {
  const params = useParams()
  const setName = decodeURIComponent(params.slug as string)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortField>('raw')

  useEffect(() => {
    async function loadCards() {
      const { data } = await supabase.rpc('get_set_cards', { set_text: setName })
      if (data) setCards(data)
      setLoading(false)
    }
    loadCards()
  }, [setName])

  const sorted = [...cards].sort((a, b) => {
    if (sortBy === 'name') return (a.card_name || '').localeCompare(b.card_name || '')
    const field = sortBy === 'raw' ? 'raw_usd' : sortBy === 'psa10' ? 'psa10_usd' : 'psa9_usd'
    return (b[field] || 0) - (a[field] || 0)
  })

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <Link href="/browse" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
        ← Back to sets
      </Link>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 32,
        margin: '8px 0', color: 'var(--text)',
      }}>{setName}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
        {cards.length} cards & sealed products
      </p>

      {/* Chat */}
      <div style={{ marginBottom: 28 }}>
        <InlineChat />
      </div>

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginRight: 4 }}>Sort by:</span>
        {([
          { key: 'raw', label: 'Raw Price' },
          { key: 'psa10', label: 'PSA 10' },
          { key: 'psa9', label: 'PSA 9' },
          { key: 'name', label: 'Name' },
        ] as { key: SortField; label: string }[]).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSortBy(opt.key)}
            style={{
              background: sortBy === opt.key ? 'var(--primary)' : 'var(--card)',
              color: sortBy === opt.key ? '#fff' : 'var(--text)',
              border: `1px solid ${sortBy === opt.key ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 8, padding: '6px 14px', fontSize: 13,
              fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
          >{opt.label}</button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading cards...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {sorted.map((c) => (
            <Link
              key={c.card_slug}
              href={`/card/${c.card_slug}`}
              style={{
                background: 'var(--card)', borderRadius: 12,
                border: '1px solid var(--border)', padding: 16,
                textDecoration: 'none', color: 'var(--text)',
                transition: 'box-shadow 0.2s, transform 0.2s',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
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
              {c.image_url ? (
                <img src={c.image_url} alt={c.card_name} style={{
                  width: 120, height: 168, objectFit: 'contain', marginBottom: 10, borderRadius: 6,
                }} />
              ) : (
                <div style={{
                  width: 120, height: 168, background: '#f4f1ec', borderRadius: 6,
                  marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: 'var(--text-muted)',
                }}>No image</div>
              )}
              <div style={{ fontWeight: 600, fontSize: 14, textAlign: 'center', marginBottom: 4, lineHeight: 1.3 }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Raw: {formatPrice(c.raw_usd)}
              </div>
              {c.psa9_usd && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  PSA 9: {formatPrice(c.psa9_usd)}
                </div>
              )}
              {c.psa10_usd && (
                <div style={{ fontSize: 12, color: 'var(--accent)' }}>
                  PSA 10: {formatPrice(c.psa10_usd)}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
