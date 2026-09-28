// src/middleware.ts
//
// Runs before every request. Two responsibilities:
//
//   1. **Bare-domain → www permanent redirect (Stage 6A)**.
//      Bing WMT and every canonical link in the app agrees on
//      https://www.pokeprices.io/*. Sending bare-domain traffic to www
//      via HTTP 301 (not 307) tells Bing/Google to consolidate authority
//      onto the www variant. Preserves path + query string exactly.
//
//   2. **/intel gate**. Everything under /intel except the login page
//      requires a password cookie; unauthenticated requests bounce to
//      /intel/login.
//
// The matcher is scoped to just the paths we actually mutate so we do
// not pay per-request middleware cost on the entire site.

import { NextRequest, NextResponse } from 'next/server'

const INTEL_PASSWORD =
  process.env.INTEL_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices'

const CANONICAL_HOST = 'www.pokeprices.io'
const BARE_HOST      = 'pokeprices.io'

export function middleware(request: NextRequest) {
  const { nextUrl, headers } = request
  const host = (headers.get('host') || '').toLowerCase()

  // ── 1. bare-domain → www 301 ────────────────────────────────────────
  // Applies to every non-/_next / non-/api request (see the matcher
  // below): HTML pages, sitemaps, and the IndexNow key file all end up
  // uniformly 301'd from bare → www. This gives Bing/Google a single
  // canonical property to attribute authority to.
  if (host === BARE_HOST) {
    // Use plain URL construction (rather than nextUrl.clone()) so the same
    // helper is testable outside the Next runtime.
    const redirected = new URL(nextUrl.href)
    redirected.host = CANONICAL_HOST
    redirected.protocol = 'https:'
    return NextResponse.redirect(redirected.toString(), 301)
  }

  // ── 2. /intel gate ──────────────────────────────────────────────────
  const { pathname } = nextUrl
  if (pathname.startsWith('/intel') && !pathname.startsWith('/intel/login')) {
    const authCookie = request.cookies.get('intel_auth')?.value
    if (authCookie !== INTEL_PASSWORD) {
      return NextResponse.redirect(new URL('/intel/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Match every request the Next.js runtime would serve — including sitemaps
  // and the IndexNow key file — so bare→www 301 applies uniformly. We only
  // exclude /_next (Next.js internals) and /api (route handlers Vercel
  // serves directly). The IndexNow key file continues to serve a valid
  // response from bare (via 301 → www) which is fully compliant with the
  // IndexNow protocol.
  matcher: [
    '/((?!_next/|api/).*)',
    '/intel/:path*',
  ],
}
