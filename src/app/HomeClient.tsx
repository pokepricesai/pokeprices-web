'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import InlineChat from '@/components/InlineChat'
import NewsletterSignup from '@/components/NewsletterSignup'
import FAQ from '@/components/FAQ'
import { getHomeFaqItems } from '@/lib/faqs'

// ── Types ─────────────────────────────────────────────────────────────────

type MarketIndexRow = {
  date: string
  total_raw_usd: number
  median_raw_usd: number
  raw_pct_30d: number | null
}

type MarketTotal = {
  total_raw_usd: number
  cards_tracked: number
}

type WeeklyReportRow = {
  category: string
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  current_price: number
  metric_label: string
}

type HeatmapCard = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  price_usd: number | null
  pct_change: number | null
  color_band: string
  is_recovery: boolean
}

type HiddenGem = {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string | null
  current_price: number
  pct_30d: number | null
  psa10_pop: number
  gem_score: number
}

// ── Tools Row Components ─────────────────────────────────────────────────

function ToolIcon({ path }: { path: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={path} />
    </svg>
  )
}

function PokeballIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  )
}

function ToolChip({ href, icon, label, comingSoon = false }: {
  href?: string; icon: React.ReactNode; label: string; comingSoon?: boolean
}) {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 14px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "'Figtree', sans-serif",
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    backdropFilter: 'blur(4px)',
  }

  if (comingSoon) {
    return (
      <span style={{
        ...baseStyle,
        background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.55)',
        border: '1px dashed rgba(255,255,255,0.2)',
        cursor: 'default',
      }}>
        {icon}
        {label}
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 0.5,
          background: 'rgba(255,203,5,0.2)',
          color: 'var(--accent)',
          padding: '1px 6px',
          borderRadius: 10,
          textTransform: 'uppercase',
          marginLeft: 2,
        }}>
          Soon
        </span>
      </span>
    )
  }

  return (
    <Link href={href!} style={{
      ...baseStyle,
      background: 'rgba(255,255,255,0.15)',
      color: '#fff',
      border: '1px solid rgba(255,255,255,0.25)',
    }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.background = 'rgba(255,255,255,0.25)'
        el.style.borderColor = 'rgba(255,255,255,0.4)'
        el.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement
        el.style.background = 'rgba(255,255,255,0.15)'
        el.style.borderColor = 'rgba(255,255,255,0.25)'
        el.style.transform = ''
      }}
    >
      {icon}
      {label}
    </Link>
  )
}

function ToolsRow() {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      justifyContent: 'center',
      maxWidth: 780,
      margin: '0 auto',
    }}>
      <ToolChip href="/browse" icon={<ToolIcon path="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />} label="Browse sets" />
      <ToolChip href="/pokemon" icon={<PokeballIcon />} label="By Pokémon" />
      <ToolChip href="/insights" icon={<ToolIcon path="M12 20h9M3 17l6-6 4 4 8-8" />} label="Insights" />
      <ToolChip href="/studio" icon={<ToolIcon path="M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 1-2-2 2 2 0 0 1 2 2z" />} label="Studio" />
      <ToolChip href="/creators" icon={<ToolIcon path="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />} label="Creators" />
      <ToolChip href="/vendors" icon={<ToolIcon path="M3 7h18M3 7l2-4h14l2 4M3 7v13a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7M9 12h6" />} label="Vendors" />

      <ToolChip icon={<ToolIcon path="M3 3v18h18M7 14l4-4 4 4 5-5" />} label="Portfolio tracker" comingSoon />
      <ToolChip icon={<ToolIcon path="M6 2l.01 7.01L12 17l5.99-7.99L18 2H6zM6 22h12" />} label="Pull rates" comingSoon />
      <ToolChip icon={<ToolIcon path="M5 12l5 5L20 7" />} label="Rip or keep" comingSoon />
    </div>
  )
}

// ── Hero visual components ───────────────────────────────────────────────

const HERO_POKEMON = [
  { id: 6,   x: '6%',  y: '18%', size: 140, opacity: 0.09, delay: '0s'   },
  { id: 149, x: '88%', y: '12%', size: 130, opacity: 0.08, delay: '1s'   },
  { id: 25,  x: '12%', y: '60%', size: 110, opacity: 0.07, delay: '2s'   },
  { id: 150, x: '85%', y: '55%', size: 120, opacity: 0.08, delay: '1.5s' },
  { id: 94,  x: '45%', y: '75%', size: 100, opacity: 0.06, delay: '0.5s' },
]

