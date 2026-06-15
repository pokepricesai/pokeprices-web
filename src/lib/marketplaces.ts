// src/lib/marketplaces.ts
// Block 2D — central marketplace registry.
//
// Every supported eBay marketplace is declared here.
//
// A marketplace passes through three independent readiness states:
//
//   1. implemented — the central URL engine (ebayAffiliate.ts) can emit
//      a NATIVE affiliate URL for it. Only UK and US are implemented
//      today; the others fall back to the engine's UK/US composition.
//
//   2. configured — a non-empty campaign id is present in the static
//      PUBLIC_EBAY_CAMPAIGN_IDS map below (read at build time from a
//      NEXT_PUBLIC_EBAY_CAMPID_<CODE> env var).
//
//   3. selectable — implemented AND configured. Only selectable
//      marketplaces are surfaced in the selector or the settings
//      dropdown.
//
// Important: NEXT_PUBLIC_* variables are baked into the browser bundle
// at build time. Adding or changing one requires a Vercel deployment.
// See docs/ebay-affiliate.md for the full deployment flow.

export type MarketplaceCode =
  | 'UK' | 'US'
  | 'CA' | 'AU' | 'DE' | 'FR' | 'IT' | 'ES'

export type MarketplaceDefinition = {
  code:           MarketplaceCode
  hostname:       string          // e.g. www.ebay.co.uk
  siteId:         string          // eBay site id (string for URL composition)
  mkrid:          string          // eBay rotation campaign id (per marketplace)
  campaignEnvVar: string          // NEXT_PUBLIC_EBAY_CAMPID_<CODE> — documentation only; reads go through PUBLIC_EBAY_CAMPAIGN_IDS
  label:          string          // human label for the selector
  currencyCode:   string          // ISO 4217
  flag:           string          // single-character flag emoji
  fallback:       MarketplaceCode // fallback when this marketplace is unconfigured
  preferLocal:    boolean         // emit LH_PrefLoc on this marketplace
}

/**
 * Statically-referenced map of NEXT_PUBLIC campaign IDs. Each property is
 * a literal `process.env.<NAME>` access so Next.js's build-time inliner
 * replaces it in the browser bundle. Dynamic access via
 * `process.env[name]` does NOT get inlined on the client and would
 * silently return `undefined` in production. Do not change this map's
 * shape without confirming the inliner still sees each access as a
 * literal.
 */
export const PUBLIC_EBAY_CAMPAIGN_IDS: Readonly<Record<MarketplaceCode, string | undefined>> = {
  UK: process.env.NEXT_PUBLIC_EBAY_CAMPID_UK,
  US: process.env.NEXT_PUBLIC_EBAY_CAMPID_US,
  CA: process.env.NEXT_PUBLIC_EBAY_CAMPID_CA,
  AU: process.env.NEXT_PUBLIC_EBAY_CAMPID_AU,
  DE: process.env.NEXT_PUBLIC_EBAY_CAMPID_DE,
  FR: process.env.NEXT_PUBLIC_EBAY_CAMPID_FR,
  IT: process.env.NEXT_PUBLIC_EBAY_CAMPID_IT,
  ES: process.env.NEXT_PUBLIC_EBAY_CAMPID_ES,
} as const

/**
 * Marketplaces whose NATIVE URL composition is implemented in
 * src/lib/ebayAffiliate.ts. Until a marketplace appears here, it must
 * not be selectable from the selector or the settings dropdown — even
 * if its campaign id is set — because the engine cannot yet emit a
 * correctly-attributed URL for it.
 */
export const IMPLEMENTED_MARKETPLACES: ReadonlyArray<MarketplaceCode> = ['UK', 'US']

// Order matters — selector renders in this order.
const DEFS: MarketplaceDefinition[] = [
  {
    code: 'UK', hostname: 'www.ebay.co.uk', siteId: '3',
    mkrid: '710-53481-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_UK',
    label: 'United Kingdom', currencyCode: 'GBP', flag: '🇬🇧',
    fallback: 'US', preferLocal: true,
  },
  {
    code: 'US', hostname: 'www.ebay.com', siteId: '0',
    mkrid: '711-53200-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_US',
    label: 'United States', currencyCode: 'USD', flag: '🇺🇸',
    fallback: 'UK', preferLocal: false,
  },
  {
    code: 'CA', hostname: 'www.ebay.ca', siteId: '2',
    mkrid: '706-53473-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_CA',
    label: 'Canada', currencyCode: 'CAD', flag: '🇨🇦',
    fallback: 'US', preferLocal: true,
  },
  {
    code: 'AU', hostname: 'www.ebay.com.au', siteId: '15',
    mkrid: '705-53470-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_AU',
    label: 'Australia', currencyCode: 'AUD', flag: '🇦🇺',
    fallback: 'US', preferLocal: true,
  },
  {
    code: 'DE', hostname: 'www.ebay.de', siteId: '77',
    mkrid: '707-53477-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_DE',
    label: 'Deutschland', currencyCode: 'EUR', flag: '🇩🇪',
    fallback: 'UK', preferLocal: true,
  },
  {
    code: 'FR', hostname: 'www.ebay.fr', siteId: '71',
    mkrid: '709-53476-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_FR',
    label: 'France', currencyCode: 'EUR', flag: '🇫🇷',
    fallback: 'UK', preferLocal: true,
  },
  {
    code: 'IT', hostname: 'www.ebay.it', siteId: '101',
    mkrid: '724-53478-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_IT',
    label: 'Italia', currencyCode: 'EUR', flag: '🇮🇹',
    fallback: 'UK', preferLocal: true,
  },
  {
    code: 'ES', hostname: 'www.ebay.es', siteId: '186',
    mkrid: '716-53482-19255-0', campaignEnvVar: 'NEXT_PUBLIC_EBAY_CAMPID_ES',
    label: 'España', currencyCode: 'EUR', flag: '🇪🇸',
    fallback: 'UK', preferLocal: true,
  },
]

