// Stage 6A — middleware bare→www redirect + /intel gate tests.
//
// The middleware runs before requests hit our routes. Its two jobs:
//   * 301 redirect any bare-domain HTML/route request to the www host,
//     preserving path + query;
//   * gate /intel/* on the intel_auth cookie.

import { describe, it, expect, beforeEach } from 'vitest'
import { middleware } from '../middleware'

function req(url: string, opts?: { host?: string; cookies?: Record<string, string> }) {
  const u = new URL(url)
  const host = opts?.host ?? u.host
  const headers = new Headers({ host })
  if (opts?.cookies) {
    const c = Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    headers.set('cookie', c)
  }
  const request = new Request(url, { headers, redirect: 'manual' })
  // NextRequest is a superset of Request; middleware() only reads nextUrl,
  // headers, and cookies — all present on the plain Request wrapper
  // Next.js provides via `NextRequest` inheritance. For test purposes we
  // shim the missing bits.
  const nextUrl = new URL(url)
  const cookiesGet = (name: string) => {
    const raw = request.headers.get('cookie') ?? ''
    const parts = raw.split(';').map(s => s.trim())
    for (const p of parts) {
      const [k, ...vs] = p.split('=')
      if (k === name) return { name, value: vs.join('=') }
    }
    return undefined
  }
  const shim = Object.assign(request, {
    nextUrl,
    cookies: { get: cookiesGet },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return shim as any
}

// INTEL_PASSWORD is read at module-load time from process.env, so the
// tests exercise the default fallback ("pokeprices") that the module
// captured before Vitest could reset env vars.
const MODULE_PASSWORD = 'pokeprices'
beforeEach(() => {
  // no-op; kept so future changes have a hook.
})

describe('middleware — bare→www 301', () => {
  it('301-redirects bare domain to www, preserving path', () => {
    const r = middleware(req('https://pokeprices.io/set/Chaos%20Rising/card/ampharos-29'))
    expect(r.status).toBe(301)
    const loc = r.headers.get('location') ?? ''
    expect(loc).toBe('https://www.pokeprices.io/set/Chaos%20Rising/card/ampharos-29')
  })

  it('301-redirects bare domain to www, preserving query string', () => {
    const r = middleware(req('https://pokeprices.io/browse?q=charizard&sort=price'))
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('https://www.pokeprices.io/browse?q=charizard&sort=price')
  })

  it('does not redirect when host is already www', () => {
    const r = middleware(req('https://www.pokeprices.io/'))
    // NextResponse.next() has status 200 by default. Regardless, this
    // must NOT be a redirect.
    expect([200, undefined, null]).toContain(r.status)
    expect(r.headers.get('location')).toBeNull()
  })

  it('does not create a redirect loop when bare hits and lands on www', () => {
    const r = middleware(req('https://pokeprices.io/anything'))
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toMatch(/^https:\/\/www\.pokeprices\.io\//)
  })
})

describe('middleware — /intel gate', () => {
  it('redirects /intel to /intel/login without cookie', () => {
    const r = middleware(req('https://www.pokeprices.io/intel'))
    expect(r.status).toBeGreaterThanOrEqual(300)
    expect(r.headers.get('location')).toBe('https://www.pokeprices.io/intel/login')
  })

  it('lets /intel through with matching cookie', () => {
    const r = middleware(req('https://www.pokeprices.io/intel', {
      cookies: { intel_auth: MODULE_PASSWORD },
    }))
    expect(r.headers.get('location')).toBeNull()
  })

  it('does not gate /intel/login itself', () => {
    const r = middleware(req('https://www.pokeprices.io/intel/login'))
    expect(r.headers.get('location')).toBeNull()
  })
})
