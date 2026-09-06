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
 *  the editorial profile. */
export const FORBIDDEN_TROPE_PHRASES: readonly string[] = [
  'Honest answer',
  'The honest answer',
  "I'm going to push back",
  'That said',
  "Here's the thing",
  "It's worth noting",
  "In today's",
  'In the world of',
  "Whether you're a collector or investor",
  'not just X, but Y',
]

/** Regex form of the em dash (U+2014). */
const EM_DASH = '—'

// ── Public API ────────────────────────────────────────────────────

export type StyleViolation = {
  kind:    'em_dash' | 'trope'
  match:   string             // the offending substring
  count:   number             // how many times it appears in the checked text
  where:   string             // 'assistantMessage' | `primary[0].angle` | etc
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
      // Count occurrences.
      let n = 0, i = 0
      while ((i = lower.indexOf(needle, i)) !== -1) { n++; i += needle.length }
      out.push({ kind: 'trope', match: phrase, count: n, where })
    }
  }
}

// ── Repair prompt builder ─────────────────────────────────────────

export function buildStyleRepairUserTurn(rawText: string, audit: StyleAudit): string {
  const lines = [
    'STYLE-REPAIR-PASS',
    '',
    'The previous assistant reply violates the PokePrices writing rules. Rewrite the SAME response so that every violation below is fixed. Non-negotiable rules for this rewrite:',
    '  * Preserve every fact, number, slug, cited article, opportunity id, dataStrength, citationPotential, radar score, and every other structured value.',
    '  * Preserve the JSON schema exactly. Same top-level keys. Same recommendation shape. Same fenced json code block.',
    '  * Preserve the meaning of every recommendation and every chat sentence. Do not delete a recommendation. Do not merge or split them.',
    '  * Use American English (behavior, analyze, prioritize, center, color).',
    '  * Remove every em dash character (U+2014). Do NOT substitute a double hyphen. Use a period, comma, colon, semicolon, or parentheses.',
    '  * Remove every one of the listed trope phrases below. Replace them with plain specific editorial language that says the same thing.',
    '',
    'Violations detected in the previous reply:',
    ...audit.violations.map(v => `  * ${v.kind}${v.kind === 'trope' ? ` "${v.match}"` : ''} at ${v.where} (${v.count}x)`),
    '',
    'Previous reply (verbatim), to rewrite:',
    '',
    rawText,
  ]
  return lines.join('\n')
}
