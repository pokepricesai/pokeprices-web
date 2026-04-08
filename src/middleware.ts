// src/middleware.ts

import { NextRequest, NextResponse } from 'next/server'

const INTEL_PASSWORD = process.env.INTEL_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protect /intel routes — but NOT the login page itself
  if (pathname.startsWith('/intel') && !pathname.startsWith('/intel/login')) {
    const authCookie = request.cookies.get('intel_auth')?.value
    if (authCookie !== INTEL_PASSWORD) {
      return NextResponse.redirect(new URL('/intel/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/intel/:path*'],
}