function PokemonSilhouettes() {
  return (
    <>
      {HERO_POKEMON.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', left: p.x, top: p.y, width: p.size, height: p.size,
          opacity: p.opacity, pointerEvents: 'none',
          animation: `float 6s ease-in-out ${p.delay} infinite`,
          filter: 'brightness(0) invert(1)',
        }}>
          <img
            src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`}
            alt="" width={p.size} height={p.size}
            style={{ objectFit: 'contain', width: '100%', height: '100%' }} />
        </div>
      ))}
    </>
  )
}

function Sparkles() {
  return (
    <>
      {[
        { top: '8%',  left: '10%',  size: 6, delay: '0s'   },
        { top: '15%', right: '15%', size: 8, delay: '0.8s' },
        { top: '25%', left: '20%',  size: 5, delay: '1.6s' },
        { top: '12%', right: '30%', size: 7, delay: '0.4s' },
        { top: '30%', left: '5%',   size: 4, delay: '1.2s' },
        { top: '20%', right: '8%',  size: 6, delay: '2s'   },
        { top: '5%',  left: '40%',  size: 5, delay: '0.6s' },
        { top: '35%', right: '20%', size: 4, delay: '1.4s' },
      ].map((s, i) => (
        <div key={i} style={{
          position: 'absolute', ...s, width: s.size, height: s.size,
          background: 'white',
          clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
          animation: `twinkle 2.5s ease-in-out ${s.delay} infinite`,
          pointerEvents: 'none', opacity: 0.6,
        }} />
      ))}
    </>
  )
}

function Sparkline({ data, color = '#22c55e', height = 48 }: { data: number[], color?: string, height?: number }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 120, h = height
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const lastPt = pts[pts.length - 1].split(',')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastPt[0]} cy={lastPt[1]} r={3} fill={color} />
    </svg>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatMarketTotal(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`
  return `$${dollars.toFixed(0)}`
}

function categoryMeta(cat: string) {
  switch (cat) {
    case 'top_riser':     return { label: 'Top Riser (30d)',  color: '#22c55e' }
    case 'top_faller':    return { label: 'Top Faller (30d)', color: '#ef4444' }
    case 'most_volatile': return { label: 'Most Volatile',    color: '#f59e0b' }
    case 'new_ath':       return { label: 'New High',         color: '#a78bfa' }
    case 'most_traded':   return { label: 'Most Active',      color: '#3b82f6' }
    default:              return { label: cat,                color: '#94a3b8' }
  }
}

function heatColor(band: string) {
  switch (band) {
    case 'strong_up':   return { bg: 'rgba(34,197,94,0.15)',   border: 'rgba(34,197,94,0.3)',   text: '#16a34a' }
    case 'up':          return { bg: 'rgba(34,197,94,0.07)',   border: 'rgba(34,197,94,0.18)',  text: '#22c55e' }
    case 'strong_down': return { bg: 'rgba(239,68,68,0.15)',   border: 'rgba(239,68,68,0.3)',   text: '#dc2626' }
    case 'down':        return { bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.18)',  text: '#ef4444' }
    default:            return { bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.18)',text: '#94a3b8' }
  }
}

const upcomingReleases = [
  { name: 'Chaos Rising',       date: 'May 22, 2026', confirmed: true  },
  { name: 'Destined Rivals 2',  date: 'Jul 2026',      confirmed: false },
  { name: 'Mega Evolution Set', date: 'Aug 2026',      confirmed: false },
  { name: 'Journey Together 2', date: 'Q4 2026',       confirmed: false },
]

const features = [
  { icon: '📊', title: 'Real sold data',     desc: 'Prices from actual sold listings, not asking prices' },
  { icon: '🎯', title: 'Grading insights',   desc: 'Is it worth grading? See the PSA 10 premium and gem rate' },
  { icon: '📈', title: 'Market trends',      desc: 'Price movements, drawdowns and momentum for every card' },
  { icon: '🔒', title: 'No data collection', desc: 'No login, no tracking, no email capture — ever' },
]

// ── Main ──────────────────────────────────────────────────────────────────

