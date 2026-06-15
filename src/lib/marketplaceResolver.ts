// src/lib/marketplaceResolver.ts
// Block 2D — marketplace precedence logic.
//
// Pure functions only. No window / cookie reads here — the React hook
// in marketplaceClient.ts threads the inputs in. Keeps unit tests
// simple and SSR-safe.

import {
  countryToMarketplace,
  isMarketplaceConfigured,
  isMarketplaceSelectable,
  selectableMarketplaces,
  nearestConfiguredMarketplace,
  ultimateFallback,
  type MarketplaceCode,
  type MarketplaceDefinition,
  MARKETPLACE_DEFINITIONS,
} from './marketplaces'

export type ResolutionSource = 'cookie' | 'profile' | 'geo' | 'fallback' | 'none'

export type MarketplaceResolution = {
  marketplace: MarketplaceCode | null
  source:      ResolutionSource
}

export type ResolveInput = {
  /** Raw value read from profiles.marketplace_preference. May be a
   *  legacy value like 'EU' or 'other'. */
  profilePreference?: string | null
  /** Raw value read from the first-party pp_marketplace cookie. */
  manualCookie?:     string | null
  /** Raw value read from the pp_geo_country cookie (set by the geo
   *  endpoint). ISO 3166-1 alpha-2 expected. */
  geoCountry?:       string | null
}

// ── Legacy / loose value coercion ──────────────────────────────────────────

const KNOWN_CODES = new Set<MarketplaceCode>(
  (Object.keys(MARKETPLACE_DEFINITIONS) as MarketplaceCode[])
)

/**
 * Coerces a stored profile / cookie value into a known MarketplaceCode,
 * mapping a small list of legacy strings to current codes. Returns null
 * when the value cannot be safely mapped.
 *
 * Legacy 'EU' coerces to the first SELECTABLE European marketplace
 * (i.e. one that is both URL-engine implemented AND has a campaign id).
 * Today none are selectable, so the coercion returns null and the
 * caller falls through to the next precedence step.
 */
export function coerceLegacyMarketplace(raw: unknown): MarketplaceCode | null {
  if (raw == null) return null
  const s = String(raw).trim().toUpperCase()
  if (!s) return null
  // Direct hit on a known code.
  if (KNOWN_CODES.has(s as MarketplaceCode)) return s as MarketplaceCode
  // Legacy 'EU' → first selectable European marketplace, else null.
  if (s === 'EU') {
    const eu: MarketplaceCode[] = ['DE', 'FR', 'IT', 'ES']
    for (const c of eu) if (isMarketplaceSelectable(c)) return c
    return null
  }
  // Legacy 'OTHER' / unknown strings → null. The caller falls through.
  return null
}

// ── Main resolver ──────────────────────────────────────────────────────────

/**
 * Applies the precedence:
 *
 *   1. explicit manual cookie (the user's last selector choice)
 *   2. authenticated profile preference (server-stored default)
 *   3. detected country (Vercel geo header)
 *   4. configured fallback (selectable marketplace, prefers UK then US)
 *
 * The manual cookie wins so a temporary override always takes effect
 * immediately — even when the user is signed in with a server-stored
 * profile preference, and even if the profile save fails after the
 * selector click.
 *
 * Only SELECTABLE marketplaces (URL-engine implemented AND configured)
 * are returned. Anything else falls through to the next step. Returns
 * null marketplace when no marketplace is selectable at all; callers
 * should hide affiliate UI in that case.
 */
export function resolveMarketplace(input: ResolveInput): MarketplaceResolution {
  // 1. Manual cookie — explicit user choice wins.
  const fromCookie = coerceLegacyMarketplace(input.manualCookie)
  if (fromCookie && isMarketplaceSelectable(fromCookie)) {
    return { marketplace: fromCookie, source: 'cookie' }
  }

  // 2. Profile preference.
  const fromProfile = coerceLegacyMarketplace(input.profilePreference)
  if (fromProfile && isMarketplaceSelectable(fromProfile)) {
    return { marketplace: fromProfile, source: 'profile' }
  }

  // 3. Country detection.
  if (input.geoCountry) {
    const guess = countryToMarketplace(input.geoCountry)
    if (isMarketplaceSelectable(guess)) {
      return { marketplace: guess, source: 'geo' }
    }
    // Walk the guess's fallback chain when its own marketplace is not
    // selectable. Only return a selectable target.
    const def = MARKETPLACE_DEFINITIONS[guess]
    if (def) {
      const fb = nearestSelectableMarketplace(def.fallback)
      if (fb) return { marketplace: fb, source: 'geo' }
    }
  }

  // 4. Ultimate fallback.
  const u = ultimateSelectableFallback()
  if (u) return { marketplace: u, source: 'fallback' }

  return { marketplace: null, source: 'none' }
}

// Local helpers — the registry's nearestConfiguredMarketplace /
// ultimateFallback intentionally consider any CONFIGURED marketplace.
// The resolver must only ever surface SELECTABLE marketplaces, so we
// wrap them with a selectable filter here.
function nearestSelectableMarketplace(preferred: MarketplaceCode): MarketplaceCode | null {
  if (isMarketplaceSelectable(preferred)) return preferred
  const fb = MARKETPLACE_DEFINITIONS[preferred]?.fallback
  if (fb && isMarketplaceSelectable(fb)) return fb
  const all = selectableMarketplaces()
  return all.length > 0 ? all[0] : null
}

function ultimateSelectableFallback(): MarketplaceCode | null {
  if (isMarketplaceSelectable('UK')) return 'UK'
  if (isMarketplaceSelectable('US')) return 'US'
  const all = selectableMarketplaces()
  return all.length > 0 ? all[0] : null
}

// Re-export the configured-only helpers for callers that explicitly
// want them, while resolveMarketplace itself always uses selectable.
export { nearestConfiguredMarketplace, ultimateFallback }

// ── Convenience: list of marketplaces shown in the selector ─────────────────

/**
 * Returns the SELECTABLE marketplaces in their canonical order — these
 * are the marketplaces the user is allowed to pick from. The selector
 * hides itself entirely when this returns 0 or 1 entries.
 */
export function selectorOptions(): MarketplaceDefinition[] {
  return (Object.values(MARKETPLACE_DEFINITIONS) as MarketplaceDefinition[])
    .filter(def => isMarketplaceSelectable(def.code))
}
