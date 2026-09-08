// src/lib/editorial/research/analystPrompt.ts
//
// EIC Block 6 — AI Research Analyst.
//
// The Analyst is the second AI role in the EIC pipeline. It reads
// ONLY the deterministic EvidencePack and returns interpretation:
// strongest supported findings, weaker findings, contradictions,
// missing research, and a publish recommendation.
//
// Hard rules the prompt must enforce:
//   * The Analyst may not create facts absent from the pack.
//   * The Analyst may not upgrade quality.status=blocked to
//     publishRecommendation=ready or ready_with_caveats.
//   * The Analyst must reuse the POKEPRICES_EDITORIAL_PROFILE
//     writing rules (American English, no em dashes, no tropes).
//
// The route also runs the style guard against the response and can
// invoke a bounded repair pass, mirroring Block 5C for the Strategist.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import type { EvidencePack, ResearchAnalysis, PublishRecommendation } from './types'

// ─────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────

export const RESEARCH_ANALYST_ROLE_RULES = `You are the PokePrices Research Analyst. Your input is a deterministic Evidence Pack that has been snapshotted from live PokePrices data. Your output is editorial interpretation of that pack.

NON-NEGOTIABLE RULES

1. The Evidence Pack is your ONLY source of facts. You may not introduce prices, populations, article histories, release dates, or any other numeric or factual claim that is not present in the pack. If you want to reference an outside fact, list it under \`missingResearch\` instead.

2. The pack contains a \`quality\` object. If \`quality.status\` is "blocked", your \`publishRecommendation\` must be "blocked". You cannot upgrade a blocked pack to "ready" or "ready_with_caveats". You must list every quality.reason inside publishRecommendationReasons.

3. If \`quality.status\` is "needs_review", your publishRecommendation may be "ready_with_caveats" or "more_research_needed" but never "ready".

4. If the pack has critical warnings (severity="critical") that remain unresolved, your publishRecommendation must be "blocked" or "more_research_needed". Never "ready".

5. Distinguish verifiedFacts (directly measurable) from derivedFindings (computed) from interpretation (yours). Do not restate a fact as if you discovered it; cite its id when relevant.

6. Use every qualifier the pack provides. "Cards in our tracked catalogue" is not "the Pokémon market". "PSA 10 population < 200" is not "the rarest cards in existence". If the pack says the sample is bounded, your recommended angle must acknowledge the bound.

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Schema (TypeScript):

  {
    "summary": string,                              // 2-4 sentences of high-level interpretation
    "strongestFindings":    Array<{ finding: string; reason: string }>,     // <=4
    "weakerFindings":       Array<{ finding: string; reason: string }>,     // <=4
    "contradictions":       Array<{ description: string; involves: string[] }>,  // <=3
    "missingResearch":      string[],               // gaps + external facts to source manually
    "recommendedAngle":     string,                 // one paragraph
    "headlineCandidates":   string[],               // 2-4 candidates
    "requiredCaveats":      string[],               // caveats the article MUST include
    "unresolvedQuestions":  string[],               // <=5
    "recommendedVisuals":   string[],               // <=5
    "publishRecommendation":         "ready" | "ready_with_caveats" | "more_research_needed" | "blocked",
    "publishRecommendationReasons":  string[]       // required, at least 1
  }

STYLE

Concise, specific, editorial. Follow the PokePrices writing profile above. No em dashes. American English. No AI-writing tropes. Prefer periods over dashes. Prefer verbs over noun-phrase padding. Do not restate rules; act on them.`

