// src/lib/vendorSubmissionValidation.ts
// Shared validation rules for vendor submissions. Used by the server
// route at /api/vendors/submit. Kept dependency-free so the same rules
// can later be reused on the client for instant feedback if needed.

export const VENDOR_TYPES = [
  'physical_shop',
  'online_shop',
  'ebay_store',
  'retailer',
  'grading_service',
  'marketplace',
  'private_seller',
] as const
export type VendorType = typeof VENDOR_TYPES[number]

export const COUNTRIES = ['UK', 'US', 'EU', 'AU', 'CA', 'Other'] as const
export type Country = typeof COUNTRIES[number]

export const SPECIALISMS = [
  'singles', 'sealed', 'graded', 'vintage', 'bulk', 'accessories',
] as const

export const GRADING_COMPANIES = [
  'PSA', 'BGS', 'CGC', 'ACE', 'TAG', 'SGC', 'Other',
] as const

// Slugs that must not be claimed because they collide with our own routes
// or with conventional URL conventions.
export const RESERVED_SLUGS = new Set([
  'submit', 'new', 'admin', 'api', 'index', 'edit', '_',
  'login', 'logout', 'signup', 'auth', 'dashboard',
])

// Reasonable size caps. Mostly to prevent accidental abuse; not a
// security boundary on their own.
export const LIMITS = {
  name:                   { min: 1,  max: 120 },
  description:            { min: 0,  max: 2000 },
  shortText:              { min: 0,  max: 200 },
  addressText:            { min: 0,  max: 200 },
  url:                    { min: 0,  max: 500 },
  openingHours:           { min: 0,  max: 500 },
  arrayMaxLen:            8,
  bodyJsonBytes:          32 * 1024,
  honeypotMaxLen:         0,         // honeypot must be empty
  minFormFillTimeMs:      3000,
  duplicateLookbackHours: 24,
} as const

// ── URL normalisation ──────────────────────────────────────────────────────
export function normaliseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Allow protocol-less "www.foo.com" but reject if it parses to something
  // hostile.
  const candidate = /^https?:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname || u.hostname.length < 3) return null
    // Strip credentials if present.
    u.username = ''
    u.password = ''
    const out = u.toString()
    if (out.length > LIMITS.url.max) return null
    return out
  } catch {
    return null
  }
}

// ── Plain text ─────────────────────────────────────────────────────────────
// Trim, drop control characters except newlines, enforce max length.
export function cleanText(
  raw: unknown,
  max: number,
): string {
  if (typeof raw !== 'string') return ''
  // Replace CR with LF; drop ASCII control chars except \n and \t.
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .trim()
  if (cleaned.length > max) return cleaned.slice(0, max)
  return cleaned
}

// ── Slug ───────────────────────────────────────────────────────────────────
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildVendorSlugBase(name: string, locality: string): string {
  const base = slugify(`${name} ${locality}`.trim())
  if (!base) return ''
  // 1–60 chars, must start with a letter.
  const trimmed = base.replace(/^-+/, '').slice(0, 60).replace(/-+$/, '')
  if (!trimmed) return ''
  if (RESERVED_SLUGS.has(trimmed)) return ''
  return trimmed
}

// ── Latitude / longitude ───────────────────────────────────────────────────
export function cleanLatLng(
  raw: unknown,
): number | null {
  if (raw == null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return null
  return n
}

// ── Top-level body validation ──────────────────────────────────────────────
export type SubmissionInput = {
  name:                   unknown
  vendor_type:            unknown
  country:                unknown
  city?:                  unknown
  county?:                unknown
  postcode?:              unknown
  address?:               unknown
  website?:               unknown
  ebay_store_url?:        unknown
  store_finder_url?:      unknown
  grading_submission_url?:unknown
  phone?:                 unknown
  email?:                 unknown
  instagram?:             unknown
  twitter?:               unknown
  facebook?:              unknown
  specialisms?:           unknown
  grading_services?:      unknown
  grading_turnaround?:    unknown
  grading_starting_price?:unknown
  buys_cards?:            unknown
  runs_tournaments?:      unknown
  ships_internationally?: unknown
  multiple_locations?:    unknown
  opening_hours?:         unknown
  description?:           unknown
  submitted_by?:          unknown
  latitude?:              unknown
  longitude?:             unknown
  // Anti-abuse fields
  company_url?:           unknown   // honeypot
  form_started_at_ms?:    unknown
}

export type ValidatedSubmission = {
  // Always present
  name:        string
  vendor_type: VendorType
  country:     Country
  slug_base:   string
  // Optional / cleaned
  city:                    string | null
  county:                  string | null
  postcode:                string | null
  address:                 string | null
  website:                 string | null
  ebay_store_url:          string | null
  store_finder_url:        string | null
  grading_submission_url:  string | null
  phone:                   string | null
  email:                   string | null
  instagram:               string | null
  twitter:                 string | null
  facebook:                string | null
  specialisms:             string[]
  grading_services:        string[]
  grading_turnaround:      string | null
  grading_starting_price:  string | null
  buys_cards:              boolean
  runs_tournaments:        boolean
  ships_internationally:   boolean
  multiple_locations:      boolean
  opening_hours:           string | null
  description:             string | null
  submitted_by:            string | null
  latitude:                number | null
  longitude:               number | null
}

// Flat result shape avoids TS narrowing issues when the project has
// strict mode off. Always-present fields; only `value` is conditional on
// `ok === true`.
export type ValidationOutcome = {
  ok:          boolean
  value:       ValidatedSubmission | null
  honeypotHit: boolean
  tooFast:     boolean
  status:      number
  error:       string
}

function cleanArray(raw: unknown, allowed: ReadonlyArray<string>): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const v = item.trim()
    if (!v) continue
    if (!allowed.includes(v)) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
    if (out.length >= LIMITS.arrayMaxLen) break
  }
  return out
}

