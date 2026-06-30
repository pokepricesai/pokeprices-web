// src/lib/seo-analysis/ebayAnalysis.ts
// Block 5A-W-33 — aggregate the eBay TransactionDetail export.
//
// SAFETY
//   * Currency: the export does NOT carry a currency column. We
//     surface earnings + sales as bare numerics and require the
//     caller to read the campaign / checkout-site columns to infer
//     currency. The report should never claim "GBP £X" without
//     proof.
//   * Landing-page diversity is the key W39 signal — most rows here
//     point at https://www.ebay.co.uk/sch/i.html (a generic eBay
//     search), not at card-specific deep links. That suggests the
//     current EPN integration uses keyword landing pages rather than
//     item-level affiliate URLs.

export type EbayRow = {
  eventDate?:       string | null
  eventName?:       string | null
  campaignId?:      string | null
  campaignName?:    string | null
  itemId?:          string | null
  itemName?:        string | null
  quantity?:        number | null
  earnings?:        number | null
  sales?:           number | null
  checkoutSite?:    string | null
  buyerCountry?:    string | null
  trafficType?:     string | null
  landingPageUrl?:  string | null
  status?:          string | null
}

export type EbaySummary = {
  rowCount:            number
  totalQuantity:       number
  totalSalesNumeric:   number
  totalEarningsNumeric: number
  /** Distinct campaigns seen in the file. */
  campaigns:           string[]
  /** Top item names by earnings. */
  topItemsByEarnings:  Array<{ itemName: string; earnings: number; quantity: number }>
  /** Distinct landing-page URLs and how many rows each accounts for. */
  landingPages:        Array<{ url: string; rows: number }>
  /** Distinct checkout sites (UK / US / etc). */
  checkoutSites:       Array<{ site: string; rows: number }>
  /** Distinct buyer countries (lowercase ISO code as it appears). */
  buyerCountries:      Array<{ country: string; rows: number }>
  /** Distinct traffic types (Desktop / Mobile / etc). */
  trafficTypes:        Array<{ type: string; rows: number }>
  /** Currency claim is deliberately not made. */
  currencyNote:        string
}

export function summariseEbay(rows: EbayRow[]): EbaySummary {
  const itemEarnings  = new Map<string, { earnings: number; quantity: number }>()
  const landingMap    = new Map<string, number>()
  const checkoutMap   = new Map<string, number>()
  const countryMap    = new Map<string, number>()
  const trafficMap    = new Map<string, number>()
  const campaignSet   = new Set<string>()
  let totalQuantity   = 0
  let totalSales      = 0
  let totalEarnings   = 0

  for (const r of rows) {
    const q = num(r.quantity)
    const s = num(r.sales)
    const e = num(r.earnings)
    totalQuantity += q
    totalSales    += s
    totalEarnings += e

    if (r.itemName) {
      const cur = itemEarnings.get(r.itemName) ?? { earnings: 0, quantity: 0 }
      cur.earnings += e
      cur.quantity += q
      itemEarnings.set(r.itemName, cur)
    }
    if (r.landingPageUrl)   bump(landingMap,  r.landingPageUrl)
    if (r.checkoutSite)     bump(checkoutMap, r.checkoutSite)
    if (r.buyerCountry)     bump(countryMap,  r.buyerCountry)
    if (r.trafficType)      bump(trafficMap,  r.trafficType)
    if (r.campaignName)     campaignSet.add(r.campaignName)
  }

  const topItemsByEarnings = Array.from(itemEarnings.entries())
    .map(([itemName, v]) => ({ itemName, ...v }))
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, 25)

  return {
    rowCount:             rows.length,
    totalQuantity,
    totalSalesNumeric:    round2(totalSales),
    totalEarningsNumeric: round2(totalEarnings),
    campaigns:            Array.from(campaignSet).sort(),
    topItemsByEarnings:   topItemsByEarnings.map(i => ({ ...i, earnings: round2(i.earnings) })),
    landingPages:         mapToSortedList(landingMap),
    checkoutSites:        mapToSortedList(checkoutMap).map(({ url, rows }) => ({ site: url, rows })),
    buyerCountries:       mapToSortedList(countryMap).map(({ url, rows }) => ({ country: url, rows })),
    trafficTypes:         mapToSortedList(trafficMap).map(({ url, rows }) => ({ type: url, rows })),
    currencyNote:         'Currency is not in the export header. Earnings/sales are unitless numerics. Use Checkout Site (UK / US) + Campaign Name to infer the currency before stating "£" or "$".',
  }
}

function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) ?? 0) + 1)
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function mapToSortedList(m: Map<string, number>): Array<{ url: string; rows: number }> {
  return Array.from(m.entries())
    .map(([url, rows]) => ({ url, rows }))
    .sort((a, b) => b.rows - a.rows)
}
