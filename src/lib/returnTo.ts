// src/lib/returnTo.ts
// Safe internal-path validator used by every place we accept a redirect
// target from a query parameter, cookie or client-side intent.
//
// Allows ONLY paths that:
//   * Start with a single '/'
//   * Do not start with '//' (which a browser interprets as a protocol-
//     relative URL pointing at an arbitrary host).
//   * Do not contain a backslash (defends against Windows-style host
//     smuggling in older parsers).
//   * Do not specify a scheme.
//
// Any returnTo that fails validation is replaced with null so the caller
// can fall back to a safe default (typically /dashboard).

const SCHEME_RE = /^[a-z][a-z0-9+\-.]*:/i

export function safeReturnTo(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s) return null
  if (s.length > 1024) return null
  if (!s.startsWith('/')) return null
  if (s.startsWith('//')) return null
  if (s.startsWith('/\\') || s.includes('\\')) return null
  if (SCHEME_RE.test(s)) return null
  // Reject explicit cross-origin patterns like "/example.com" with a host.
  // We treat the input as a path; URL parsing should round-trip it.
  try {
    const u = new URL(s, 'https://internal.invalid')
    if (u.origin !== 'https://internal.invalid') return null
    return u.pathname + u.search + u.hash
  } catch {
    return null
  }
}
