'use client'

// PokePrices v2 Block 2C — restrained reusable affiliate UI.
//
// This component does NOT introduce new placements anywhere in the app.
// It is the foundation the next affiliate block will use to retire the
// current bespoke chip rows beside raw / PSA 9 / PSA 10 prices, on the
// portfolio, watchlist, AI answers and grading tools — but ONLY when
// those expansions are explicitly approved.
//
// Until then it serves as the canonical pattern for any affiliate
// action: one primary action, optional UK/US split, optional compact
// grade dropdown (raw / PSA 9 / PSA 10), all via the central engine
// so the audit script can keep proving there is no leak.

import { useEffect, useRef } from 'react'
import { buildAffiliateLink, type AffiliateBuildInput, type Marketplace, type AffiliateIntent } from '@/lib/ebayAffiliate'
import { trackEvent } from '@/lib/analytics'

export type EbayAffiliateActionProps = {
  /** Card / set / pokémon context. All optional — engine builds whatever query it can. */
  cardName?:    string | null
  setName?:     string | null
  cardNumber?:  string | null
  cardSlug?:    string | null
  setSlug?:     string | null
  pokemonSlug?: string | null
  productName?: string | null
  language?:    string
  /** Card-specific variant token (e.g. "1st Edition", "Reverse Holo"). */
  cardVariant?:     string | null

  /** Default intent applied unless `grades` are provided. */
  intent:      AffiliateIntent
  /** When set, a compact grade-options row is shown. Each grade renders
   *  one button per provided marketplace. */
  grades?:     ('raw' | 'psa9' | 'psa10')[]

  /** Which marketplaces to render. Defaults to ['uk'] for the inline
   *  layout and ['uk', 'us'] for the block layout. */
  marketplaces?: Marketplace[]

  /** 'block' renders the standard two-button block (matches the existing
   *  EbayLiveListings UI). 'inline' renders a single compact link. */
  layout?: 'block' | 'inline'

  /** Analytics context. */
  placement:        string
  pageType?:        string
  sourceComponent?: string

  /** Backwards-compat custom ID. When set, the engine will use it
   *  verbatim to keep existing EPN reports flowing. */
  legacyCustomId?: string | null

  /** Override the primary-action label. */
  label?: string
}

const GRADE_INTENT: Record<'raw' | 'psa9' | 'psa10', AffiliateIntent> = {
  raw:   'raw',
  psa9:  'psa9',
  psa10: 'psa10',
}

const GRADE_LABEL: Record<'raw' | 'psa9' | 'psa10', string> = {
  raw:   'Raw',
  psa9:  'PSA 9',
  psa10: 'PSA 10',
}

const MARKETPLACE_FLAG: Record<Marketplace, string> = { uk: '🇬🇧', us: '🇺🇸' }

export default function EbayAffiliateAction(props: EbayAffiliateActionProps) {
  const marketplaces = props.marketplaces && props.marketplaces.length > 0
    ? props.marketplaces
    : props.layout === 'inline' ? (['uk'] as Marketplace[]) : (['uk', 'us'] as Marketplace[])

  const grades = props.grades
  const layout = props.layout ?? 'block'

  function buildOne(mp: Marketplace, intent: AffiliateIntent) {
    const input: AffiliateBuildInput = {
      marketplace:     mp,
      intent,
      cardName:        props.cardName,
      setName:         props.setName,
      cardNumber:      props.cardNumber,
      cardSlug:        props.cardSlug,
      setSlug:         props.setSlug,
      pokemonSlug:     props.pokemonSlug,
      productName:     props.productName,
      language:        props.language,
      variant:         props.cardVariant,
      placement:       props.placement,
      pageType:        props.pageType,
      sourceComponent: props.sourceComponent,
      legacyCustomId:  props.legacyCustomId,
    }
    return buildAffiliateLink(input)
  }

  // One impression event per mount, covering this whole action area.
  const containerRef = useRef<HTMLDivElement>(null)
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) return
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const el = containerRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting && !firedRef.current) {
          firedRef.current = true
          const sample = buildOne(marketplaces[0], grades ? GRADE_INTENT[grades[0]] : props.intent)
          trackEvent('affiliate_link_view', { ...sample.analytics })
          io.disconnect()
          break
        }
      }
    }, { threshold: 0.5 })
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onClick(mp: Marketplace, intent: AffiliateIntent) {
    const built = buildOne(mp, intent)
    if (built.url) {
      trackEvent('affiliate_click', { ...built.analytics })
    }
  }

  if (layout === 'inline') {
    const built = buildOne(marketplaces[0], props.intent)
    if (!built.url) return null
    return (
      <a
        href={built.url}
        target="_blank"
        rel="sponsored noopener noreferrer"
        onClick={() => onClick(marketplaces[0], props.intent)}
        ref={containerRef as any}
        style={{
          fontSize:       10,
          color:          'var(--text-muted)',
          textDecoration: 'none',
          fontFamily:     "'Figtree', sans-serif",
          whiteSpace:     'nowrap',
          flexShrink:     0,
          padding:        '2px 4px',
        }}
      >
        {props.label ?? 'See eBay listings →'}
      </a>
    )
  }

  return (
    <div ref={containerRef} style={{ fontFamily: "'Figtree', sans-serif" }}>
      {grades && grades.length > 0 ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {grades.map(g => marketplaces.map(mp => {
            const built = buildOne(mp, GRADE_INTENT[g])
            if (!built.url) return null
            return (
              <a
                key={`${g}-${mp}`}
                href={built.url}
                target="_blank"
                rel="sponsored noopener noreferrer"
                onClick={() => onClick(mp, GRADE_INTENT[g])}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '6px 10px', borderRadius: 18,
                  border: '1px solid var(--border)', background: 'var(--card)',
                  color: 'var(--text)', fontSize: 11, fontWeight: 700,
                  textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 12 }}>{MARKETPLACE_FLAG[mp]}</span>
                {GRADE_LABEL[g]}
              </a>
            )
          }))}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {marketplaces.map((mp, i) => {
            const built = buildOne(mp, props.intent)
            if (!built.url) return null
            const primary = i === 0
            return (
              <a
                key={mp}
                href={built.url}
                target="_blank"
                rel="sponsored noopener noreferrer"
                onClick={() => onClick(mp, props.intent)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7,
                  padding: '9px 16px', borderRadius: 10,
                  textDecoration: 'none',
                  fontSize: 13, fontWeight: 700,
                  border: '1px solid var(--border)',
                  background: primary ? 'var(--primary)' : 'var(--bg-light)',
                  color: primary ? '#fff' : 'var(--text)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 15 }}>{MARKETPLACE_FLAG[mp]}</span>
                {props.label ?? 'See eBay listings'}
              </a>
            )
          })}
        </div>
      )}
      <p
        style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          margin: '8px 0 0',
          opacity: 0.75,
        }}
      >
        Affiliate link · we may earn commission
      </p>
    </div>
  )
}
