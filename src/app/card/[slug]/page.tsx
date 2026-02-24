'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatPrice, formatPct } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import PriceChart from '@/components/PriceChart'

export default function CardPage() {
  const params = useParams()
  const slug = params.slug as string
  const [card, setCard] = useState<any>(null)
  const [trend, setTrend] = useState<any>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [insight, setInsight] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCard() {
      // Load card detail
      const { data: cardData } = await supabase.rpc('get_card_detail', { slug })
      if (cardData) setCard(cardData)

      // Load trends
      const { data: trendData } = await supabase.rpc('get_card_trends_detail', { slug })
      if (trendData) setTrend(trendData)

      // Load price history for chart
      const { data: histData } = await supabase.rpc('get_card_price_history', { slug })
      if (histData) setPriceHistory(histData)

      // Load insight
      const { data: insightData } = await supabase.rpc('get_card_insight', { slug })
      if (insightData) setInsight(insightData)

      setLoading(false)
    }
    loadCard()
  }, [slug])

  if (loading) return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div className="skeleton" style={{ width: 220, height: 308, borderRadius: 10 }} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="skeleton" style={{ height: 32, width: '60%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 18, width: '40%', marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  )

  if (!card) return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, marginBottom: 12 }}>Card not found</h1>
      <p style={{ color: 'var(--text-muted)' }}>This card doesn&apos;t exist in our database.</p>
      <Link href="/browse" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>Browse sets →</Link>
    </div>
  )

  const grades = [
    { label: 'Raw', value: card.raw_usd },
    { label: 'PSA 7', value: card.psa7_usd },
    { label: 'PSA 8', value: card.psa8_usd },
    { label: 'PSA 9', value: card.psa9_usd },
    { label: 'PSA 10', value: card.psa10_usd },
    { label: 'CGC 9.5', value: card.cgc95_usd },
  ]

  const hasAnyTrend = trend && (
    trend.raw_pct_7d !== null || trend.raw_pct_30d !== null || trend.raw_pct_90d !== null ||
    trend.raw_pct_180d !== null || trend.raw_pct_365d !== null
  )

  const trends = hasAnyTrend ? [
    { label: '7d', val: trend.raw_pct_7d },
    { label: '30d', val: trend.raw_pct_30d },
    { label: '90d', val: trend.raw_pct_90d },
    { label: '180d', val: trend.raw_pct_180d },
    { label: '1y', val: trend.raw_pct_365d },
    { label: '2y', val: trend.raw_pct_2y },
    { label: '5y', val: trend.raw_pct_5y },
  ] : []

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 24px' }}>
      <Link href={`/set/${encodeURIComponent(card.set_name)}`} style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
        marginBottom: 8, display: 'inline-block',
      }}>← {card.set_name}</Link>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 8 }}>
        {/* Image */}
        <div style={{ flex: '0 0 auto' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} style={{
              width: 220, borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }} />
          ) : (
            <div style={{
              width: 220, height: 308, background: 'var(--bg)', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 40, border: '1px solid var(--border)',
            }}>🃏</div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 28,
            margin: '0 0 4px', color: 'var(--text)',
          }}>{card.card_name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>{card.set_name}</p>

          {insight && (
            <div className="insight-badge" style={{ marginBottom: 16 }}>{insight}</div>
          )}

          {/* Prices */}
          <div style={{
            background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: 18, marginBottom: 16,
          }}>
            <h3 style={{
              fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
              margin: '0 0 12px', color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 1,
            }}>Current Prices</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {grades.map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{g.label}</div>
                  <div style={{
                    fontSize: 17, fontWeight: 700,
                    color: g.value ? 'var(--text)' : 'var(--border)',
                  }}>
                    {formatPrice(g.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trends */}
          {trends.length > 0 && (
            <div style={{
              background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
              padding: 18,
            }}>
              <h3 style={{
                fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
                margin: '0 0 12px', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1,
              }}>Raw Price Trend</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {trends.map((t) => {
                  const f = formatPct(t.val)
                  return (
                    <div key={t.label}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{t.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: f.color }}>{f.text}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Price History Chart */}
      {priceHistory.length > 1 && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '20px', marginTop: 24,
        }}>
          <h3 style={{
            fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
            margin: '0 0 14px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 1,
          }}>Price History</h3>
          <PriceChart data={priceHistory} height={280} />
        </div>
      )}

      {/* Chat */}
      <div style={{ marginTop: 36 }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', serif", fontSize: 20,
          margin: '0 0 14px', color: 'var(--text)',
        }}>Ask about this card</h2>
        <InlineChat cardContext={`${card.card_name} from ${card.set_name}`} />
      </div>
    </div>
  )
}
