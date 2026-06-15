'use client'

// src/components/affiliate/EbayGradingScenarioAction.tsx
// Block 2D — single compact "Compare PSA n listings" link beside a
// grading-tool scenario row. No "profit guaranteed" language anywhere.

import EbayCompactLink from './EbayCompactLink'
import type { AffiliateIntent } from '@/lib/ebayAffiliate'

type Props = {
  scenario: 'raw' | 'psa8' | 'psa9' | 'psa10'
  cardName: string
  setName:  string
  cardNumber?: string | null
  cardSlug?:   string | null
  setSlug?:    string | null
}

const LABELS: Record<Props['scenario'], string> = {
  raw:   'Compare raw copies',
  psa8:  'Compare PSA 8 listings',
  psa9:  'Compare PSA 9 listings',
  psa10: 'Compare PSA 10 listings',
}

const INTENT: Record<Props['scenario'], AffiliateIntent> = {
  raw:   'raw',
  psa8:  'psa8',
  psa9:  'psa9',
  psa10: 'psa10',
}

export default function EbayGradingScenarioAction(props: Props) {
  return (
    <EbayCompactLink
      intent={INTENT[props.scenario]}
      cardName={props.cardName}
      setName={props.setName}
      cardNumber={props.cardNumber}
      cardSlug={props.cardSlug}
      setSlug={props.setSlug}
      placement="grading_report"
      pageType="grading"
      sourceComponent="grading_scenario_action"
      label={LABELS[props.scenario]}
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
