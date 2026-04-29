// src/app/api/vendor-logo-upload/route.ts
// Accepts a logo file from the public vendor submission form, validates it,
// uploads to Supabase Storage via the service-role key (so we never expose
// storage credentials to the client), and returns the public URL.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const BUCKET = 'vendor-logos'
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

// Cheap random suffix for filename uniqueness. Doesn't need cryptographic
// strength — collisions just produce a 409 from storage which we'd retry.
function randomSlug(): string {
  return Math.random().toString(36).slice(2, 10)
}

function extFromType(type: string): string {
  switch (type) {
    case 'image/png':     return 'png'
    case 'image/jpeg':    return 'jpg'
    case 'image/webp':    return 'webp'
    case 'image/gif':     return 'gif'
    case 'image/svg+xml': return 'svg'
    default:              return 'bin'
  }
}

export async function POST(req: Request) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({
      error: `File too large. Max 2 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
    }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({
      error: `Unsupported type "${file.type}". Allowed: PNG, JPG, WEBP, GIF, SVG.`,
    }, { status: 400 })
  }

  // Use slug provided by the client if any (helps debugging in storage UI),
  // but always append a random suffix so submissions can't overwrite each other.
  const rawSlug = (formData.get('vendor_slug') ?? '').toString().toLowerCase()
    .replace(/[^a-z0-9-]/g, '').slice(0, 60) || 'vendor'
  const filename = `${rawSlug}-${Date.now()}-${randomSlug()}.${extFromType(file.type)}`

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)

  const { error: uploadErr } = await supa.storage
    .from(BUCKET)
    .upload(filename, file, {
      contentType: file.type,
      cacheControl: '604800', // 7 days
      upsert: false,
    })

  if (uploadErr) {
    console.error('[vendor-logo-upload] storage error:', uploadErr)
    return NextResponse.json({
      error: uploadErr.message?.includes('Bucket not found')
        ? 'Storage bucket "vendor-logos" not configured. Create it in Supabase Storage.'
        : 'Upload failed',
    }, { status: 500 })
  }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(filename)
  return NextResponse.json({ url: pub.publicUrl, filename })
}
