// src/lib/email/providerEvents.ts
// Block 3A (correction) — payload classifiers for Resend webhook
// events. Pure functions, no I/O, safe to unit test.
//
// We do NOT trust the raw `data.failed.reason` or `data.bounce.type`
// at face value. Resend's vocabulary changes over time, and treating
// every failure as permanent caused exactly the kind of "global
// suppression on a transient timeout" issue this module exists to
// prevent.
//
// Classification rules:
//
//   * email.bounced
//       → classifyBounce(data.bounce.type, data.bounce.subType)
//       'hard'    when the type identifies a permanent address rejection
//                 (Resend sends literal "Permanent" or "HardBounce" /
//                 "Suppressed" / "Undetermined" with subType containing
//                 "MailboxFull" / "General" / "NoEmail")
//       'soft'    when the type identifies a transient issue
//                 (literal "Transient" / "SoftBounce", or types like
//                 "ContentRejected" / "DnsFailure" that may recover)
//       'unknown' anything else — DO NOT SUPPRESS on unknown
//
//   * email.failed
//       → classifyFailedReason(data.failed.reason)
//       'permanent_recipient' when the reason string clearly identifies
//                 the recipient or address as the cause and the failure
//                 is permanent ("mailbox does not exist", "recipient
//                 rejected", "no such user", SMTP 5.1.x codes, etc.)
//       'temporary' when the reason identifies a transient cause
//                 (timeout, quota/rate limit, throttle, deferred, TLS,
//                 connection, configuration, domain DNS, capacity,
//                 4xx SMTP)
//       'unknown' anything else — DO NOT SUPPRESS on unknown
//
// Only `hard` bounces and `permanent_recipient` failures lead to
// suppression in the webhook receiver. Everything else updates the
// delivery log status but leaves the contact deliverable.

export type BounceClassification     = 'hard' | 'soft' | 'unknown'
export type FailureClassification    = 'permanent_recipient' | 'temporary' | 'unknown'

// Bounce type strings that Resend has used historically. Matched
// case-insensitively, substring allowed.
const HARD_BOUNCE_TYPE_RE = /\b(hard|permanent|suppressed|undetermined)\b/i
// Use leading-word-boundary but allow trailing characters (CamelCase
// like "DnsFailure" / "ContentRejected" must match).
const SOFT_BOUNCE_TYPE_RE = /\b(soft|transient|temporary|temporarily|deferred|dns|content|throttl|rate)/i

const HARD_BOUNCE_SUBTYPE_RE = /\b(no[\s_-]?email|mailbox[\s_-]?does[\s_-]?not[\s_-]?exist|general|invalid|no[\s_-]?such[\s_-]?user|recipient[\s_-]?reject)\b/i

export function classifyBounce(
  type:    string | null | undefined,
  subType: string | null | undefined,
): BounceClassification {
  const t = (type    ?? '').trim()
  const s = (subType ?? '').trim()
  if (t && HARD_BOUNCE_TYPE_RE.test(t))      return 'hard'
  if (s && HARD_BOUNCE_SUBTYPE_RE.test(s))   return 'hard'
  if (t && SOFT_BOUNCE_TYPE_RE.test(t))      return 'soft'
  return 'unknown'
}

// Reason strings come from Resend's `failed.reason`. Patterns
// intentionally favour false-negative (don't suppress on ambiguity).
const PERMANENT_RECIPIENT_RE = new RegExp([
  '\\bmailbox\\b.*\\bnot\\b.*\\bexist',
  '\\brecipient\\b.*\\breject',
  '\\binvalid[\\s_-]+recipient',
  '\\bno[\\s_-]+such[\\s_-]+user',
  '\\baddress\\b.*\\bdoes[\\s_-]+not[\\s_-]+exist',
  '\\bunknown[\\s_-]+user',
  '\\bpermanent',
  '\\b5\\.[01]\\.[0-9]',                // SMTP 5.1.x / 5.0.x codes
  '\\baccount[\\s_-]+disabled',
  '\\bnot[\\s_-]+a[\\s_-]+valid[\\s_-]+(mailbox|recipient)',
].join('|'), 'i')

const TEMPORARY_RE = new RegExp([
  '\\btimeout',
  '\\bquota',
  '\\brate[\\s_-]?limit',
  '\\bthrottl',
  '\\btemporar',
  '\\bdeferred',
  '\\btls',
  '\\bconnection',
  '\\bdomain',
  '\\bconfiguration',
  '\\bservice\\b',
  '\\bcapacity',
  '\\b4\\d{2}\\b',                       // any 4xx SMTP code
  '\\btry[\\s_-]+again',
  '\\bbusy',
  '\\bgreylist',
].join('|'), 'i')

export function classifyFailedReason(reason: string | null | undefined): FailureClassification {
  if (typeof reason !== 'string') return 'unknown'
  const r = reason.trim()
  if (!r) return 'unknown'
  if (PERMANENT_RECIPIENT_RE.test(r)) return 'permanent_recipient'
  if (TEMPORARY_RE.test(r))           return 'temporary'
  return 'unknown'
}
