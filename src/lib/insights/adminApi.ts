// src/lib/insights/adminApi.ts
//
// EIC Block 0B — shared helpers for the /api/admin/insights/* route
// handlers. Keeps the routes small and colocates the "what columns is
// the admin allowed to write" rule in one place so it can not drift.
//
// The route handlers themselves handle auth (requireAdmin) and HTTP
// concerns; this module handles data-shape concerns only.

import 'server-only'
import { ARTICLE_IMAGE_MIME_ALLOWLIST } from './richText'

// ── Column allow-list ─────────────────────────────────────────────
//
// The strict list of columns an admin write is allowed to touch. Any
// other keys in the incoming payload are dropped. This prevents a
// compromised admin session from silently altering server-controlled
// fields (id, created_at) or columns we do not want the editor to
// author (card_refs, set_refs, generation_log, hero_image_query,
// cover_image_url — all present on the live insights table but not
// part of the admin editor's remit today).
//
// Confirmed against the live schema in Block 1: the four "legacy"
// columns previously listed here (title, excerpt, body_text,
// updated_at) do not exist on the table and have been removed to
// avoid a future insert failing with "column does not exist".

const WRITABLE_ARTICLE_COLUMNS = new Set<string>([
  'slug',
  'headline',
  'intro',
  'body_json',
  'theme',
  'theme_label',
  'status',
  'published_at',
  'image_url',
  'author',
  'read_time_mins',
  'seo_title',
  'seo_description',
  'meta_title',       // legacy admin-only field name; dual-written to seo_title on save
  'meta_description', // legacy admin-only field name; dual-written to seo_description on save
])

/** Return a new object containing only the keys the admin editor is
 *  allowed to write. Unknown keys are silently dropped. */
export function pickWritableArticleFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (WRITABLE_ARTICLE_COLUMNS.has(k)) {
      out[k] = v
    }
  }
  return out as Partial<T>
}

/**
 * EIC Block 1 — canonicalise SEO fields.
 *
 * The admin editor historically wrote meta_title / meta_description
 * (form field names) while the public route reads seo_title /
 * seo_description. The result was that admin-authored SEO metadata
 * never reached the public site. Block 1 makes seo_title /
 * seo_description the canonical pair and dual-writes both columns on
 * every save, so:
 *
 *   * legacy meta_* columns keep working (nothing renamed, nothing
 *     dropped — see block scope);
 *   * public reads via seo_* now surface the admin's intent;
 *   * a future client that sends only seo_* (e.g. the eventual EIC
 *     TipTap editor) is also handled.
 *
 * Rule: never OVERWRITE a value the caller explicitly supplied. Only
 * fill in the mirror side when it is absent from the payload.
 */
export function mirrorSeoFields<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = { ...payload }
  const hasMetaT = 'meta_title'       in out
  const hasSeoT  = 'seo_title'        in out
  const hasMetaD = 'meta_description' in out
  const hasSeoD  = 'seo_description'  in out

  if (hasMetaT && !hasSeoT)  out.seo_title       = out.meta_title
  if (hasSeoT  && !hasMetaT) out.meta_title      = out.seo_title
  if (hasMetaD && !hasSeoD)  out.seo_description = out.meta_description
  if (hasSeoD  && !hasMetaD) out.meta_description = out.seo_description

  return out as T
}

/** Sanity checks on a full write payload. Returns null when acceptable,
 *  otherwise a short human-readable message the route can surface. */
export function validateArticleWrite(payload: Record<string, unknown>): string | null {
  if ('status' in payload) {
    const s = payload.status
    if (s !== 'draft' && s !== 'published') return 'status must be "draft" or "published"'
  }
  if ('headline' in payload && payload.headline != null) {
    if (typeof payload.headline !== 'string') return 'headline must be a string'
    if (payload.headline.length > 500) return 'headline too long (max 500 chars)'
  }
  if ('slug' in payload && payload.slug != null) {
    if (typeof payload.slug !== 'string' || !payload.slug) return 'slug must be a non-empty string'
    if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(payload.slug)) return 'slug must be lowercase kebab-case (a-z, 0-9, -), starting with a letter or digit'
  }
  if ('body_json' in payload && payload.body_json != null) {
    // Reject overly large bodies at the API boundary. 512 KB of JSON is
    // roughly a 100k-word article — far beyond any editorial use case.
    let bytes = 0
    try { bytes = JSON.stringify(payload.body_json).length } catch { return 'body_json is not JSON-serialisable' }
    if (bytes > 512 * 1024) return 'body_json too large (max 512 KB)'
  }
  return null
}

// ── Image upload constraints (re-exported so routes don't need
//    to import from two places) ───────────────────────────────────

export const ARTICLE_IMAGE_MAX_UPLOAD_BYTES = 5 * 1024 * 1024

/** Map an allow-listed content type to a safe filename extension. */
const CT_TO_EXT: Readonly<Record<string, string>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
})

export function extForContentType(contentType: string): string | null {
  if (!ARTICLE_IMAGE_MIME_ALLOWLIST.includes(contentType)) return null
  return CT_TO_EXT[contentType] ?? null
}

export type UploadPurpose = 'hero' | 'body'

export function isUploadPurpose(v: unknown): v is UploadPurpose {
  return v === 'hero' || v === 'body'
}

/** Build the storage path we will hand out via a signed upload URL.
 *  The path is entirely server-chosen — the client has no influence
 *  over the bucket, the folder, or the filename. This prevents any
 *  form of arbitrary bucket write. */
export function buildInsightsUploadPath(purpose: UploadPurpose, ext: string): string {
  const stamp = Date.now().toString(36)
  const rand  = randomToken(10)
  return `insights/${purpose}/${stamp}-${rand}.${ext}`
}

function randomToken(len: number): string {
  // crypto.getRandomValues is available in Node 20+ globalThis.
  const bytes = new Uint8Array(len)
  ;(globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(bytes)
  return Array.from(bytes).map(b => (b % 36).toString(36)).join('')
}
