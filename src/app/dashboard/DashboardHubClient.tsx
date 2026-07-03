'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import AvatarPicker from '@/components/AvatarPicker'
import ComingSoonBadge from '@/components/ComingSoonBadge'
import DashboardNav from './DashboardNav'
import AccountPlanBadge from '@/components/account/AccountPlanBadge'
import DashboardOnboardingChecklist from '@/components/dashboard/DashboardOnboardingChecklist'
import PotentialDealsSection from '@/components/dashboard/PotentialDealsSection'
import {
  loadPortfolioSummary,
  formatPortfolioValue,
  type PortfolioSummaryCurrency,
  type PortfolioSummaryItem,
} from '@/lib/account/portfolioSummary'

// Block 5A-W-42A — dashboard hub upgraded from a bare tools directory
// into a "My PokePrices" personal summary page. Existing tables /
// RPCs only; no schema, no new RPC.
//
// Layout (top → bottom):
//   1. DashboardNav (unchanged)
//   2. Avatar prompt banner (unchanged, banner glyph removed)
//   3. Header: "My PokePrices" + strapline + AccountPlanBadge
//   4. DashboardOnboardingChecklist (unchanged, self-hides)
//   5. Personal snapshot row: Portfolio · Watchlist · Alerts
//   6. Market movement for you (top 5 personal movers)
//   7. Tools tile grid (kept, emoji glyphs stripped)
//   8. Free-forever footer + AvatarPicker mount

// ── Types ─────────────────────────────────────────────────────────────────

interface PortfolioSnapshot {
  totalCents:      number
  itemCount:       number       // sum of quantity across deduped items — matches PortfolioDashboard.item_count
  uniqueCards:     number       // count of distinct card_slug across deduped items — matches PortfolioDashboard.unique_cards
  pct30dWeighted:  number | null
  currency:        PortfolioSummaryCurrency  // Block 5A-W-42A-FIX4 — display currency from user_email_preferences
}

interface WatchlistTopMover {
  card_name:      string
  set_name:       string
  card_url_slug:  string | null
  card_slug:      string
  pct:            number
}

interface WatchlistSnapshot {
  count:     number
  topMover:  WatchlistTopMover | null
}

interface AlertRow {
  id:           string
  card_name:    string | null
  set_name:     string | null
  rule:         string | null
  detected_at:  string
}

interface AlertsSnapshot {
  recent:    AlertRow[]
  count30d:  number
}

interface Mover {
  card_slug:      string
  card_url_slug:  string | null
  card_name:      string
  set_name:       string
  current_cents:  number | null
  pct_7d:         number | null
  pct_30d:        number | null
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Currency-aware value formatting lives in
// src/lib/account/portfolioSummary.ts::formatPortfolioValue and is
// imported at the top of this file. Both the portfolio snapshot and
// the movers row use it so the hub renders one currency, matching
// the user's display_currency preference.

function fmtPct(pct: number | null | undefined): { text: string; color: string } {
  if (pct == null) return { text: '—', color: 'var(--text-muted)' }
  const n = Number(pct)
  if (Number.isNaN(n)) return { text: '—', color: 'var(--text-muted)' }
  const color = n > 0 ? '#22c55e' : n < 0 ? '#ef4444' : 'var(--text-muted)'
  const arrow = n > 0 ? '▲' : n < 0 ? '▼' : ''
  return { text: `${arrow ? arrow + ' ' : ''}${Math.abs(n).toFixed(1)}%`, color }
}

// alert_events.rule → human label. Matches the six production rule
// names from migrations/2026-06-23-user-alert-preferences.sql.
function ruleLabel(rule: string | null | undefined): string {
  switch (rule) {
    case 'price_move':      return 'Price move'
    case 'recent_sales':    return 'Recent sales'
    case 'psa10_change':    return 'PSA 10 change'
    case 'raw_change':      return 'Raw price change'
    case 'spread_change':   return 'Spread change'
    case 'market_activity': return 'Market activity'
    default:                return rule || 'Alert'
  }
}

function cardHref(setName: string | null, cardUrlSlug: string | null, cardSlug: string): string {
  if (!setName) return '/dashboard/portfolio'
  return `/set/${encodeURIComponent(setName)}/card/${cardUrlSlug || cardSlug}`
}

// ── Main component ────────────────────────────────────────────────────────

export default function DashboardHubClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [portfolioSnap, setPortfolioSnap] = useState<PortfolioSnapshot | null>(null)
  const [watchSnap,     setWatchSnap]     = useState<WatchlistSnapshot | null>(null)
  const [alertsSnap,    setAlertsSnap]    = useState<AlertsSnapshot | null>(null)
  const [movers,        setMovers]        = useState<Mover[]>([])

