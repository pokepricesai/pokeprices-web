'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import SearchBar from '@/components/SearchBar'
import InlineChat from '@/components/InlineChat'
import NewsletterSignup from '@/components/NewsletterSignup'
import FAQ from '@/components/FAQ'
import { getHomeFaqItems } from '@/lib/faqs'
import { getSetAssets } from '@/lib/setAssets'

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
  // Block 5A-W-56A — Deep Card Search featured first because it
  // covers the primary user question ("which card matches my
  // budget?") that everything else on the site indirectly supports.
  {
    title: 'Deep Card Search',
    blurb: 'Search all English and Japanese Pokémon cards by price, PSA grade, Pokémon, set and market movement.',
    href: '/cards/search',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #e68a40 100%)',
  },
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

// The `upcomingReleases` / "coming next" list was retired on 2026-09-19.
// It sat below the previous "Just Released" banner, promoted planned
// English sets, and required manual editorial updates that reliably
// went stale (First Partner Series 3 shipped in August; the 30th
// Anniversary entry was still marked "coming next" the day the set
// actually launched). It has been replaced by a Recently Added Sets
// strip further down the page which surfaces live catalogue content
// instead of speculating about future releases.
//
// If you want to bring the upcoming-releases list back, restore the
// `type UpcomingRelease` + `upcomingReleases` const from git history
// and reintroduce the render block that used to live below the
// Just Released banner (see commit 6c22a36 for the full shape).

