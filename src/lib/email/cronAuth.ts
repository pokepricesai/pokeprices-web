// src/lib/email/cronAuth.ts
// Block 3D — bearer-secret check for the internal processor route.
//
// CRON_SECRET is the canonical value Vercel sends in
// `Authorization: Bearer <secret>` when it invokes a configured cron
// route. We accept that as authoritative. For one release we also
// accept the legacy ONBOARDING_CRON_SECRET so the operator can roll
// the new value out before retiring the old one. After the deployment
// proves out, ONBOARDING_CRON_SECRET should be removed from Vercel.
//
// Fail-closed: when both env vars are missing, the request is
// rejected. Never log or echo the secret.

import 'server-only'

function constTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function readBearer(req: Request): string {
  const header = req.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

export type CronAuthCheck = {
  ok:           boolean
  /** Which secret authorised the request. 'none' when rejected. */
  matched:      'primary' | 'legacy' | 'none'
  /** When ok=false, a short reason. Never includes any secret. */
  reason?:      'missing_secret' | 'no_bearer' | 'mismatch'
}

export function isCronAuthOk(req: Request): CronAuthCheck {
  const primary = (process.env.CRON_SECRET             ?? '').trim()
  const legacy  = (process.env.ONBOARDING_CRON_SECRET  ?? '').trim()

  if (!primary && !legacy) {
    return { ok: false, matched: 'none', reason: 'missing_secret' }
  }
  const bearer = readBearer(req)
  if (!bearer) {
    return { ok: false, matched: 'none', reason: 'no_bearer' }
  }
  if (primary && constTimeEq(bearer, primary)) return { ok: true, matched: 'primary' }
  if (legacy  && constTimeEq(bearer, legacy))  return { ok: true, matched: 'legacy' }
  return { ok: false, matched: 'none', reason: 'mismatch' }
}
