// src/lib/seo-analysis/pageClassifier.ts
// Block 5A-W-33 — URL → page-type classifier.
//
// Used to bucket GSC / Bing page-level rows by template so we can
// report "card pages have CTR X, set pages have CTR Y" rather than a
// 40k-row haystack.
//
// Order of checks matters — deeper segments first so that
// /set/foo/card/bar resolves to 'card', not 'set'.

export type PageType =
  | 'home'
  | 'card'
  | 'set'
  | 'pokemon'
  | 'insights'
  | 'tools'
  | 'vendors'
  | 'creators'
  | 'card-shows'
  | 'games'
  | 'visualisations'
  | 'browse'
  | 'dealer'
  | 'studio'
  | 'ai-assistant'
  | 'roadmap'
  | 'legal'
  | 'submit'
  | 'private'   // dashboard, admin, intel, auth, scan-test, api
  | 'other'

const SITE_HOST_PATTERNS = [
  /^https?:\/\/(www\.)?pokeprices\.io/i,
  /^https?:\/\/pokeprices\.io/i,
]

/** Strip protocol + host so the classifier works on bare paths too. */
export function toPath(input: string): string {
  if (!input) return '/'
  const trimmed = input.trim()
  for (const re of SITE_HOST_PATTERNS) {
    if (re.test(trimmed)) {
      const rest = trimmed.replace(re, '')
      if (rest === '' || rest === '/') return '/'
      return rest.startsWith('/') ? rest : `/${rest}`
    }
  }
  // Already a bare path? Normalize.
  if (trimmed.startsWith('/')) return trimmed
  // Anything else (non-site URL, weird input) — return as-is for transparency.
  return trimmed
}

export function classifyPage(input: string): PageType {
  const raw = toPath(input)
  // Drop query/hash for matching.
  const path = raw.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '')

  if (path === '' || path === '/') return 'home'

  // Submit forms — match before the parent vendor / creator route so
  // /vendors/submit doesn't get bucketed as 'vendors'.
  if (path === '/vendors/submit' || path === '/creators/submit') return 'submit'

  // Private surfaces.
  if (path.startsWith('/dashboard'))  return 'private'
  if (path.startsWith('/admin'))      return 'private'
  if (path.startsWith('/intel'))      return 'private'
  if (path.startsWith('/auth'))       return 'private'
  if (path.startsWith('/api'))        return 'private'
  if (path.startsWith('/scan-test'))  return 'private'

  // Deeper templates first.
  // /set/{slug}/card/{cardSlug} → card
  if (/^\/set\/[^/]+\/card\/[^/]+$/.test(path)) return 'card'
  if (/^\/set\/[^/]+$/.test(path))              return 'set'

  if (path === '/pokemon')                                  return 'pokemon'
  if (/^\/pokemon\/[^/]+$/.test(path))                      return 'pokemon'

  if (path === '/insights')                                 return 'insights'
  if (/^\/insights\/[^/]+$/.test(path))                     return 'insights'

  if (path === '/tools')                                    return 'tools'

  if (path === '/vendors')                                  return 'vendors'
  if (/^\/vendors\/[^/]+$/.test(path))                      return 'vendors'

  if (path === '/creators')                                 return 'creators'
  if (/^\/creators\/[^/]+$/.test(path))                     return 'creators'

  if (path === '/card-shows')                               return 'card-shows'
  if (/^\/card-shows\/[^/]+$/.test(path))                   return 'card-shows'
  if (/^\/card-shows\/[^/]+\/[^/]+$/.test(path))            return 'card-shows'

  if (path === '/games')                                    return 'games'
  if (/^\/games\/[^/]+$/.test(path))                        return 'games'

  if (path === '/visualisations')                           return 'visualisations'
  if (/^\/visualisations\/[^/]+$/.test(path))               return 'visualisations'

  if (path === '/browse')        return 'browse'
  if (path === '/dealer')        return 'dealer'
  if (path === '/studio')        return 'studio'
  if (path === '/ai-assistant')  return 'ai-assistant'
  if (path === '/roadmap')       return 'roadmap'

  if (path === '/privacy' || path === '/terms' || path === '/contact') return 'legal'

  return 'other'
}
