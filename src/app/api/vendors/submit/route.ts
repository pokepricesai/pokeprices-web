// src/app/api/vendors/submit/route.ts
// Secure vendor submission endpoint.
//
// The browser no longer writes to the `vendors` table directly. It POSTs a
// JSON body to this route; the route validates everything, inserts the
// vendor row under service-role with `active=false, verified=false`, and
// returns a single-use logo-upload token tied to that vendor.
//
// Anti-abuse controls (all best-effort, intentionally cheap):
//   * honeypot field `company_url` (must be empty)
//   * minimum form-fill time (3 s)
//   * 32 KB request body cap
//   * per-instance IP throttle (5 / 5 min) — labelled best-effort
//   * duplicate-submission window (24 h) on (lower(name), city||country)
//
// The token issuance is NOT a freely callable endpoint. A token is only
// returned when a valid submission has been accepted, the row has been
// inserted, and active=false. There is no /api/vendor-upload-token route.

import 'server-only'
import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import {
  LIMITS,
  RESERVED_SLUGS,
  validateSubmission,
} from '@/lib/vendorSubmissionValidation'

export const runtime = 'nodejs'

// ── Per-instance throttle (best-effort) ─────────────────────────────────────
// Documented as best-effort because Next.js / Vercel runs many instances
// and this map is per-instance. Durable rate-limiting is a Block-1B
// follow-up tracked in the report.

const WINDOW_MS = 5 * 60 * 1000
const MAX_PER_WINDOW = 5
const throttle = new Map<string, number[]>()

