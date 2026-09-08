// src/lib/editorial/releaseCalendarApi.ts
//
// EIC Block 3 — shared input validation for /api/admin/editorial/release-calendar.
// Pure code, safe to import from anywhere.

const WRITABLE = new Set<string>([
  'set_name', 'set_code', 'release_date', 'region',
  'jp_release_date', 'confirmed', 'notes',
])

/** Whitelist writable columns so the admin API can never touch id,
 *  created_at, updated_at, product_types, uk_retailers. */
export function pickWritableReleaseCalendarFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (WRITABLE.has(k)) out[k] = v
  return out as Partial<T>
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Validate a release_calendar write. Returns null when acceptable,
 *  otherwise a short human-readable message. */
export function validateReleaseCalendarWrite(payload: Record<string, unknown>): string | null {
  if ('set_name' in payload) {
    if (typeof payload.set_name !== 'string' || !payload.set_name.trim()) return 'set_name must be a non-empty string'
    if (payload.set_name.length > 300) return 'set_name too long (max 300 chars)'
  }
  if ('set_code' in payload && payload.set_code != null) {
    if (typeof payload.set_code !== 'string') return 'set_code must be a string or null'
    if (payload.set_code.length > 20) return 'set_code too long (max 20 chars)'
  }
  if ('region' in payload && payload.region != null) {
    if (typeof payload.region !== 'string') return 'region must be a string or null'
    if (payload.region.length > 50) return 'region too long (max 50 chars)'
  }
  if ('release_date' in payload && payload.release_date != null) {
    if (typeof payload.release_date !== 'string' || !ISO_DATE_RE.test(payload.release_date)) {
      return 'release_date must be an ISO date (YYYY-MM-DD) or null'
    }
    const y = Number(payload.release_date.slice(0, 4))
    if (y < 2020 || y > 2100) return 'release_date year out of range'
  }
  if ('jp_release_date' in payload && payload.jp_release_date != null) {
    if (typeof payload.jp_release_date !== 'string' || !ISO_DATE_RE.test(payload.jp_release_date)) {
      return 'jp_release_date must be an ISO date (YYYY-MM-DD) or null'
    }
    const y = Number(payload.jp_release_date.slice(0, 4))
    if (y < 2020 || y > 2100) return 'jp_release_date year out of range'
  }
  if ('confirmed' in payload && payload.confirmed != null && typeof payload.confirmed !== 'boolean') {
    return 'confirmed must be a boolean or null'
  }
  if ('notes' in payload && payload.notes != null) {
    if (typeof payload.notes !== 'string') return 'notes must be a string or null'
    if (payload.notes.length > 2000) return 'notes too long (max 2000 chars)'
  }
  return null
}
