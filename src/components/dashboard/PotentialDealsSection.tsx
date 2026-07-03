'use client'

// src/components/dashboard/PotentialDealsSection.tsx
//
// Block 5A-W-43A — dashboard hub section listing potential eBay
// deals sourced from the shared `daily_deals` table.
//
// Copy is deliberately cautious per the W43 audit brief:
//   * Heading:     "Potential eBay deals"
//   * Sub-copy:    "Cards listed below recent market price. Check
//                   condition and seller before buying."
//   * Disclaimer:  "Prices and availability can change quickly.
//                   Always check the listing before buying. Updated
//                   daily."
//   * Empty state: "No potential deals found today."
//   * CTA:         "Check on eBay"
//
// Explicitly avoids the banned copy set enforced by
// PotentialDealsSection.test.tsx (see the "cautious copy" describe
// block for the exact allow/deny list).
//
// CTA safety: every user-facing eBay URL is routed through the
// central affiliateWrapEbayUrl (W39 / Block 2C). A raw item URL is
// never assigned to an href directly. When the wrapper returns null
// (missing campaign ID / unrecognised URL) the row still renders,
// with the CTA replaced by a small "eBay listing" text hint — the
// listing data is still informative, just not clickable.
//
// Not gated on Pro — free for everyone.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { affiliateWrapEbayUrl } from '@/lib/ebayAffiliate'
import {
  loadPotentialDeals,
  type PotentialDeal,
} from '@/lib/dashboard/potentialDeals'

// ── Helpers ─────────────────────────────────────────────────────────

function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents == null || cents <= 0) return '—'
  const sym = currency === 'GBP' ? '£' : '$'
  const v = cents / 100
  if (v >= 1000) return `${sym}${(v / 1000).toFixed(1)}k`
  return `${sym}${v.toFixed(2)}`
}

function formatFairValue(cents: number | null | undefined): string {
  // fair_value_cents is USD cents everywhere (detect_deals.py normalises).
  if (cents == null || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function marketplaceLabel(mp: string | null | undefined): string {
  if (mp === 'EBAY_GB') return 'ebay.co.uk'
  if (mp === 'EBAY_US') return 'ebay.com'
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

// ── Styles ──────────────────────────────────────────────────────────

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

// ── Section pieces ─────────────────────────────────────────────────

function SectionHeader() {
  return (
    <>
      <div style={headerRowStyle}>
        <h2 style={h2Style}>Potential eBay deals</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Updated daily</span>
      </div>
      <p style={subCopyStyle}>
        Cards listed below recent market price. Check condition and seller before buying.
      </p>
    </>
  )
}

function Disclaimer() {
  return (
    <p style={disclaimerStyle}>
      Prices and availability can change quickly. Always check the listing before buying. Updated daily.
    </p>
  )
}

function DealRow({ deal }: { deal: PotentialDeal }) {
  // Route the CTA through the central affiliate helper. Never assign
  // deal.item_web_url to an href directly.
  const wrapped = deal.item_web_url
    ? affiliateWrapEbayUrl(deal.item_web_url, {
        placement:       'dashboard_potential_deals',
        pageType:        'dashboard',
        sourceComponent: 'PotentialDealsSection',
        cardSlug:        deal.card_slug,
      })
    : null
  const affiliateUrl = wrapped?.url ?? null

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
        <div style={totalCostStyle}>{formatMoney(deal.total_cost_cents, deal.currency)}</div>
        <div style={fairValueStyle}>vs {formatFairValue(deal.fair_value_cents)}</div>
      </div>
      {affiliateUrl ? (
        <a
          href={affiliateUrl}
          target="_blank" rel="noopener sponsored nofollow"
          style={ctaStyle}
          aria-label={`Check on ${marketplace}`}
        >
          Check on eBay
          <span aria-hidden>→</span>
        </a>
      ) : (
        // Fail-closed: no CTA when the wrapper can't produce a URL.
        <span style={noCtaStyle}>eBay listing</span>
      )}
    </li>
  )
}

// ── Main component ─────────────────────────────────────────────────

export default function PotentialDealsSection() {
  const [deals, setDeals] = useState<PotentialDeal[] | null>(null)

  useEffect(() => {
    let live = true
    loadPotentialDeals(supabase, { limit: 5 })
      .then(rows => { if (live) setDeals(rows) })
      .catch(() => { if (live) setDeals([]) })
    return () => { live = false }
  }, [])

  if (deals === null) {
    return (
      <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
        <SectionHeader />
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
      </section>
    )
  }

  if (deals.length === 0) {
    return (
      <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
        <SectionHeader />
        <div style={emptyBoxStyle}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            No potential deals found today.
          </p>
          <Disclaimer />
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Potential eBay deals" style={sectionWrapStyle}>
      <SectionHeader />
      <ul style={listWrapStyle}>
        {deals.map((d, i) => <DealRow key={String(d.ebay_item_id ?? d.item_web_url ?? i)} deal={d} />)}
      </ul>
      <Disclaimer />
    </section>
  )
}

// Marketplace utility exposed for testing (kept minimal — the loader
// already handles the risky data path).
export { marketplaceLabel, marketplaceMode }
