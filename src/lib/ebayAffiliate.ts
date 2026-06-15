// src/lib/ebayAffiliate.ts
// PokePrices v2 Block 2C — central eBay affiliate engine.
//
// All eBay affiliate URLs in the codebase must come from this module.
// The repository audit script (scripts/audit-ebay-links.mjs) fails if a
// user-facing eBay URL is built anywhere else.
//
// Two surfaces:
//
//   1. buildAffiliateLink(input) — the canonical new engine. Typed input,
//      typed result, returns `url: null` when the marketplace's campaign
//      ID is missing so the caller can hide that action rather than render
//      a malformed URL.
//
//   2. Legacy exports (getEbayUkUrl, getEbayUsUrl, …) — byte-identical
//      signatures and output to pre-Block-2C, so existing EPN custom IDs
//      already in live reports keep flowing. New code must prefer
//      buildAffiliateLink.
//
// Custom-ID format
//   * If legacyCustomId is supplied, it is used verbatim (byte-identical).
//   * Otherwise the v2 form is emitted:
//
//       pp:<placement>:<intent>:<marketplace>:<page_type>:<reference>
//
//     with the slot list always present (empty slots become `_`), the
//     whole string sanitised to [A-Za-z0-9._:-] and length-capped at 200.

// ── Marketplaces / categories ───────────────────────────────────────────────
//
// Block 2D moved per-marketplace configuration into
// src/lib/marketplaces.ts. The constants below are KEPT for backwards
// compatibility (the legacy exports getEbayUkUrl etc. continue to read
// them) but new code goes through buildAffiliateLink + the registry.

import { PUBLIC_EBAY_CAMPAIGN_IDS } from './marketplaces'

const UK_BASE   = 'https://www.ebay.co.uk/sch/i.html'
const US_BASE   = 'https://www.ebay.com/sch/i.html'
const UK_HOST   = 'www.ebay.co.uk'
const US_HOST   = 'www.ebay.com'
const UK_MKRID  = '710-53481-19255-0'
const US_MKRID  = '711-53200-19255-0'
const UK_SITEID = '3'
const US_SITEID = '0'

/** Trading-card singles category. Use for single-card searches only. */
const CAT_SINGLES = '183454'
/** Sealed Pokémon TCG products live in a different category. Leaving the
 *  singles cat on a sealed-product search hides legitimate results. */
const CAT_SEALED_PARENT = '2536' // Pokémon Trading Card Game parent

// ── Public types ────────────────────────────────────────────────────────────

export type Marketplace = 'uk' | 'us'

export type AffiliateIntent =
  | 'raw'
  | 'psa8'
  | 'psa9'
  | 'psa10'
  | 'graded'
  | 'sold_search'
  | 'japanese'
  | 'set_search'
  | 'pokemon_search'
  | 'sealed'
  | 'exact_listing'
  | 'other'

export type GradingCompany = 'PSA' | 'BGS' | 'CGC' | 'SGC' | 'TAG' | 'ACE'

export type AffiliateBuildInput = {
  marketplace:      Marketplace
  intent:           AffiliateIntent

  // Card / set context (any combination)
  cardName?:        string | null
  setName?:         string | null
  cardNumber?:      string | null
  cardSlug?:        string | null
  setSlug?:         string | null
  pokemonSlug?:     string | null

  // Optional refinements
  language?:        'en' | 'ja' | string
  variant?:         string | null
  gradingCompany?:  GradingCompany | string | null
  grade?:           string | number | null
  productName?:     string | null   // sealed products

  // Analytics context
  placement?:       string
  pageType?:        string
  sourceComponent?: string

  // Custom-ID controls
  /** EXACT value to use as customid. Bypasses the v2 builder so existing
   *  EPN reports keep flowing unchanged. */
  legacyCustomId?:  string | null
  /** Optional reference token to embed at the tail of a v2 custom ID. */
  customReference?: string | null
  /** When set, this verbatim string is used as `_nkw`, bypassing the
   *  intent-specific search-query builder. Used by `affiliateWrapEbayUrl`
   *  so an item ID or pre-existing search string lands intact. */
  rawQueryOverride?: string | null
}