export const MARKETPLACE_DEFINITIONS: Record<MarketplaceCode, MarketplaceDefinition> =
  Object.fromEntries(DEFS.map(d => [d.code, d])) as Record<MarketplaceCode, MarketplaceDefinition>

export const ALL_MARKETPLACES: ReadonlyArray<MarketplaceCode> =
  DEFS.map(d => d.code)

// ── Country → preferred marketplace mapping ────────────────────────────────
// Always returns a MarketplaceCode; downstream code checks whether the
// chosen marketplace is actually configured before using it.
const COUNTRY_TO_MARKETPLACE_RAW: Record<string, MarketplaceCode> = {
  GB: 'UK', UK: 'UK', IE: 'UK',
  US: 'US',
  CA: 'CA',
  AU: 'AU', NZ: 'AU',
  DE: 'DE', AT: 'DE', CH: 'DE',
  FR: 'FR', BE: 'FR', LU: 'FR', MC: 'FR',
  IT: 'IT', SM: 'IT', VA: 'IT',
  ES: 'ES', PT: 'ES',
}

export function countryToMarketplace(country: string | null | undefined): MarketplaceCode {
  if (typeof country !== 'string') return 'US'
  const c = country.trim().toUpperCase()
  return COUNTRY_TO_MARKETPLACE_RAW[c] ?? 'US'
}

// ── Configuration helpers ───────────────────────────────────────────────────
// Read in a side-effect-free way; safe for SSR and tests.

/**
 * Reads the campaign id from the static PUBLIC_EBAY_CAMPAIGN_IDS map.
 * Returns the trimmed value or null. Never uses dynamic `process.env[name]`
 * lookups because those are not inlined into the client bundle.
 */
export function readCampaignId(code: MarketplaceCode): string | null {
  const raw = PUBLIC_EBAY_CAMPAIGN_IDS[code] ?? ''
  const trimmed = String(raw).trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isMarketplaceConfigured(code: MarketplaceCode): boolean {
  return readCampaignId(code) !== null
}

export function isMarketplaceImplemented(code: MarketplaceCode): boolean {
  return IMPLEMENTED_MARKETPLACES.includes(code)
}

/**
 * Selectable = implemented AND configured. Anything else is hidden from
 * the selector + settings dropdown to prevent users from picking a
 * marketplace that the engine cannot attribute correctly today.
 */
export function isMarketplaceSelectable(code: MarketplaceCode): boolean {
  return isMarketplaceImplemented(code) && isMarketplaceConfigured(code)
}

export function configuredMarketplaces(): MarketplaceCode[] {
  return ALL_MARKETPLACES.filter(isMarketplaceConfigured)
}

export function selectableMarketplaces(): MarketplaceCode[] {
  return ALL_MARKETPLACES.filter(isMarketplaceSelectable)
}

// Returns the first configured marketplace in a fallback chain. If none
// of the chain entries are configured, returns null — callers should
// hide affiliate UI in that case.
export function pickConfigured(chain: ReadonlyArray<MarketplaceCode>): MarketplaceCode | null {
  for (const code of chain) {
    if (isMarketplaceConfigured(code)) return code
  }
  return null
}

/**
 * Returns the first configured marketplace, preferring `preferred`, then
 * walking its declared `fallback` chain, then any other configured
 * marketplace. Useful when the caller does not need precedence
 * semantics — only "give me a marketplace that works".
 */
export function nearestConfiguredMarketplace(preferred: MarketplaceCode | null | undefined): MarketplaceCode | null {
  if (preferred && isMarketplaceConfigured(preferred)) return preferred
  if (preferred) {
    const fb = MARKETPLACE_DEFINITIONS[preferred]?.fallback
    if (fb && isMarketplaceConfigured(fb)) return fb
  }
  const all = configuredMarketplaces()
  return all.length > 0 ? all[0] : null
}

/**
 * Returns the constant "ultimate default" that the resolver falls back to
 * when nothing else is known. UK comes first because the current product
 * is UK-leaning; US is the secondary if UK ever becomes unconfigured.
 */
export function ultimateFallback(): MarketplaceCode | null {
  return nearestConfiguredMarketplace('UK')
}
