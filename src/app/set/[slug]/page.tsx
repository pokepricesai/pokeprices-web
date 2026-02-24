'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatPrice } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import PriceChart from '@/components/PriceChart'

interface Card {
  card_slug: string
  card_name: string
  card_number: string
  set_name: string
  raw_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  image_url: string | null
}

type SortOption = 'raw_desc' | 'raw_asc' | 'psa10_desc' | 'name_asc' | 'number_asc'

export default function SetPage() {
  const params = useParams()
  const setName = decodeURIComponent(params.slug as string)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<SortOption>('raw_desc')
  const [insight, setInsight] = useState<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(false)

      // Load cards
      const { data, error: err } = await supabase.rpc('get_set_cards_sortable', {
        set_text: setName,
        sort_col: sort,
      })
      if (err || !data) {
        setError(true)
      } else {
        setCards(data)
      }

      // Load insight
      const { data: insightData } = await supabase.rpc('get_set_insight', { set_text: setName })
      if (insightData) setInsight(insightData)

      // Load price history
      const { data: histData } = await supabase.rpc('get_set_price_history', { set_text: setName })
if (histData) {
  setPriceHistory(histData.map((d: any) => ({
    ...d,
    value_usd: d.value_usd ? d.value_usd * 100 : null,
  })))
}

      setLoading(false)
    }
    loadData()
  }, [setName, sort])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      <Link href="/browse" style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
        marginBottom: 8, display: 'inline-block',
      }}>← Back to sets</Link>

      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 30,
        margin: '8px 0 4px', color: 'var(--text)',
      }}>{setName}</h1>

      {insight && (
        <div className="insight-badge" style={{ marginBottom: 12 }}>{insight}</div>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px' }}>
        {cards.length} cards
      </p>

      {/* Set Price Chart */}
      {priceHistory.length > 1 && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '20px', marginBottom: 20,
        }}>
          <h3 style={{
            fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            margin: '0 0 14px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>Set Price History</h3>
          <PriceChart
            data={priceHistory}
            lines={[
              { key: 'median_usd', color: 'var(--primary)', label: 'Avg Card' },
              { key: 'value_usd', color: 'var(--accent)', label: 'Total Set Value' },
            ]}
            height={220}
          />
        </div>
      )}

      {/* Sort controls */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['raw_desc', 'Highest Raw'],
          ['raw_asc', 'Lowest Raw'],
          ['psa10_desc', 'Highest PSA 10'],
          ['name_asc', 'Name A-Z'],
          ['number_asc', 'Card #'],
        ] as [SortOption, string][]).map(([val, label]) => (
          <button
            key={val}
            className={`sort-btn ${sort === val ? 'active' : ''}`}
            onClick={() => setSort(val)}
          >{label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 240, borderRadius: 12 }} />
          ))}
        </div>
      ) : error ? (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '40px 24px', textAlign: 'center',
        }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Could not load cards for this set. Try refreshing the page.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {cards.map((c) => (
            <Link
              key={c.card_slug}
              href={`/card/${c.card_slug}`}
              className="card-hover holo-shimmer"
              style={{
                background: 'var(--card)', borderRadius: 12,
                border: '1px solid var(--border)', padding: 14,
                textDecoration: 'none', color: 'var(--text)',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
              }}
            >
              {c.image_url ? (
                <img src={c.image_url} alt={c.card_name} style={{
                  width: 110, height: 154, objectFit: 'contain', marginBottom: 8, borderRadius: 6,
                }} loading="lazy" />
              ) : (
                <div style={{
                  width: 110, height: 154, background: 'var(--bg)', borderRadius: 6,
                  marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, color: 'var(--border)',
                }}>🃏</div>
              )}
              <div style={{
                fontWeight: 600, fontSize: 13, textAlign: 'center',
                marginBottom: 3, lineHeight: 1.3,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Raw: {formatPrice(c.raw_usd)}
              </div>
              {c.psa10_usd && c.psa10_usd > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent-hover)', fontWeight: 500 }}>
                  PSA 10: {formatPrice(c.psa10_usd)}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Chat */}
      <div style={{ marginTop: 40 }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 20,
          margin: '0 0 14px', color: 'var(--text)',
        }}>Ask about this set</h2>
        <InlineChat cardContext={setName} />
      </div>
    </div>
  )
}
