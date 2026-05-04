// eBay Partner Network affiliate URL builders.
// Campaign IDs are exposed via NEXT_PUBLIC_ envs so client components can use them.

const UK_BASE = 'https://www.ebay.co.uk/sch/i.html'
const US_BASE = 'https://www.ebay.com/sch/i.html'

const UK_MKRID = '710-53481-19255-0'
const US_MKRID = '711-53200-19255-0'

const TRADING_CARD_SINGLES_CATEGORY = '183454'

function buildUrl(
  base: string,
  searchQuery: string,
  campid: string,
  mkrid: string,
  siteid: string,
  options: { ukPrefLoc?: boolean; customId?: string },
): string {
  const params = new URLSearchParams()
  params.set('_nkw', searchQuery)
  params.set('mkcid', '1')
  params.set('mkrid', mkrid)
  params.set('siteid', siteid)
  params.set('campid', campid)
  params.set('toolid', '10001')
  params.set('mkevt', '1')
  if (options.ukPrefLoc) params.set('LH_PrefLoc', '1')
  params.set('_sacat', TRADING_CARD_SINGLES_CATEGORY)
  if (options.customId) params.set('customid', options.customId)
  return `${base}?${params.toString()}`
}

export function getEbayUkUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_UK ?? ''
  return buildUrl(UK_BASE, searchQuery, campid, UK_MKRID, '3', { ukPrefLoc: true, customId })
}

export function getEbayUsUrl(searchQuery: string, customId?: string): string {
  const campid = process.env.NEXT_PUBLIC_EBAY_CAMPID_US ?? ''
  return buildUrl(US_BASE, searchQuery, campid, US_MKRID, '0', { customId })
}
