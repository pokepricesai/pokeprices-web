// portfolioGrades — single source of truth for which grading slabs the
// portfolio supports, which have live market data, and which need a manual
// value entered by the user.
//
// "manual" === true means we don't yet have a market-price feed for that
// grading company / grade, so the user must enter the value themselves and
// the portfolio shows a "manual value" badge against the holding.

export interface HoldingType {
  value: string
  label: string
  /** True when no live market data exists — user must enter value manually. */
  manual: boolean
  /** Grouping label shown in the dropdown. */
  company: string
}

export const HOLDING_TYPES: HoldingType[] = [
  // Ungraded
  { value: 'raw', label: 'Raw (Ungraded)', manual: false, company: 'Ungraded' },

  // PSA — full ladder, all live
  { value: 'psa1',  label: 'PSA 1',  manual: false, company: 'PSA' },
  { value: 'psa2',  label: 'PSA 2',  manual: false, company: 'PSA' },
  { value: 'psa3',  label: 'PSA 3',  manual: false, company: 'PSA' },
  { value: 'psa4',  label: 'PSA 4',  manual: false, company: 'PSA' },
  { value: 'psa5',  label: 'PSA 5',  manual: false, company: 'PSA' },
  { value: 'psa6',  label: 'PSA 6',  manual: false, company: 'PSA' },
  { value: 'psa7',  label: 'PSA 7',  manual: false, company: 'PSA' },
  { value: 'psa8',  label: 'PSA 8',  manual: false, company: 'PSA' },
  { value: 'psa9',  label: 'PSA 9',  manual: false, company: 'PSA' },
  { value: 'psa10', label: 'PSA 10', manual: false, company: 'PSA' },

  // BGS — 10 + 10 Black are live; lower grades manual
  { value: 'bgs8',       label: 'BGS 8',        manual: true,  company: 'BGS' },
  { value: 'bgs9',       label: 'BGS 9',        manual: true,  company: 'BGS' },
  { value: 'bgs95',      label: 'BGS 9.5',      manual: true,  company: 'BGS' },
  { value: 'bgs10',      label: 'BGS 10',       manual: false, company: 'BGS' },
  { value: 'bgs10black', label: 'BGS 10 Black', manual: false, company: 'BGS' },

  // CGC — 9.5 / 10 / 10 Pristine are live; lower grades manual
  { value: 'cgc8',          label: 'CGC 8',           manual: true,  company: 'CGC' },
  { value: 'cgc9',          label: 'CGC 9',           manual: true,  company: 'CGC' },
  { value: 'cgc95',         label: 'CGC 9.5',         manual: false, company: 'CGC' },
  { value: 'cgc10',         label: 'CGC 10',          manual: false, company: 'CGC' },
  { value: 'cgc10pristine', label: 'CGC 10 Pristine', manual: false, company: 'CGC' },

  // SGC — 10 only
  { value: 'sgc8',  label: 'SGC 8',   manual: true,  company: 'SGC' },
  { value: 'sgc9',  label: 'SGC 9',   manual: true,  company: 'SGC' },
  { value: 'sgc95', label: 'SGC 9.5', manual: true,  company: 'SGC' },
  { value: 'sgc10', label: 'SGC 10',  manual: false, company: 'SGC' },

  // ACE — 10 only
  { value: 'ace9',  label: 'ACE 9',   manual: true,  company: 'ACE' },
  { value: 'ace95', label: 'ACE 9.5', manual: true,  company: 'ACE' },
  { value: 'ace10', label: 'ACE 10',  manual: false, company: 'ACE' },

  // TAG — 10 only
  { value: 'tag9',  label: 'TAG 9',   manual: true,  company: 'TAG' },
  { value: 'tag95', label: 'TAG 9.5', manual: true,  company: 'TAG' },
  { value: 'tag10', label: 'TAG 10',  manual: false, company: 'TAG' },

  { value: 'other', label: 'Other / Unknown', manual: true, company: 'Other' },
]

export const GRADE_LABELS: Record<string, string> = Object.fromEntries(
  HOLDING_TYPES.map(t => [t.value, t.label]),
)

export function isManualGrade(holdingType: string): boolean {
  return HOLDING_TYPES.find(t => t.value === holdingType)?.manual ?? false
}

/**
 * Maps a holding_type string to the column name on `daily_prices` that
 * holds its current market price (cents, USD). Only includes types where
 * `manual === false`. Used by the portfolio dashboard to enrich holdings
 * with tier-specific live prices.
 */
export const HOLDING_TYPE_TO_PRICE_COLUMN: Record<string, string> = {
  raw:           'raw_usd',
  psa1:          'grade1_usd',
  psa2:          'grade2_usd',
  psa3:          'grade3_usd',
  psa4:          'grade4_usd',
  psa5:          'grade5_usd',
  psa6:          'grade6_usd',
  psa7:          'psa7_usd',
  psa8:          'psa8_usd',
  psa9:          'psa9_usd',
  psa10:         'psa10_usd',
  bgs10:         'bgs10_usd',
  bgs10black:    'bgs10black_usd',
  cgc95:         'cgc95_usd',
  cgc10:         'cgc10_usd',
  cgc10pristine: 'cgc10pristine_usd',
  sgc10:         'sgc10_usd',
  tag10:         'tag10_usd',
  ace10:         'ace10_usd',
}

export const NO_MARKET_DATA_NOTE =
  'PokePrices does not yet pull live market data for this specific grade. ' +
  'Please enter the current value manually below — you can update it from the Edit screen any time.'
