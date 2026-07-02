'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SearchBar from '@/components/SearchBar'
import InlineChat from '@/components/InlineChat'
import NewsletterSignup from '@/components/NewsletterSignup'
import FAQ from '@/components/FAQ'
import HomeMarketTicker from '@/components/home/HomeMarketTicker'
import HomeAccountRail from '@/components/home/HomeAccountRail'
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

type Insight = {
  id: string
  slug: string
  headline: string
  intro: string | null
  theme_label: string | null
  published_at: string
  image_url: string | null
  read_time_mins: number | null
}

// ── Featured tools ───────────────────────────────────────────────────────

// Block 5A-W-40B — dropped the per-card emoji glyphs. The coloured
// gradient block + bold title now carry the visual weight alone,
// matching the premium/data-market feel from the W40 design brief.
const FEATURED_TOOLS = [
  {
    title: 'Grading Calculator',
    blurb: 'PSA / CGC / BGS landed cost vs. graded uplift. Break-even at a glance.',
    href: '/dashboard/grading',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)',
  },
  {
    title: 'Studio',
    blurb: 'One-click branded graphics from any card or set, for X, Insta and Discord.',
    href: '/studio',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #7c3aed 100%)',
  },
  {
    title: 'Card Show Planner',
    blurb: 'UK & US Pokémon card shows, mapped and filtered. Plan your weekend.',
    href: '/dashboard/card-shows',
    accent: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)',
  },
]

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

function formatInsightDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const upcomingReleases = [
  { name: 'Mega Evolution — Pitch Black', date: 'Jul 17, 2026', confirmed: true  },
  { name: 'Journey Together 2',           date: 'Q4 2026',      confirmed: false },
]

// Block 5A-W-40B — dropped the leading emoji glyphs. Feature-tile
// headline + one-line description read as clean copy blocks now.
const features = [
  { title: 'Real sold data',     desc: 'Prices from actual sold listings, not asking prices' },
  { title: 'Grading insights',   desc: 'Is it worth grading? See the PSA 10 premium and gem rate' },
  { title: 'Market trends',      desc: 'Price movements, drawdowns and momentum for every card' },
  { title: 'No data collection', desc: 'No login, no tracking, no email capture — ever' },
]

// ── Main ──────────────────────────────────────────────────────────────────

