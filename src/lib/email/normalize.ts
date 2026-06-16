// src/lib/email/normalize.ts
// Pure email normalisation helpers. No I/O, safe to import anywhere.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Lower-cases + trims the address. Returns null when the input is not
 * recognisably an email. Storage is consistently lowercase; combined
 * with the `CITEXT` column type on `email_contacts.email_normalized`
 * this gives case-insensitive uniqueness with predictable keys.
 *
 * No address-parts canonicalisation (no `+tag` stripping). Some
 * providers route `foo+bar@…` differently and silently rewriting would
 * change which mailbox we deliver to.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // Strip ASCII control characters defensively before parsing.
  const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, '').trim().toLowerCase()
  if (!cleaned) return null
  if (cleaned.length > 254) return null         // RFC 5321 hard max
  if (!EMAIL_RE.test(cleaned)) return null
  return cleaned
}

/**
 * SHA-256 hash of the normalised email. Used by the delivery log so
 * recipient information can be searched without storing the address in
 * plain text. Returns a 64-char lowercase hex string.
 *
 * Edge / Node compatible: uses globalThis.crypto.subtle.
 */
export async function hashEmail(emailNormalized: string): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) throw new Error('crypto.subtle unavailable')
  const bytes = new TextEncoder().encode(emailNormalized)
  const digest = await subtle.digest('SHA-256', bytes)
  const arr = Array.from(new Uint8Array(digest))
  return arr.map(b => b.toString(16).padStart(2, '0')).join('')
}