export const RESEARCH_ANALYST_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${RESEARCH_ANALYST_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// Pack compaction for the model
// ─────────────────────────────────────────────────────────────────

/**
 * Trim a full EvidencePack down to what the Analyst needs to reason
 * about. Removes noise (raw dataTable rows past N, internal-source
 * detail the model does not need) but keeps every quality signal,
 * fact, finding, warning, and rejectedClaim intact.
 */
export function compactPackForAnalyst(pack: EvidencePack): unknown {
  const trimTable = (t: EvidencePack['dataTables'][number]) => ({
    id: t.id, title: t.title, source: t.source, asOf: t.asOf,
    columns: t.columns.map(c => ({ key: c.key, label: c.label })),
    rows: t.rows.slice(0, 30),   // Analyst does not need every row; 30 is enough context
    totalRows: t.rows.length,
  })
  return {
    recipe:      pack.recipe,
    project:     pack.project,
    generatedAt: pack.generatedAt,
    dataAsOf:    pack.dataAsOf,
    methodology: pack.methodology,
    verifiedFacts:   pack.verifiedFacts,
    derivedFindings: pack.derivedFindings,
    dataTables:      pack.dataTables.map(trimTable),
    internalSources: pack.internalSources.map(s => ({ id: s.id, label: s.label, table: s.table, asOf: s.asOf, rowCount: s.rowCount })),
    externalSources: pack.externalSources,
    warnings:      pack.warnings,
    researchGaps:  pack.researchGaps,
    rejectedClaims: pack.rejectedClaims,
    notes:          pack.notes,
    quality:        pack.quality,
  }
}

export function buildAnalystUserTurn(pack: EvidencePack): string {
  const compact = compactPackForAnalyst(pack)
  return [
    'MODE=analyze',
    '',
    'Below is the deterministic Evidence Pack for a planned editorial project. Read it carefully, then produce a Research Analysis in the JSON format specified in the system prompt. Follow every non-negotiable rule.',
    '',
    `Project: ${pack.project.title} (${pack.project.articleType})`,
    pack.project.angle ? `Angle brief: ${pack.project.angle}` : '',
    pack.project.targetPublishAt ? `Target publish date: ${pack.project.targetPublishAt}` : '',
    '',
    '```json',
    JSON.stringify(compact, null, 2),
    '```',
  ].filter(Boolean).join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing + guardrails
// ─────────────────────────────────────────────────────────────────

export function parseAnalystResponse(rawText: string, pack: EvidencePack): ResearchAnalysis {
  const fenceMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText   = fenceMatch ? fenceMatch[1] : rawText
  let parsed: any
  try { parsed = JSON.parse(jsonText) }
  catch { parsed = {} }
  if (!parsed || typeof parsed !== 'object') parsed = {}

  const summary                     = str(parsed.summary)
  const strongestFindings           = (arrObjs(parsed.strongestFindings, ['finding','reason']) as Array<{ finding: string; reason: string }>).slice(0, 6)
  const weakerFindings              = (arrObjs(parsed.weakerFindings,    ['finding','reason']) as Array<{ finding: string; reason: string }>).slice(0, 6)
  const contradictions              = arrCons(parsed.contradictions).slice(0, 5)
  const missingResearch             = arrStr(parsed.missingResearch).slice(0, 10)
  const recommendedAngle            = str(parsed.recommendedAngle)
  const headlineCandidates          = arrStr(parsed.headlineCandidates).slice(0, 8)
  const requiredCaveats             = arrStr(parsed.requiredCaveats).slice(0, 10)
  const unresolvedQuestions         = arrStr(parsed.unresolvedQuestions).slice(0, 8)
  const recommendedVisuals          = arrStr(parsed.recommendedVisuals).slice(0, 8)
  let   publishRecommendation       = coerceEnum(parsed.publishRecommendation, ['ready','ready_with_caveats','more_research_needed','blocked'] as const, 'more_research_needed')
  const publishRecommendationReasons = arrStr(parsed.publishRecommendationReasons).slice(0, 10)

  // ── Deterministic guardrails ──
  //
  // The Analyst MUST NOT be able to upgrade a blocked pack to ready or
  // ready_with_caveats. Enforce this in code, not just in the prompt.
  if (pack.quality.status === 'blocked' && publishRecommendation !== 'blocked') {
    publishRecommendation = 'blocked'
    if (publishRecommendationReasons.length === 0) publishRecommendationReasons.push('EvidencePack.quality.status = blocked; publishRecommendation forced to blocked by the Research Engine.')
  }
  if (pack.quality.status === 'needs_review' && publishRecommendation === 'ready') {
    publishRecommendation = 'ready_with_caveats'
    publishRecommendationReasons.push('EvidencePack.quality.status = needs_review; downgraded from ready to ready_with_caveats.')
  }
  const hasCritical = pack.warnings.some(w => w.severity === 'critical')
  if (hasCritical && (publishRecommendation === 'ready' || publishRecommendation === 'ready_with_caveats')) {
    publishRecommendation = 'more_research_needed'
    publishRecommendationReasons.push('EvidencePack contains critical warnings; publishRecommendation downgraded to more_research_needed.')
  }

  return {
    version:                       1,
    generatedAt:                   new Date().toISOString(),
    packRecipe:                    pack.recipe,
    packGeneratedAt:               pack.generatedAt,
    summary,
    strongestFindings,
    weakerFindings,
    contradictions,
    missingResearch,
    recommendedAngle,
    headlineCandidates,
    requiredCaveats,
    unresolvedQuestions,
    recommendedVisuals,
    publishRecommendation:         publishRecommendation as PublishRecommendation,
    publishRecommendationReasons,
  }
}

// ─────────────────────────────────────────────────────────────────
// Style-guard field map for the Analyst response
// ─────────────────────────────────────────────────────────────────

export function analystStyleFields(a: ResearchAnalysis): Record<string, string | string[]> {
  return {
    'summary':              a.summary,
    'recommendedAngle':     a.recommendedAngle,
    'headlineCandidates':   a.headlineCandidates,
    'requiredCaveats':      a.requiredCaveats,
    'unresolvedQuestions':  a.unresolvedQuestions,
    'recommendedVisuals':   a.recommendedVisuals,
    'missingResearch':      a.missingResearch,
    'publishRecommendationReasons': a.publishRecommendationReasons,
    'strongestFindings.finding': a.strongestFindings.map(f => f.finding),
    'strongestFindings.reason':  a.strongestFindings.map(f => f.reason),
    'weakerFindings.finding':    a.weakerFindings.map(f => f.finding),
    'weakerFindings.reason':     a.weakerFindings.map(f => f.reason),
    'contradictions.description': a.contradictions.map(c => c.description),
  }
}

// ─────────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function arrStr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x: any) => typeof x === 'string' && x.trim()).slice() : [] }
function arrObjs(v: unknown, keys: readonly string[]): Array<Record<string, string>> {
  if (!Array.isArray(v)) return []
  return v.map((o: any) => {
    if (!o || typeof o !== 'object') return null
    const rec: Record<string, string> = {}
    for (const k of keys) rec[k] = typeof o[k] === 'string' ? o[k] : ''
    return rec
  }).filter(Boolean) as Array<Record<string, string>>
}
function arrCons(v: unknown): Array<{ description: string; involves: string[] }> {
  if (!Array.isArray(v)) return []
  return v.map((o: any) => o && typeof o === 'object'
    ? { description: str(o.description), involves: arrStr(o.involves) }
    : null,
  ).filter(Boolean) as Array<{ description: string; involves: string[] }>
}
function coerceEnum<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return (typeof v === 'string' && (options as readonly string[]).includes(v)) ? v as T : fallback
}
