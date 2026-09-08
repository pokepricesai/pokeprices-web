// src/lib/insights/uploadArticleImage.ts
//
// Small client helper: get a signed upload URL from
// /api/admin/insights/upload, PUT the file bytes to it, return the
// public URL for embedding in the article. Shared between the
// Studio Hero Image control and the TipTap in-body image insert.
//
// Extracted from StudioClient.tsx so the exact request/response
// shape can be regression-tested against the server route without
// pulling the whole client component into the test environment.

export type UploadArticleImagePurpose = 'hero' | 'body'

export type UploadArticleImageOptions = {
  /** Async function returning HTTP auth headers for the admin API
   *  (typically an { authorization: 'Bearer ...' } from Supabase). */
  authHeader: () => Promise<Record<string, string>>
  /** Fetch to use. Defaults to global fetch; tests inject a mock. */
  fetchImpl?: typeof fetch
}

/** Sign + upload one image. Returns the public URL on success. */
export async function uploadArticleImage(
  file: File,
  purpose: UploadArticleImagePurpose,
  opts: UploadArticleImageOptions,
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const auth = await opts.authHeader()
  const filename = `studio-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`

  // Server validator (src/app/api/admin/insights/upload/route.ts)
  // requires exactly these four fields:
  //   purpose:     'hero' | 'body'
  //   contentType: string
  //   size:        number    ← NOT sizeBytes
  //   filename:    (unused server-side; included for parity with
  //                 the server's documented request shape)
  const signRes = await fetchImpl('/api/admin/insights/upload', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      filename,
      contentType: file.type,
      size:        file.size,
      purpose,
    }),
  })
  const signJson = await signRes.json().catch(() => ({} as any))
  // Server response shape (from route.ts):
  //   { signedUrl, token, path, publicUrl, bucket, contentType }
  // Read the fields the server actually sends.
  if (!signRes.ok || !signJson?.signedUrl || !signJson?.publicUrl) {
    throw new Error(signJson?.error || `${signRes.status} ${signRes.statusText}`)
  }
  const putRes = await fetchImpl(signJson.signedUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body:    file,
  })
  if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`)
  return signJson.publicUrl as string
}
