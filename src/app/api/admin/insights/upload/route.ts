// src/app/api/admin/insights/upload/route.ts
//
// EIC Block 0B — admin-only "issue signed upload URL" endpoint.
//
// Rather than proxying multi-MB image binaries through Vercel, we ask
// Supabase Storage for a short-lived signed upload URL that lets the
// browser PUT the file bytes directly to a path we choose here on the
// server. The client never picks the bucket, the folder, or the
// filename — that removes any "arbitrary bucket write" surface even
// though the caller is already an authenticated admin.
//
// Flow:
//   1. Admin sends { purpose: 'hero'|'body', contentType, size, filename? }.
//   2. requireAdmin verifies the Supabase session + allow-list.
//   3. Server rejects unsupported content types / oversize declarations.
//   4. Server picks a random path under insights/<purpose>/ inside the
//      creator-images bucket and calls createSignedUploadUrl(path).
//   5. Server returns { signedUrl, token, path, publicUrl } to the
//      client, which uploads the bytes and then writes publicUrl to
//      the article via /api/admin/insights or /:id.
//
// Constraints preserved from the previous browser-direct flow:
//   * MIME allow-list: image/jpeg, image/png, image/webp
//   * Max size:        5 MB (declared; enforced client-side pre-upload)
//   * Bucket:          creator-images
//
// Gate:
//   1. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list.
//   2. POST-only.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { ARTICLE_IMAGE_MIME_ALLOWLIST } from '@/lib/insights/richText'
import {
  ARTICLE_IMAGE_MAX_UPLOAD_BYTES,
  buildInsightsUploadPath,
  extForContentType,
  isUploadPurpose,
} from '@/lib/insights/adminApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'creator-images'

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

type Body = {
  purpose?:     unknown
  contentType?: unknown
  size?:        unknown
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  let body: Body = {}
  try { body = await req.json() as Body }
  catch { return bad(400, 'Invalid JSON') }

  if (!isUploadPurpose(body.purpose)) return bad(400, 'purpose must be "hero" or "body"')

  if (typeof body.contentType !== 'string' || !body.contentType) return bad(400, 'contentType is required')
  if (!ARTICLE_IMAGE_MIME_ALLOWLIST.includes(body.contentType)) {
    return bad(400, `Unsupported content type "${body.contentType}". Allowed: ${ARTICLE_IMAGE_MIME_ALLOWLIST.join(', ')}`)
  }
  const ext = extForContentType(body.contentType)
  if (!ext) return bad(400, 'Unsupported content type')

  if (typeof body.size !== 'number' || !Number.isFinite(body.size) || body.size <= 0) {
    return bad(400, 'size is required')
  }
  if (body.size > ARTICLE_IMAGE_MAX_UPLOAD_BYTES) {
    return bad(413, `File too large. Max is ${(ARTICLE_IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB.`)
  }

  const path = buildInsightsUploadPath(body.purpose, ext)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error) return bad(500, error.message)
    if (!data?.signedUrl || !data?.token) return bad(500, 'no signed URL returned')

    const { data: publicUrlData } = supa.storage.from(BUCKET).getPublicUrl(path)
    const publicUrl = publicUrlData?.publicUrl
    if (!publicUrl) return bad(500, 'could not resolve public URL')

    return NextResponse.json({
      signedUrl: data.signedUrl,
      token:     data.token,
      path,
      publicUrl,
      bucket:    BUCKET,
      contentType: body.contentType,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'signed URL failed', detail: msg }, { status: 500 })
  }
}
