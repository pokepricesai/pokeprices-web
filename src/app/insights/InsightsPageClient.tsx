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