// Recently added English sets — displayed in the "Recently added"
// strip that replaced the "Coming next" list.
//
// Source (refresh when a new English set launches — usually 4–6× a
// year, on the same day the scraper batch line is added):
//     SELECT set_name, MAX(set_release_date) AS d
//     FROM   cards
//     WHERE  language = 'en' AND set_release_date IS NOT NULL
//     GROUP  BY set_name
//     ORDER  BY d DESC
//     LIMIT  4
// Last refreshed: 2026-09-19.
type RecentSet = { name: string; date: string; releaseISO: string }
const recentEnglishSets: RecentSet[] = [
  { name: '30th Celebration', date: 'Released 16 September 2026', releaseISO: '2026-09-16' },
  { name: 'Pitch Black',      date: 'Released 17 July 2026',      releaseISO: '2026-07-17' },
  { name: 'Chaos Rising',     date: 'Released 22 May 2026',       releaseISO: '2026-05-22' },
  { name: 'Perfect Order',    date: 'Released 27 March 2026',     releaseISO: '2026-03-27' },
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

  // Block 5A-W-41A-RETRY — inline auth-aware CTA for the split-hero
  // left column. Same Supabase session pattern the previous hero
  // quick-action block used; kept inline rather than in a separate
  // component to keep the retry diff small.
  const [isAuthed, setIsAuthed] = useState(false)
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (live) setIsAuthed(!!session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (live) setIsAuthed(!!session)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])

  const sparklineData = marketIndex.slice(-30).map(r => r.total_raw_usd / 100)
  const marketUp = (totalMarket?.pct30d ?? 0) >= 0

  return (
    <>
      {/* ── SPLIT HERO ── Block 5A-W-41A-RETRY
           Two-column asymmetric hero replacing the classic centred
           SaaS stack. Left column carries the brand + primary CTAs;
           right column carries the AI panel and a small market pulse
           card. At <1024 the columns stack into a natural mobile
           order. No dashboard/terminal styling — this is still a
           friendly, blue, Pokémon-flavoured homepage; the change is
           layout, not visual identity. */}
      <section style={{
        background: 'linear-gradient(170deg, #1a5fad 0%, #3b8fe8 32%, #6ab0f5 58%, #b8dbfb 82%, var(--bg) 100%)',
        padding: '28px 24px 44px', position: 'relative', overflow: 'hidden',
      }}>
        {/* Scoped responsive rules for the split hero grid. Kept
            inline in the client component so no new CSS module is
            introduced. */}
        <style dangerouslySetInnerHTML={{ __html: `
          .pp-split-hero { display: flex; flex-direction: column; gap: 20px; }
          .pp-split-hero-left, .pp-split-hero-right { min-width: 0; }
          @media (min-width: 1024px) {
            .pp-split-hero {
              display: grid;
              grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
              gap: 36px;
              align-items: start;
            }
          }
        ` }} />
        <PokemonSilhouettes />
        <Sparkles />
        <div className="pp-split-hero" style={{
          maxWidth: 1200, margin: '0 auto',
          position: 'relative', zIndex: 1,
        }}>
          {/* ── LEFT COLUMN: brand, headline, search, actions ── */}
          <div className="pp-split-hero-left">
            <img src="/logo.png" alt="PokePrices" style={{
              height: 68, width: 'auto', display: 'block', marginBottom: 12,
              filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.2))',
            }} />

            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {['100% Free', 'No Login', 'No Data Collection', 'Japanese Sets Included'].map(pill => (
                <span key={pill} style={{
                  background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 11, fontWeight: 700,
                  padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.2)',
                  letterSpacing: 0.3, backdropFilter: 'blur(4px)',
                }}>{pill}</span>
              ))}
            </div>

            {/* H1 is single-colour on purpose — Block 5A-W-41A-RETRY
                dropped the yellow "Pokémon" accent split because it
                read as a generic AI-template treatment. */}
            <h1 style={{
              fontSize: 42, color: '#fff', margin: '0 0 12px',
              lineHeight: 1.12, letterSpacing: -0.5,
              textShadow: '0 2px 10px rgba(0,0,0,0.15)',
              fontFamily: "'Outfit', sans-serif", fontWeight: 800,
            }}>
              The numbers behind every Pokémon card
            </h1>
            <p style={{
              color: 'rgba(255,255,255,0.9)', fontSize: 15, margin: '0 0 20px',
              lineHeight: 1.55, fontFamily: "'Figtree', sans-serif", fontWeight: 600,
            }}>
              Live values · PSA 10 data · grading insights · 65,000+ cards · English & Japanese sets
            </p>

            <div style={{ maxWidth: 560, marginBottom: 10 }}>
              <SearchBar placeholder='Search cards, sets, Pokémon… try "Charizard Base Set"' />
            </div>
            <p style={{
              color: 'rgba(255,255,255,0.6)', fontSize: 11, margin: '0 0 16px',
              fontFamily: "'Figtree', sans-serif",
            }}>
              Updated nightly from real sold listings — no asking prices, no guesses
            </p>

            {/* Browse links — quiet inline row so they don't compete
                with the primary Search + Sign-up CTAs. */}
            <nav aria-label="Browse" style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14,
            }}>
              {[
                { label: 'Browse Cards & Sets', href: '/browse'        },
                { label: 'Browse Pokémon',      href: '/pokemon'       },
                { label: 'Market Movers',       href: '#market-movers' },
                { label: 'Insights',            href: '/insights'      },
              ].map(item => (
                <Link key={item.label} href={item.href} style={{
                  display: 'inline-flex', alignItems: 'center',
                  padding: '7px 14px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.12)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.22)',
                  fontSize: 12.5, fontWeight: 700, letterSpacing: 0.2,
                  textDecoration: 'none', backdropFilter: 'blur(4px)',
                  fontFamily: "'Figtree', sans-serif",
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.20)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(255,255,255,0.12)' }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Auth-aware CTA row. Signed-out visitors see the primary
                Sign-up-free pill + Log-in text link + a single-line
                strapline that lightly hints at the future personal
                dashboard. Signed-in visitors see Dashboard/Watchlist/
                Portfolio entry points. */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              {isAuthed ? (
                <>
                  <Link href="/dashboard" style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '11px 20px', borderRadius: 999,
                    background: 'var(--accent)', color: '#1a1a1a',
                    border: '1px solid var(--accent)',
                    fontSize: 14, fontWeight: 800, textDecoration: 'none',
                    boxShadow: '0 4px 14px rgba(255,203,5,0.30)',
                    fontFamily: "'Figtree', sans-serif",
                  }}>My Dashboard</Link>
                  <Link href="/dashboard/watchlist-alerts" style={{
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    textDecoration: 'none', letterSpacing: 0.2,
                    fontFamily: "'Figtree', sans-serif",
                  }}>My Watchlist →</Link>
                  <Link href="/dashboard/portfolio" style={{
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    textDecoration: 'none', letterSpacing: 0.2,
                    fontFamily: "'Figtree', sans-serif",
                  }}>My Portfolio →</Link>
                </>
              ) : (
                <>
                  <Link href="/dashboard/login?mode=signup" style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '11px 20px', borderRadius: 999,
                    background: 'var(--accent)', color: '#1a1a1a',
                    border: '1px solid var(--accent)',
                    fontSize: 14, fontWeight: 800, textDecoration: 'none',
                    boxShadow: '0 4px 14px rgba(255,203,5,0.30)',
                    fontFamily: "'Figtree', sans-serif",
                  }}>Sign up free</Link>
                  <Link href="/dashboard/login" style={{
                    fontSize: 13, fontWeight: 700, color: '#fff',
                    textDecoration: 'none', letterSpacing: 0.2,
                    fontFamily: "'Figtree', sans-serif",
                  }}>Log in →</Link>
                  <span style={{
                    fontSize: 11.5, color: 'rgba(255,255,255,0.70)', lineHeight: 1.4,
                    fontFamily: "'Figtree', sans-serif", flexBasis: '100%',
                  }}>
                    Track cards, follow sets, build your own collector dashboard.
                  </span>
                </>
              )}
            </div>

            {/* ── 30TH CELEBRATION NEW-RELEASE HERO BANNER ──
                Primary new-release promotion. Sits inside the hero
                left column beneath the auth-aware CTA row, so it's
                visible without any scroll on desktop AND mobile.
                Whole banner is a single crawlable Next.js <Link>
                to /set/30th%20Celebration — no JS-only navigation.
                There is only ONE new-release feature on the page;
                the earlier lower banner was removed as part of the
                same change (see git commit history for the diff).
                No 30th Celebration logo exists in
                public/set-assets/logos/, so the visual anchor is a
                text-only "30" mark in the Outfit display font —
                nothing invented or hotlinked. */}
            <Link href="/set/30th%20Celebration" style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              marginTop: 20, padding: '18px 20px', borderRadius: 18,
              background: 'linear-gradient(135deg, #b8791a 0%, #d99525 45%, #b8791a 100%)',
              border: '1px solid rgba(255,255,255,0.22)',
              boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
              textDecoration: 'none', color: '#fff',
              transition: 'filter 0.15s',
              maxWidth: 560,
            }}
              onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.filter = 'brightness(1.08)'}
              onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.filter = ''}
            >
              {/* Real 30th Celebration set logo — dropped in on
                  2026-09-19, replacing the temporary text-only "30"
                  mark used on launch day. Sized to sit comfortably
                  alongside the copy on desktop and reflow to top of
                  the stack on mobile via the parent flexWrap. Height
                  is capped and objectFit keeps the aspect ratio, so
                  a wider or narrower logo cannot warp. */}
              <img
                src="/set-assets/logos/30th Celebration.webp"
                alt="Pokémon 30th Celebration — set logo"
                style={{
                  flexShrink: 0, height: 68, width: 'auto',
                  maxWidth: 200, objectFit: 'contain',
                  filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.28))',
                }}
                loading="eager"
              />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    background: 'var(--accent)', color: '#1a1a1a', fontSize: 10, fontWeight: 900,
                    padding: '3px 8px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase',
                    fontFamily: "'Figtree', sans-serif",
                  }}>New Release</span>
                </div>
                <span style={{
                  display: 'block', fontSize: 22, fontWeight: 800,
                  color: '#fff', fontFamily: "'Outfit', sans-serif",
                  lineHeight: 1.15, letterSpacing: -0.2,
                }}>Pokémon 30th Celebration</span>
                <span style={{
                  display: 'block', fontSize: 12.5,
                  color: 'rgba(255,255,255,0.90)', marginTop: 4,
                  fontFamily: "'Figtree', sans-serif", lineHeight: 1.45,
                }}>
                  158-card main set + 30 Classic Collection reprints · live prices and graded values
                </span>
              </div>
              <span style={{
                fontSize: 13, fontWeight: 800, color: '#fff',
                padding: '9px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.32)',
                whiteSpace: 'nowrap', flexShrink: 0,
                fontFamily: "'Figtree', sans-serif",
              }}>Explore 30th Celebration →</span>
            </Link>
          </div>

          {/* ── RIGHT COLUMN: AI panel + Market pulse card ── */}
          <div className="pp-split-hero-right" style={{
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {/* AI panel — surfaces the assistant in the hero without
                making it the identity of the site. InlineChat behaviour
                is unchanged; only its container moved from a standalone
                section below the hero into the right column here. */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18,
              padding: '18px 20px', boxShadow: '0 4px 18px rgba(0,0,0,0.08)',
              fontFamily: "'Figtree', sans-serif",
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <p style={{
                  margin: 0, fontSize: 10, fontWeight: 800,
                  letterSpacing: 1.5, textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>Assistant</p>
                <Link href="/ai-assistant" style={{
                  fontSize: 10.5, fontWeight: 800, color: 'var(--primary)',
                  textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.4,
                }}>
                  Open full assistant →
                </Link>
              </div>
              <h2 style={{
                fontSize: 18, margin: '0 0 6px',
                fontFamily: "'Outfit', sans-serif", color: 'var(--text)', fontWeight: 800,
              }}>
                Ask the market assistant
              </h2>
              <p style={{
                fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55,
              }}>
                Ask about card values, PSA 10 prices, set trends and grading.
              </p>
              <InlineChat />
            </div>

            {/* Market pulse — small card, light styling on the hero.
                Not a Bloomberg-style ticker; a friendly at-a-glance
                summary of the same numbers that used to live in the
                standalone market-index banner below the hero. */}
            {totalMarket && (
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18,
                padding: '16px 20px', boxShadow: '0 4px 18px rgba(0,0,0,0.06)',
                fontFamily: "'Figtree', sans-serif",
              }}>
                <p style={{
                  margin: '0 0 6px', fontSize: 10, fontWeight: 800,
                  letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)',
                }}>Market pulse</p>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 28, fontWeight: 900, color: 'var(--text)', letterSpacing: -0.6,
                    }}>{formatMarketTotal(totalMarket.value)}</span>
                    {totalMarket.pct30d != null && (
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: marketUp ? '#22c55e' : '#ef4444',
                        background: marketUp ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                        padding: '3px 9px', borderRadius: 20,
                      }}>
                        {marketUp ? '▲' : '▼'} {Math.abs(totalMarket.pct30d).toFixed(1)}% 30d
                      </span>
                    )}
                  </div>
                  {sparklineData.length >= 2 && (
                    <Sparkline data={sparklineData} color={marketUp ? '#22c55e' : '#ef4444'} height={36} />
                  )}
                </div>
                <p style={{
                  color: 'var(--text-muted)', fontSize: 11.5, margin: '6px 0 0', lineHeight: 1.5,
                }}>
                  65,000+ cards · 280+ sets · updated nightly
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── WEEKLY MARKET REPORT (pulse strip) ── */}
      {weeklyReport.length > 0 && (
        <section id="market-movers" style={{ padding: '32px 24px 12px', maxWidth: 960, margin: '0 auto', scrollMarginTop: 76 }}>
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

      {/* ── BROWSE DISCOVERY ── Block 5A-W-40B
           Four clean text-only cards that route visitors into the
           four highest-value browse destinations. Sits above the
           Featured Tools row because browsing is more important
           than secondary tools. */}
      <section style={{ padding: '36px 24px 8px', maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, margin: '0 0 14px', fontFamily: "'Outfit', sans-serif" }}>Start browsing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {[
            { title: 'Browse Cards & Sets',   desc: '65,000+ Pokémon cards across 280+ sets. Live raw and PSA 10 prices, grading data, and set completion tools.', href: '/browse'         },
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

      {/* ── RECENTLY ADDED SETS ──
          Replaces the previous "Coming next" / upcoming-releases strip
          (retired 2026-09-19 — it kept going stale). This strip surfaces
          the four most recently added English catalogue sets instead,
          each a normal Next.js <Link> to its live set page. The list is
          hardcoded from a DB query at deploy time (see the comment on
          `recentEnglishSets`); refresh when a new English set launches. */}
      <section style={{ padding: '36px 24px 8px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: '0 2px 15px rgba(37,99,168,0.06)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0, fontFamily: "'Figtree', sans-serif", fontWeight: 800, color: 'var(--text)', letterSpacing: 0.3, textTransform: 'uppercase' }}>
              Recently added sets
            </h2>
            <Link href="/browse" style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', letterSpacing: 0.4 }}>
              Browse all sets →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {recentEnglishSets.map(s => {
              // Reuses the same LOGO_MAP / SYMBOL_MAP the set page and
              // card page consume — no special-case rendering, just a
              // small symbol adornment next to each set name to match
              // the visual convention elsewhere on the site.
              const { symbolUrl } = getSetAssets(s.name)
              return (
              <Link key={s.name} href={`/set/${encodeURIComponent(s.name)}`} style={{
                display: 'flex', flexDirection: 'column',
                padding: '14px 16px', background: 'var(--bg-light)',
                borderRadius: 12, border: '1px solid var(--border-light)',
                textDecoration: 'none', color: 'inherit',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = 'translateY(-2px)'; el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.08)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLAnchorElement; el.style.transform = ''; el.style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {symbolUrl && (
                    <img
                      src={symbolUrl}
                      alt=""
                      style={{ width: 22, height: 22, objectFit: 'contain', flexShrink: 0 }}
                      loading="lazy"
                    />
                  )}
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", lineHeight: 1.2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.name}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>
                  {s.date}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--primary)', fontWeight: 800, marginTop: 10, letterSpacing: 0.3, fontFamily: "'Figtree', sans-serif" }}>
                  Explore set →
                </span>
              </Link>
              )
            })}
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
            // Numbers refreshed 2026-09-19 from the live DB:
            //   SELECT COUNT(*)                 FROM cards → 65,040
            //   SELECT COUNT(DISTINCT set_name) FROM cards → 288
            // Rounded down slightly for the "+" phrasing.
            { val: '65,000+',  label: 'Cards Tracked'  },
            { val: '280+',     label: 'Sets Covered'   },
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
