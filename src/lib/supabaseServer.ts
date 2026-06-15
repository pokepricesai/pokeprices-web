// src/lib/supabaseServer.ts
// Server-only Supabase client bound to the request's auth cookies.
//
// Used by:
//   * React Server Components (RSCs) under /dashboard/** for the auth boundary.
//   * Route handlers (e.g. /auth/callback) that need to read or write the
//     session.
//
// In RSCs the Next.js cookies() API is read-only — attempts to set a cookie
// throw. The cookies handler below tolerates that: it always reports what is
// present and only attempts to mutate when a writable context is available.
//
// Service-role access is intentionally NOT exposed here. See
// src/lib/supabaseService.ts for that.

import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

export async function getSupabaseServerClient() {
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    throw new Error('supabaseServer: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  }
  const store = await cookies()
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return store.getAll().map(c => ({ name: c.name, value: c.value }))
      },
      setAll(arr) {
        // Read-only in RSCs; writable in Server Actions and Route Handlers.
        // Swallowing the error is intentional — Supabase's SSR helper
        // handles the read-only context by not refreshing the cookie.
        try {
          for (const { name, value, options } of arr) {
            store.set(name, value, options)
          }
        } catch { /* RSC read-only — fine */ }
      },
    },
  })
}