export type AffiliateBuildResult = {
  /** Final affiliate URL, or null when the marketplace campaign ID is missing. */
  url:               string | null
  /** The raw search string used as _nkw. */
  searchQuery:       string
  marketplace:       Marketplace
  intent:            AffiliateIntent
  customTrackingId:  string
  campaignId:        string | null
  analytics: {
    placement?:           string
    intent:               AffiliateIntent
    marketplace:          'UK' | 'US'
    card_slug?:           string
    set_slug?:            string
    grading_company?:     string
    grade?:               string
    language?:            string
    custom_tracking_id:   string
    source_component?:    string
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function stripControl(s: string): string {
  // Drop ASCII control chars (incl. NULs and tabs in queries) and trim.
  return s.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalisedGrade(grade: string | number | null | undefined): string | null {
  if (grade == null) return null
  const s = String(grade).trim()
  if (!s) return null
  return s
}

function normaliseCompany(company: string | null | undefined): string | null {
  if (!company) return null
  return String(company).trim().toUpperCase()
}

function v2Slot(value: string | null | undefined): string {
  const s = (value ?? '').toString().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s || '_'
}

function buildV2CustomId(input: AffiliateBuildInput, mp: Marketplace): string {
  const placement = v2Slot(input.placement)
  const intent    = v2Slot(input.intent)
  const market    = mp === 'uk' ? 'uk' : 'us'
  const pageType  = v2Slot(input.pageType)
  const reference = v2Slot(
    input.customReference
    || input.cardSlug
    || input.setSlug
    || input.pokemonSlug
    || (input.intent === 'sealed' ? input.productName : undefined)
  )
  let out = `pp:${placement}:${intent}:${market}:${pageType}:${reference}`
  // eBay accepts up to 256 chars; cap defensively at 200 to leave room
  // for any future ?campid wrapping.
  if (out.length > 200) out = out.slice(0, 200)
  out = out.replace(/[^A-Za-z0-9._:-]/g, '_')
  return out
}

/**
 * Build the search query string for a given intent. Pure function.
 */
export function buildSearchQuery(input: AffiliateBuildInput): string {
  const name    = input.cardName    ? stripControl(input.cardName)    : ''
  const setStr  = input.setName     ? stripControl(input.setName)     : ''
  const num     = input.cardNumber  ? stripControl(String(input.cardNumber)) : ''
  const product = input.productName ? stripControl(input.productName) : ''
  const variant = input.variant     ? stripControl(input.variant)     : ''

  function withNumberSuffix(rest: string): string {
    if (!num) return rest
    if (name.includes(`#${num}`)) return rest
    return `${rest} #${num}`.replace(/\s+/g, ' ').trim()
  }

  function join(parts: (string | undefined)[]): string {
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  }

  switch (input.intent) {
    case 'raw': {
      const head = withNumberSuffix(name)
      return join([head, setStr, variant, 'pokemon card'])
    }
    case 'sold_search': {
      // Sold search carries grading context when provided so a PSA-10
      // sold search reads as "<name> <set> PSA 10" with LH_Sold flag.
      const company = normaliseCompany(input.gradingCompany)
      const grade   = normalisedGrade(input.grade)
      if (company || grade) {
        const tail = grade ? `${company || 'PSA'} ${grade}` : (company || '')
        const head = withNumberSuffix(name)
        return join([head, setStr, variant, tail])
      }
      const head = withNumberSuffix(name)
      return join([head, setStr, variant, 'pokemon card'])
    }
    case 'psa8':
    case 'psa9':
    case 'psa10': {
      const gradeNum = input.intent === 'psa8' ? 8 : input.intent === 'psa9' ? 9 : 10
      const head = withNumberSuffix(name)
      return join([head, setStr, variant, `PSA ${gradeNum}`])
    }
    case 'graded': {
      const company = normaliseCompany(input.gradingCompany) || 'PSA'
      const grade   = normalisedGrade(input.grade)
      const tail    = grade ? `${company} ${grade}` : company
      const head    = withNumberSuffix(name)
      return join([head, setStr, variant, tail])
    }
    case 'japanese': {
      const head = withNumberSuffix(name)
      return join([head, variant, 'Japanese Pokemon card'])
    }
    case 'set_search':
      return join([setStr || name, 'pokemon set'])
    case 'pokemon_search':
      return join([name || 'pokemon', 'pokemon card'])
    case 'sealed':
      return join([product || name, 'pokemon'])
    case 'exact_listing':
      // Exact listing intent resolves to a precise search.
      return join([product || withNumberSuffix(name), setStr])
    case 'other':
    default:
      return join([withNumberSuffix(name), setStr, 'pokemon card'])
  }
}

function categoryFor(intent: AffiliateIntent): string {
  return intent === 'sealed' ? CAT_SEALED_PARENT : CAT_SINGLES
}

function readCampaignId(mp: Marketplace): string | null {
  // Reads from the static PUBLIC_EBAY_CAMPAIGN_IDS map so the campaign
  // ID is inlined into the client bundle at build time. Dynamic
  // `process.env[name]` is NOT inlined on the client and would silently
  // resolve to undefined in production.
  const raw = (mp === 'uk' ? PUBLIC_EBAY_CAMPAIGN_IDS.UK : PUBLIC_EBAY_CAMPAIGN_IDS.US) ?? ''
  const trimmed = String(raw).trim()
  return trimmed.length > 0 ? trimmed : null
}

function rawBuildUrl(
  mp: Marketplace,
  searchQuery: string,
  campid: string,
  customId: string,
  options: { sold: boolean; category?: string },
): string {
  const base   = mp === 'uk' ? UK_BASE   : US_BASE
  const mkrid  = mp === 'uk' ? UK_MKRID  : US_MKRID
  const siteid = mp === 'uk' ? UK_SITEID : US_SITEID
  const params = new URLSearchParams()
  params.set('_nkw',   searchQuery)
  params.set('mkcid',  '1')
  params.set('mkrid',  mkrid)
  params.set('siteid', siteid)
  params.set('campid', campid)
  params.set('toolid', '10001')
  params.set('mkevt',  '1')
  if (mp === 'uk') params.set('LH_PrefLoc', '1')
  if (options.sold) {
    params.set('LH_Sold',     '1')
    params.set('LH_Complete', '1')
  }
  if (options.category) params.set('_sacat', options.category)
  if (customId)         params.set('customid', customId)
  return `${base}?${params.toString()}`
}

// ── New canonical engine ────────────────────────────────────────────────────

export function buildAffiliateLink(input: AffiliateBuildInput): AffiliateBuildResult {
  const mp           = input.marketplace
  const searchQuery  = input.rawQueryOverride && input.rawQueryOverride.length > 0
    ? stripControl(input.rawQueryOverride)
    : buildSearchQuery(input)
  const customId     = input.legacyCustomId && input.legacyCustomId.length > 0
    ? input.legacyCustomId
    : buildV2CustomId(input, mp)
  const campid       = readCampaignId(mp)

  const analytics = {
    placement:           input.placement,
    intent:              input.intent,
    marketplace:         (mp === 'uk' ? 'UK' : 'US') as 'UK' | 'US',
    card_slug:           input.cardSlug ?? undefined,
    set_slug:            input.setSlug ?? undefined,
    grading_company:     normaliseCompany(input.gradingCompany) ?? undefined,
    grade:               normalisedGrade(input.grade) ?? undefined,
    language:            input.language,
    custom_tracking_id:  customId,
    source_component:    input.sourceComponent,
  }

  if (!campid) {
    return {
      url:              null,
      searchQuery,
      marketplace:      mp,
      intent:           input.intent,
      customTrackingId: customId,
      campaignId:       null,
      analytics,
    }
  }

  const sold = input.intent === 'sold_search'
  const url  = rawBuildUrl(mp, searchQuery, campid, customId, {
    sold,
    category: categoryFor(input.intent),
  })

  return {
    url,
    searchQuery,
    marketplace:      mp,
    intent:           input.intent,
    customTrackingId: customId,
    campaignId:       campid,
    analytics,
  }
}

// ── Defensive wrapper for raw eBay URLs (AI answers) ───────────────────────

/**
 * Wraps an arbitrary raw eBay URL with affiliate tracking, **as a search**.
 *
 * eBay's affiliate programme does not give us a verified exact-item
 * tracking URL today, so this function deliberately collapses every
 * input to a precise affiliate search:
 *
 *   * /itm/<id>         → search for the listing's numeric id
 *   * /sch/i.html?_nkw= → rewrite with affiliate params, preserve _nkw
 *   * /str/<store>      → search for the store name
 *   * everything else   → search for the URL's last meaningful path segment
 *
 * Returns null when the marketplace's campaign ID is missing OR when the
 * input is not an eBay URL we recognise — the caller should leave the
 * original URL alone in that case.
 */
export function affiliateWrapEbayUrl(
  rawUrl: string,
  ctx: {
    placement?: string
    pageType?:  string
    sourceComponent?: string
    cardSlug?:  string | null
  } = {},
): { url: string | null; intent: AffiliateIntent; marketplace: Marketplace; customTrackingId: string } | null {
  if (typeof rawUrl !== 'string' || !rawUrl) return null
  let parsed: URL
  try { parsed = new URL(rawUrl) }
  catch { return null }

  const host = parsed.hostname.toLowerCase()
  let mp: Marketplace
  if (host === UK_HOST || host.endsWith('.ebay.co.uk')) mp = 'uk'
  else if (host === US_HOST || host.endsWith('.ebay.com')) mp = 'us'
  else return null

  let searchTerm = ''
  let intent: AffiliateIntent = 'other'

  const itmMatch = parsed.pathname.match(/\/itm\/(?:[^\/?]+\/)?(\d{6,})/)
  if (itmMatch) {
    searchTerm = itmMatch[1]
    intent     = 'exact_listing'
  } else if (parsed.pathname.startsWith('/sch/')) {
    searchTerm = parsed.searchParams.get('_nkw') || ''
    intent     = parsed.searchParams.get('LH_Sold') === '1' ? 'sold_search' : 'raw'
  } else if (parsed.pathname.startsWith('/str/')) {
    const seg = parsed.pathname.split('/').filter(Boolean)
    searchTerm = (seg[1] || '').replace(/[-_]+/g, ' ')
    intent     = 'other'
  } else {
    const segs = parsed.pathname.split('/').filter(Boolean)
    searchTerm = (segs[segs.length - 1] || 'pokemon').replace(/[-_]+/g, ' ')
    intent     = 'other'
  }

  if (!searchTerm.trim()) searchTerm = 'pokemon'

  const built = buildAffiliateLink({
    marketplace:      mp,
    intent,
    cardSlug:         ctx.cardSlug,
    placement:        ctx.placement   ?? 'ai_response',
    pageType:         ctx.pageType    ?? 'other',
    sourceComponent:  ctx.sourceComponent ?? 'affiliate_wrap_ebay_url',
    rawQueryOverride: searchTerm,
  })

  return {
    url:              built.url,
    intent,
    marketplace:      mp,
    customTrackingId: built.customTrackingId,
  }
}

// ── Legacy exports — byte-identical to pre-Block-2C ────────────────────────

export function getEbayUkUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_UK ?? ''
  return rawBuildUrl('uk', searchQuery, campid, customId ?? '', { sold: false, category: CAT_SINGLES })
}

export function getEbayUsUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_US ?? ''
  return rawBuildUrl('us', searchQuery, campid, customId ?? '', { sold: false, category: CAT_SINGLES })
}

export function getEbayUkSoldUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_UK ?? ''
  const finalCustomId = customId ? `${customId}-sold` : ''
  return rawBuildUrl('uk', searchQuery, campid, finalCustomId, { sold: true, category: CAT_SINGLES })
}

export function getEbayUsSoldUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_US ?? ''
  const finalCustomId = customId ? `${customId}-sold` : ''
  return rawBuildUrl('us', searchQuery, campid, finalCustomId, { sold: true, category: CAT_SINGLES })
}

/** Legacy: `<name>[ #<number>] <set> pokemon card`. */
export function buildCardEbayQuery(
  cardName: string,
  setName: string,
  cardNumber: string | null,
): string {
  const numberSuffix = cardNumber && !cardName.includes(`#${cardNumber}`) ? ` #${cardNumber}` : ''
  return `${cardName}${numberSuffix} ${setName} pokemon card`
}

// ── Marketplace availability ────────────────────────────────────────────────

export function hasMarketplaceCampaign(mp: Marketplace): boolean {
  return readCampaignId(mp) !== null
}
