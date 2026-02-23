'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatPrice } from '@/lib/supabase'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  raw_usd: number | null
  psa10_usd: number | null
  image_url: string | null
}

export default function SetPage() {
  const params = useParams()
  const setName = decodeURIComponent(params.slug as string)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCards() {
const { data } = await supabase.rpc('get_set_cards', { set_text: setName })
      if (data) setCards(data)
      setLoading(false)
    }
    loadCards()
  }, [setName])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <Link href="/browse" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 8, display: 'inline-block' }}>
        ← Back to sets
      </Link>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 32,
        margin: '8px 0', color: 'var(--text)',
      }}>{setName}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 28px' }}>
        {cards.length} cards · Sorted by value (highest first)
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>Loading cards...</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {cards.map((c) => (
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
