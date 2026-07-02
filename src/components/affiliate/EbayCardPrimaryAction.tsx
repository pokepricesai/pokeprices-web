'use client'

// src/components/affiliate/EbayCardPrimaryAction.tsx
// Block 5A-W-39B — one prominent card-page "Find this card on eBay"
// CTA, sitting inside the Current Prices card between the grade
// ladder and the compact grade-specific "Compare on eBay" chips.
//
// Contract:
//   * Uses EbayCompactLink internally so it inherits marketplace
//     localisation (UK/US via useMarketplace()), impression + click
//     tracking, and rel="sponsored noopener noreferrer".
//   * Uses intent="raw" and placement="card_primary" — the v2 custom
//     tracking ID includes "card_primary" so this placement is
//     attributable in EPN reporting distinct from the existing
//     price_raw / price_psa9 / price_psa10 / recent_sales_all rows.
//   * Query is built by the W39A-cleaned buildSearchQuery — no
//     duplicated `#NN #NN/MM` tokens.
//   * Returns null (renders nothing) when:
//       - the card is a sealed product (label "…this card…" would
//         mislead — sealed products already have their own path),
//       - card_name or set_name are missing/blank,
//       - the resolved marketplace has no campaign ID (handled
//         inside EbayCompactLink).

import EbayCompactLink from './EbayCompactLink'

export type EbayCardPrimaryActionProps = {
  cardName:    string
  setName:     string
  cardNumber?: string | null
  cardSlug?:   string | null
  setSlug?:    string | null
  isSealed?:   boolean
}

export default function EbayCardPrimaryAction(props: EbayCardPrimaryActionProps) {
  if (props.isSealed) return null
  if (!props.cardName?.trim() || !props.setName?.trim()) return null

  return (
    <div style={{ marginTop: 12, marginBottom: 4 }}>
      <EbayCompactLink
        intent="raw"
        cardName={props.cardName}
        setName={props.setName}
        cardNumber={props.cardNumber}
        cardSlug={props.cardSlug}
        setSlug={props.setSlug}
        placement="card_primary"
        pageType="card"
        sourceComponent="card_primary_action"
        label="Find this card on eBay"
        icon="🛒"
        ariaLabel="Find this card on eBay — opens current listings in a new tab"
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          gap:            8,
          padding:        '10px 18px',
          fontSize:       13,
          fontWeight:     800,
          color:          '#fff',
          background:     'var(--primary)',
          border:         '1px solid var(--primary)',
          borderRadius:   999,
          textDecoration: 'none',
          whiteSpace:     'nowrap',
          fontFamily:     "'Figtree', sans-serif",
        }}
      />
    </div>
  )
}
