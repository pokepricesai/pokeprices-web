// src/lib/email/webhookVerify.ts
// Svix signature verification for Resend webhooks.
//
// Resend signs webhook deliveries with Svix. The official `svix` SDK
// exposes a `Webhook` class whose `verify()` returns the parsed
// payload on success and throws on any failure (missing signature,
// wrong timestamp tolerance, hash mismatch). We wrap it so callers can
// branch on a structured result instead of catching exceptions.

import 'server-only'
import { Webhook } from 'svix'

// Flat result type — all fields always present. Discriminated-union
// narrowing is unreliable under strict:false in this project's tsconfig
// (cf. Block 1A's adminAuth.ts).
export type WebhookVerifyResult<T> = {
  ok:      boolean
  payload: T | null
  reason:  'missing_secret' | 'missing_headers' | 'bad_signature' | 'bad_payload' | ''
}

const REQUIRED_HEADERS = ['svix-id', 'svix-timestamp', 'svix-signature'] as const

export function verifyResendWebhook<T = unknown>(
  rawBody:    string,
  headers:    Headers | Record<string, string>,
  secretFromCaller?: string,
): WebhookVerifyResult<T> {
  const secret = (secretFromCaller ?? process.env.RESEND_WEBHOOK_SECRET ?? '').trim()
  if (!secret) return { ok: false, payload: null, reason: 'missing_secret' }

  const headerMap: Record<string, string> = {}
  if (headers instanceof Headers) {
    for (const h of REQUIRED_HEADERS) {
      const v = headers.get(h)
      if (v) headerMap[h] = v
    }
  } else {
    for (const h of REQUIRED_HEADERS) {
      const v = headers[h] ?? headers[h.toUpperCase()]
      if (typeof v === 'string') headerMap[h] = v
    }
  }
  for (const h of REQUIRED_HEADERS) {
    if (!headerMap[h]) return { ok: false, payload: null, reason: 'missing_headers' }
  }

  let wh: Webhook
  try {
    wh = new Webhook(secret)
  } catch {
    return { ok: false, payload: null, reason: 'missing_secret' }
  }

  try {
    const payload = wh.verify(rawBody, headerMap) as T
    if (!payload || typeof payload !== 'object') {
      return { ok: false, payload: null, reason: 'bad_payload' }
    }
    return { ok: true, payload, reason: '' }
  } catch {
    return { ok: false, payload: null, reason: 'bad_signature' }
  }
}
