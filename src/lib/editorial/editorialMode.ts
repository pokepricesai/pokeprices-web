// src/lib/editorial/editorialMode.ts
//
// Canonical classification: every editorial opportunity / project
// resolves to exactly one of two modes.
//
//   external — content whose facts come from live web research
//              (upcoming sets, news, product reveals, evergreen
//              guides). Written in ChatGPT Deep Research and
//              pasted into Studio. No EIC AI stages required.
//   internal — content whose facts come from proprietary PokePrices
//              data (monthly reports, population studies, price
//              analysis). Runs the strict internal-data pipeline
//              with numeric audit + strict Fact Checker.
//
// The classification is ARTICLE-TYPE FIRST. A title containing
// "release" or "Pokémon" must not accidentally send an internal
// data article through the external workflow. The legacy title
// heuristic only fires for legacy records without a reliable
// article_type, and only on very specific phrases.

export type EditorialMode = 'external' | 'internal'

const EXTERNAL_TYPES = new Set<string>([
  'upcoming_set',
  'new_set',
  'news',
  'release_news',
  'product_announcement',
  'set_preview',
  'evergreen_guide',
  'external_research',
])

const INTERNAL_TYPES = new Set<string>([
  'monthly_market_report',
  'population_scarcity',
  'data_study',
  'market_analysis',
  'price_analysis',
  'grading_analysis',
  'search_trends',
  'movers',
])

/** Legacy-only title matcher. VERY restrictive on purpose — never
 *  matches generic Pokémon vocabulary like "release", "set", or
 *  "Pokémon". Only fires when article_type is empty or 'evergreen'
 *  (which is genuinely ambiguous). */
const LEGACY_EXTERNAL_TITLE_HINT = /\b(everything we know|coming soon|announced by|announcement|revealed|reveal|preview of|leaked|leak dropped|preorder|pre-order|drop date|drops on|is here|is coming|launches on|launch date)\b/i

export type EditorialModeInput = {
  article_type?:    string | null
  articleType?:     string | null
  title?:           string | null
  angle?:           string | null
}

/** Resolve a project or opportunity to its editorial mode. */
export function getEditorialMode(project: EditorialModeInput): EditorialMode {
  const rawType = String(project.article_type ?? project.articleType ?? '').toLowerCase().trim()

  // 1. Explicit article_type wins.
  if (INTERNAL_TYPES.has(rawType)) return 'internal'
  if (EXTERNAL_TYPES.has(rawType)) return 'external'

  // 2. Legacy fallback — ONLY for records with no reliable
  //    article_type (empty string or generic 'evergreen'). Do NOT
  //    fall back for e.g. `data_study` typos — treat unknown but
  //    non-empty types as internal by default (safer for
  //    proprietary-data content).
  if (rawType === '' || rawType === 'evergreen') {
    const combined = `${project.title ?? ''} ${project.angle ?? ''}`
    if (LEGACY_EXTERNAL_TITLE_HINT.test(combined)) return 'external'
  }

  // 3. Safe default. Anything unclassified goes through the
  //    stricter internal pipeline until an admin sets an article_type.
  return 'internal'
}

/** Convenience — is this project external? */
export function isExternalProject(project: EditorialModeInput): boolean {
  return getEditorialMode(project) === 'external'
}

/** Convenience — is this project internal? */
export function isInternalProject(project: EditorialModeInput): boolean {
  return getEditorialMode(project) === 'internal'
}
