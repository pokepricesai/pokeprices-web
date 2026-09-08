// src/lib/adminRateLimit.ts
//
// EIC Block 0B — tiny in-memory rate-limit helper for admin API routes.
// The goal is narrow: prevent a compromised or malfunctioning admin
// session from burning upstream quota (Anthropic, Storage, etc.) with
// a runaway loop. This is not a general-purpose rate limiter.
//
// Per-instance in-memory. Not shared across serverless invocations, so
// this is a SOFT cap not a strict limit — good enough to blunt an
// accidental loop without needing Redis. Mirrors the pattern used by
// src/app/api/deep-search/parse/route.ts, but keyed by admin identity
// (email) rather than IP so a single admin who signs in from multiple
// devices shares one bucket.

import 'server-only'

type Bucket = { count: number; resetAt: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stores = new Map<string, Map<string, Bucket>>()

export type RateLimitResult =
  | { ok: true;  retryAfter?: undefined }
  | { ok: false; retryAfter: number }

/**
 * Check-and-increment a rate-limit bucket.
 *
 * @param namespace  Bucket namespace (typically the route path). Buckets
 *                   from different routes never collide.
 * @param key        Per-caller key (typically the admin email).
 * @param limit      Max calls per window.
 * @param windowMs   Window duration in ms.
 */
export function checkAdminRateLimit(
  namespace: string,
  key:       string,
  limit:     number,
  windowMs:  number,
): RateLimitResult {
  const now = Date.now()
  let store = stores.get(namespace)
  if (!store) {
    store = new Map<string, Bucket>()
    stores.set(namespace, store)
  }
  const bucket = store.get(key)
  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  bucket.count += 1
  return { ok: true }
}

/**
 * TEST-ONLY: clear all buckets. Not called from application code.
 */
export function _resetAdminRateLimitForTests(): void {
  stores.clear()
}
