'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

interface Insight {
  id: string
  slug: string
  headline: string
  intro: string
  theme: string
  theme_label: string
  published_at: string
}

const THEME_COLOURS: Record<string, string> = {
  movers:    '#ef4444',
  grading:   '#a78bfa',
  set_watch: '#3b82f6',
  sleepers:  '#22c55e',
  pulse:     '#f59e0b',
  collector: '#ec4899',
  history:   '#94a3b8',
}

const THEME_LABELS: Record<string, string> = {
  movers: 'The Movers', grading: 'Grading Desk', set_watch: 'Set Watch',
  sleepers: 'Sleeper Picks', pulse: 'Market Pulse',
  collector: "Collector's Corner", history: 'History Lesson',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function ThemeTag({ theme, label }: { theme: string; label: string }) {
  const color = THEME_COLOURS[theme] ?? '#94a3b8'
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
      textTransform: 'uppercase' as const, color,
      fontFamily: "'Figtree', sans-serif",
    }}>
      {label}
    </span>
  )
}

export default function InsightsPageClient() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('insights')
        .select('id, slug, headline, intro, theme, theme_label, published_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(40)
      if (data) setInsights(data)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif", fontSize: 34,
          margin: '0 0 8px', color: 'var(--text)', letterSpacing: -0.5,
        }}>
          Market Insights
        </h1>
        <p style={{
          color: 'var(--text-muted)', fontSize: 14, margin: 0,
          fontFamily: "'Figtree', sans-serif", lineHeight: 1.6,
        }}>
          Daily articles from live price data — movers, sleepers, grading intelligence, set analysis.
        </p>
      </div>

      {/* Theme key */}
      <div style={{
        display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28,
        paddingBottom: 20, borderBottom: '1px solid var(--border)',
      }}>
        {Object.entries(THEME_LABELS).map(([theme, label]) => (
          <div key={theme} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: THEME_COLOURS[theme], flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Loading…
        </div>
      ) : insights.length === 0 ? (
        <div style={{
          background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)',
          padding: '48px 32px', textAlign: 'center',
        }}>
          <h3 style={{ fontFamily: "'Figtree', sans-serif", fontWeight: 700, fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>
            First articles coming soon
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 400, margin: '0 auto', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
            Daily market articles are generated from live price data. Check back tomorrow.
          </p>
        </div>
      ) : (
        <>
          {/* Featured — latest article large */}
          {insights[0] && (
            <Link href={`/insights/${insights[0].slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 14 }}>
              <div
                style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 14, padding: '26px 28px', transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.07)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ''}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <ThemeTag theme={insights[0].theme} label={insights[0].theme_label} />
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    {formatDate(insights[0].published_at)}
                  </span>
                </div>
                <h2 style={{
                  fontFamily: "'Playfair Display', serif", fontSize: 26,
                  margin: '0 0 10px', color: 'var(--text)', lineHeight: 1.25, letterSpacing: -0.3,
                }}>
                  {insights[0].headline}
                </h2>
                <p style={{
                  fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px',
                  lineHeight: 1.65, fontFamily: "'Figtree', sans-serif", maxWidth: 640,
                }}>
                  {insights[0].intro}
                </p>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                  Read article →
                </span>
              </div>
            </Link>
          )}

          {/* Grid — remaining */}
          {insights.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {insights.slice(1).map(ins => (
                <Link key={ins.id} href={`/insights/${ins.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div
                    style={{
                      background: 'var(--card)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '18px 20px', height: '100%',
                      boxSizing: 'border-box' as const, transition: 'box-shadow 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.06)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ''}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <ThemeTag theme={ins.theme} label={ins.theme_label} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {formatDate(ins.published_at)}
                      </span>
                    </div>
                    <h3 style={{
                      fontFamily: "'Playfair Display', serif", fontSize: 16,
                      margin: '0 0 8px', color: 'var(--text)', lineHeight: 1.3, letterSpacing: -0.2,
                    }}>
                      {ins.headline}
                    </h3>
                    <p style={{
                      fontSize: 12, color: 'var(--text-muted)', margin: 0,
                      lineHeight: 1.55, fontFamily: "'Figtree', sans-serif",
                      display: '-webkit-box', WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
                    }}>
                      {ins.intro}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
