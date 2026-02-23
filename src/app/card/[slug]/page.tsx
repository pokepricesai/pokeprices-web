'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatPrice, formatPct, formatDate } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'

export default function CardPage() {
  const params = useParams()
  const slug = params.slug as string
  const [card, setCard] = useState<any>(null)
  const [trend, setTrend] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCard() {
      const { data: cardData } = await supabase.rpc('get_card_detail', { slug })
      if (cardData) setCard(cardData)

      const { data: trendData } = await supabase.rpc('get_card_trends_detail', { slug })
      if (trendData) setTrend(trendData)

      setLoading(false)
    }
    loadCard()
  }, [slug])

  if (loading) return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
      Loading card data...
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

const trends: {label: string; val: number | null}[] = trend ? [
    { label: '7d', val: trend.raw_pct_7d },
    { label: '30d', val: trend.raw_pct_30d },
    { label: '90d', val: trend.raw_pct_90d },
    { label: '180d', val: trend.raw_pct_180d },
    { label: '1y', val: trend.raw_pct_365d },
    { label: '2y', val: trend.raw_pct_2y },
    { label: '5y', val: trend.raw_pct_5y },
  ] : [];
  
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <Link href={`/set/${encodeURIComponent(card.set_name)}`} style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 8, display: 'inline-block',
      }}>← {card.set_name}</Link>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 8 }}>
        {/* Image */}
        <div style={{ flex: '0 0 auto' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} style={{
              width: 220, borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }} />
          ) : (
            <div style={{
              width: 220, height: 308, background: '#f4f1ec', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 13,
            }}>Image coming soon</div>
          )}
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{
            fontFamily: "'DM Serif Display', serif", fontSize: 30,
