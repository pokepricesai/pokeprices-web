'use client'

// src/components/dashboard/PotentialDealsSection.tsx
//
// Block 5A-W-43A / 5A-W-43B — dashboard hub section listing potential
// eBay deals sourced from the shared `daily_deals` table.
//
// This is a PRO feature. Free users see a locked preview card with
// an "Upgrade to Pro" link routing to /dashboard/settings where the
// existing plan panel (AccountPlanBadge full mode) is rendered.
//
// Copy is deliberately cautious — see the "cautious copy" describe
// block in PotentialDealsSection.test.tsx for the exact allow/deny
// list of marketing verbs the section must avoid.
//
// Two tabs — Watchlist deals and Best deals — with independent
// client-side pagination (page size 5).
//
// CTA safety: every user-facing eBay URL is routed through the local
// deep-link builder buildDealDeepLink (src/lib/dashboard/affiliateDealLink.ts)
// which reads campaign IDs from the central marketplaces registry and
// appends the standard EPN affiliate parameters to the /itm/<id> URL.
// A raw item URL is never assigned to an href directly.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useUserPlan } from '@/lib/account/useUserPlan'
import {
  loadPotentialDeals,
  loadWatchlistSlugs,
  type PotentialDeal,
} from '@/lib/dashboard/potentialDeals'
import { buildDealDeepLink } from '@/lib/dashboard/affiliateDealLink'

// ── Constants ──────────────────────────────────────────────────────

export const DEALS_PAGE_SIZE = 5
const DEALS_MAX_FETCH = 30
type TabId = 'watchlist' | 'best'

// ── Types ──────────────────────────────────────────────────────────

type Props = {
  /** Signed-in user id. Null while the session is still loading —
   *  the section renders a loading skeleton until it settles. */
  userId: string | null | undefined
}

// ── Helpers ────────────────────────────────────────────────────────

