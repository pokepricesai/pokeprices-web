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

interface PopStats {
  total_graded: number
  gem_rate: number
  total_psa10: number
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
  const [popStats, setPopStats] = useState<PopStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(false)

      const { data, error: err } = await supabase.rpc('get_set_cards_sortable', {
        set_text: setName,
        sort_col: sort,
      })
      if (err || !data) {
        setError(true)
      } else {
        setCards(data)
      }

      const { data: insightData } = await supabase.rpc('get_set_insight', { set_text: setName })
      if (insightData) setInsight(insightData)

      const { data: histData } = await supabase.rpc('get_set_price_history', { set_text: setName })
      if (histData) {
        setPriceHistory(histData.map((d: any) => ({
          ...d,
          value_usd: d.value_usd ? d.value_usd * 100 : null,
        })))
      }

      const { data: popData } = await supabase
        .from('psa_set_totals')
        .select('*')
        .or(`set_name.eq.Pokemon ${setName},set_name.ilike.%${setName}%`)
        .order('snapshot_date', { ascending: false })
        .limit(1)

      if (popData && popData.length > 0) {
        const pop = popData[0]
        setPopStats({
          total_graded: pop.total_graded || 0,
          gem_rate: pop.gem_rate || 0,
          total_psa10: pop.total_psa_10 || 0,
        })
      }

      setLoading(false)
    }
    loadData()
  }, [setName, sort])

  const hasInsight = !!insight
  const hasPop = !!(popStats && popStats.total_graded > 0)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>
      <Link href="/browse" style={{
        color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none',
        marginBottom: 8, display: 'inline-block',
        fontFamily: "'Figtree', sans-serif",
      }}>← Back to sets</Link>

      <h1 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: 34,
        fontWeight: 700,
        margin: '8px 0 16px',
        color: 'var(--text)',
        letterSpacing: '-0.5px',
      }}>{setName}</h1>

      {/* Chat */}
      <div style={{ marginBottom: 24 }}>
        <InlineChat cardContext={setName} />
      </div>

      {/* Set Insights + PSA Population side by side */}
      {(hasInsight || hasPop) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: hasInsight && hasPop ? '1fr auto' : '1fr',
          gap: 12,
          marginBottom: 20,
          alignItems: 'stretch',
        }}>
          {hasInsight && (
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--primary)',
              borderRadius: 12,
              padding: '14px 18px',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--primary)', marginBottom: 7,
                fontFamily: "'Figtree', sans-serif",
              }}>Set Insights</div>
              <p style={{
                fontSize: 13, lineHeight: 1.6, color: 'var(--text)',
                margin: 0, fontFamily: "'Figtree', sans-serif",
              }}>{insight}</p>
            </div>
          )}

          {hasPop && popStats && (
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '14px 18px',
              minWidth: 190,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 12,
                fontFamily: "'Figtree', sans-serif",
              }}>PSA Population</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={statValue}>{popStats.total_graded.toLocaleString()}</div>
                  <div style={statLabel}>Total Graded</div>
                </div>
                <div>
                  <div style={statValue}>{popStats.total_psa10.toLocaleString()}</div>
                  <div style={statLabel}>PSA 10s</div>
                </div>
                <div>
                  <div style={{
                    ...statValue,
                    color: popStats.gem_rate >= 20
                      ? 'var(--green)'
                      : popStats.gem_rate >= 5
                      ? 'var(--accent-hover)'
                      : 'var(--text)',
                  }}>{popStats.gem_rate.toFixed(1)}%</div>
                  <div style={statLabel}>Gem Rate</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <p style={{
        color: 'var(--text-muted)', fontSize: 13,
        margin: '0 0 20px', fontFamily: "'Figtree', sans-serif",
      }}>
        {cards.length} cards
      </p>

      {/* Set Price Chart */}
      {priceHistory.length > 1 && (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '20px 20px 32px', marginBottom: 20,
        }}>
          <h3 style={{
            fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            margin: '0 0 14px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: 1.5,
          }}>Set Price History</h3>
          <PriceChart
            data={priceHistory}
            lines={[
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
            style={{ fontFamily: "'Figtree', sans-serif" }}
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
          <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif" }}>
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
                fontFamily: "'Figtree', sans-serif",
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                Raw: {formatPrice(c.raw_usd)}
              </div>
              {c.psa10_usd && c.psa10_usd > 0 && (
                <div style={{ fontSize: 12, color: 'var(--accent-hover)', fontWeight: 500, fontFamily: "'Figtree', sans-serif" }}>
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

const statValue: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif",
  lineHeight: 1,
}

const statLabel: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  textTransform: 'uppercase',
  letterSpacing: 1,
  fontWeight: 600,
  marginTop: 2,
}
