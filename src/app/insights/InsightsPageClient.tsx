// app/insights/InsightsPageClient.tsx
'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatDate } from '@/lib/supabase'

interface Insight {
  id: number
  slug: string
  title: string
  summary: string
  category: string
  published_at: string
}

export default function InsightsPageClient() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('insights')
        .select('id, slug, title, summary, category, published_at')
        .order('published_at', { ascending: false })
        .limit(20)
      if (data) setInsights(data)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{
        fontFamily: "'Playfair Display', serif", fontSize: 32,
        margin: '0 0 8px', color: 'var(--text)',
      }}>Market Insights</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: '0 0 32px', fontFamily: "'Figtree', sans-serif" }}>
        Weekly market analysis, trend reports, and collecting guides — powered by real data.
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40, fontFamily: "'Figtree', sans-serif" }}>Loading insights...</p>
      ) : insights.length === 0 ? (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '48px 32px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📝</div>
          <h3 style={{ fontFamily: "'Figtree', sans-serif", fontWeight: 700, fontSize: 18, margin: '0 0 8px' }}>
            Coming soon
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 400, margin: '0 auto', fontFamily: "'Figtree', sans-serif" }}>
            Our first batch of data-driven market insights are being written. Check back soon for weekly trend reports, set analyses, and collecting guides.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map((ins) => (
            <Link
              key={ins.id}
              href={`/insights/${ins.slug}`}
              style={{
                background: 'var(--card)', borderRadius: 12,
                border: '1px solid var(--border)', padding: '20px 24px',
                textDecoration: 'none', color: 'var(--text)',
                transition: 'box-shadow 0.2s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
                <div>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                    textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif",
                  }}>{ins.category}</span>
                  <h3 style={{ fontSize: 17, fontWeight: 700, margin: '4px 0 6px', fontFamily: "'Figtree', sans-serif" }}>
                    {ins.title}
                  </h3>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5, fontFamily: "'Figtree', sans-serif" }}>
                    {ins.summary}
                  </p>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginTop: 2, fontFamily: "'Figtree', sans-serif" }}>
                  {formatDate(ins.published_at)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