  const [avatarPokemonId, setAvatarPokemonId] = useState<number | null>(null)
  const [pickerOpen,       setPickerOpen]      = useState(false)
  const [bannerDismissed,  setBannerDismissed] = useState(false)

  // ── Auth session ──────────────────────────────────────────────────────
  useEffect(() => {
    function applyUser(u: any) {
      setUser(u)
      const pid = u?.user_metadata?.avatar_pokemon_id
      setAvatarPokemonId(typeof pid === 'number' ? pid : null)
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/dashboard/login'); return }
      applyUser(session.user)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.replace('/dashboard/login')
      else applyUser(session.user)
    })
    try {
      if (typeof window !== 'undefined' && window.sessionStorage.getItem('pp-avatar-banner-dismissed') === '1') {
        setBannerDismissed(true)
      }
    } catch {}
    return () => subscription.unsubscribe()
  }, [])

  // ── Load personal snapshot ────────────────────────────────────────────
  // Block 5A-W-42A-FIX4 — data sources:
  //
  //   * PORTFOLIO  — loadPortfolioSummary() (shared helper). Fully
  //                  mirrors PortfolioDashboard.loadPortfolio: primary
  //                  is_default portfolio (limit 1), get_portfolio_summary
  //                  RPC, dedupe by id, card_trends + daily_prices
  //                  recompute, and display_currency preference.
  //   * WATCHLIST  — get_watchlist_with_prices RPC (unchanged)
  //   * ALERTS     — alert_events by user_id, last 30d (unchanged)
  //
  // Each query is wrapped so a failure in one section still lets the
  // others render.
  useEffect(() => {
    if (!user) return
    let live = true

    async function load() {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

      // Hoisted so the movers merge below can reuse the summary items
      // without a second query.
      const portfolioItems: PortfolioSummaryItem[] = []

      // ── Portfolio ────────────────────────────────────────────────────
      // Block 5A-W-42A-FIX4 — single call to the shared summary helper
      // which fully mirrors PortfolioDashboard.loadPortfolio (limit(1)
      // scope, dedupe by id, card_trends + daily_prices recompute,
      // display_currency preference). The hub therefore renders exactly
      // the same value, item count, unique count and currency as
      // /dashboard/portfolio — no independent approximation.
      try {
        const summary = await loadPortfolioSummary(supabase, user.id)
        if (!live) return
        portfolioItems.push(...summary.items)
        setPortfolioSnap({
          totalCents:     summary.totalCents,
          itemCount:      summary.itemCount,
          uniqueCards:    summary.uniqueCards,
          pct30dWeighted: summary.pct30dWeighted,
          currency:       summary.currency,
        })
      } catch { if (live) setPortfolioSnap({ totalCents: 0, itemCount: 0, uniqueCards: 0, pct30dWeighted: null, currency: 'GBP' }) }

      // ── Watchlist ────────────────────────────────────────────────────
      let wlItems: any[] = []
      try {
        const { data } = await supabase.rpc('get_watchlist_with_prices', { p_user_id: user.id })
        wlItems = data || []
        if (!live) return
        let topMover: WatchlistTopMover | null = null
        let bestAbs = 0
        for (const w of wlItems) {
          const p = w.pct_7d ?? w.pct_30d
          if (p != null) {
            const abs = Math.abs(Number(p))
            if (abs > bestAbs) {
              bestAbs = abs
              topMover = {
                card_name:     w.card_name,
                set_name:      w.set_name,
                card_url_slug: w.card_url_slug ?? null,
                card_slug:     w.card_slug,
                pct:           Number(p),
              }
            }
          }
        }
        setWatchSnap({ count: wlItems.length, topMover })
      } catch { if (live) setWatchSnap({ count: 0, topMover: null }) }

      // ── Alerts (Block 5A-W-42A bug fix) ─────────────────────────────
      // Previous hub queried `user_alerts` (legacy, no writers, no UI).
      // Production feed lives in `alert_events`. Filter by user_id and
      // detected_at >= 30 days ago; return the two most recent for the
      // summary card and a total count via a HEAD/count query.
      try {
        const [recentRes, countRes] = await Promise.all([
          supabase.from('alert_events')
            .select('id, card_name, set_name, rule, detected_at')
            .eq('user_id', user.id)
            .gte('detected_at', thirtyDaysAgo)
            .order('detected_at', { ascending: false })
            .limit(2),
          supabase.from('alert_events')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .gte('detected_at', thirtyDaysAgo),
        ])
        if (!live) return
        setAlertsSnap({
          recent:   (recentRes.data as AlertRow[]) || [],
          count30d: countRes.count ?? 0,
        })
      } catch { if (live) setAlertsSnap({ recent: [], count30d: 0 }) }

      // ── Movers: merge portfolio + watchlist, dedupe by card_slug, ──
      //   sort by |pct_30d| (fallback pct_7d), top 5. Watchlist rows
      //   win the dedupe because they carry card_url_slug.
      //
      //   Block 5A-W-42A-FIX2 — reuses the portfolioItems already
      //   loaded via get_portfolio_summary above. Previously a second
      //   direct SELECT was issued here with the wrong non-snapshot
      //   column names and silently returned []; movers stayed empty.
      try {
        const byCard = new Map<string, Mover>()
        for (const p of portfolioItems) {
          if (!p?.card_slug) continue
          byCard.set(p.card_slug, {
            card_slug:     p.card_slug,
            card_url_slug: p.card_url_slug ?? null,
            card_name:     p.card_name ?? '',
            set_name:      p.set_name  ?? '',
            current_cents: p.position_value_cents ?? p.current_value_cents ?? null,
            pct_7d:        p.pct_7d ?? null,
            pct_30d:       p.pct_30d ?? null,
          })
        }
        for (const w of wlItems) {
          byCard.set(w.card_slug, {
            card_slug:     w.card_slug,
            card_url_slug: w.card_url_slug ?? null,
            card_name:     w.card_name,
            set_name:      w.set_name,
            current_cents: w.current_raw ?? null,
            pct_7d:        w.pct_7d ?? null,
            pct_30d:       w.pct_30d ?? null,
          })
        }
        const sorted = Array.from(byCard.values())
          .filter(m => m.pct_30d != null || m.pct_7d != null)
          .sort((a, b) => {
            const av = Math.abs(Number(a.pct_30d ?? a.pct_7d ?? 0))
            const bv = Math.abs(Number(b.pct_30d ?? b.pct_7d ?? 0))
            return bv - av
          })
          .slice(0, 5)
        setMovers(sorted)
      } catch { if (live) setMovers([]) }
    }

    load()
    return () => { live = false }
  }, [user])

  if (loading) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
        <div className="skeleton" style={{ height: 40, width: '40%', marginBottom: 24, borderRadius: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 130, borderRadius: 16 }} />)}
        </div>
      </div>
    )
  }

  // ── Tools tile grid config ────────────────────────────────────────────
  // Block 5A-W-42A — dropped per-tile emoji glyphs (icon field). Portfolio
  // and Watchlist & Alerts stay first as the primary destinations; every
  // other tile keeps its previous position. Counts stay on the tiles but
  // are secondary — the snapshot cards above are the primary state.
  const tools = [
    {
      id: 'portfolio',
      title: 'Portfolio',
      desc: 'Track what you own — collection value, P&L, grading insights.',
      href: '/dashboard/portfolio',
      count: portfolioSnap?.itemCount ?? null,
      countLabel: 'cards',
      colour: '#3b82f6',
    },
    {
      id: 'watchlist',
      title: 'Watchlist & Alerts',
      desc: 'Cards you are watching, the alerts that fire on them, and your alert settings — all in one place.',
      href: '/dashboard/watchlist-alerts',
      count: watchSnap?.count ?? null,
      countLabel: 'watching',
      colour: '#a78bfa',
    },
    {
      id: 'sets',
      title: 'Set Completion',
      desc: 'Track which sets you are working on. Cheapest path to finish, biggest gaps, value owned.',
      href: '/dashboard/sets',
      count: null,
      countLabel: '',
      colour: '#22c55e',
    },
    {
      id: 'grading',
      title: 'Grading Calculator',
      desc: 'Should you grade it? Expected ROI by service, breakeven price, best candidates from your raw cards.',
      href: '/dashboard/grading',
      count: null,
      countLabel: '',
      colour: '#f59e0b',
    },
    {
      id: 'quick-price',
      title: 'Quick Price Checker',
      desc: 'Scan or upload a batch of cards, set grade + quantity, apply a percentage. Built for live pricing on the move.',
      href: '/dashboard/quick-price',
      count: null,
      countLabel: '',
      colour: '#f97316',
    },
    {
      id: 'card-shows',
      title: 'Card Show Planner',
      desc: 'Star upcoming Pokémon card shows + TCG events. Sort by nearest to your city.',
      href: '/dashboard/card-shows',
      count: null,
      countLabel: '',
      colour: '#0ea5e9',
    },
    {
      id: 'trade',
      title: 'Trade Evaluator',
      desc: 'Build two stacks side-by-side, see fair value with cash / trade / blended modes.',
      href: '/dealer',
      count: null,
      countLabel: '',
      colour: '#06b6d4',
    },
    {
      id: 'settings',
      title: 'Settings',
      desc: 'Email preferences, weekly digest, account.',
      href: '/dashboard/settings',
      count: null,
      countLabel: '',
      colour: '#94a3b8',
    },
  ]

  function dismissBanner() {
    setBannerDismissed(true)
    try { window.sessionStorage.setItem('pp-avatar-banner-dismissed', '1') } catch {}
  }

  // ── Derived render props for the snapshot cards ───────────────────────

  const portfolioIsEmpty = portfolioSnap != null && portfolioSnap.itemCount === 0
  const watchlistIsEmpty = watchSnap     != null && watchSnap.count     === 0
  const alertsIsEmpty    = alertsSnap    != null && alertsSnap.count30d === 0

  const hasAnyPersonalCards =
    (portfolioSnap?.itemCount ?? 0) > 0 || (watchSnap?.count ?? 0) > 0

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 32px' }}>

      {/* Same chip strip as every dashboard sub-page so users can jump
          between tools quickly. Scrolls horizontally on narrow screens. */}
      <DashboardNav email={user?.email} />

      {!avatarPokemonId && !bannerDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(26,95,173,0.10), rgba(124,58,237,0.08))',
          border: '1px solid rgba(26,95,173,0.25)',
          borderRadius: 14, padding: '14px 18px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          fontFamily: "'Figtree', sans-serif",
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginBottom: 2 }}>
              Pick your Pokémon avatar
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Adds a bit of personality next to your name. One click to set.
            </div>
          </div>
          <button onClick={() => setPickerOpen(true)}
            style={{
              background: 'var(--primary)', color: '#fff', border: 'none',
              padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer',
            }}
          >Pick avatar</button>
          <button onClick={dismissBanner} aria-label="Dismiss"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 8px',
            }}
          >Later</button>
        </div>
      )}

      {/* Block 5A-W-42A — renamed heading + subheading for the personal
          dashboard framing. Plan chip stays on the right. */}
      <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: 0, color: 'var(--text)' }}>
          My PokePrices
        </h1>
        {user?.id && <AccountPlanBadge userId={user.id} mode="compact" source="dashboard" />}
      </div>
      <p style={{
        fontFamily: "'Figtree', sans-serif", fontSize: 13.5, color: 'var(--text-muted)',
        margin: '0 0 20px', lineHeight: 1.55,
      }}>
        Track your portfolio, watchlist, alerts and market movement.
      </p>

      {/* Block 5A-W-30 — onboarding checklist. Self-hides once every
          item is complete so it doesn't clutter the hub for active
          users. */}
      {user?.id && <DashboardOnboardingChecklist userId={user.id} />}

      {/* ── Personal snapshot row (Block 5A-W-42A) ─────────────────── */}
      <section
        aria-label="Personal snapshot"
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14, marginBottom: 20,
        }}
      >
        {/* Portfolio snapshot */}
        <SnapshotCard
          kicker="Portfolio"
          accent="#3b82f6"
          href="/dashboard/portfolio"
          openLabel={portfolioIsEmpty ? 'Add first card →' : 'Open portfolio →'}
        >
          {portfolioSnap == null ? (
            <SnapshotLoading />
          ) : portfolioIsEmpty ? (
            <p style={emptyCopyStyle}>
              Add cards to your portfolio to track value here.
            </p>
          ) : portfolioSnap.totalCents === 0 ? (
            // Block 5A-W-42A-FIX — items exist but no value data yet.
            // Show item count with a "value updating" note rather than
            // rendering a misleading "$0.00" or the empty-state copy.
            <>
              <div style={bigNumberStyle}>
                {portfolioSnap.itemCount}{' '}
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>
                  card{portfolioSnap.itemCount === 1 ? '' : 's'}
                </span>
              </div>
              <div style={secondaryLineStyle}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {portfolioSnap.uniqueCards} unique · Value updating…
                </span>
              </div>
            </>
          ) : (
            <>
              {/* Block 5A-W-42A-FIX4 — currency-aware formatter that
                  mirrors PortfolioDashboard's fmtBig. Respects the
                  user's display_currency preference (GBP vs USD) so the
                  hub matches whatever the portfolio page shows. */}
              <div style={bigNumberStyle}>{formatPortfolioValue(portfolioSnap.totalCents, portfolioSnap.currency)}</div>
              <div style={secondaryLineStyle}>
                {portfolioSnap.pct30dWeighted != null && (
                  <PctChip pct={portfolioSnap.pct30dWeighted} suffix="30d" />
                )}
                {/* Block 5A-W-42A-FIX3 — show both counts explicitly so
                    "cards" here matches "Total cards" on the portfolio
                    page and "unique" matches "Unique cards". Removes the
                    ambiguity that made 50 vs 35 read as a plain "cards"
                    count. */}
                <span style={{ marginLeft: portfolioSnap.pct30dWeighted != null ? 10 : 0 }}>
                  {portfolioSnap.itemCount} card{portfolioSnap.itemCount === 1 ? '' : 's'} · {portfolioSnap.uniqueCards} unique
                </span>
              </div>
            </>
          )}
        </SnapshotCard>

        {/* Watchlist snapshot */}
        <SnapshotCard
          kicker="Watchlist"
          accent="#a78bfa"
          href="/dashboard/watchlist-alerts"
          openLabel={watchlistIsEmpty ? 'Add first card →' : 'Open watchlist →'}
        >
          {watchSnap == null ? (
            <SnapshotLoading />
          ) : watchlistIsEmpty ? (
            <p style={emptyCopyStyle}>
              Watch a card to catch price moves.
            </p>
          ) : (
            <>
              <div style={bigNumberStyle}>
                {watchSnap.count} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>watched</span>
              </div>
              {watchSnap.topMover ? (
                <div style={secondaryLineStyle}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>Top mover:</span>
                  <Link
                    href={cardHref(watchSnap.topMover.set_name, watchSnap.topMover.card_url_slug, watchSnap.topMover.card_slug)}
                    style={linkInlineStyle}
                  >
                    {watchSnap.topMover.card_name}
                  </Link>
                  <span style={{ marginLeft: 8 }}>
                    <PctChip pct={watchSnap.topMover.pct} suffix="7d" />
                  </span>
                </div>
              ) : (
                <div style={secondaryLineStyle}>Price data updating…</div>
              )}
            </>
          )}
        </SnapshotCard>

        {/* Alerts snapshot — reads alert_events, not legacy user_alerts */}
        <SnapshotCard
          kicker="Alerts"
          accent="#f59e0b"
          href="/dashboard/watchlist-alerts"
          openLabel={alertsIsEmpty ? 'Set up alerts →' : 'Open alerts →'}
        >
          {alertsSnap == null ? (
            <SnapshotLoading />
          ) : alertsIsEmpty ? (
            <p style={emptyCopyStyle}>
              Set alert rules to be notified when prices move.
            </p>
          ) : (
            <>
              <div style={bigNumberStyle}>
                {alertsSnap.count30d} <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>new (30d)</span>
              </div>
              <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', fontFamily: "'Figtree', sans-serif" }}>
                {alertsSnap.recent.map(row => (
                  <li key={row.id} style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                      {row.card_name || 'Card'}
                    </span>
                    <span style={{ margin: '0 6px' }}>·</span>
                    <span>{ruleLabel(row.rule)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SnapshotCard>
      </section>

      {/* ── Market movement for you (Block 5A-W-42A) ─────────────────── */}
      <section aria-label="Market movement for you" style={{ marginBottom: 24 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 8, marginBottom: 10, flexWrap: 'wrap',
        }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0, color: 'var(--text)' }}>
            Market movement for you
          </h2>
          {hasAnyPersonalCards && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              Top movers from your list
            </span>
          )}
        </div>

        {movers.length > 0 ? (
          <ul style={{
            margin: 0, padding: 0, listStyle: 'none',
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
            overflow: 'hidden',
          }}>
            {movers.map((m, i) => {
              const pct = m.pct_30d ?? m.pct_7d
              const p = fmtPct(pct)
              const isLast = i === movers.length - 1
              return (
                <li key={m.card_slug} style={{
                  borderBottom: isLast ? 'none' : '1px solid var(--border)',
                }}>
                  <Link
                    href={cardHref(m.set_name, m.card_url_slug, m.card_slug)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
                      textDecoration: 'none', color: 'var(--text)',
                      fontFamily: "'Figtree', sans-serif",
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-light)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent' }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13.5, fontWeight: 700,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{m.card_name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        {m.set_name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 90 }}>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {/* Block 5A-W-42A-FIX4 — respect display_currency
                            for mover prices too so the hub is internally
                            consistent (portfolio card and movers agree). */}
                        {formatPortfolioValue(m.current_cents, portfolioSnap?.currency ?? 'GBP')}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: p.color }}>
                        {p.text}{pct != null ? ` ${m.pct_30d != null ? '30d' : '7d'}` : ''}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : (
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
            padding: '18px 20px', fontFamily: "'Figtree', sans-serif",
          }}>
            <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.55 }}>
              No cards tracked yet. Add something to see personal price moves here.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <MoverEmptyLink href="/dashboard/portfolio">Add a card to your portfolio</MoverEmptyLink>
              <MoverEmptyLink href="/dashboard/watchlist-alerts">Watch your first card</MoverEmptyLink>
              <MoverEmptyLink href="/#market-movers">Browse market movers</MoverEmptyLink>
            </div>
          </div>
        )}
      </section>

      {/* ── Potential eBay deals (Block 5A-W-43A) ────────────────────
           Sits below Market Movement so the user's own state (portfolio
           / watchlist / alerts / movers) stays higher in the visual
           hierarchy than an eBay browse surface. Not gated on Pro. */}
      <PotentialDealsSection />

      {/* ── Tools tile grid (existing, cleaned up) ───────────────────── */}
      <h2 style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 10px', color: 'var(--text)',
      }}>Tools</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {tools.map(t => (
          <Link key={t.id} href={t.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '18px 18px',
              height: '100%',
              boxSizing: 'border-box',
              transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
              cursor: 'pointer',
              position: 'relative',
            }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.transform = 'translateY(-2px)'
                el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'
                el.style.borderColor = t.colour
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.transform = ''
                el.style.boxShadow = 'none'
                el.style.borderColor = 'var(--border)'
              }}
            >
              {(t as any).comingSoon && (
                <span style={{ position: 'absolute', top: 12, right: 12 }}>
                  <ComingSoonBadge />
                </span>
              )}
              {/* Thin coloured accent bar in place of the removed emoji
                  glyph — keeps a small visual differentiator per tool. */}
              <div style={{ width: 32, height: 3, background: t.colour, borderRadius: 2, marginBottom: 12 }} />
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 6px', color: 'var(--text)' }}>
                {t.title}
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px', lineHeight: 1.5 }}>
                {t.desc}
              </p>
              {t.count != null && (
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)', fontWeight: 700,
                  fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.6,
                }}>
                  {t.count} {t.countLabel}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      <p style={{
        fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        textAlign: 'center', margin: '32px 0 0', lineHeight: 1.6,
      }}>
        Free forever. No tracking. No data sold. Ever.
      </p>

      <AvatarPicker
        open={pickerOpen}
        currentPokemonId={avatarPokemonId}
        onClose={() => setPickerOpen(false)}
        onSaved={(id) => { setAvatarPokemonId(id); dismissBanner() }}
      />
    </div>
  )
}

