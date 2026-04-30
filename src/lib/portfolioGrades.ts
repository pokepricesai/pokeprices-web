// portfolioGrades — single source of truth for which grading slabs the
// portfolio supports, which have live market data, and which need a manual
// value entered by the user.
//
// "manual" === true means we don't yet have a market-price feed for that
// grading company, so the user must enter the value themselves and the
// portfolio shows a "manual value" badge against the holding.

export interface HoldingType {
  value: string
  label: string
  /** True when no live market data exists — user must enter value manually. */
  manual: boolean
  /** Grouping label shown in the dropdown. */
  company: string
}

export const HOLDING_TYPES: HoldingType[] = [
  // ── Live market data (PriceCharting + PSA pop) ──
  { value: 'raw',    label: 'Raw (Ungraded)',     manual: false, company: 'Ungraded' },
  { value: 'psa7',   label: 'PSA 7',              manual: false, company: 'PSA' },
  { value: 'psa8',   label: 'PSA 8',              manual: false, company: 'PSA' },
  { value: 'psa9',   label: 'PSA 9',              manual: false, company: 'PSA' },
  { value: 'psa10',  label: 'PSA 10',             manual: false, company: 'PSA' },

  // ── Manual entry (no live market feed yet) ──
  { value: 'bgs8',   label: 'BGS 8',              manual: true,  company: 'BGS' },
  { value: 'bgs9',   label: 'BGS 9',              manual: true,  company: 'BGS' },
  { value: 'bgs95',  label: 'BGS 9.5',            manual: true,  company: 'BGS' },
  { value: 'bgs10',  label: 'BGS 10 (Pristine)',  manual: true,  company: 'BGS' },

  { value: 'cgc8',   label: 'CGC 8',              manual: true,  company: 'CGC' },
  { value: 'cgc9',   label: 'CGC 9',              manual: true,  company: 'CGC' },
  { value: 'cgc95',  label: 'CGC 9.5',            manual: true,  company: 'CGC' },
  { value: 'cgc10',  label: 'CGC 10 (Pristine)',  manual: true,  company: 'CGC' },

  { value: 'sgc8',   label: 'SGC 8',              manual: true,  company: 'SGC' },
  { value: 'sgc9',   label: 'SGC 9',              manual: true,  company: 'SGC' },
  { value: 'sgc95',  label: 'SGC 9.5',            manual: true,  company: 'SGC' },
  { value: 'sgc10',  label: 'SGC 10 (Gold/Pristine)', manual: true, company: 'SGC' },

  { value: 'ace9',   label: 'ACE 9',              manual: true,  company: 'ACE' },
  { value: 'ace95',  label: 'ACE 9.5',            manual: true,  company: 'ACE' },
  { value: 'ace10',  label: 'ACE 10',             manual: true,  company: 'ACE' },

  { value: 'tag9',   label: 'TAG 9',              manual: true,  company: 'TAG' },
  { value: 'tag95',  label: 'TAG 9.5',            manual: true,  company: 'TAG' },
  { value: 'tag10',  label: 'TAG 10',             manual: true,  company: 'TAG' },

  { value: 'other',  label: 'Other / Unknown',    manual: true,  company: 'Other' },
]

export const GRADE_LABELS: Record<string, string> = Object.fromEntries(
  HOLDING_TYPES.map(t => [t.value, t.label]),
)

export function isManualGrade(holdingType: string): boolean {
  return HOLDING_TYPES.find(t => t.value === holdingType)?.manual ?? false
}

export const NO_MARKET_DATA_NOTE =
  'PokePrices does not yet pull live market data for this grading company. ' +
  'Please enter the current value manually below — you can update it from the Edit screen any time. ' +
  'BGS, CGC, SGC, ACE and TAG market feeds are coming soon.'
