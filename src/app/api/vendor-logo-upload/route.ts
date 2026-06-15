// src/app/api/vendor-logo-upload/route.ts
// Authorised single-use vendor logo upload.
//
// REQUIRES a valid upload token issued by /api/vendors/submit. The token
// is single-use and short-lived; the upload is committed atomically
// against the vendors row via the SECURITY DEFINER RPC
// `consume_vendor_upload_token`, which also confirms the vendor is still
// pending and has no existing logo.
//
// File rules:
//   * 2 MB cap
//   * MIME in {image/png, image/jpeg, image/webp}
//   * Magic-byte sniff must match the declared MIME
//   * SVG and GIF are rejected
//   * Filename is server-generated as `pending/<uuid>.<ext>` — the client
//     can never influence the storage path

import 'server-only'
import { NextResponse } from 'next/server'
import { createHash, randomUUID } from 'crypto'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'

const BUCKET    = 'vendor-logos'
const MAX_BYTES = 2 * 1024 * 1024

type AllowedMime = 'image/png' | 'image/jpeg' | 'image/webp'

const ALLOWED_MIMES: Record<AllowedMime, { ext: string }> = {
  'image/png':  { ext: 'png' },
  'image/jpeg': { ext: 'jpg' },
  'image/webp': { ext: 'webp' },
}

// ── Per-instance upload throttle (best-effort) ──────────────────────────────
const WINDOW_MS = 5 * 60 * 1000
const MAX_PER_WINDOW = 8
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
  return true
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  const first = xff.split(',')[0].trim()
  if (first) return first
  return req.headers.get('x-real-ip') || 'unknown'
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ── Magic-byte sniffing ─────────────────────────────────────────────────────
// Returns the MIME type implied by the file's first bytes, or null.
function detectMimeFromBytes(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length < 12) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
      bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A) {
    return 'image/png'
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return 'image/jpeg'
  }

  // WEBP: "RIFF" .... "WEBP"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }

  return null
}