function asBool(raw: unknown): boolean {
  return raw === true
}

export function validateSubmission(input: SubmissionInput): ValidationOutcome {
  // ── 1. Honeypot ──
  // company_url is hidden in the UI; any non-empty value implies a bot.
  if (typeof input.company_url === 'string' && input.company_url.trim().length > LIMITS.honeypotMaxLen) {
    return { ok: false, value: null, honeypotHit: true, tooFast: false, status: 200, error: 'ok' }
  }

  // ── 2. Minimum form fill time ──
  const started = typeof input.form_started_at_ms === 'number' ? input.form_started_at_ms : 0
  const elapsedMs = started > 0 ? (Date.now() - started) : Number.MAX_SAFE_INTEGER
  if (started > 0 && elapsedMs < LIMITS.minFormFillTimeMs) {
    return { ok: false, value: null, honeypotHit: false, tooFast: true, status: 400, error: 'Form submitted too quickly. Please try again.' }
  }

  // ── 3. Required: name & vendor_type & country ──
  const name = cleanText(input.name, LIMITS.name.max)
  if (name.length < LIMITS.name.min) {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Store name is required.' }
  }
  const vendor_type = typeof input.vendor_type === 'string' ? input.vendor_type : ''
  if (!VENDOR_TYPES.includes(vendor_type as VendorType)) {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Invalid vendor type.' }
  }
  const country = typeof input.country === 'string' ? input.country : ''
  if (!COUNTRIES.includes(country as Country)) {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Invalid country.' }
  }

  // ── 4. Optional text fields ──
  const city                   = cleanText(input.city,                   LIMITS.addressText.max) || null
  const county                 = cleanText(input.county,                 LIMITS.addressText.max) || null
  const postcode               = cleanText(input.postcode,               LIMITS.shortText.max)   || null
  const address                = cleanText(input.address,                LIMITS.addressText.max) || null
  const phone                  = cleanText(input.phone,                  LIMITS.shortText.max)   || null
  const email                  = cleanText(input.email,                  LIMITS.shortText.max)   || null
  const instagram              = cleanText(input.instagram,              LIMITS.shortText.max)   || null
  const twitter                = cleanText(input.twitter,                LIMITS.shortText.max)   || null
  const facebook               = cleanText(input.facebook,               LIMITS.shortText.max)   || null
  const opening_hours          = cleanText(input.opening_hours,          LIMITS.openingHours.max) || null
  const description            = cleanText(input.description,            LIMITS.description.max)  || null
  const submitted_by           = cleanText(input.submitted_by,           LIMITS.shortText.max)   || null
  const grading_turnaround     = cleanText(input.grading_turnaround,     LIMITS.shortText.max)   || null
  const grading_starting_price = cleanText(input.grading_starting_price, LIMITS.shortText.max)   || null

  // ── 5. URL fields ──
  const website                = normaliseUrl(typeof input.website                === 'string' ? input.website                : null)
  const ebay_store_url         = normaliseUrl(typeof input.ebay_store_url         === 'string' ? input.ebay_store_url         : null)
  const store_finder_url       = normaliseUrl(typeof input.store_finder_url       === 'string' ? input.store_finder_url       : null)
  const grading_submission_url = normaliseUrl(typeof input.grading_submission_url === 'string' ? input.grading_submission_url : null)

  // ── 6. Arrays ──
  const specialisms      = cleanArray(input.specialisms,      SPECIALISMS)
  const grading_services = cleanArray(input.grading_services, GRADING_COMPANIES)

  // ── 7. Booleans ──
  const buys_cards            = asBool(input.buys_cards)
  const runs_tournaments      = asBool(input.runs_tournaments)
  const ships_internationally = asBool(input.ships_internationally)
  const multiple_locations    = asBool(input.multiple_locations)

  // ── 8. Geo ──
  const latitude  = cleanLatLng(input.latitude)
  const longitude = cleanLatLng(input.longitude)
  if (latitude != null  && (latitude  < -90  || latitude  > 90))  {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Invalid latitude.' }
  }
  if (longitude != null && (longitude < -180 || longitude > 180)) {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Invalid longitude.' }
  }

  // ── 9. Slug base ──
  const locality = city || country
  const slug_base = buildVendorSlugBase(name, locality)
  if (!slug_base) {
    return { ok: false, value: null, honeypotHit: false, tooFast: false, status: 400, error: 'Could not build a valid slug from this name. Please use plain letters and numbers.' }
  }

  return {
    ok: true,
    honeypotHit: false,
    tooFast: false,
    status: 200,
    error: '',
    value: {
      name,
      vendor_type: vendor_type as VendorType,
      country:     country as Country,
      slug_base,
      city, county, postcode, address,
      website, ebay_store_url, store_finder_url, grading_submission_url,
      phone, email, instagram, twitter, facebook,
      specialisms, grading_services,
      grading_turnaround, grading_starting_price,
      buys_cards, runs_tournaments, ships_internationally, multiple_locations,
      opening_hours, description, submitted_by,
      latitude, longitude,
    },
  }
}
