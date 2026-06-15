// src/lib/profileValidation.ts
// Pure validators for the public.profiles fields written from the
// dashboard settings UI.

export const PROFILE_LIMITS = {
  displayName:           { min: 1, max: 60 },
  marketplacePreference: { values: ['UK', 'US', 'EU', 'AU', 'CA', 'other'] as const },
} as const

export type MarketplacePreference = typeof PROFILE_LIMITS.marketplacePreference.values[number]

const COUNTRY_RE = /^[A-Z]{2}$/

/**
 * Returns the country code or null if invalid. Accepts lowercase input
 * and uppercases it. Empty string is normalised to null (clearing the
 * field).
 */
export function cleanCountryCode(raw: unknown): string | null {
  if (raw == null) return null
  const s = String(raw).trim().toUpperCase()
  if (!s) return null
  if (!COUNTRY_RE.test(s)) return null
  return s
}

export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[\x00-\x1F\x7F]/g, '').trim()
  if (!s) return null
  if (s.length > PROFILE_LIMITS.displayName.max) {
    return s.slice(0, PROFILE_LIMITS.displayName.max)
  }
  return s
}

export function cleanMarketplacePreference(raw: unknown): MarketplacePreference | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  return (PROFILE_LIMITS.marketplacePreference.values as readonly string[]).includes(s)
    ? (s as MarketplacePreference)
    : null
}

export type ProfilePatch = {
  display_name?:           string | null
  country_code?:           string | null
  marketplace_preference?: MarketplacePreference | null
}

/**
 * Normalises a settings-form payload into a database-safe patch. Unknown
 * keys are dropped. Each field is validated independently; an invalid
 * value is silently coerced to null so the UI can show a generic save
 * error rather than crashing.
 */
export function cleanProfilePatch(input: unknown): ProfilePatch {
  const out: ProfilePatch = {}
  if (!input || typeof input !== 'object') return out
  const o = input as Record<string, unknown>
  if ('display_name' in o)           out.display_name           = cleanDisplayName(o.display_name)
  if ('country_code' in o)           out.country_code           = cleanCountryCode(o.country_code)
  if ('marketplace_preference' in o) out.marketplace_preference = cleanMarketplacePreference(o.marketplace_preference)
  return out
}