function logRejected(reason: string, ip: string, extra: Record<string, unknown> = {}) {
  try {
    console.warn(JSON.stringify({
      at: 'api/vendor-logo-upload',
      reason,
      ip,
      ...extra,
    }))
  } catch { /* best-effort */ }
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = clientIp(req)
  if (!throttleAccept(ip)) {
    logRejected('throttled', ip)
    return NextResponse.json({ error: 'Too many uploads.' }, { status: 429 })
  }

  // Size guard before reading the body.
  const lenHeader = req.headers.get('content-length')
  if (lenHeader && Number(lenHeader) > MAX_BYTES + 64 * 1024 /* multipart overhead */) {
    logRejected('body_too_large', ip, { contentLength: lenHeader })
    return NextResponse.json({ error: `File too large. Max 2 MB.` }, { status: 413 })
  }

  let formData: FormData
  try { formData = await req.formData() }
  catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }) }

  const vendorIdRaw  = formData.get('vendorId')
  const tokenRaw     = formData.get('token')
  const fileField    = formData.get('file')

  const vendorId = typeof vendorIdRaw === 'string' ? vendorIdRaw.trim() : ''
  const token    = typeof tokenRaw    === 'string' ? tokenRaw.trim()    : ''

  if (!vendorId || vendorId.length > 64) {
    return NextResponse.json({ error: 'Missing vendorId.' }, { status: 400 })
  }
  if (!token || token.length < 16 || token.length > 128) {
    return NextResponse.json({ error: 'Missing or invalid token.' }, { status: 400 })
  }
  if (!(fileField instanceof File)) {
    return NextResponse.json({ error: 'Missing file.' }, { status: 400 })
  }

  // ── File-level validation ──
  if (fileField.size === 0) {
    return NextResponse.json({ error: 'Empty file.' }, { status: 400 })
  }
  if (fileField.size > MAX_BYTES) {
    logRejected('file_too_large', ip, { vendorId, size: fileField.size })
    return NextResponse.json({ error: `File too large. Max 2 MB.` }, { status: 413 })
  }

  const declaredMime = fileField.type as string
  if (!(declaredMime in ALLOWED_MIMES)) {
    logRejected('bad_mime', ip, { vendorId, declaredMime })
    return NextResponse.json(
      { error: 'Unsupported file type. Use PNG, JPG, or WEBP.' },
      { status: 400 },
    )
  }
  const mime = declaredMime as AllowedMime

  // ── Magic-byte sniff ──
  const fileBytes  = new Uint8Array(await fileField.arrayBuffer())
  const sniffedMime = detectMimeFromBytes(fileBytes)
  if (sniffedMime !== mime) {
    logRejected('magic_mismatch', ip, { vendorId, declaredMime: mime, sniffedMime })
    return NextResponse.json(
      { error: 'File contents do not match the declared type.' },
      { status: 400 },
    )
  }

  // ── Token / vendor preflight ──
  // The atomic RPC will re-verify; this preflight short-circuits to give
  // the client a clear status BEFORE we touch storage.
  const tokenHash = sha256Hex(token)
  let supa
  try { supa = getSupabaseServiceClient() }
  catch { return NextResponse.json({ error: 'Server misconfigured.' }, { status: 500 }) }

  const { data: preflight } = await supa
    .from('vendor_upload_tokens')
    .select('id, vendor_id, used_at, expires_at, purpose')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!preflight) {
    logRejected('token_unknown', ip, { vendorId })
    return NextResponse.json({ error: 'Upload token is invalid.' }, { status: 401 })
  }
  if (preflight.vendor_id !== vendorId) {
    logRejected('token_vendor_mismatch', ip, { vendorId, tokenVendorId: preflight.vendor_id })
    return NextResponse.json({ error: 'Upload token does not match this submission.' }, { status: 403 })
  }
  if (preflight.purpose !== 'logo_upload') {
    return NextResponse.json({ error: 'Upload token cannot be used here.' }, { status: 403 })
  }
  if (preflight.used_at) {
    logRejected('token_reused', ip, { vendorId })
    return NextResponse.json({ error: 'Upload token has already been used.' }, { status: 410 })
  }
  if (new Date(preflight.expires_at).getTime() < Date.now()) {
    logRejected('token_expired', ip, { vendorId })
    return NextResponse.json({ error: 'Upload token has expired.' }, { status: 410 })
  }

  // ── Storage upload (server-generated path) ──
  const ext      = ALLOWED_MIMES[mime].ext
  const filename = `pending/${randomUUID()}.${ext}`

  const { error: uploadErr } = await supa.storage
    .from(BUCKET)
    .upload(filename, fileBytes, {
      contentType: mime,
      cacheControl: '604800',
      upsert: false,
    })

  if (uploadErr) {
    const msg = uploadErr.message || 'upload failed'
    if (msg.toLowerCase().includes('bucket not found')) {
      return NextResponse.json(
        { error: 'Storage bucket "vendor-logos" is not configured.' },
        { status: 500 },
      )
    }
    logRejected('storage_error', ip, { vendorId, msg })
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 })
  }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(filename)
  const publicUrl = pub?.publicUrl
  if (!publicUrl) {
    // Should never happen for a public bucket; clean up the orphan and abort.
    await supa.storage.from(BUCKET).remove([filename]).catch(() => {})
    return NextResponse.json({ error: 'Upload succeeded but URL was unavailable.' }, { status: 500 })
  }

  // ── Atomic commit via RPC ──
  const { data: rpc, error: rpcErr } = await supa.rpc('consume_vendor_upload_token', {
    p_token_hash: tokenHash,
    p_vendor_id:  vendorId,
    p_logo_url:   publicUrl,
  })

  // rpc may return [{ok, reason}] or a single object depending on driver.
  const row = Array.isArray(rpc) ? rpc[0] : rpc
  const committed = !rpcErr && row && row.ok === true

  if (!committed) {
    // Race lost (token used between preflight and commit, vendor activated,
    // logo already set, etc.). Clean up the orphan upload best-effort and
    // surface a structured error so the client can show a clear message.
    const reason = (row && row.reason) || rpcErr?.message || 'commit_failed'
    logRejected('commit_failed', ip, { vendorId, reason, orphan: filename })
    try {
      await supa.storage.from(BUCKET).remove([filename])
    } catch (cleanupErr: any) {
      // Log so it can be hand-cleaned. Do not block the client response.
      console.error(JSON.stringify({
        at:       'api/vendor-logo-upload',
        reason:   'orphan_cleanup_failed',
        vendorId,
        filename,
        msg:      cleanupErr?.message,
      }))
    }
    return NextResponse.json(
      { error: 'Upload could not be committed. The token may have expired or been used.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ url: publicUrl, filename })
}