// ── Small presentational subcomponents ────────────────────────────────

function SnapshotCard(props: {
  kicker:     string
  accent:     string
  href:       string
  openLabel:  string
  children:   React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
      padding: '16px 18px', display: 'flex', flexDirection: 'column',
      fontFamily: "'Figtree', sans-serif",
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: props.accent }} aria-hidden />
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>{props.kicker}</span>
      </div>
      <div style={{ flex: 1, minHeight: 44 }}>
        {props.children}
      </div>
      <Link href={props.href} style={{
        marginTop: 10, fontSize: 11, fontWeight: 800, color: props.accent,
        textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1.2,
      }}>
        {props.openLabel}
      </Link>
    </div>
  )
}

function SnapshotLoading() {
  return (
    <div className="skeleton" style={{ height: 44, borderRadius: 8 }} />
  )
}

function PctChip({ pct, suffix }: { pct: number; suffix: string }) {
  const p = fmtPct(pct)
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 12, fontWeight: 800, color: p.color,
      background: p.color === '#22c55e' ? 'rgba(34,197,94,0.10)' : p.color === '#ef4444' ? 'rgba(239,68,68,0.10)' : 'var(--bg-light)',
      padding: '2px 8px', borderRadius: 20,
    }}>{p.text} {suffix}</span>
  )
}

function MoverEmptyLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '7px 12px', borderRadius: 999,
      background: 'var(--bg-light)', border: '1px solid var(--border)',
      color: 'var(--text)', fontSize: 12, fontWeight: 700,
      textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
    }}>{children}</Link>
  )
}

// ── Shared inline styles used across snapshot cards ───────────────────

const bigNumberStyle: React.CSSProperties = {
  fontSize: 26, fontWeight: 900, color: 'var(--text)',
  letterSpacing: -0.4, lineHeight: 1.1,
}

const secondaryLineStyle: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text)', marginTop: 6,
  display: 'flex', alignItems: 'center', flexWrap: 'wrap',
}

const emptyCopyStyle: React.CSSProperties = {
  margin: 0, fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55,
}

const linkInlineStyle: React.CSSProperties = {
  color: 'var(--text)', fontWeight: 700, textDecoration: 'none',
  borderBottom: '1px solid var(--border)',
}
