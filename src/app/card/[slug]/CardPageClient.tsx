'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice, formatPct } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import PriceChart from '@/components/PriceChart'
import CardStructuredData from '@/components/CardStructuredData'

function extractVariant(cardName: string): string | null {
  const match = cardName.match(/\[([^\]]+)\]/)
  return match ? match[1] : null
}

export default function CardPageClient({ slug }: { slug: string }) {
  const [card, setCard] = useState<any>(null)
  const [trend, setTrend] = useState<any>(null)
  const [metrics, setMetrics] = useState<any>(null)
  const [priceHistory, setPriceHistory] = useState<any[]>([])
  const [insight, setInsight] = useState<string | null>(null)
  const [psaPop, setPsaPop] = useState<any | null>(null)
  const [ebayDeals, setEbayDeals] = useState<any[]>([])
  const [ebayListings, setEbayListings] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadCard() {
      const { data: cardData } = await supabase.rpc('get_card_detail', { slug })
      if (!cardData) { setLoading(false); return }
      setCard(cardData)

      const [trendRes, metricsRes, histRes, insightRes] = await Promise.all([
        supabase.rpc('get_card_trends_detail', { slug }),
        supabase.rpc('get_card_metrics', { search_text: cardData.card_name }),
        supabase.rpc('get_card_price_history', { slug }),
        supabase.rpc('get_card_insight', { slug }),
      ])

      if (trendRes.data) setTrend(trendRes.data)
      if (metricsRes.data) {
        const m = Array.isArray(metricsRes.data) ? metricsRes.data[0] : metricsRes.data
        setMetrics(m)
      }
      if (histRes.data) setPriceHistory(histRes.data)
      if (insightRes.data) setInsight(insightRes.data)

      // PSA population — exact variant match
      const baseName = cardData.card_name.split('[')[0].split('#')[0].trim()
      const variant = extractVariant(cardData.card_name)
      const setNameClean = cardData.set_name.replace(/^Pokemon /, '')

      let popQuery = supabase
        .from('psa_population')
        .select('card_name, variant, set_name, card_number, psa_7, psa_8, psa_9, psa_10, total_graded, gem_rate')
        .ilike('card_name', `%${baseName}%`)
        .ilike('set_name', `%${setNameClean}%`)
        .gt('total_graded', 0)

      if (variant) {
        popQuery = popQuery.ilike('variant', `%${variant}%`)
      } else {
        popQuery = popQuery.or('variant.is.null,variant.eq.,variant.ilike.Standard%')
      }

      const { data: popData } = await popQuery
        .order('total_graded', { ascending: false })
        .limit(1)

      if (popData && popData.length > 0) setPsaPop(popData[0])

      // eBay deals
      const { data: dealsData } = await supabase
        .from('daily_deals')
        .select('*')
        .eq('card_slug', slug)
        .order('discount_pct', { ascending: false })
        .limit(5)

      if (dealsData && dealsData.length > 0) {
        setEbayDeals(dealsData)
      } else {
        const { data: listingsData } = await supabase
          .from('ebay_listings')
          .select('*')
          .eq('card_slug', slug)
          .in('match_confidence', ['high', 'medium'])
          .order('total_cost_cents', { ascending: true })
          .limit(5)
        if (listingsData) setEbayListings(listingsData)
      }

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
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, marginBottom: 12 }}>Card not found</h1>
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
    trend.raw_pct_7d !== null || trend.raw_pct_30d !== null ||
    trend.raw_pct_90d !== null || trend.raw_pct_180d !== null || trend.raw_pct_365d !== null
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

  // Buying signals
  const signals: { label: string; value: string; type: 'good' | 'warn' | 'neutral' }[] = []

  if (metrics) {
    const raw = metrics.results?.[0] || metrics
    if (raw.drawdown_pct !== null && raw.drawdown_pct !== undefined) {
      const dd = parseFloat(raw.drawdown_pct)
      if (dd < -30) signals.push({ label: 'Price vs ATH', value: `${dd.toFixed(1)}% below peak`, type: 'good' })
      else if (dd < -10) signals.push({ label: 'Price vs ATH', value: `${dd.toFixed(1)}% below peak`, type: 'neutral' })
      else signals.push({ label: 'Price vs ATH', value: `Near all-time high (${dd.toFixed(1)}%)`, type: 'warn' })
    }
    if (raw.slope_30d !== null && raw.slope_30d !== undefined) {
      const slope = parseFloat(raw.slope_30d)
      if (slope > 50) signals.push({ label: 'Trend', value: 'Rising strongly (30d)', type: 'good' })
      else if (slope > 0) signals.push({ label: 'Trend', value: 'Trending up (30d)', type: 'good' })
      else if (slope < -50) signals.push({ label: 'Trend', value: 'Falling sharply (30d)', type: 'warn' })
      else signals.push({ label: 'Trend', value: 'Flat / sideways (30d)', type: 'neutral' })
    }
  }

  if (psaPop && card.psa10_usd && card.raw_usd) {
    const gemRate = parseFloat(psaPop.gem_rate)
    const multiple = card.psa10_usd / card.raw_usd
    if (gemRate < 5 && multiple > 3) signals.push({ label: 'PSA 10 rarity', value: `${gemRate.toFixed(1)}% gem rate — premium justified`, type: 'good' })
    else if (gemRate > 40 && multiple < 2) signals.push({ label: 'PSA 10 value', value: `${gemRate.toFixed(1)}% gem rate — 10s are plentiful`, type: 'warn' })
    else signals.push({ label: 'PSA 10 gem rate', value: `${gemRate.toFixed(1)}%`, type: 'neutral' })
  }

  if (card.psa9_usd && card.psa10_usd) {
    const jumpTo10 = card.psa10_usd / card.psa9_usd
    if (jumpTo10 > 3) signals.push({ label: 'Best grade value', value: `PSA 9 — PSA 10 costs ${jumpTo10.toFixed(1)}x more`, type: 'neutral' })
    else if (jumpTo10 < 1.5) signals.push({ label: 'Best grade value', value: `PSA 10 (only ${jumpTo10.toFixed(1)}x PSA 9 price)`, type: 'good' })
  }

  const hasDeals = ebayDeals.length > 0
  const hasListings = ebayListings.length > 0
  const cardNumber = card.card_number ? ` #${card.card_number}` : ''
  const prefillMessage = `I'm looking at ${card.card_name}${cardNumber} from ${card.set_name}`

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 24px' }}>
      <CardStructuredData card={card} />

      <Link href={`/set/${encodeURIComponent(card.set_name)}`} style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
        marginBottom: 8, display: 'inline-block', fontFamily: "'Figtree', sans-serif",
      }}>← {card.set_name}</Link>

      {/* Chat at top */}
      <div style={{ margin: '12px 0 28px' }}>
        <InlineChat
          cardContext={`${card.card_name} from ${card.set_name}`}
          prefillMessage={prefillMessage}
        />
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        {/* Image */}
        <div style={{ flex: '0 0 auto' }}>
          {card.image_url ? (
            <img src={card.image_url} alt={card.card_name} style={{
              width: 220, borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
            }} />
          ) : (
            <div style={{
              width: 220, height: 308, background: 'var(--bg)', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 40, border: '1px solid var(--border)',
            }}>🃏</div>
          )}
        </div>

        {/* Info column */}
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{
            fontFamily: "'Playfair Display', serif", fontSize: 26,
            margin: '0 0 4px', color: 'var(--text)', letterSpacing: '-0.3px',
          }}>{card.card_name}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 12px', fontFamily: "'Figtree', sans-serif" }}>
            {card.set_name}
          </p>

          {insight && (
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderLeft: '3px solid var(--primary)', borderRadius: 10,
              padding: '10px 14px', marginBottom: 14,
              fontSize: 13, lineHeight: 1.55, color: 'var(--text)',
              fontFamily: "'Figtree', sans-serif",
            }}>{insight}</div>
          )}

          {/* Buying signals */}
          {signals.length > 0 && (
            <div style={{
              background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
              padding: '14px 16px', marginBottom: 14,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 10,
                fontFamily: "'Figtree', sans-serif",
              }}>Buying Signals</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {signals.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{s.label}</span>
                    <span style={{
                      fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                      color: s.type === 'good' ? 'var(--green)' : s.type === 'warn' ? '#e07b39' : 'var(--text)',
                      background: s.type === 'good' ? 'rgba(39,174,96,0.08)' : s.type === 'warn' ? 'rgba(224,123,57,0.08)' : 'var(--bg-light)',
                      padding: '2px 8px', borderRadius: 20,
                    }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prices */}
          <div style={{
            background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
            padding: '14px 16px', marginBottom: 14,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 12,
              fontFamily: "'Figtree', sans-serif",
            }}>Current Prices</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {grades.map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{g.label}</div>
                  <div style={{
                    fontSize: 16, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
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
              padding: '14px 16px',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 10,
                fontFamily: "'Figtree', sans-serif",
              }}>Raw Price Trend</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                {trends.map((t) => {
                  const f = formatPct(t.val)
                  return (
                    <div key={t.label}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{t.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: f.color, fontFamily: "'Figtree', sans-serif" }}>{f.text}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* PSA Population */}
      {psaPop && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '18px 20px', marginTop: 24,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 14,
            fontFamily: "'Figtree', sans-serif",
          }}>PSA Population{psaPop.variant && psaPop.variant !== 'Standard' ? ` — ${psaPop.variant}` : ''}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
            {[
              { label: 'PSA 7', value: psaPop.psa_7 },
              { label: 'PSA 8', value: psaPop.psa_8 },
              { label: 'PSA 9', value: psaPop.psa_9 },
              { label: 'PSA 10', value: psaPop.psa_10 },
              { label: 'Total Graded', value: psaPop.total_graded },
            ].map((stat) => (
              <div key={stat.label} style={{
                background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: stat.label === 'Total Graded' ? 18 : 20,
                  fontWeight: 700, color: 'var(--text)',
                  fontFamily: "'Figtree', sans-serif", lineHeight: 1,
                }}>{stat.value?.toLocaleString() ?? '—'}</div>
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
                  fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600,
                }}>{stat.label}</div>
              </div>
            ))}
          </div>
          {psaPop.gem_rate && (
            <div style={{ marginTop: 12, fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)' }}>
              Gem rate:{' '}
              <strong style={{
                color: parseFloat(psaPop.gem_rate) >= 20 ? 'var(--green)' : parseFloat(psaPop.gem_rate) >= 5 ? 'var(--accent-hover)' : 'var(--text)',
              }}>
                {parseFloat(psaPop.gem_rate).toFixed(1)}%
              </strong>
              {' '}of all graded copies received PSA 10.
            </div>
          )}
        </div>
      )}

      {/* eBay Deals / Listings */}
      {(hasDeals || hasListings) && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '18px 20px', marginTop: 24,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 1.5, marginBottom: 14, fontFamily: "'Figtree', sans-serif",
            color: hasDeals ? 'var(--green)' : 'var(--text-muted)',
          }}>{hasDeals ? 'Live Deals' : 'Live Listings'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(hasDeals ? ebayDeals : ebayListings).map((item: any, i: number) => {
              const price = hasDeals
                ? (item.listing_price_cents / 100).toFixed(2)
                : (item.total_cost_cents / 100).toFixed(2)
              const currency = item.currency === 'GBP' ? '£' : '$'
              const url = item.item_web_url
              const condition = item.condition || 'Ungraded'
              const seller = item.seller_username
              const feedback = item.seller_feedback_score
              const discount = hasDeals ? item.discount_pct : null
              const fairValue = hasDeals && item.fair_value_cents
                ? (item.fair_value_cents / 100).toFixed(2)
                : null
              return (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: 'var(--bg-light)',
                  borderRadius: 10, gap: 12, flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
                        {currency}{price}
                      </span>
                      {discount && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, color: 'var(--green)',
                          background: 'rgba(39,174,96,0.1)', padding: '1px 7px', borderRadius: 20,
                          fontFamily: "'Figtree', sans-serif",
                        }}>{discount.toFixed(0)}% off</span>
                      )}
                      {fairValue && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                          vs {currency}{fairValue} fair value
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                      {condition} · {seller} ({feedback?.toLocaleString()} feedback)
                    </div>
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer" style={{
                      background: 'var(--primary)', color: '#fff',
                      padding: '6px 14px', borderRadius: 8,
                      fontSize: 12, fontWeight: 700, textDecoration: 'none',
                      fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
                    }}>View on eBay</a>
                  )}
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0', fontFamily: "'Figtree', sans-serif" }}>
            Prices scraped daily. Always verify listing before buying.
          </p>
        </div>
      )}

      {/* Price History Chart */}
      {priceHistory.length > 1 && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '20px 20px 32px', marginTop: 24,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 14,
            fontFamily: "'Figtree', sans-serif",
          }}>Price History</div>
          <PriceChart data={priceHistory} height={280} />
        </div>
      )}
    </div>
  )
}