export default function HomeClient() {
  const nextRelease = new Date('2026-05-22T00:00:00')
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0 })
  const [marketIndex, setMarketIndex] = useState<MarketIndexRow[]>([])
  const [totalMarket, setTotalMarket] = useState<{ value: number, pct30d: number | null, cardsTracked: number } | null>(null)
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportRow[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCard[]>([])
  const [hiddenGems, setHiddenGems] = useState<HiddenGem[]>([])
  const [heatmapUpdated, setHeatmapUpdated] = useState<string | null>(null)
  const [weeklyUpdated, setWeeklyUpdated] = useState<string | null>(null)

  useEffect(() => {
    const tick = () => {
      const diff = nextRelease.getTime() - Date.now()
      if (diff > 0) setCountdown({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        mins: Math.floor((diff % 3600000) / 60000),
      })
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    async function loadAnalytics() {
      const [indexRes, gemsRes, totalRes] = await Promise.all([
        supabase.from('market_index')
          .select('date, total_raw_usd, median_raw_usd, raw_pct_30d')
          .order('date', { ascending: true })
          .limit(80),
        supabase.rpc('get_hidden_gems', { lim: 6 }),
        supabase.rpc('get_market_total'),
      ])

      if (indexRes.data && indexRes.data.length > 0) {
        setMarketIndex(indexRes.data)
        const latest = indexRes.data[indexRes.data.length - 1]
        const displayValue = (totalRes.data as MarketTotal)?.total_raw_usd ?? latest.total_raw_usd
        const cardsTracked = (totalRes.data as MarketTotal)?.cards_tracked ?? 0
        const pct30d = latest.raw_pct_30d != null ? Number(latest.raw_pct_30d) : null
        setTotalMarket({ value: displayValue, pct30d, cardsTracked })
      }

      if (gemsRes.data && gemsRes.data.length > 0) setHiddenGems(gemsRes.data)
    }
    loadAnalytics()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load(attempt = 1) {
      const { data } = await supabase.rpc('get_weekly_market_report')
      if (cancelled) return
      if (data && data.length > 0) {
        setWeeklyReport(data)
        setWeeklyUpdated(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      } else if (attempt < 3) {
        setTimeout(() => load(attempt + 1), 1500 * attempt)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    async function loadHeatmap() {
      const res = await supabase.rpc('get_heatmap_top_cards', { lim: 30 })
      const rows = res.data?.results ?? res.data
      if (rows && rows.length > 0) {
        setHeatmap(rows)
        setHeatmapUpdated(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))
      }
    }
    loadHeatmap()
  }, [])

  const sparklineData = marketIndex.slice(-30).map(r => r.total_raw_usd / 100)
  const marketUp = (totalMarket?.pct30d ?? 0) >= 0

  return (
    <>
      {/* ── HERO ── */}
      <section style={{
        background: 'linear-gradient(170deg, #1a5fad 0%, #3b8fe8 35%, #6ab0f5 60%, #9dcbfa 80%, var(--bg) 100%)',
        padding: '40px 24px 70px', position: 'relative', overflow: 'hidden',
      }}>
        <PokemonSilhouettes />
        <Sparkles />
        <div style={{ maxWidth: 820, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
          <img src="/logo.png" alt="PokePrices" style={{
            height: 120, margin: '0 auto 16px', display: 'block',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.2))',
            animation: 'float 4s ease-in-out infinite',
          }} />

          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            {['100% Free', 'No Login', 'No Data Collection'].map(pill => (
              <span key={pill} style={{
                background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 11, fontWeight: 700,
                padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
                letterSpacing: 0.3, backdropFilter: 'blur(4px)',
              }}>{pill}</span>
            ))}
          </div>

          <h1 style={{
            fontSize: 38, color: '#fff', margin: '0 0 10px', lineHeight: 1.15,
            textShadow: '0 2px 10px rgba(0,0,0,0.15)', fontFamily: "'Outfit', sans-serif",
          }}>
            The numbers behind every<br /><span style={{ color: 'var(--accent)' }}>Pokémon</span> card
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, margin: '0 0 8px', lineHeight: 1.6, fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}>
            Live prices · PSA 10 values · Grading calculator · Collector&apos;s AI assistant
          </p>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, margin: '0 0 22px', lineHeight: 1.5, fontFamily: "'Figtree', sans-serif" }}>
            40,000+ cards · 156+ sets · Updated nightly from real sold listings
          </p>

          <ToolsRow />

          <div style={{ marginTop: 24, position: 'relative' }}>
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                background: 'linear-gradient(135deg, #ffcb05, #ffae00)',
                color: '#1a5fad',
                padding: '6px 8px 6px 14px',
                borderRadius: 22, fontSize: 12, fontWeight: 800,
                fontFamily: "'Figtree', sans-serif", letterSpacing: 0.2,
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
              }}>
                <span style={{ fontSize: 13 }}>✨</span>
                Try the collector&apos;s AI assistant
                <span aria-hidden style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'rgba(26,95,173,0.15)',
                  fontSize: 13, fontWeight: 900,
                  animation: 'bounce 1.4s ease-in-out infinite',
                }}>↓</span>
              </span>
            </div>

            <div style={{ maxWidth: 640, margin: '0 auto', position: 'relative' }}>
              <div aria-hidden style={{
                position: 'absolute', inset: -12, borderRadius: 28,
                background: 'radial-gradient(ellipse at center, rgba(255,203,5,0.5), rgba(106,176,245,0.25) 55%, transparent 78%)',
                filter: 'blur(18px)',
                animation: 'pulseGlow 3.2s ease-in-out infinite',
                pointerEvents: 'none',
              }} />
              <div style={{ position: 'relative' }}>
                <InlineChat />
              </div>
            </div>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 14, fontFamily: "'Figtree', sans-serif" }}>
            Free, no login — knows every card, set and sold price we track
          </p>
        </div>
      </section>

      {/* ── MARKET INDEX BANNER ── */}
      {totalMarket && (
        <section style={{ padding: '0 24px', maxWidth: 960, margin: '-28px auto 0', position: 'relative', zIndex: 10 }}>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18,
            boxShadow: '0 4px 24px rgba(26,95,173,0.10)', padding: '20px 28px',
            display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center',
          }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', margin: '0 0 6px', fontFamily: "'Figtree', sans-serif" }}>
                Pokémon TCG Market Index
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 34, fontWeight: 900, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", letterSpacing: -1 }}>
                  {formatMarketTotal(totalMarket.value)}
                </span>
                {totalMarket.pct30d != null && (
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: marketUp ? '#22c55e' : '#ef4444',
                    background: marketUp ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    padding: '3px 10px', borderRadius: 20, fontFamily: "'Figtree', sans-serif",
                  }}>
                    {marketUp ? '▲' : '▼'} {Math.abs(totalMarket.pct30d).toFixed(1)}% 30d
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 0', fontFamily: "'Figtree', sans-serif" }}>
                Ungraded (raw) card values
                {totalMarket.cardsTracked > 0 && ` · ${totalMarket.cardsTracked.toLocaleString()} cards tracked`}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <Sparkline data={sparklineData} color={marketUp ? '#22c55e' : '#ef4444'} height={48} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>30 day trend</span>
            </div>
          </div>
        </section>
      )}

      {/* ── WEEKLY MARKET REPORT ── */}
      {weeklyReport.length > 0 && (
        <section style={{ padding: '32px 24px 12px', maxWidth: 960, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
              This week in the market
            </h2>
            {weeklyUpdated && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                Updated {weeklyUpdated}
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px', fontFamily: "'Figtree', sans-serif" }}>
            Volume-verified signals from the market — min 3 confirmed sales
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            {weeklyReport.map(row => {
              const { label, color } = categoryMeta(row.category)
              const priceUsd = row.current_price / 100
              return (
                <Link key={row.category} href={`/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug || row.card_slug}`} style={{ textDecoration: 'none' }}>
                  <div style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
                    padding: '14px 16px', height: '100%', boxSizing: 'border-box',
                    transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'pointer',
                  }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.boxShadow = '' }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: 0.5, marginBottom: 7, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4, fontFamily: "'Figtree', sans-serif",
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {row.card_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, fontFamily: "'Figtree', sans-serif" }}>
                      {row.set_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                          ${priceUsd >= 100 ? priceUsd.toFixed(0) : priceUsd.toFixed(2)}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', letterSpacing: 0.5, fontFamily: "'Figtree', sans-serif" }}>
                          RAW
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color, fontWeight: 700, fontFamily: "'Figtree', sans-serif", textAlign: 'right', maxWidth: 90 }}>
                        {row.metric_label}
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* ── MARKET HEATMAP ── */}
      <section style={{ padding: '8px 24px 40px', maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 24, margin: '0 0 4px', fontFamily: "'Outfit', sans-serif" }}>Market Heatmap</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
              High-value actively-traded cards — colour shows 30-day price movement · min 3 confirmed sales
            </p>
          </div>
          {heatmapUpdated && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
              Updated {heatmapUpdated}
            </span>
          )}
        </div>
        {heatmap.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
              {heatmap.slice(0, 48).map(card => {
                const { bg, border, text } = heatColor(card.color_band)
                return (
                  <Link key={card.card_slug} href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug || card.card_slug}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 10px 8px', cursor: 'pointer', transition: 'opacity 0.12s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.opacity = '0.75'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.opacity = '1'}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 3, fontFamily: "'Figtree', sans-serif",
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {card.card_name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.set_name}
                      </div>
                      {card.is_recovery && (
                        <div style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', letterSpacing: 0.3, marginBottom: 4, fontFamily: "'Figtree', sans-serif" }}>
                          ↩ RECOVERY
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                            {card.price_usd != null ? `$${card.price_usd >= 100 ? Math.round(card.price_usd) : Number(card.price_usd).toFixed(2)}` : '—'}
                          </span>
                          <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--text-muted)', opacity: 0.7, fontFamily: "'Figtree', sans-serif", letterSpacing: 0.3 }}>RAW</span>
                        </div>
                        {card.pct_change != null && (
                          <span style={{ fontSize: 12, fontWeight: 800, color: text, fontFamily: "'Figtree', sans-serif" }}>
                            {card.pct_change > 0 ? '+' : ''}{Number(card.pct_change).toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[
                { band: 'strong_up',   label: '+10% or more' },
                { band: 'up',          label: '+2% to +10%'  },
                { band: 'flat',        label: 'Flat (±2%)'   },
                { band: 'down',        label: '-2% to -10%'  },
                { band: 'strong_down', label: '-10% or more' },
              ].map(({ band, label }) => {
                const { bg, border } = heatColor(band)
                return (
                  <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: bg, border: `1px solid ${border}` }} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{label}</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            Loading heatmap…
          </div>
        )}
      </section>

      {/* ── HIDDEN GEMS ── */}
      {hiddenGems.length > 0 && (
        <section style={{ padding: '0 24px 44px', maxWidth: 960, margin: '0 auto' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(167,139,250,0.07), rgba(59,130,246,0.05))',
            border: '1px solid rgba(167,139,250,0.18)', borderRadius: 18, padding: '24px',
          }}>
            <h2 style={{ fontSize: 20, margin: '0 0 4px', fontFamily: "'Outfit', sans-serif" }}>Hidden Gems</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px', fontFamily: "'Figtree', sans-serif" }}>
              Rising price · low pop · under the radar — volume-verified cards worth a closer look
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
              {hiddenGems.map(gem => {
                const priceUsd = gem.current_price / 100
                return (
                  <Link key={gem.card_slug} href={`/set/${encodeURIComponent(gem.set_name)}/card/${gem.card_url_slug || gem.card_slug}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      background: 'var(--card)', borderRadius: 12, border: '1px solid var(--border)',
                      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
                      cursor: 'pointer', transition: 'transform 0.15s',
                    }}
                      onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)'}
                      onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.transform = ''}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {gem.card_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: "'Figtree', sans-serif" }}>
                          {gem.set_name}
                          {gem.psa10_pop > 0 && <span style={{ marginLeft: 6, color: '#a78bfa' }}>pop {gem.psa10_pop}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                          ${priceUsd >= 100 ? priceUsd.toFixed(0) : priceUsd.toFixed(2)}
                        </div>
                        {gem.pct_30d != null && (
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', fontFamily: "'Figtree', sans-serif" }}>
                            +{Number(gem.pct_30d).toFixed(1)}% 30d
                          </div>
                        )}
                      </div>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        background: 'linear-gradient(135deg, #a78bfa, #3b82f6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 900, color: '#fff', fontFamily: "'Figtree', sans-serif",
                      }}>
                        {gem.gem_score}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── NEXT RELEASE ── */}
      <section style={{ padding: '0 24px 40px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 2px 15px rgba(37,99,168,0.06)' }}>
          <div style={{ background: 'linear-gradient(135deg, #1a5fad, #2874c8)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, margin: '0 0 2px', textTransform: 'uppercase', fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>Next Release</p>
              <h3 style={{ color: '#fff', fontSize: 22, margin: 0, fontWeight: 800, fontFamily: "'Outfit', sans-serif" }}>Chaos Rising</h3>
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: '2px 0 0', fontFamily: "'Figtree', sans-serif" }}>May 22, 2026</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ val: countdown.days, label: 'Days' }, { val: countdown.hours, label: 'Hrs' }, { val: countdown.mins, label: 'Min' }].map(t => (
                <div key={t.label} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: '8px 12px', textAlign: 'center', minWidth: 46, border: '1px solid rgba(255,203,5,0.2)' }}>
                  <div style={{ color: 'var(--accent)', fontSize: 20, fontWeight: 800, lineHeight: 1, fontFamily: "'Figtree', sans-serif" }}>{t.val}</div>
                  <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ padding: '16px 24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              {upcomingReleases.map(r => (
                <div key={r.name} style={{ padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border-light)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 2, fontFamily: "'Figtree', sans-serif" }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    {r.date}
                    {!r.confirmed && <span style={{ background: 'rgba(255,165,0,0.12)', color: '#b8741f', fontSize: 10, padding: '1px 6px', borderRadius: 4, marginLeft: 6, fontWeight: 700 }}>Rumoured</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── BUILT DIFFERENT ── */}
      <section style={{ padding: '16px 24px 44px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 24, textAlign: 'center', margin: '0 0 6px', fontFamily: "'Outfit', sans-serif" }}>Built for collectors, not investors</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14, margin: '0 0 28px', fontFamily: "'Figtree', sans-serif" }}>No login. No paywall. No data collection. Ever.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {features.map((f, i) => (
            <div key={f.title} className={`card-hover animate-fade-in-up delay-${i + 1}`} style={{ background: 'var(--card)', borderRadius: 16, padding: '22px 18px', border: '1px solid var(--border)', textAlign: 'center' }}>
              <div style={{ fontSize: 22, marginBottom: 8, color: 'var(--text-muted)' }}>{f.icon}</div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', fontFamily: "'Figtree', sans-serif" }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0, fontFamily: "'Figtree', sans-serif" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section style={{ background: 'linear-gradient(135deg, #1a5fad, #2874c8)', padding: '30px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', justifyContent: 'space-around', flexWrap: 'wrap', gap: 20 }}>
          {[
            { val: '40,000+',  label: 'Cards Tracked'  },
            { val: '156+',     label: 'Sets Covered'   },
            { val: '5+ Years', label: 'Price History'  },
            { val: 'Nightly',  label: 'Price Updates'  },
            { val: totalMarket ? formatMarketTotal(totalMarket.value) : '—', label: 'Market Tracked' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--accent)', fontSize: 26, fontWeight: 900, fontFamily: "'Figtree', sans-serif" }}>{s.val}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2, letterSpacing: 0.5, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── NEWSLETTER ── */}
      <section style={{ padding: '0 24px 44px', maxWidth: 680, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))',
          border: '1px solid rgba(26,95,173,0.2)', borderRadius: 20, padding: '32px 28px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📬</div>
          <h2 style={{ fontSize: 22, margin: '0 0 8px', fontFamily: "'Outfit', sans-serif", color: 'var(--text)' }}>
            Monthly collector digest
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 20px', lineHeight: 1.6, fontFamily: "'Figtree', sans-serif", maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            Market moves, biggest risers and fallers, grading tips, hidden gems and upcoming set previews — once a month, no spam, no paywall.
          </p>
          <NewsletterSignup source="homepage" />
          <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '12px 0 0', fontFamily: "'Figtree', sans-serif" }}>
            No login required. Unsubscribe any time.
          </p>
        </div>
      </section>

      {/* ── FAQ (visible content + FAQPage schema) ── */}
      <section style={{ padding: '24px 24px 44px', maxWidth: 680, margin: '0 auto' }}>
        <FAQ items={getHomeFaqItems()} title="Questions collectors ask" />
      </section>
    </>
  )
}