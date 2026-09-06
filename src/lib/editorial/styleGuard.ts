// src/lib/editorial/styleGuard.ts
//
// EIC Block 5C — lightweight output-quality guard for editorial AI.
//
// The Block 5B prompt tells the model to write in American English,
// to avoid em dashes, and to avoid a specific list of AI-writing
// tropes. Prompt-only enforcement is imperfect. This module inspects
// the model's actual output and lets the route decide whether to
// perform ONE bounded repair pass that preserves facts + schema
// while stripping style violations.
//
// This is not a full linter. It catches the concrete violations the
// Block 5C report specifies, and nothing else.

// ── Detectable violations ─────────────────────────────────────────

/** Every literal phrase in this list is a case-insensitive substring
 *  the strategist output must never contain. Block 5C explicitly
 *  enumerates them plus the general "AI-writing tropes" list from
 *  the editorial profile. Block 5D adds "Short answer:". */
export const FORBIDDEN_TROPE_PHRASES: readonly string[] = [
  'Honest answer',
  'The honest answer',
  'Short answer',            // Block 5D
  "I'm going to push back",
  'That said',
  "Here's the thing",
  "It's worth noting",
  "In today's",
  'In the world of',
  "Whether you're a collector or investor",
  'not just X, but Y',
]

/** Block 5D — lightweight British-English -> American-English map.
 *  Applied as a case-insensitive whole-word check. The style-repair
 *  prompt is told to preserve proper nouns and quoted source text
 *  verbatim so the model does not "correct" e.g. "Center Parcs" or
 *  a book title, and to only Americanize genuine prose. This is a
 *  small pragmatic list, not a linter. */
export const BRITISH_SPELLING_PATTERNS: ReadonlyArray<{ british: string; american: string }> = [
  { british: 'catalogue',   american: 'catalog'    },
  { british: 'catalogued',  american: 'cataloged'  },
  { british: 'cataloguing', american: 'cataloging' },
  { british: 'behaviour',   american: 'behavior'   },
  { british: 'behavioural', american: 'behavioral' },
  { british: 'analyse',     american: 'analyze'    },
  { british: 'analysed',    american: 'analyzed'   },
  { british: 'analysing',   american: 'analyzing'  },
  { british: 'prioritise',  american: 'prioritize' },
  { british: 'prioritised', american: 'prioritized' },
  { british: 'prioritising',american: 'prioritizing' },
  { british: 'centre',      american: 'center'     },
  { british: 'centred',     american: 'centered'   },
  { british: 'centres',     american: 'centers'    },
  { british: 'colour',      american: 'color'      },
  { british: 'coloured',    american: 'colored'    },
  { british: 'colours',     american: 'colors'     },
  { british: 'labelled',    american: 'labeled'    },
  { british: 'labelling',   american: 'labeling'   },
]

/** Regex form of the em dash (U+2014). */
const EM_DASH = '—'

// ── Public API ────────────────────────────────────────────────────

export type StyleViolation = {
  kind:    'em_dash' | 'trope' | 'british_spelling'
  match:   string             // the offending substring
  count:   number             // how many times it appears in the checked text
  where:   string             // 'assistantMessage' | `primary[0].angle` | etc
  suggest?: string            // for british_spelling: the American equivalent
}

export type StyleAudit = {
  hasViolations: boolean
  violations:    readonly StyleViolation[]
}

/** Walk every human-facing string in the parsed strategist response
 *  (assistantMessage + every field of every recommendation) and
 *  return the concrete violations found. Fast, pure, testable. */
