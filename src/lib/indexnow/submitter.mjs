// src/lib/indexnow/submitter.mjs
// Block 5A-W-46B — pure logic for the IndexNow submitter, plain ES
// module so the CLI (`scripts/submit-indexnow.js`) AND the Vitest
// tests share ONE canonical source. JSDoc supplies types for the
// TS-checked test file that imports this module.
//
// SCOPE
//   * URL validation: host, protocol, path shape, canonical.
//   * Rejection of non-canonical, dashboard, admin, api, login/signup
//     and _next paths.
//   * Deduplication.
//   * Batching per protocol limit.
//   * Snapshot diff for change-detection.
//   * HTTP status classification + retry policy.
//   * Payload construction + key-safe log redaction.
//
// No network side effects. Callers handle fetch; this module tells
// them what to send, what to skip, and how to interpret the response.

/** @type {string} */
export const CANONICAL_HOST = 'www.pokeprices.io'

/** @type {number} */
export const MAX_BATCH_SIZE = 1000

/** @type {number} */
export const MAX_ATTEMPTS = 4

/** @type {readonly number[]} */
export const RETRY_DELAY_SCHEDULE_MS = Object.freeze([1000, 4000, 15000])

const REJECTED_PATH_PREFIXES = Object.freeze([
  '/admin',
  '/intel',
  '/api',
  '/scan-test',
  '/dashboard',
  '/_next',
])

const REJECTED_PATH_SEGMENTS = Object.freeze([
  '/login',
  '/signup',
  '/logout',
])

/**
 * @typedef {'not-a-string' | 'not-a-url' | 'wrong-protocol' | 'wrong-host'
 *           | 'has-query-string' | 'has-fragment' | 'rejected-path' | 'noindex-marker'} RejectionReason
 */

/**
 * @typedef {{ ok: true; url: string } | { ok: false; reason: RejectionReason; input: unknown }} ValidationResult
 */

/**
 * Canonicalise + validate a single URL. Returns { ok: true, url } for
 * the canonical form or { ok: false, reason } for anything to drop.
 * Pure.
 *
 * @param {unknown} input
 * @param {{ allowDeletions?: boolean }} [opts]
 * @returns {ValidationResult}
 */
export function validateUrl(input, opts = {}) {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, reason: 'not-a-string', input }
  }
  const raw = input.trim()
  let parsed
  try { parsed = new URL(raw) }
  catch { return { ok: false, reason: 'not-a-url', input } }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'wrong-protocol', input }
  }
  if (parsed.hostname.toLowerCase() !== CANONICAL_HOST) {
    return { ok: false, reason: 'wrong-host', input }
  }
  if (parsed.search.length > 0) {
    return { ok: false, reason: 'has-query-string', input }
  }
  if (parsed.hash.length > 0) {
    return { ok: false, reason: 'has-fragment', input }
  }
  const path = parsed.pathname || '/'
  for (const bad of REJECTED_PATH_PREFIXES) {
    if (path === bad || path.startsWith(bad + '/')) {
      return { ok: false, reason: 'rejected-path', input }
    }
  }
  for (const seg of REJECTED_PATH_SEGMENTS) {
    if (path === seg || path.endsWith(seg) || path.includes(seg + '/')) {
      return { ok: false, reason: 'rejected-path', input }
    }
  }
  // Surface the deletions flag so consumers can extend later without
  // breaking the signature.
  void opts.allowDeletions
  const canonical = `https://${CANONICAL_HOST}${path}`
  return { ok: true, url: canonical }
}

/**
 * @param {ReadonlyArray<string>} urls
 * @returns {string[]}
 */
export function dedupe(urls) {
  const seen = new Set()
  const out = []
  for (const u of urls) {
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/**
 * @param {ReadonlyArray<unknown>} inputs
 * @param {{ allowDeletions?: boolean }} [opts]
 * @returns {{ accepted: string[]; rejected: Array<{ reason: RejectionReason; input: unknown }> }}
 */
export function collectValidUrls(inputs, opts = {}) {
  const acc = []
  const rej = []
  for (const input of inputs) {
    const r = validateUrl(input, opts)
    if (r.ok) acc.push(r.url)
    else      rej.push({ reason: r.reason, input: r.input })
  }
  return { accepted: dedupe(acc), rejected: rej }
}

/**
 * @param {ReadonlyArray<string>} urls
 * @param {number} [size=MAX_BATCH_SIZE]
 * @returns {string[][]}
 */
export function batchUrls(urls, size = MAX_BATCH_SIZE) {
  if (size <= 0) throw new Error('batch size must be positive')
  const out = []
  for (let i = 0; i < urls.length; i += size) out.push(Array.from(urls.slice(i, i + size)))
  return out
}

/**
 * Compute changed + deleted URLs from two snapshots keyed by URL.
 * Values are content hashes.
 * @param {ReadonlyMap<string, string>} previous
 * @param {ReadonlyMap<string, string>} current
 * @returns {{ changed: string[]; deleted: string[] }}
 */
export function diffSnapshots(previous, current) {
  const changed = []
  const deleted = []
  for (const [u, hash] of Array.from(current.entries())) {
    const prev = previous.get(u)
    if (prev == null || prev !== hash) changed.push(u)
  }
  for (const u of Array.from(previous.keys())) {
    if (!current.has(u)) deleted.push(u)
  }
  return { changed, deleted }
}

/**
 * @typedef {'ok' | 'accepted' | 'bad-request' | 'forbidden' | 'unprocessable'
 *           | 'rate-limited' | 'server-error' | 'unknown' | 'network-error'} IndexNowStatus
 */

/**
 * @param {number} status
 * @returns {IndexNowStatus}
 */
export function classifyStatus(status) {
  if (status === 200)                     return 'ok'
  if (status === 202)                     return 'accepted'
  if (status === 400)                     return 'bad-request'
  if (status === 403)                     return 'forbidden'
  if (status === 422)                     return 'unprocessable'
  if (status === 429)                     return 'rate-limited'
  if (status >= 500 && status < 600)      return 'server-error'
  if (status === 0)                       return 'network-error'
  return 'unknown'
}

/**
 * @param {IndexNowStatus} status
 * @returns {boolean}
 */
export function shouldRetry(status) {
  return status === 'rate-limited'
      || status === 'server-error'
      || status === 'network-error'
}

/**
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
export function safeLogBody(text, key) {
  if (!text) return ''
  let redacted = text
  if (key && key.length > 0) {
    redacted = redacted.split(key).join('[REDACTED_KEY]')
  }
  if (redacted.length > 500) redacted = redacted.slice(0, 500) + '…'
  return redacted
}

/**
 * @param {ReadonlyArray<string>} urls
 * @param {{ key: string; keyLocation: string }} opts
 * @returns {{ host: string; key: string; keyLocation: string; urlList: string[] }}
 */
export function buildPayload(urls, opts) {
  return {
    host:        CANONICAL_HOST,
    key:         opts.key,
    keyLocation: opts.keyLocation,
    urlList:     Array.from(urls),
  }
}
