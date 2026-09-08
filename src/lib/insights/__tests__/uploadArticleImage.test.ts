// src/lib/insights/__tests__/uploadArticleImage.test.ts
//
// Regression tests locking the client/server contract of the Studio
// image upload. Previous bugs:
//   * client sent `sizeBytes`; server wanted `size`
//   * client read `uploadUrl`; server returned `signedUrl`
// Both caused 100% failure of Studio image uploads in production.

import { describe, it, expect, vi } from 'vitest'
import { uploadArticleImage } from '../uploadArticleImage'

function makeFile(overrides: { name?: string; type?: string; size?: number } = {}): File {
  const name = overrides.name ?? 'photo.jpg'
  const type = overrides.type ?? 'image/jpeg'
  const size = overrides.size ?? 123_456
  // Vitest's Node env has File; give it a tiny body then override
  // size for the assertions.
  const f = new File([new Uint8Array([1, 2, 3])], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

/** Fake sequenced fetch: first call = /api/admin/insights/upload
 *  (returns signed URL JSON); second call = the actual PUT. */
function makeFakeFetch(opts: {
  signResponse?:  Partial<{ signedUrl: string; publicUrl: string; error: string; status: number }>
  putResponseOk?: boolean
} = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const signedUrl = opts.signResponse?.signedUrl ?? 'https://storage.example/upload-token-abc'
  const publicUrl = opts.signResponse?.publicUrl ?? 'https://cdn.example/insights/hero/xyz.jpg'
  const signBody: Record<string, unknown> = opts.signResponse?.error
    ? { error: opts.signResponse.error }
    : { signedUrl, publicUrl, token: 'tok', path: 'insights/hero/xyz.jpg', bucket: 'creator-images', contentType: 'image/jpeg' }
  const signStatus = opts.signResponse?.status ?? 200

  const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const asStr = typeof url === 'string' ? url : String(url)
    calls.push({ url: asStr, init })
    if (asStr.includes('/api/admin/insights/upload')) {
      return new Response(JSON.stringify(signBody), {
        status:  signStatus,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(null, { status: (opts.putResponseOk ?? true) ? 200 : 500 })
  })
  return { fake: fake as unknown as typeof fetch, calls, signedUrl, publicUrl }
}

const authHeader = async () => ({ authorization: 'Bearer test-token' })

// ─────────────────────────────────────────────────────────────────
// Sign-request body shape — the exact fields the server requires
// ─────────────────────────────────────────────────────────────────

describe('uploadArticleImage: sign request body', () => {
  it('sends { filename, contentType, size, purpose } — with `size`, not `sizeBytes`', async () => {
    const { fake, calls } = makeFakeFetch()
    const file = makeFile({ name: 'hero.jpg', type: 'image/jpeg', size: 987_654 })
    await uploadArticleImage(file, 'hero', { authHeader, fetchImpl: fake })

    const signCall = calls.find(c => c.url.includes('/api/admin/insights/upload'))!
    expect(signCall).toBeTruthy()
    const body = JSON.parse(String(signCall.init?.body))
    expect(body.size).toBe(987_654)
    expect(body.contentType).toBe('image/jpeg')
    expect(body.purpose).toBe('hero')
    expect(typeof body.filename).toBe('string')
    // Regression: previous bug sent sizeBytes and the server rejected
    // every call with "size is required". The old field name must
    // not appear in the request.
    expect(body).not.toHaveProperty('sizeBytes')
  })

  it('sends purpose: "body" for TipTap in-body inserts', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile(), 'body', { authHeader, fetchImpl: fake })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.purpose).toBe('body')
  })

  it('sends purpose: "hero" for Hero Image control', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile(), 'hero', { authHeader, fetchImpl: fake })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.purpose).toBe('hero')
  })

  it('includes the admin auth header on the sign request', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile(), 'body', { authHeader, fetchImpl: fake })
    const signCall = calls[0]
    const headers = signCall.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer test-token')
    expect(headers['content-type']).toBe('application/json')
  })

  it('POSTs the sign request (not GET)', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile(), 'body', { authHeader, fetchImpl: fake })
    expect(calls[0].init?.method).toBe('POST')
  })
})

// ─────────────────────────────────────────────────────────────────
// Sign-response shape — reads `signedUrl`, not `uploadUrl`
// ─────────────────────────────────────────────────────────────────

describe('uploadArticleImage: sign response handling', () => {
  it('reads signedUrl (not uploadUrl) and PUTs the file to it', async () => {
    const { fake, calls, signedUrl } = makeFakeFetch({
      signResponse: {
        signedUrl: 'https://storage.example/signed-upload-abc',
        publicUrl: 'https://cdn.example/insights/hero/xyz.jpg',
      },
    })
    await uploadArticleImage(makeFile(), 'hero', { authHeader, fetchImpl: fake })

    const putCall = calls[1]
    expect(putCall).toBeTruthy()
    expect(putCall.url).toBe('https://storage.example/signed-upload-abc')
    expect(putCall.init?.method).toBe('PUT')
  })

  it('returns the publicUrl on success', async () => {
    const { fake } = makeFakeFetch({
      signResponse: {
        signedUrl: 'https://storage.example/x',
        publicUrl: 'https://cdn.example/insights/body/abc.png',
      },
    })
    const result = await uploadArticleImage(makeFile(), 'body', { authHeader, fetchImpl: fake })
    expect(result).toBe('https://cdn.example/insights/body/abc.png')
  })

  it('throws with the server error message when the sign call fails', async () => {
    const { fake } = makeFakeFetch({
      signResponse: { error: 'size is required', status: 400 },
    })
    await expect(uploadArticleImage(makeFile(), 'hero', { authHeader, fetchImpl: fake }))
      .rejects.toThrow('size is required')
  })

  it('throws when the PUT to Supabase storage fails', async () => {
    const { fake } = makeFakeFetch({ putResponseOk: false })
    await expect(uploadArticleImage(makeFile(), 'body', { authHeader, fetchImpl: fake }))
      .rejects.toThrow(/Storage upload failed/)
  })
})

// ─────────────────────────────────────────────────────────────────
// End-to-end shape check — hero + body cycle
// ─────────────────────────────────────────────────────────────────

describe('uploadArticleImage: end-to-end shape', () => {
  it('exact hero-upload request body matches server contract', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile({ size: 500_000 }), 'hero', { authHeader, fetchImpl: fake })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(Object.keys(body).sort()).toEqual(['contentType', 'filename', 'purpose', 'size'])
    expect(body.purpose).toBe('hero')
    expect(body.size).toBe(500_000)
    expect(body.contentType).toBe('image/jpeg')
  })

  it('exact body-upload request body matches server contract', async () => {
    const { fake, calls } = makeFakeFetch()
    await uploadArticleImage(makeFile({ type: 'image/png', size: 200_000 }), 'body', { authHeader, fetchImpl: fake })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(Object.keys(body).sort()).toEqual(['contentType', 'filename', 'purpose', 'size'])
    expect(body.purpose).toBe('body')
    expect(body.contentType).toBe('image/png')
    expect(body.size).toBe(200_000)
  })
})