export function auditStrategistStyle(response: unknown): StyleAudit {
  const violations: StyleViolation[] = []
  if (!response || typeof response !== 'object') return { hasViolations: false, violations: [] }
  const r = response as any

  // 1. assistantMessage
  if (typeof r.assistantMessage === 'string') {
    collectViolations(r.assistantMessage, 'assistantMessage', violations)
  }

  // 2. every recommendation in primary + alternatives
  const recBuckets: Array<[string, unknown]> = []
  if (r.recommendations && typeof r.recommendations === 'object') {
    if (typeof r.recommendations.summary === 'string') {
      collectViolations(r.recommendations.summary, 'recommendations.summary', violations)
    }
    if (Array.isArray(r.recommendations.primary)) {
      r.recommendations.primary.forEach((rec: any, i: number) => recBuckets.push([`primary[${i}]`, rec]))
    }
    if (Array.isArray(r.recommendations.alternatives)) {
      r.recommendations.alternatives.forEach((rec: any, i: number) => recBuckets.push([`alternatives[${i}]`, rec]))
    }
  }

  const RECOMMENDATION_TEXT_FIELDS = [
    'headline', 'angle', 'whyNow', 'whyUseful', 'searchOrEditorialIntent', 'recommendedPublishDay',
  ] as const
  const RECOMMENDATION_ARRAY_FIELDS = [
    'evidenceAvailable', 'evidenceStillNeeded', 'suggestedVisualsOrDataBlocks',
  ] as const

  for (const [prefix, rec] of recBuckets) {
    if (!rec || typeof rec !== 'object') continue
    const rr = rec as any
    for (const f of RECOMMENDATION_TEXT_FIELDS) {
      if (typeof rr[f] === 'string') collectViolations(rr[f], `${prefix}.${f}`, violations)
    }
    for (const f of RECOMMENDATION_ARRAY_FIELDS) {
      if (Array.isArray(rr[f])) {
        rr[f].forEach((s: unknown, i: number) => {
          if (typeof s === 'string') collectViolations(s, `${prefix}.${f}[${i}]`, violations)
        })
      }
    }
    // existingContentOverlap.related[].headline
    if (rr.existingContentOverlap && Array.isArray(rr.existingContentOverlap.related)) {
      rr.existingContentOverlap.related.forEach((rel: any, i: number) => {
        if (rel && typeof rel === 'object' && typeof rel.headline === 'string') {
          collectViolations(rel.headline, `${prefix}.existingContentOverlap.related[${i}].headline`, violations)
        }
      })
    }
  }

  return { hasViolations: violations.length > 0, violations }
}

function collectViolations(text: string, where: string, out: StyleViolation[]): void {
  if (text.includes(EM_DASH)) {
    let n = 0; for (const ch of text) if (ch === EM_DASH) n++
    out.push({ kind: 'em_dash', match: EM_DASH, count: n, where })
  }
  const lower = text.toLowerCase()
  for (const phrase of FORBIDDEN_TROPE_PHRASES) {
    const needle = phrase.toLowerCase()
    if (lower.includes(needle)) {
      let n = 0, i = 0
      while ((i = lower.indexOf(needle, i)) !== -1) { n++; i += needle.length }
      out.push({ kind: 'trope', match: phrase, count: n, where })
    }
  }
  // Block 5D — British-English whole-word check. Word boundaries
  // prevent false positives like "encentre" or "centred" being
  // matched inside a proper noun (case is also normalised). Proper-
  // noun preservation is left to the repair prompt, which has an
  // explicit rule to not touch quoted or proper-noun text.
  for (const { british, american } of BRITISH_SPELLING_PATTERNS) {
    const re = new RegExp(`\\b${escapeRegex(british)}\\b`, 'gi')
    const matches = text.match(re)
    if (matches && matches.length > 0) {
      out.push({ kind: 'british_spelling', match: british, count: matches.length, where, suggest: american })
    }
  }
}

function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// ── Repair prompt builder ─────────────────────────────────────────

export function buildStyleRepairUserTurn(rawText: string, audit: StyleAudit): string {
  const lines = [
    'STYLE-REPAIR-PASS',
    '',
    'The previous assistant reply violates the PokePrices writing rules. Rewrite the SAME response so that every violation below is fixed. Non-negotiable rules for this rewrite:',
    '  * Preserve every fact, number, slug, cited article, opportunity id, dataStrength, citationPotential, radar score, and every other structured value.',
    '  * Preserve the JSON schema exactly. Same top-level keys. Same recommendation shape. Same fenced json code block.',
    '  * Preserve the meaning of every recommendation and every chat sentence. Do not delete a recommendation. Do not merge or split them.',
    '  * Use American English throughout (behavior, analyze, prioritize, center, color, labeled, catalog).',
    '  * Remove every em dash character (U+2014). Do NOT substitute a double hyphen. Use a period, comma, colon, semicolon, or parentheses.',
    '  * Remove every one of the listed trope phrases below. Replace them with plain specific editorial language that says the same thing.',
    '  * Replace British spellings with their American forms as listed below. Do NOT change proper nouns, article titles, brand names, quoted source text, or existing slugs. If a match is inside a proper noun or verbatim quote, leave it alone.',
    '',
    'Violations detected in the previous reply:',
    ...audit.violations.map(v => {
      if (v.kind === 'trope')            return `  * trope "${v.match}" at ${v.where} (${v.count}x)`
      if (v.kind === 'british_spelling') return `  * british_spelling "${v.match}" -> "${v.suggest}" at ${v.where} (${v.count}x)`
      return `  * em_dash at ${v.where} (${v.count}x)`
    }),
    '',
    'Previous reply (verbatim), to rewrite:',
    '',
    rawText,
  ]
  return lines.join('\n')
}
