// src/lib/adminAuth.ts
// Server-only admin authorisation helper.
//
// Verifies that an incoming Request carries a valid Supabase Auth
// session whose email address is present in the server-only env var
// ADMIN_ALLOWED_EMAILS (comma-separated, case-insensitive).
//
// Returns a tagged result instead of throwing so route handlers can
// translate it directly into HTTP responses without leaking internal
// detail.

import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Flat result type with all fields always present. Avoids reliance on TS
// discriminated-union narrowing, which is not consistently available when
// the project tsconfig has `strict: false`.
export type AdminAuthResult = {
  ok:      boolean
  userId:  string
  email:   string
  status:  number
  error:   string
}

function fail(status: number, error: string): AdminAuthResult {
  return { ok: false, userId: '', email: '', status, error }
}

function parseAllowList(): Set<string> {
  const raw = process.env.ADMIN_ALLOWED_EMAILS ?? ''
  return new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  )
}

export async function requireAdmin(req: Request): Promise<AdminAuthResult> {
  const header = req.headers.get('authorization') ?? ''
  const token  = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  if (!token) {
    return fail(401, 'Missing bearer token')
  }

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return fail(500, 'Server misconfigured')
  }

  // Fresh anon client purely to validate the token. We pass the token
  // to getUser() rather than to the client constructor so we never
  // attach the caller's session to the long-lived module.
  const supa = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data?.user) {
    return fail(401, 'Invalid session')
  }

  const email = (data.user.email ?? '').toLowerCase()
  if (!email) {
    return fail(403, 'Account has no email')
  }

  const allow = parseAllowList()
  if (allow.size === 0) {
    // Fail closed: refuse to allow anyone if the operator has not
    // configured the allow-list.
    return fail(503, 'Admin allow-list not configured')
  }
  if (!allow.has(email)) {
    return fail(403, 'Not authorised')
  }

  return { ok: true, userId: data.user.id, email, status: 200, error: '' }
}