function throttleAccept(key: string): boolean {
  const now  = Date.now()
  const arr  = throttle.get(key) || []
  const live = arr.filter(t => now - t < WINDOW_MS)
  if (live.length >= MAX_PER_WINDOW) {
    throttle.set(key, live)
    return false
  }
  live.push(now)
  throttle.set(key, live)
  // Opportunistic cleanup: keep the map small in long-running instances.
  // (Using Array.from to satisfy ES5 target without downlevelIteration.)
  if (throttle.size > 1024) {
    Array.from(throttle.entries()).forEach(([k, v]) => {
      const liveV = v.filter(t => now - t < WINDOW_MS)
      if (liveV.length === 0) throttle.delete(k)
      else throttle.set(k, liveV)
    })
  }
  return true
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clientIp(req: Request): string {
  // Vercel / standard reverse proxies.
  const xff = req.headers.get('x-forwarded-for') || ''
  const first = xff.split(',')[0].trim()
  if (first) return first
  return req.headers.get('x-real-ip') || 'unknown'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function generateToken(): { raw: string; hash: string } {
  // 32 random bytes -> 43-char base64url, no padding.
  const raw = randomBytes(32).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hash = sha256Hex(raw)
  return { raw, hash }
}

function logRejected(reason: string, ip: string, extra: Record<string, unknown> = {}) {
  // Structured-ish console line. No personal data beyond IP, which is
  // already in Vercel's request logs.
  try {
    console.warn(JSON.stringify({
      at: 'api/vendors/submit',
      reason,
      ip,
      ...extra,
    }))
  } catch { /* best-effort */ }
}

// Slug uniqueness — append -2, -3 ... up to -9 if the base collides.
async function pickUniqueSlug(
  supa: ReturnType<typeof getSupabaseServiceClient>,
  base: string,
): Promise<string | null> {
  if (RESERVED_SLUGS.has(base)) return null
  const candidates = [base, ...Array.from({ length: 8 }, (_, i) => `${base}-${i + 2}`)]
  // One round-trip per candidate; vendors table is small enough.
  for (const candidate of candidates) {
    const { data, error } = await supa
      .from('vendors')
      .select('id')
      .eq('slug', candidate)
      .limit(1)
    if (error) return null
    if (!data || data.length === 0) return candidate
  }
  return null
}

// 24-hour duplicate check on (lower(name), lower(city||country)).
async function isDuplicate(
  supa: ReturnType<typeof getSupabaseServiceClient>,
  name: string,
  locality: string,
): Promise<boolean> {
  const since = new Date(Date.now() - LIMITS.duplicateLookbackHours * 3600 * 1000).toISOString()
  const { data } = await supa
    .from('vendors')
    .select('id, name, city, country, created_at')
    .ilike('name', name)
    .gte('created_at', since)
    .limit(10)
  if (!data || data.length === 0) return false
  const localityLower = locality.toLowerCase()
  return data.some((row: any) => {
    const rowLocality = `${row.city || ''}${row.country || ''}`.toLowerCase()
    return rowLocality.includes(localityLower) || localityLower.includes(rowLocality)
  })
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = clientIp(req)

  // 1. Size cap before parsing.
  const lenHeader = req.headers.get('content-length')
  if (lenHeader && Number(lenHeader) > LIMITS.bodyJsonBytes) {
    logRejected('body_too_large', ip, { contentLength: lenHeader })
    return NextResponse.json({ error: 'Submission too large.' }, { status: 413 })
  }

  // 2. Throttle.
  if (!throttleAccept(ip)) {
    logRejected('throttled', ip)
    return NextResponse.json({ error: 'Too many submissions. Please try again later.' }, { status: 429 })
  }

  // The route now always reads outcome.value (which is non-null only on
  // success). On failure outcome.status / outcome.error carry the
  // response details (flat shape, see vendorSubmissionValidation.ts).

  // 3. Parse body.
  let body: any
  try {
    const raw = await req.text()
    if (raw.length > LIMITS.bodyJsonBytes) {
      logRejected('body_too_large', ip, { rawLength: raw.length })
      return NextResponse.json({ error: 'Submission too large.' }, { status: 413 })
    }
    body = JSON.parse(raw)
  } catch {
    logRejected('bad_json', ip)
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }

  // 4. Validate.
  const outcome = validateSubmission(body)
  if (!outcome.ok || !outcome.value) {
    if (outcome.honeypotHit) {
      // Pretend success — do not insert anything.
      logRejected('honeypot', ip)
      return NextResponse.json({ vendorId: null, uploadToken: null, expiresAt: null }, { status: 200 })
    }
    if (outcome.tooFast) {
      logRejected('too_fast', ip)
    }
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }
  const v = outcome.value

  // 5. Service-role client.
  let supa
  try { supa = getSupabaseServiceClient() }
  catch {
    return NextResponse.json({ error: 'Server misconfigured.' }, { status: 500 })
  }

  // 6. Duplicate check.
  const localityForDup = v.city || v.country
  try {
    if (await isDuplicate(supa, v.name, localityForDup)) {
      logRejected('duplicate', ip, { name: v.name, locality: localityForDup })
      return NextResponse.json(
        { error: 'A submission for this store was received in the last 24 hours.' },
        { status: 409 },
      )
    }
  } catch (e: any) {
    // If the duplicate check itself errors, log and continue rather than
    // block legitimate submissions.
    logRejected('dup_check_error', ip, { msg: e?.message })
  }

  // 7. Pick a unique slug.
  const slug = await pickUniqueSlug(supa, v.slug_base)
  if (!slug) {
    logRejected('slug_unavailable', ip, { base: v.slug_base })
    return NextResponse.json({ error: 'Please choose a different store name.' }, { status: 409 })
  }

  // 8. Insert vendor row. ALL ownership/state fields are server-forced.
  const insertPayload = {
    name:                   v.name,
    vendor_type:            v.vendor_type,
    address:                v.address,
    city:                   v.city,
    county:                 v.county,
    postcode:               v.postcode,
    country:                v.country,
    website:                v.website,
    ebay_store_url:         v.ebay_store_url,
    phone:                  v.phone,
    email:                  v.email,
    instagram:              v.instagram,
    facebook:               v.facebook,
    twitter:                v.twitter,
    specialisms:            v.specialisms,
    buys_cards:             v.buys_cards,
    runs_tournaments:       v.runs_tournaments,
    ships_internationally:  v.ships_internationally,
    opening_hours:          v.opening_hours,
    description:            v.description,
    submitted_by:           v.submitted_by,
    multiple_locations:     v.multiple_locations,
    store_finder_url:       v.store_finder_url,
    grading_services:       v.grading_services,
    grading_turnaround:     v.grading_turnaround,
    grading_starting_price: v.grading_starting_price,
    grading_submission_url: v.grading_submission_url,
    latitude:               v.latitude,
    longitude:              v.longitude,
    slug,
    active:   false,
    verified: false,
    logo_url: null,
  }

  const { data: inserted, error: insErr } = await supa
    .from('vendors')
    .insert(insertPayload)
    .select('id')
    .single()

  if (insErr || !inserted?.id) {
    logRejected('insert_failed', ip, { msg: insErr?.message })
    return NextResponse.json({ error: 'Could not save submission. Please try again.' }, { status: 500 })
  }
  const vendorId = inserted.id as string

  // 9. Generate token (raw returned to client once; hash persisted).
  const { raw: token, hash: tokenHash } = generateToken()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  const ipHash = sha256Hex(`${ip}|${process.env.VENDOR_DAILY_IP_SALT || 'v1'}`)

  const { error: tokErr } = await supa
    .from('vendor_upload_tokens')
    .insert({
      vendor_id:       vendorId,
      token_hash:      tokenHash,
      expires_at:      expiresAt.toISOString(),
      created_ip_hash: ipHash,
      purpose:         'logo_upload',
    })

  if (tokErr) {
    // Vendor row exists but we could not mint a token. Surface the row id so
    // the client can decide whether to retry without logo. Do NOT delete the
    // vendor row — admin still wants to see the submission.
    logRejected('token_insert_failed', ip, { vendorId, msg: tokErr.message })
    return NextResponse.json(
      { vendorId, uploadToken: null, expiresAt: null, error: 'Saved submission but could not authorise logo upload.' },
      { status: 200 },
    )
  }

  return NextResponse.json({
    vendorId,
    uploadToken: token,
    expiresAt:   expiresAt.toISOString(),
  })
}