export default function HomeClient() {
  const [marketIndex, setMarketIndex] = useState<MarketIndexRow[]>([])
  const [totalMarket, setTotalMarket] = useState<{ value: number, pct30d: number | null, cardsTracked: number } | null>(null)
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportRow[]>([])
  const [hiddenGems, setHiddenGems] = useState<HiddenGem[]>([])
  const [latestInsights, setLatestInsights] = useState<Insight[]>([])
  const [weeklyUpdated, setWeeklyUpdated] = useState<string | null>(null)

  useEffect(() => {
    async function loadAnalytics() {
      const [indexRes, gemsRes, totalRes, insightsRes] = await Promise.all([
        supabase.from('market_index')
          .select('date, total_raw_usd, median_raw_usd, raw_pct_30d')
          .order('date', { ascending: true })
          .limit(80),
        supabase.rpc('get_hidden_gems', { lim: 6 }),
        supabase.rpc('get_market_total'),
        supabase.from('insights')
          .select('id, slug, headline, intro, theme_label, published_at, image_url, read_time_mins')
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(3),
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
      if (insightsRes.data && insightsRes.data.length > 0) setLatestInsights(insightsRes.data)
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

  const sparklineData = marketIndex.slice(-30).map(r => r.total_raw_usd / 100)

  // Block 5A-W-41A — derive ticker top-riser / top-faller cells from
  // the already-loaded weekly report. Falls back to null when the
  // report hasn't returned yet, which the ticker component handles.
  const topRiserRow  = weeklyReport.find(r => r.category === 'top_riser')  ?? null
  const topFallerRow = weeklyReport.find(r => r.category === 'top_faller') ?? null
  const tickerTopRiser  = topRiserRow
    ? { name: topRiserRow.card_name, pctLabel: topRiserRow.metric_label }
    : null
  const tickerTopFaller = topFallerRow
    ? { name: topFallerRow.card_name, pctLabel: topFallerRow.metric_label }
    : null

  return (
    <>
      {/* Block 5A-W-41A — full-width market status strip. Replaces the
          old centred blue-gradient hero as the visual opening of the
          homepage. Data comes from the same RPCs the homepage already
          loads (market_index / get_market_total / get_weekly_report). */}
      <HomeMarketTicker
        marketValueCents={totalMarket?.value ?? null}
        pct30d={totalMarket?.pct30d ?? null}
        cardsTracked={totalMarket?.cardsTracked ?? null}
        setsTracked={null}
        latestSetName="Chaos Rising"
        topRiser={tickerTopRiser}
        topFaller={tickerTopFaller}
      />

      {/* ── DASHBOARD OPENING ── Block 5A-W-41A
           Three-panel opening that breaks out of the classic hero
           layout. Left rail: search + browse directory. Main
           workspace: this week in the market. Right rail: AI + account.
           Uses flex-wrap so the layout collapses to stacked panels on
           narrow widths without needing new @media rules. */}
      <section style={{ position: 'relative', overflow: 'hidden', background: 'var(--bg)' }}>
        <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.35 }}>
          <PokemonSilhouettes />
          <Sparkles />
        </div>
        <div style={{
          maxWidth: 1440, margin: '0 auto', padding: '20px 20px 28px',
          position: 'relative', zIndex: 1,
          display: 'flex', flexWrap: 'wrap', gap: 18,
          alignItems: 'flex-start',
        }}>
          {/* ── LEFT RAIL: Search & Browse ── */}
          <aside aria-label="Search and browse" style={{
            flex:  '1 1 240px', minWidth: 240, maxWidth: 320,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '18px 20px',
            fontFamily: "'Figtree', sans-serif",
          }}>
            <p style={{
              margin: '0 0 6px', fontSize: 10, fontWeight: 800,
              letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>PokePrices Market</p>
            <h1 style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: 20, fontWeight: 800, color: 'var(--text)',
              margin: '0 0 14px', lineHeight: 1.25, letterSpacing: -0.2,
            }}>
              The numbers behind every Pokémon card
            </h1>

            <SearchBar placeholder="Search cards, sets, Pokémon…" />

            <p style={{
              margin: '18px 0 8px', fontSize: 10, fontWeight: 800,
              letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>Search & Browse</p>
            <nav aria-label="Browse directory" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {[
                { label: 'Cards & Sets',   href: '/browse'         },
                { label: 'Pokémon Index',  href: '/pokemon'        },
                { label: 'Market Movers',  href: '#market-movers'  },
                { label: 'Insights',       href: '/insights'       },
                { label: 'Tools',          href: '/tools'          },
              ].map(item => (
                <Link key={item.label} href={item.href} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '9px 10px', borderRadius: 10,
                  color: 'var(--text)', textDecoration: 'none',
                  fontSize: 13.5, fontWeight: 700,
                }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = 'var(--bg-light)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.background = 'transparent' }}
                >
                  <span>{item.label}</span>
                  <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
                </Link>
              ))}
            </nav>

            <div style={{
              marginTop: 18, paddingTop: 14,
              borderTop: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column', gap: 4,
              fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.55,
            }}>
              <span>40,000+ cards</span>
              <span>156+ sets</span>
              <span>Updated nightly from sold listings</span>
            </div>
          </aside>

          {/* ── MAIN WORKSPACE: This week in the market ── */}
          <main style={{
            flex: '3 1 480px', minWidth: 300,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {weeklyReport.length > 0 ? (
              <section id="market-movers" style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '18px 20px',
                scrollMarginTop: 76, fontFamily: "'Figtree', sans-serif",
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>
                    This week in the market
                  </h2>
                  {weeklyUpdated && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Updated {weeklyUpdated}
                    </span>
                  )}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>
                  Volume-verified signals from the market — min 3 confirmed sales
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                  {weeklyReport.map(row => {
                    const { label, color } = categoryMeta(row.category)
                    const priceUsd = row.current_price / 100
                    return (
                      <Link key={row.category} href={`/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug || row.card_slug}`} style={{ textDecoration: 'none' }}>
                        <div style={{
                          background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 12,
                          padding: '13px 15px', height: '100%', boxSizing: 'border-box',
                          transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'pointer',
                        }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.transform = ''; el.style.boxShadow = '' }}
                        >
                          <div style={{ fontSize: 11, fontWeight: 800, color, letterSpacing: 0.5, marginBottom: 7, textTransform: 'uppercase' }}>
                            {label}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {row.card_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                            {row.set_name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
                                ${priceUsd >= 100 ? priceUsd.toFixed(0) : priceUsd.toFixed(2)}
                              </span>
                              <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', letterSpacing: 0.5 }}>
                                RAW
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color, fontWeight: 700, textAlign: 'right', maxWidth: 90 }}>
                              {row.metric_label}
                            </span>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </section>
            ) : (
              // Placeholder id="market-movers" even when the report hasn't
              // loaded yet — the ticker + left-rail deep-link both point
              // here, and the anchor should always resolve.
              <section id="market-movers" style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '18px 20px', scrollMarginTop: 76,
                fontFamily: "'Figtree', sans-serif",
              }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>
                  This week in the market
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
                  Loading volume-verified signals…
                </p>
              </section>
            )}
          </main>

          {/* ── RIGHT RAIL: AI + Account ── */}
          <div style={{
            flex: '1 1 260px', minWidth: 260, maxWidth: 340,
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* AI panel */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '18px 20px', fontFamily: "'Figtree', sans-serif",
            }}>
              <p style={{
                margin: '0 0 6px', fontSize: 10, fontWeight: 800,
                letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)',
              }}>Assistant</p>
              <h3 style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: 16, fontWeight: 800, color: 'var(--text)',
                margin: '0 0 6px',
              }}>Ask the market assistant</h3>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
                Ask about card values, PSA 10 prices, set trends and grading.
              </p>
              <InlineChat />
              <Link href="/ai-assistant" style={{
                display: 'inline-block', marginTop: 10,
                fontSize: 11, fontWeight: 800, color: 'var(--primary)',
                textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.5,
              }}>
                Open full assistant →
              </Link>
            </div>
            {/* Auth-aware account panel */}
            <HomeAccountRail />
            {/* Tiny "30-day trend" mini card retains the sparkline that
                used to sit in the removed market index banner. Only
                renders when there's sparkline data to show. */}
            {sparklineData.length >= 2 && (
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '14px 18px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, fontFamily: "'Figtree', sans-serif",
              }}>
                <div>
                  <p style={{
                    margin: '0 0 4px', fontSize: 10, fontWeight: 800,
                    letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)',
                  }}>30-day trend</p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Raw market index</p>
                </div>
                <Sparkline data={sparklineData} color={(totalMarket?.pct30d ?? 0) >= 0 ? '#22c55e' : '#ef4444'} height={40} />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── BROWSE DISCOVERY ── Block 5A-W-40B
           Four clean text-only cards that route visitors into the
           four highest-value browse destinations. Sits above the
           Featured Tools row because browsing is more important
           than secondary tools. */}
      <section style={{ padding: '36px 24px 8px', maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, margin: '0 0 14px', fontFamily: "'Outfit', sans-serif" }}>Start browsing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            { title: 'Browse Cards & Sets',   desc: '40,000+ Pokémon cards across 156+ sets. Live raw and PSA 10 prices, grading data, and set completion tools.', href: '/browse'         },
            { title: 'Browse Pokémon',        desc: "Every Pokémon species with all its cards, prices and grading history in one place.",                       href: '/pokemon'        },
            { title: 'Follow Market Movers',  desc: 'This week’s top risers, fallers, most volatile and most-traded cards — volume-verified.',            href: '#market-movers'  },
            { title: 'Read Market Insights',  desc: 'Grading guides, PSA 10 value gaps, chase-card analysis and market breakdowns.',                              href: '/insights'       },
          ].map(card => (
            <Link key={card.title} href={card.href} style={{
              display: 'flex', flexDirection: 'column', textDecoration: 'none',
              background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)',
              padding: '20px 22px', transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
              fontFamily: "'Figtree', sans-serif",
            }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.06)'; el.style.borderColor = 'var(--primary)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = ''; el.style.boxShadow = ''; el.style.borderColor = 'var(--border)' }}
            >
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', fontFamily: "'Outfit', sans-serif", lineHeight: 1.2 }}>
                {card.title}
              </h3>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55 }}>
                {card.desc}
              </p>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto' }}>
                Open →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── FEATURED TOOLS ── */}
      <section style={{ padding: '36px 24px 8px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <h2 style={{ fontSize: 22, margin: 0, fontFamily: "'Outfit', sans-serif" }}>Tools collectors actually use</h2>
          <Link href="/tools" style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.5 }}>
            All tools →
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {FEATURED_TOOLS.map(tool => (
            <Link key={tool.title} href={tool.href} style={{
              display: 'flex', flexDirection: 'column', textDecoration: 'none',
              background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)',
              overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = ''; el.style.boxShadow = '' }}
            >
              <div style={{
                background: tool.accent, color: '#fff', padding: '24px 20px',
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, minHeight: 120,
              }}>
                <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Outfit', sans-serif", lineHeight: 1.15, marginTop: 'auto' }}>
                  {tool.title}
                </div>
              </div>
              <div style={{ padding: '14px 18px 18px', flex: 1, display: 'flex', flexDirection: 'column', fontFamily: "'Figtree', sans-serif" }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 12px' }}>
                  {tool.blurb}
                </p>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto' }}>
                  Open tool →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── HIDDEN GEMS ── */}
      {hiddenGems.length > 0 && (
        <section style={{ padding: '36px 24px 0', maxWidth: 960, margin: '0 auto' }}>
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

      {/* ── JUST RELEASED (Chaos Rising) ── */}
      <section style={{ padding: '36px 24px 8px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 2px 15px rgba(37,99,168,0.06)' }}>
          <Link href="/set/Chaos%20Rising" style={{
            display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
            background: 'linear-gradient(135deg, #1a5fad, #2874c8)', padding: '22px 24px',
            textDecoration: 'none', transition: 'filter 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.filter = 'brightness(1.08)'}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.filter = ''}
          >
            <img src="/set-assets/logos/Chaos Rising.webp" alt="Chaos Rising"
              style={{ height: 64, width: 'auto', maxWidth: 220, objectFit: 'contain',
                filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.25))', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  background: 'var(--accent)', color: '#1a1a1a', fontSize: 10, fontWeight: 900,
                  padding: '3px 8px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase',
                  fontFamily: "'Figtree', sans-serif",
                }}>New Set</span>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
                  Just Released
                </span>
              </div>
              <h3 style={{ color: '#fff', fontSize: 22, margin: 0, fontWeight: 800, fontFamily: "'Outfit', sans-serif" }}>Chaos Rising</h3>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, margin: '2px 0 0', fontFamily: "'Figtree', sans-serif" }}>
                Released May 22, 2026 · Mega Evolution era
              </p>
            </div>
            <span style={{
              background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 13, fontWeight: 800,
              padding: '10px 18px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)',
              fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
            }}>
              Explore the set →
            </span>
          </Link>
          <div style={{ padding: '16px 24px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', margin: '0 0 10px', fontFamily: "'Figtree', sans-serif" }}>
              Coming next
            </p>
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

      {/* ── LATEST GUIDES ── Block 5A-W-40B moved from position 5 →
           position 9 (between Just Released and Built Different) so
           the browse-oriented sections stay at the top of the page. */}
      {latestInsights.length > 0 && (
        <section style={{ padding: '36px 24px 8px', maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <h2 style={{ fontSize: 22, margin: 0, fontFamily: "'Outfit', sans-serif" }}>Latest guides</h2>
            <Link href="/insights" style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.5 }}>
              All guides →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {latestInsights.map(insight => (
              <Link key={insight.id} href={`/insights/${insight.slug}`} style={{
                display: 'flex', flexDirection: 'column', textDecoration: 'none',
                background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)',
                overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = ''; el.style.boxShadow = '' }}
              >
                {insight.image_url ? (
                  <img src={insight.image_url} alt="" style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: 140, background: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)' }} />
                )}
                <div style={{ padding: '14px 18px 18px', flex: 1, display: 'flex', flexDirection: 'column', fontFamily: "'Figtree', sans-serif" }}>
                  {insight.theme_label && (
                    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
                      {insight.theme_label}
                    </div>
                  )}
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.3, fontFamily: "'Outfit', sans-serif" }}>
                    {insight.headline}
                  </h3>
                  {insight.intro && (
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 12px',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {insight.intro}
                    </p>
                  )}
                  <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatInsightDate(insight.published_at)}
                    {insight.read_time_mins ? ` · ${insight.read_time_mins} min read` : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── BUILT DIFFERENT ── */}
      <section style={{ padding: '36px 24px 44px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 24, textAlign: 'center', margin: '0 0 6px', fontFamily: "'Outfit', sans-serif" }}>Built for collectors, not investors</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: 14, margin: '0 0 28px', fontFamily: "'Figtree', sans-serif" }}>No login. No paywall. No data collection. Ever.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {features.map((f, i) => (
            <div key={f.title} className={`card-hover animate-fade-in-up delay-${i + 1}`} style={{ background: 'var(--card)', borderRadius: 16, padding: '22px 18px', border: '1px solid var(--border)', textAlign: 'center' }}>
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
      <section style={{ padding: '44px 24px 44px', maxWidth: 680, margin: '0 auto' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))',
          border: '1px solid rgba(26,95,173,0.2)', borderRadius: 20, padding: '32px 28px', textAlign: 'center',
        }}>
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
      <section style={{ padding: '0 24px 44px', maxWidth: 680, margin: '0 auto' }}>
        <FAQ items={getHomeFaqItems()} title="Questions collectors ask" />
      </section>
    </>
  )
}