function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents == null || cents <= 0) return '—'
  const sym = currency === 'GBP' ? '£' : '$'
  const v = cents / 100
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(1)}k`
  return `${sym}${v.toFixed(2)}`
}

function formatFairValue(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function marketplaceLabel(mp: string | null | undefined): string {
  // W43C — collector-facing labels ("eBay UK" / "eBay US") rather than
  // raw domains. The affiliate CTA still deep-links to the correct
  // domain via buildDealDeepLink's marketplaceHint check.
  if (mp === 'EBAY_GB') return 'eBay UK'
  if (mp === 'EBAY_US') return 'eBay US'
  return 'eBay'
}

function marketplaceMode(mp: string | null | undefined): 'uk' | 'us' | null {
  if (mp === 'EBAY_GB') return 'uk'
  if (mp === 'EBAY_US') return 'us'
  return null
}

function formatFeedback(score: number | null | undefined): string {
  if (score == null || score <= 0) return ''
  return score.toLocaleString('en-GB')
}

// ── Styles ─────────────────────────────────────────────────────────

const sectionWrapStyle: React.CSSProperties = {
  marginBottom: 24, fontFamily: "'Figtree', sans-serif",
}
const headerRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
  gap: 8, marginBottom: 4, flexWrap: 'wrap',
}
const h2Style: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0, color: 'var(--text)',
}
const subCopyStyle: React.CSSProperties = {
  fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.55,
}
const disclaimerStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5,
}
const listWrapStyle: React.CSSProperties = {
  margin: 0, padding: 0, listStyle: 'none',
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
  overflow: 'hidden',
}
const emptyBoxStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
  padding: '16px 18px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
}
const thumbStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 8, objectFit: 'cover',
  border: '1px solid var(--border)', background: 'var(--bg-light)', flexShrink: 0,
}
const thumbPlaceholderStyle: React.CSSProperties = {
  ...thumbStyle, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 10, color: 'var(--text-muted)', fontWeight: 700,
}
const nameStyle: React.CSSProperties = {
  fontSize: 13.5, fontWeight: 700, color: 'var(--text)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const metaStyle: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4,
}
const priceColStyle: React.CSSProperties = {
  textAlign: 'right', minWidth: 96, flexShrink: 0,
}
const totalCostStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 800, color: 'var(--text)',
}
const fairValueStyle: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2,
}
const discountChipStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11, fontWeight: 800, color: '#22c55e',
  background: 'rgba(34,197,94,0.10)',
  padding: '2px 8px', borderRadius: 20,
}
const ctaStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', borderRadius: 999,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontSize: 12, fontWeight: 800,
  textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
}
const noCtaStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)',
  fontStyle: 'italic', whiteSpace: 'nowrap',
}
const tabsRowStyle: React.CSSProperties = {
  display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap',
}
function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999,
    border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
    background: active ? 'rgba(26,95,173,0.10)' : 'transparent',
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    fontSize: 12, fontWeight: 800, cursor: 'pointer',
    fontFamily: "'Figtree', sans-serif",
  }
}
const pagerRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 10, marginTop: 10, flexWrap: 'wrap',
}
function pagerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 8,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: disabled ? 'var(--text-muted)' : 'var(--text)',
    fontSize: 12, fontWeight: 700, opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: "'Figtree', sans-serif",
  }
}
const lockedPanelStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(26,95,173,0.05))',
  border: '1px solid rgba(124,58,237,0.25)', borderRadius: 14,
  padding: '18px 20px',
}
const lockedCtaStyle: React.CSSProperties = {
  display: 'inline-block', marginTop: 10,
  padding: '7px 14px', borderRadius: 999,
  background: 'var(--primary)', color: '#fff',
  fontSize: 12, fontWeight: 800, textDecoration: 'none',
}

// ── Section pieces ─────────────────────────────────────────────────

function SectionHeader() {
  return (
    <>
      <div style={headerRowStyle}>
        <h2 style={h2Style}>Potential eBay deals</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updated daily</span>
      </div>
      <p style={subCopyStyle}>
        Listings 15–30% below recent market data. Check condition and seller before buying.
      </p>
    </>
  )
}

function Disclaimer() {
  return (
    <p style={disclaimerStyle}>
      Prices and availability can change quickly. Always check the listing before buying.
    </p>
  )
}

function LockedForFree() {
  return (
    <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
      <div style={headerRowStyle}>
        <h2 style={h2Style}>Potential eBay deals</h2>
      </div>
      <div style={lockedPanelStyle}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
          Pro members can view potential eBay listings priced below recent market data.
        </p>
        <Link
          href="/dashboard/settings"
          aria-label="Upgrade to Pro"
          style={lockedCtaStyle}
        >
          Upgrade to Pro
        </Link>
      </div>
    </section>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={active}
      style={tabButtonStyle(active)}
    >
      {label}
    </button>
  )
}

function DealRow({ deal }: { deal: PotentialDeal }) {
  // Route the CTA through the local deep-link builder — it appends
  // affiliate parameters directly to the /itm/<id> URL rather than
  // collapsing to a search result. Never assign deal.item_web_url
  // to an href directly.
  const affiliateUrl = useMemo(() => buildDealDeepLink({
    itemWebUrl:      deal.item_web_url,
    ebayItemId:      deal.ebay_item_id,
    // W43C — marketplace hint cross-checks the URL host so a UK
    // listing URL never gets wrapped with a US campaign or vice
    // versa. The loader also drops mismatched rows before render.
    marketplaceHint: deal.marketplace,
    customId:        `pp:dashboard-deals:${marketplaceMode(deal.marketplace) ?? 'uk'}:${deal.card_slug ?? '_'}`,
  }), [deal.item_web_url, deal.ebay_item_id, deal.marketplace, deal.card_slug])

  const cardName = (deal.card_name || 'Card').replace(/\s*#\d+.*$/, '').trim() || 'Card'
  const setName  = deal.set_name || ''
  const feedback = formatFeedback(deal.seller_feedback_score)
  const marketplace = marketplaceLabel(deal.marketplace)

  return (
    <li style={rowStyle}>
      {deal.item_image_url ? (
        <img src={deal.item_image_url} alt="" style={thumbStyle} loading="lazy" />
      ) : (
        <div aria-hidden style={thumbPlaceholderStyle}>eBay</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={nameStyle}>{cardName}</div>
        <div style={metaStyle}>
          {setName ? <span>{setName}</span> : null}
          {deal.condition ? <><span> · </span><span>{deal.condition}</span></> : null}
        </div>
        <div style={{ ...metaStyle, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {typeof deal.discount_pct === 'number' && (
            <span style={discountChipStyle}>{deal.discount_pct.toFixed(0)}% below</span>
          )}
          <span>{marketplace}</span>
          {feedback && <span>· seller feedback {feedback}</span>}
        </div>
      </div>
      <div style={priceColStyle}>
        {/* W43C — listing price uses native currency (£ for UK, $ for
            US). Reference market value is labelled USD explicitly so
            collectors don't confuse it with the listing price. */}
        <div style={totalCostStyle}>{formatMoney(deal.total_cost_cents, deal.currency)}</div>
        <div style={fairValueStyle}>Market ref: {formatFairValue(deal.fair_value_cents)} USD</div>
      </div>
      {affiliateUrl ? (
        <a
          href={affiliateUrl}
          target="_blank" rel="noopener sponsored nofollow"
          style={ctaStyle}
          aria-label={`Check listing on ${marketplace}`}
        >
          Check listing on eBay
          <span aria-hidden>→</span>
        </a>
      ) : (
        <span style={noCtaStyle}>eBay listing</span>
      )}
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────

export default function PotentialDealsSection({ userId }: Props) {
  const { plan, loading: planLoading } = useUserPlan(userId ?? null)

  const [watchlistSlugs, setWatchlistSlugs] = useState<string[] | null>(null)
  const [tab,        setTab]        = useState<TabId | null>(null)
  const [deals,      setDeals]      = useState<PotentialDeal[] | null>(null)
  const [dealsLoading, setDealsLoading] = useState(false)
  const [page,       setPage]       = useState(1)

  // ── Load the user's watchlist card_slugs once we know they're Pro.
  //    Free users skip this entirely — the section renders locked.
  useEffect(() => {
    if (planLoading) return
    if (plan !== 'pro' || !userId) { setWatchlistSlugs([]); return }
    let live = true
    loadWatchlistSlugs(supabase, userId).then(slugs => {
      if (!live) return
      setWatchlistSlugs(slugs)
      // Default tab: Watchlist when the user has watched cards,
      // otherwise Best (matches the brief).
      setTab(slugs.length > 0 ? 'watchlist' : 'best')
    })
    return () => { live = false }
  }, [plan, planLoading, userId])

  // ── Load deals whenever the tab or watchlist set changes.
  useEffect(() => {
    if (tab == null || watchlistSlugs == null) return
    let live = true
    setDealsLoading(true)
    setDeals(null)
    setPage(1)
    const filter = tab === 'watchlist' ? watchlistSlugs : null
    loadPotentialDeals(supabase, { limit: DEALS_MAX_FETCH, cardSlugFilter: filter })
      .then(rows => { if (!live) return; setDeals(rows); setDealsLoading(false) })
      .catch(() => { if (!live) return; setDeals([]); setDealsLoading(false) })
    return () => { live = false }
  }, [tab, watchlistSlugs])

  if (planLoading) {
    return (
      <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
        <div style={headerRowStyle}><h2 style={h2Style}>Potential eBay deals</h2></div>
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
      </section>
    )
  }

  if (plan !== 'pro') {
    return <LockedForFree />
  }

  // Pro path — main render.
  const totalPages = deals ? Math.max(1, Math.ceil(deals.length / DEALS_PAGE_SIZE)) : 1
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * DEALS_PAGE_SIZE
  const pageDeals = deals ? deals.slice(pageStart, pageStart + DEALS_PAGE_SIZE) : []
  const showPager = totalPages > 1

  const hasWatchlist = (watchlistSlugs?.length ?? 0) > 0

  return (
    <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
      <SectionHeader />

      <div role="tablist" aria-label="Deal filter" style={tabsRowStyle}>
        <TabButton label="Watchlist deals" active={tab === 'watchlist'} onClick={() => setTab('watchlist')} />
        <TabButton label="Best deals"      active={tab === 'best'}      onClick={() => setTab('best')} />
      </div>

      {dealsLoading || deals === null ? (
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
      ) : deals.length === 0 ? (
        <div style={emptyBoxStyle}>
          {tab === 'watchlist' ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                No watchlist deals found today.
              </p>
              <button
                type="button" onClick={() => setTab('best')}
                aria-label="View Best deals"
                style={{ ...tabButtonStyle(false), marginTop: 10 }}
              >
                View Best deals →
              </button>
            </>
          ) : hasWatchlist ? (
            <>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                No best deals found today.
              </p>
              <button
                type="button" onClick={() => setTab('watchlist')}
                aria-label="View Watchlist deals"
                style={{ ...tabButtonStyle(false), marginTop: 10 }}
              >
                View Watchlist deals →
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              No potential deals found today.
            </p>
          )}
        </div>
      ) : (
        <>
          <ul style={listWrapStyle}>
            {pageDeals.map((d, i) => <DealRow key={String(d.ebay_item_id ?? d.item_web_url ?? i)} deal={d} />)}
          </ul>
          {showPager && (
            <div style={pagerRowStyle} aria-label="Deal pagination">
              <button
                type="button"
                disabled={safePage <= 1}
                aria-label="Previous page"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                style={pagerBtnStyle(safePage <= 1)}
              >
                ← Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Page {safePage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                aria-label="Next page"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                style={pagerBtnStyle(safePage >= totalPages)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      <Disclaimer />
    </section>
  )
}

// Marketplace utility exposed for testing (kept minimal — the loader
// already handles the risky data path).
export { marketplaceLabel, marketplaceMode }
