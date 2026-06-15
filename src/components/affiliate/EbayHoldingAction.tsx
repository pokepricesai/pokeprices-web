'use client'

// src/components/affiliate/EbayHoldingAction.tsx
// Block 2D — single compact "Check current listings" link used by
// portfolio rows. Intent is derived from the holding type:
//
//   raw      → raw search
//   psa9     → PSA 9 search
//   psa10    → PSA 10 search
//   sealed   → sealed search (sealed category)
//   other graded keys → graded search with PSA n fallback
//
// Quantity, purchase price, notes and gain/loss are NEVER sent to the
// engine or to analytics. The label deliberately reads "Check current
// listings", not "your sale value".

import EbayCompactLink from './EbayCompactLink'
import type { AffiliateIntent } from '@/lib/ebayAffiliate'

type Props = {
  holdingType:  string
  cardName:     string
  setName:      string
  cardNumber?:  string | null
  cardSlug?:    string | null
  setSlug?:     string | null
  productName?: string | null

  placement: 'portfolio_row' | 'watchlist_row'
  pageType?: string
}

function intentFor(holding: string): { intent: AffiliateIntent; gradingCompany?: string; grade?: string } {
  const h = (holding || '').toLowerCase()
  if (h === 'raw')                   return { intent: 'raw' }
  if (h === 'psa9')                  return { intent: 'psa9' }
  if (h === 'psa10')                 return { intent: 'psa10' }
  if (h === 'psa8')                  return { intent: 'psa8' }
  if (h === 'cgc10')                 return { intent: 'graded', gradingCompany: 'CGC', grade: '10' }
  if (h === 'cgc95'  || h === 'cgc9.5') return { intent: 'graded', gradingCompany: 'CGC', grade: '9.5' }
  if (h === 'cgc10pristine')         return { intent: 'graded', gradingCompany: 'CGC', grade: '10 Pristine' }
  if (h === 'bgs10')                 return { intent: 'graded', gradingCompany: 'BGS', grade: '10' }
  if (h === 'bgs10black')            return { intent: 'graded', gradingCompany: 'BGS', grade: '10 Black' }
  if (h === 'sgc10')                 return { intent: 'graded', gradingCompany: 'SGC', grade: '10' }
  if (h === 'tag10')                 return { intent: 'graded', gradingCompany: 'TAG', grade: '10' }
  if (h === 'ace10')                 return { intent: 'graded', gradingCompany: 'ACE', grade: '10' }
  if (h === 'sealed')                return { intent: 'sealed' }
  if (h.startsWith('grade'))         return { intent: 'graded' }
  return { intent: 'raw' }
}

export default function EbayHoldingAction(props: Props) {
  const { intent, gradingCompany, grade } = intentFor(props.holdingType)
  const isSealed = intent === 'sealed'
  return (
    <EbayCompactLink
      intent={intent}
      cardName={props.cardName}
      setName={isSealed ? null : props.setName}
      cardNumber={props.cardNumber}
      cardSlug={props.cardSlug}
      setSlug={props.setSlug}
      productName={isSealed ? (props.productName || props.cardName) : null}
      gradingCompany={gradingCompany}
      grade={grade}
      placement={props.placement}
      pageType={props.pageType ?? (props.placement === 'portfolio_row' ? 'dashboard' : 'dashboard')}
      sourceComponent={props.placement}
      label="Check current listings"
      icon="🛒"
      style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        padding: '2px 4px',
      }}
    />
  )
}
