// src/lib/dashboard/affiliateDealLink.ts
//
// Block 5A-W-43B — deep-link builder for daily_deals CTAs.
//
// WHY THIS EXISTS
//   src/lib/ebayAffiliate.ts::affiliateWrapEbayUrl (the central W39
//   engine) deliberately collapses every /itm/<id> URL into an
//   affiliate SEARCH result, because at the time it was written the
//   affiliate programme was not delivering verified exact-item
//   tracking URLs. That default is correct for AI chat / cross-repo
//   URLs of unknown provenance, but it means "Check on eBay" CTAs
//   on the Potential Deals dashboard section point at a search
//   result instead of the listing the user is expecting to see.
//
//   eBay Partner Network deep-linking IS supported by appending
//   affiliate parameters directly to a bare /itm/<id> URL. This
//   helper does exactly that, scoped narrowly to daily_deals CTAs:
//
//     https://<host>/itm/<id>?mkcid=1&mkrid=<mkrid>&siteid=<siteid>
//       &campid=<campid>&toolid=10001&mkevt=1&customid=<track>
//
//   Only implemented marketplaces (UK, US) are handled — anything
//   else returns null and the CTA fails closed to plain text.
//
// SCOPE — NOT A W39 HELPER CHANGE
//   * The central engine (ebayAffiliate.ts) is not modified.
//   * The marketplace registry (marketplaces.ts) is consumed as
//     read-only data — same registry every other affiliate consumer
//     reads.
//   * This file is on the audit ALLOW list purely so it can pass
//     the /itm/<id> URL and marketplace hostnames through to eBay.
//     A regression in another file that constructs affiliate URLs
//     without going through the central engine still trips the
//     audit.

import {
  MARKETPLACE_DEFINITIONS,
  readCampaignId,
  type MarketplaceCode,
} from '@/lib/marketplaces'

export type ParsedItemUrl = {
  marketplace: MarketplaceCode
  itemId:      string
}

/**
 * Parse an eBay item URL. Returns the marketplace + numeric item id
 * when the URL points at a live /itm/<id> page on an implemented
 * marketplace (UK or US today). Returns null otherwise so the caller
 * can hide the CTA rather than render a broken link.
 */
export function parseEbayItemUrl(rawUrl: string | null | undefined): ParsedItemUrl | null {
  if (typeof rawUrl !== 'string' || !rawUrl) return null
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return null }

  const host = parsed.hostname.toLowerCase()
  let marketplace: MarketplaceCode | null = null
  if (host === 'www.ebay.co.uk' || host.endsWith('.ebay.co.uk')) marketplace = 'UK'
  else if (host === 'www.ebay.com' || host.endsWith('.ebay.com'))  marketplace = 'US'
  if (!marketplace) return null

  // Matches "/itm/1234567890" and "/itm/some-title-slug/1234567890".
  // eBay item IDs are typically 12 digits but historic listings can
  // be as short as 6 — treat 6+ as valid.
  const m = parsed.pathname.match(/\/itm\/(?:[^\/?]+\/)?(\d{6,})/)
  if (!m) return null

  return { marketplace, itemId: m[1] }
}

export type BuildDealDeepLinkInput = {
  /** The raw item URL from daily_deals.item_web_url. */
  itemWebUrl:  string | null | undefined
  /** Defensive: cross-check against daily_deals.ebay_item_id. When
   *  provided AND the URL's embedded id disagrees, we return null so
   *  the CTA fails closed rather than sending the user to the wrong
   *  listing. */
  ebayItemId?: string | number | null
  /** Optional customid segment for the EPN report. Sanitised to the
   *  same character set the central engine uses. */
  customId?:   string | null
}

/**
 * Build an affiliate-wrapped deep link to a specific eBay item.
 *
 * Returns null when:
 *   * `itemWebUrl` is missing / not an eBay /itm/<id> URL
 *   * the URL points at a non-implemented marketplace
 *   * `ebayItemId` is supplied and disagrees with the URL's id
 *   * the marketplace's campaign ID is missing (NEXT_PUBLIC_EBAY_CAMPID_<code> unset)
 *
 * Callers must handle the null return by hiding the CTA — never
 * fall back to the raw URL.
 */
export function buildDealDeepLink(input: BuildDealDeepLinkInput): string | null {
  const parsed = parseEbayItemUrl(input.itemWebUrl)
  if (!parsed) return null

  if (input.ebayItemId != null) {
    const providedId = String(input.ebayItemId).trim()
    if (providedId && providedId !== parsed.itemId) return null
  }

  const campid = readCampaignId(parsed.marketplace)
  if (!campid) return null

  const def = MARKETPLACE_DEFINITIONS[parsed.marketplace]
  const params = new URLSearchParams()
  params.set('mkcid',  '1')
  params.set('mkrid',  def.mkrid)
  params.set('siteid', def.siteId)
  params.set('campid', campid)
  params.set('toolid', '10001')
  params.set('mkevt',  '1')
  const customId = sanitizeCustomId(input.customId)
  if (customId) params.set('customid', customId)

  return `https://${def.hostname}/itm/${parsed.itemId}?${params.toString()}`
}

function sanitizeCustomId(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw).replace(/[^A-Za-z0-9._:-]/g, '_')
  return s.length > 200 ? s.slice(0, 200) : s
}
