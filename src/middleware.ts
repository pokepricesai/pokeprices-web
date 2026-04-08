// Add this to your existing middleware.ts or create it at src/middleware.ts
// Protects /intel with a simple password check via cookie

import { NextRequest, NextResponse } from 'next/server'

const INTEL_PASSWORD = process.env.INTEL_PASSWORD || process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protect /intel routes
  if (pathname.startsWith('/intel')) {
    const authCookie = request.cookies.get('intel_auth')?.value
    if (authCookie !== INTEL_PASSWORD) {
      // Redirect to login with return URL
      const loginUrl = new URL('/intel/login', request.url)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/intel/:path*'],
}
