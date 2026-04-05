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
  image_url: string | null
  author: string | null
  read_time_mins: number | null
}

const THEME_COLOURS: Record<string, string> = {
  grading:    '#a78bfa',
  collecting: '#22c55e',
  market:     '#3b82f6',
  vintage:    '#f59e0b',
  modern:     '#ef4444',
  investing:  '#ec4899',
  community:  '#94a3b8',
}

const THEME_LABELS: Record<string, string> = {
  grading:    'Grading & PSA',
  collecting: 'Collecting Strategy',
  market:     'Market Analysis',
  vintage:    'Vintage Cards',
  modern:     'Modern Sets',
  investing:  'Investing',
  community:  'Community',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ThemeTag({ theme, label }: { theme: string; label: string }) {
  const color = THEME_COLOURS[theme] ?? '#94a3b8'
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color, fontFamily: "'Figtree', sans-serif" }}>
      {label || THEME_LABELS[theme] || theme}
    </span>
  )
}

export default function InsightsPageClient() {
  const [insights, setInsights]   = useState<Insight[]>([])
  const [loading, setLoading]     = useState(true)
  const [activeTheme, setTheme]   = useState<string>('all')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('insights')
        .select('id, slug, headline, intro, theme, theme_label, published_at, image_url, author, read_time_mins')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(60)
      if (data) setInsights(data)
      setLoading(false)
    }
    load()
  }, [])

  const filtered = activeTheme === 'all' ? insights : insights.filter(i => i.theme === activeTheme)
  const featured = filtered[0]
  const rest     = filtered.slice(1)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 34, margin: '0 0 8px', color: 'var(--text)', letterSpacing: -0.5 }}>
          Market Insights
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
          Thoughtful writing on grading, collecting, and the Pokémon TCG market.
        </p>
      </div>

      {/* Theme filter */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setTheme('all')}
          style={{ padding: '6px 14px', borderRadius: 20, border: activeTheme === 'all' ? '1px solid var(--primary)' : '1px solid var(--border)', background: activeTheme === 'all' ? 'rgba(26,95,173,0.08)' : 'transparent', color: activeTheme === 'all' ? 'var(--primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
          All
        </button>
        {Object.entries(THEME_LABELS).map(([theme, label]) => (
          <button key={theme} onClick={() => setTheme(theme)}
            style={{ padding: '6px 14px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 6, border: activeTheme === theme ? `1px solid ${THEME_COLOURS[theme]}` : '1px solid var(--border)', background: activeTheme === theme ? `${THEME_COLOURS[theme]}18` : 'transparent', color: activeTheme === theme ? THEME_COLOURS[theme] : 'var(--text-muted)', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: THEME_COLOURS[theme], flexShrink: 0 }} />
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 120, borderRadius: 14 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>
            {activeTheme === 'all' ? 'Articles coming soon' : `No ${THEME_LABELS[activeTheme]} articles yet`}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 400, margin: '0 auto', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
            Check back soon — new articles published weekly.
          </p>
        </div>
      ) : (
        <>
          {/* Featured article */}
          {featured && (
            <Link href={`/insights/${featured.slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 14 }}>
              <div
                style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 24px rgba(0,0,0,0.08)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ''}
              >
                {featured.image_url && (
                  <img src={featured.image_url} alt={featured.headline}
                    style={{ width: '100%', height: 220, objectFit: 'cover' }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                )}
                <div style={{ padding: '24px 28px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <ThemeTag theme={featured.theme} label={featured.theme_label} />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {featured.read_time_mins && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{featured.read_time_mins} min read</span>}
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{formatDate(featured.published_at)}</span>
                    </div>
                  </div>
                  <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 10px', color: 'var(--text)', lineHeight: 1.25, letterSpacing: -0.3 }}>
                    {featured.headline}
                  </h2>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 16px', lineHeight: 1.65, fontFamily: "'Figtree', sans-serif", maxWidth: 640 }}>
                    {featured.intro}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>Read article →</span>
                    {featured.author && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>By {featured.author}</span>}
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Article grid */}
          {rest.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {rest.map(ins => (
                <Link key={ins.id} href={`/insights/${ins.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', height: '100%', boxSizing: 'border-box', transition: 'box-shadow 0.15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.07)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ''}
                  >
                    {ins.image_url && (
                      <img src={ins.image_url} alt={ins.headline}
                        style={{ width: '100%', height: 130, objectFit: 'cover' }}
                        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                    )}
                    <div style={{ padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <ThemeTag theme={ins.theme} label={ins.theme_label} />
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{formatDate(ins.published_at)}</span>
                      </div>
                      <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: '0 0 8px', color: 'var(--text)', lineHeight: 1.3 }}>
                        {ins.headline}
                      </h3>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55, fontFamily: "'Figtree', sans-serif", display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {ins.intro}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {ins.read_time_mins && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{ins.read_time_mins} min read</span>}
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>Read →</span>
                      </div>
                    </div>
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
