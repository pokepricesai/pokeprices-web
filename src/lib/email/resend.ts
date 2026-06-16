// src/lib/email/resend.ts
// Central server-only Resend client. Lazy-initialised so the absence
// of RESEND_API_KEY at build time does not crash static generation.
//
// Every feature that needs to talk to Resend MUST go through this
// module. After Block 3A, no other file constructs `new Resend(...)`.

import 'server-only'
import { Resend } from 'resend'

// Flat result type — all fields always present (cf. Block 1A pattern).
export type ResendClientResult = {
  ok:      boolean
  client:  Resend | null
  missing: 'RESEND_API_KEY' | ''
}

let cached: { client: Resend; key: string } | null = null

/**
 * Returns the cached Resend client when RESEND_API_KEY is set. Returns
 * a structured "missing" outcome otherwise — callers translate that
 * into the right HTTP status without echoing the env-var name to the
 * browser.
 */
export function getResendClient(): ResendClientResult {
  const key = (process.env.RESEND_API_KEY ?? '').trim()
  if (!key) return { ok: false, client: null, missing: 'RESEND_API_KEY' }
  if (!cached || cached.key !== key) {
    cached = { client: new Resend(key), key }
  }
  return { ok: true, client: cached.client, missing: '' }
}

/**
 * Visible for tests only — clears the cached client so a test can
 * change `process.env.RESEND_API_KEY` between assertions and pick up
 * the new value. Production code never calls this.
 */
export function __resetResendClientForTests(): void {
  cached = null
}
