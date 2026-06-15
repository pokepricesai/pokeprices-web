'use client'

// src/components/affiliate/EbayCompactLink.tsx
// Block 2D — single compact affiliate link, restraint-first.
//
// Used by the new price-tile / watchlist / portfolio / grading
// placements. Renders nothing when the resolved marketplace has no
// campaign id. Tracks one impression per mount via IntersectionObserver
// and one click event per click.
//
// Pulls the marketplace from useMarketplace(). For surfaces with their
// own explicit marketplace (e.g. dealer), use buildAffiliateLink
// directly instead.

import { useEffect, useRef } from 'react'
import {
  buildAffiliateLink,
  type AffiliateBuildInput,
  type AffiliateIntent,
} from '@/lib/ebayAffiliate'
import type { MarketplaceCode } from '@/lib/marketplaces'
import { trackEvent } from '@/lib/analytics'
import { useMarketplace } from '@/lib/marketplaceClient'

export type EbayCompactLinkProps = {
  intent:     AffiliateIntent
  cardName?:  string | null
  setName?:   string | null
  cardNumber?:string | null
  cardSlug?:  string | null
  setSlug?:   string | null
  productName?:string | null
  language?:  string
  gradingCompany?: string | null
  grade?:     string | number | null

  placement:        string
  pageType?:        string
  sourceComponent?: string

  /** Optional override; when omitted, the resolved marketplace is used. */
  marketplace?: MarketplaceCode

  label?:   string
  icon?:    string
  style?:   React.CSSProperties
  /** Optional ARIA label override. */
  ariaLabel?: string
}

function toEngineMarketplace(code: MarketplaceCode): 'uk' | 'us' | null {
  // The engine only ships UK + US URL composition today. Other
  // configured marketplaces flow through the registry and produce a
  // valid URL via buildAffiliateLink's lookup, but until the engine's
  // URL composer supports them, we route everything via UK or US to
  // avoid emitting an invalid URL.
  if (code === 'UK') return 'uk'
  if (code === 'US') return 'us'
  return null
}

export default function EbayCompactLink(props: EbayCompactLinkProps) {
  const mp = useMarketplace()
  const effective: MarketplaceCode | null =
    props.marketplace
    ?? mp.marketplace
    ?? null

  const engineMp = effective ? toEngineMarketplace(effective) : null
  const containerRef = useRef<HTMLAnchorElement>(null)
  const firedRef     = useRef(false)

  const built = engineMp
    ? buildAffiliateLink({
        marketplace:      engineMp,
        intent:           props.intent,
        cardName:         props.cardName,
        setName:          props.setName,
        cardNumber:       props.cardNumber,
        cardSlug:         props.cardSlug,
        setSlug:          props.setSlug,
        productName:      props.productName,
        language:         props.language,
        gradingCompany:   props.gradingCompany,
        grade:            props.grade,
        placement:        props.placement,
        pageType:         props.pageType,
        sourceComponent:  props.sourceComponent,
      } satisfies AffiliateBuildInput)
    : null

  useEffect(() => {
    if (firedRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    if (!built || !built.url) return
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !firedRef.current) {
          firedRef.current = true
          trackEvent('affiliate_link_view', { ...built.analytics })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
  }, [built])

  if (!built || !built.url) return null

  const label = props.label ?? 'See eBay listings →'

  return (
    <a
      ref={containerRef}
      href={built.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label={props.ariaLabel ?? label}
      onClick={() => trackEvent('affiliate_click', { ...built.analytics })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        fontFamily: "'Figtree', sans-serif",
        whiteSpace: 'nowrap',
        padding: '2px 4px',
        ...(props.style ?? {}),
      }}
    >
      {props.icon && <span aria-hidden="true">{props.icon}</span>}
      {label}
    </a>
  )
}
