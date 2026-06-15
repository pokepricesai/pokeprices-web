'use client'

// src/components/affiliate/EbayCardPriceActions.tsx
// Block 2D — compact "Find raw / PSA 9 / PSA 10 copies on eBay" row.
//
// Rules:
//   * No action when the underlying price is missing.
//   * No actions for sealed products (passed via isSealed).
//   * No PSA 8 link (we do not show a PSA 8 price column today, so
//     adding a link beside no price would be noise).
//   * Single shared disclosure line.

import EbayCompactLink from './EbayCompactLink'

export type EbayCardPriceActionsProps = {
  cardName:    string
  setName:     string
  cardNumber?: string | null
  cardSlug?:   string | null
  setSlug?:    string | null
  pageType?:   string
  isSealed?:   boolean

  rawPriceCents?:   number | null
  psa9PriceCents?:  number | null
  psa10PriceCents?: number | null
}

export default function EbayCardPriceActions(props: EbayCardPriceActionsProps) {
  if (props.isSealed) return null

  const common = {
    cardName:        props.cardName,
    setName:         props.setName,
    cardNumber:      props.cardNumber,
    cardSlug:        props.cardSlug,
    setSlug:         props.setSlug,
    pageType:        props.pageType ?? 'card',
    sourceComponent: 'card_price_actions',
  }

  const showRaw   = (props.rawPriceCents   ?? 0) > 0
  const showPsa9  = (props.psa9PriceCents  ?? 0) > 0
  const showPsa10 = (props.psa10PriceCents ?? 0) > 0
  if (!showRaw && !showPsa9 && !showPsa10) return null

  const linkStyle: React.CSSProperties = {
    fontSize: 12,
    color: 'var(--text)',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    padding: '6px 12px',
  }

  return (
    <div style={{ marginTop: 14, fontFamily: "'Figtree', sans-serif" }}>
      <div style={{
        fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 8,
      }}>
        Compare on eBay
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {showRaw && (
          <EbayCompactLink
            {...common}
            intent="raw"
            placement="price_raw"
            label="Find raw copies"
            icon="🛒"
            style={linkStyle}
          />
        )}
        {showPsa9 && (
          <EbayCompactLink
            {...common}
            intent="psa9"
            placement="price_psa9"
            label="Find PSA 9 copies"
            icon="🛒"
            style={linkStyle}
          />
        )}
        {showPsa10 && (
          <EbayCompactLink
            {...common}
            intent="psa10"
            placement="price_psa10"
            label="Find PSA 10 copies"
            icon="🛒"
            style={linkStyle}
          />
        )}
      </div>
      <p style={{
        fontSize: 10, color: 'var(--text-muted)',
        margin: '8px 0 0', opacity: 0.75,
      }}>
        Affiliate link · we may earn commission
      </p>
    </div>
  )
}
