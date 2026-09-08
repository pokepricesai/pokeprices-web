// src/lib/editorial/writer/factCheckerPrompt.ts
//
// EIC Block 9 — Fact Checker role prompt + parser.
//
// The Fact Checker is Claude Sonnet 4.6. It reads:
//   * the same approved EvidencePack the Writer received
//   * the assembled body text extracted from the Studio document
//   * the Writer's claim trace + block intents
//
// Its output is a FactCheckResult (schema in ./types).
//
// Deterministic guardrails after parsing:
//   * The checker cannot upgrade evidence. If quality.status was
//     blocked at the pack level, the parser strips any 'pass'
//     verdict.
//   * The parser normalises severity values.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import type { EvidencePack } from '../research/types'
import type {
  FactCheckIssue, FactCheckResult, FactCheckStatus, FactCheckSeverity, FactCheckIssueKind,
  WriterClaimTrace, BlockIntent, NumericAuditResult,
} from './types'
import { FACT_CHECK_VERSION } from './types'
import type { StudioDocument } from '@/lib/studio/types'

// ─────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────

export const FACT_CHECKER_ROLE_RULES = `You are the PokePrices Fact Checker. Your job is to audit a generated article against an APPROVED evidence pack and report issues. You are NOT the Writer. You do not rewrite prose; you produce a structured issue list.

INPUTS

You will see:
  * the evidence pack (methodology, verifiedFacts, derivedFindings, dataTables, warnings, rejectedClaims, requiredCaveats, quarantinedRows summary, quality, external sources)
  * the assembled article body as plain text (with markers for section boundaries and blocks)
  * the writer's claim trace (which section produced which claim)
  * the deterministic numeric audit's list of unmatched numbers (already run before you)

WHAT TO REPORT

Identify:
  * unsupported_factual_claim: a claim not backed by the pack, an external source, or a canonical PokePrices link.
  * rejected_claim_detected: the article uses phrasing from pack.rejectedClaims.
  * missing_required_caveat: the article omits a caveat the pack requires (for example, framing a stale population figure as "today").
  * sample_scope_overstated: article generalises a tracked sample to the whole Pokemon market.
  * external_source_misused: an external source is cited for a claim it does not support.
  * quarantined_row_referenced: the article uses a quarantined value.
  * inconsistent_with_evidence: an internal contradiction, or numbers that disagree with the pack.

EXTERNAL-RESEARCH SPECIFICS (pack.recipe === "external_research")

For external_research articles the authoritative research artefact is the pack's \`researchSummary\` (plus \`researchPrimaryText\` + \`researchSupportingText\` for depth). A structured \`verifiedFacts\` list may be empty and that is OK — do NOT flag every sentence as unsupported simply because there is no matching \`fact-*\` id. Instead:

  * A claim is "supported" when it is stated (or implied) in the research prose AND at least one URL in \`pack.externalSources\` is a plausible source for it. That is the extractable standard.
  * unsupported_factual_claim: raise when a claim appears in the article but has no plausible source in the pack (neither in the research prose nor an \`externalSources\` URL). Invented facts, invented URLs, invented publishers.
  * external_source_misused: raise when the research prose treats a claim as reported/rumored/unconfirmed and the article states it as confirmed news. Or when the only support is a Tier-3 (community) URL and the article presents the claim as official.
  * inconsistent_with_evidence: raise when \`pack.contradictions\` (if populated) contains a disputed claim and the article picks one side without surfacing the disagreement.
  * missing_required_caveat: raise when the article omits an important \`researchGap\` — for release/news pieces, notable unknowns must be acknowledged.

DO NOT

Do not:
  * change any evidence value
  * downgrade or dismiss a warning
  * try to "recover" a quarantined row
  * reinterpret rejected claims into acceptable phrasing
  * produce prose beyond the JSON issue list

You may set status = "pass" only when there are no critical or major issues AND no unsupported numeric claims flagged by the deterministic audit.

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Schema:

  {
    "status": "pass" | "review_required" | "fail",
    "issues": [
      {
        "kind": "unsupported_numeric_claim" | "unsupported_factual_claim" | "rejected_claim_detected" | "missing_required_caveat" | "sample_scope_overstated" | "external_source_misused" | "quarantined_row_referenced" | "inconsistent_with_evidence" | "other",
        "severity": "critical" | "major" | "minor",
        "claim": string,
        "location"?: string,
        "reason": string,
        "evidenceRefs": string[],
        "suggestedCorrection"?: string
      }
    ]
  }
`

export const FACT_CHECKER_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${FACT_CHECKER_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// EIC — lightweight external-research Fact Checker
// ─────────────────────────────────────────────────────────────────
//
// External SEO / collector pieces are not regulatory reports. The
// full Fact Checker (with per-claim provenance, numeric audits, and
// 30+ low-value findings) is designed for internal-data articles.
// For external, we care about meaningful problems only.

export const EXTERNAL_FACT_CHECKER_ROLE_RULES = `You are the PokePrices Fact Checker for an external Pokémon collector article. Your job is to catch MEANINGFUL problems, not to run a forensic audit.

INPUT

You receive:
  * The article body as plain text.
  * A short research summary (the factual source the Writer used).
  * A list of external sources (URL + title + publisher).
  * Optional: contradictions the research explicitly flagged.

WHAT TO FLAG

Only these categories count:
  * unsupported_factual_claim: an article claim that is NOT supported anywhere in the research summary or the source list. Invented dates, invented card counts, invented product names, invented publishers.
  * external_source_misused: the research flags a claim as reported/rumored/unconfirmed and the article states it as confirmed news.
  * rejected_claim_detected: rumor or leak presented as fact.
  * inconsistent_with_evidence: article contradicts the research summary or ignores a flagged contradiction.
  * missing_required_caveat: article makes a strong claim on something the research explicitly says is not yet confirmed, without qualifying it.

WHAT NOT TO FLAG

Do NOT flag:
  * every sentence for lack of a matching evidence id (this article does not carry claim traces).
  * ordinary numbers that are present in the research summary. Do not run a numeric allowlist audit.
  * minor phrasing preferences.
  * editorial interpretation that is clearly framed as opinion.
  * SEO word choices.
  * absence of a "methodology" or "sources" section.
  * paraphrase differences from the research summary.

BUDGET

Aim for PASS. If real issues exist, list at most 5. If more than 5 would qualify, list the 5 highest-severity ones. Do not pad the list.

OUTPUT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`:

  {
    "status": "pass" | "review_required" | "fail",
    "issues": [
      {
        "kind": "unsupported_factual_claim" | "external_source_misused" | "rejected_claim_detected" | "inconsistent_with_evidence" | "missing_required_caveat" | "other",
        "severity": "critical" | "major" | "minor",
        "claim": string,
        "location"?: string,
        "reason": string,
        "evidenceRefs": string[],
        "suggestedCorrection"?: string
      }
    ]
  }

Status guidance: PASS when no meaningful issues. REVIEW_REQUIRED for 1-5 issues that should be resolved before publish. FAIL only for genuinely broken output (invented sources, invented publishers, rumor stated as confirmed news on a critical claim).`

export const EXTERNAL_FACT_CHECKER_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${EXTERNAL_FACT_CHECKER_ROLE_RULES}`

export function buildExternalFactCheckerUserTurn(args: {
  articleText:     string
  headline:        string
  seoTitle:        string
  seoDescription:  string
  pack:            EvidencePack
}): string {
  const summary = (args.pack.researchSummary && args.pack.researchSummary.trim())
    || [args.pack.externalResearchRun?.primaryText, args.pack.externalResearchRun?.supportingText].filter(Boolean).join('\n\n')
  const cappedSummary = summary.length > 8_000 ? summary.slice(0, 8_000) + '\n\n[…truncated]' : summary
  const topSources = [...args.pack.externalSources]
    .sort((a, b) => ((a.sourceTier ?? 3) - (b.sourceTier ?? 3)))
    .slice(0, 20)
    .map(s => ({ url: s.url, title: s.title, publisher: s.publisher }))
  const contradictions = (args.pack.contradictions ?? []).slice(0, 3).map(c => ({ on: c.claim, positions: c.positions.map(p => p.statement) }))

  return [
    'MODE=external_fact_check',
    '',
    'Fact-check the article against the research summary + sources below. Return one JSON object matching the schema.',
    '',
    '=== ARTICLE ===',
    `HEADLINE: ${args.headline}`,
    `SEO TITLE: ${args.seoTitle}`,
    `SEO DESCRIPTION: ${args.seoDescription}`,
    '',
    args.articleText,
    '',
    '=== RESEARCH SUMMARY ===',
    cappedSummary || '(no summary — flag any unsourced factual claim as unsupported)',
    '',
    '=== SOURCES ===',
    '```json',
    JSON.stringify(topSources, null, 2),
    '```',
    contradictions.length > 0 ? '\n=== CONTRADICTIONS ===\n```json\n' + JSON.stringify(contradictions, null, 2) + '\n```' : '',
  ].filter(Boolean).join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Input compaction
// ─────────────────────────────────────────────────────────────────

export type FactCheckerInputBundle = {
  pack:          EvidencePack
  studio:        StudioDocument
  claimTrace:    WriterClaimTrace[]
  blocksBuilt:   BlockIntent[]
  numericAudit:  NumericAuditResult
}

export function buildFactCheckerUserTurn(bundle: FactCheckerInputBundle): string {
  const bodyText = flattenTiptapToPlainText(bundle.studio.bodyDoc)
  const numericIssues = bundle.numericAudit.issues.map((i, k) => `  [${k + 1}] "${i.token.raw}" (${i.token.kind}) at ${i.token.location}`).join('\n') || '  (none)'

  return [
    'MODE=fact_check',
    '',
    'Audit the following article against the evidence pack. Return one JSON object matching the schema in the system prompt.',
    '',
    '=== HEADLINE / INTRO / SEO ===',
    `HEADLINE: ${bundle.studio.headline}`,
    `INTRO: ${bundle.studio.intro}`,
    `SEO_TITLE: ${bundle.studio.seo.title}`,
    `SEO_DESCRIPTION: ${bundle.studio.seo.description}`,
    '',
    '=== ARTICLE BODY (plain text) ===',
    bodyText,
    '',
    '=== WRITER CLAIM TRACE ===',
    bundle.claimTrace.map(c => `  [${c.sectionId}] ${c.claim}  ->  ${c.evidenceRefs.join(', ') || '(none)'}`).join('\n') || '  (none)',
    '',
    '=== BLOCKS BUILT ===',
    bundle.blocksBuilt.map(b => `  * ${b.kind}${(b as any).sourceTableId ? ` (${(b as any).sourceTableId})` : ''}${(b as any).evidenceRefId ? ` (${(b as any).evidenceRefId})` : ''}`).join('\n') || '  (none)',
    '',
    '=== DETERMINISTIC NUMERIC AUDIT ISSUES (already run) ===',
    numericIssues,
    '',
    '=== EVIDENCE PACK ===',
    '```json',
    JSON.stringify(compactPackForChecker(bundle.pack), null, 2),
    '```',
  ].join('\n')
}

function compactPackForChecker(pack: EvidencePack): unknown {
  return {
    recipe:          pack.recipe,
    dataAsOf:        pack.dataAsOf,
    methodology:     pack.methodology,
    verifiedFacts:   pack.verifiedFacts,
    derivedFindings: pack.derivedFindings,
    dataTables:      pack.dataTables.map(t => ({ id: t.id, title: t.title, asOf: t.asOf, columns: t.columns, rowsPreview: t.rows.slice(0, 20), totalRows: t.rows.length })),
    externalSources: pack.externalSources,
    warnings:        pack.warnings,
    researchGaps:    pack.researchGaps,
    rejectedClaims:  pack.rejectedClaims,
    quality:         pack.quality,
    quarantinedRows: pack.quarantinedRows.map(q => ({ id: q.id, reason: q.reason, message: q.message })),
    // External Research Fix — visible to checker so it can flag
    // silent contradiction-picks and rumor→confirmation upgrades.
    contradictions:    pack.contradictions,
    researchQuestions: pack.researchQuestions,
    webResearch:       pack.webResearch ? { researchedAt: pack.webResearch.researchedAt, searchesUsed: pack.webResearch.searchesUsed, model: pack.webResearch.model } : undefined,
    // v5 — research prose so the checker can verify claims against
    // context, not just the (often empty) verifiedFacts list.
    researchSummary:        pack.researchSummary ? pack.researchSummary.slice(0, 10_000) : undefined,
    researchPrimaryText:    pack.externalResearchRun?.primaryText    ? pack.externalResearchRun.primaryText.slice(0, 10_000) : undefined,
    researchSupportingText: pack.externalResearchRun?.supportingText ? pack.externalResearchRun.supportingText.slice(0, 8_000)  : undefined,
  }
}

function flattenTiptapToPlainText(node: any, out: string[] = [], depth = 0): string {
  if (!node || typeof node !== 'object') return out.join('\n')
  if (typeof node.text === 'string') { out.push(node.text); return out.join('') }
  if (Array.isArray(node.content)) {
    const kids: string[] = []
    for (const c of node.content) {
      kids.push(flattenNode(c, depth + 1))
    }
    return kids.join('')
  }
  return ''
}
function flattenNode(node: any, depth: number): string {
  if (!node) return ''
  if (node.type === 'heading')     return `\n\n## ${collect(node.content)}\n`
  if (node.type === 'paragraph')   return `\n${collect(node.content)}\n`
  if (node.type === 'blockquote')  return `\n> ${collect(node.content)}\n`
  if (node.type === 'bulletList' || node.type === 'orderedList') return `\n${(node.content ?? []).map((li: any) => `- ${collect(li.content)}`).join('\n')}\n`
  if (node.type === 'dataBlock')   return `\n[BLOCK: ${node.attrs?.variant}]\n`
  if (node.type === 'horizontalRule') return `\n---\n`
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.content)) return collect(node.content)
  return ''
}
function collect(content: any[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content.map((c: any) => {
    if (c?.type === 'text' && typeof c.text === 'string') return c.text
    if (c?.type === 'hardBreak') return ' '
    if (Array.isArray(c?.content)) return collect(c.content)
    return ''
  }).join('')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing + deterministic guardrails
// ─────────────────────────────────────────────────────────────────

const ISSUE_KINDS: FactCheckIssueKind[] = [
  'unsupported_numeric_claim','unsupported_factual_claim','rejected_claim_detected',
  'missing_required_caveat','sample_scope_overstated','external_source_misused',
  'quarantined_row_referenced','inconsistent_with_evidence','other',
]
const SEVERITIES: FactCheckSeverity[] = ['critical', 'major', 'minor']

export function parseFactCheckerResponse(rawText: string, pack: EvidencePack, numericAudit: NumericAuditResult, opts: { checkedStudioHash: string; autoCheck: boolean }): FactCheckResult {
  const fence = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fence ? fence[1] : rawText
  let parsed: any
  try { parsed = JSON.parse(jsonText) } catch { parsed = {} }
  if (!parsed || typeof parsed !== 'object') parsed = {}

  const issues: FactCheckIssue[] = Array.isArray(parsed.issues) ? parsed.issues.map((i: any) => {
    if (!i || typeof i !== 'object') return null
    const kind = ISSUE_KINDS.includes(i.kind) ? i.kind : 'other'
    const severity: FactCheckSeverity = SEVERITIES.includes(i.severity) ? i.severity : 'major'
    const claim = str(i.claim, 800)
    if (!claim) return null
    return {
      kind, severity, claim,
      location: i.location ? str(i.location, 200) : undefined,
      reason: str(i.reason, 800) || 'no reason provided',
      evidenceRefs: Array.isArray(i.evidenceRefs) ? i.evidenceRefs.filter((x: any) => typeof x === 'string').slice(0, 12) : [],
      suggestedCorrection: i.suggestedCorrection ? str(i.suggestedCorrection, 1000) : undefined,
    } as FactCheckIssue
  }).filter(Boolean).slice(0, 40) as FactCheckIssue[] : []

  // Deterministic backstop: append the numeric-audit issues so the
  // AI does not accidentally drop them. Dedup by claim substring.
  for (const na of numericAudit.issues) {
    const already = issues.some(i => i.kind === 'unsupported_numeric_claim' && i.claim.includes(na.token.raw))
    if (already) continue
    issues.push({
      kind: 'unsupported_numeric_claim',
      severity: 'major',
      claim: `Unsupported number: ${na.token.raw}`,
      location: na.token.location,
      reason: na.reason,
      evidenceRefs: [],
      suggestedCorrection: undefined,
    })
  }

  // Deterministic status. AI's own status is a suggestion; the code
  // decides. A pack whose quality is blocked cannot be "pass".
  let status: FactCheckStatus = 'pass'
  const anyCritical = issues.some(i => i.severity === 'critical')
  const anyMajor    = issues.some(i => i.severity === 'major')
  if      (anyCritical) status = 'fail'
  else if (anyMajor)    status = 'review_required'
  else                  status = 'pass'
  if (pack.quality.status === 'blocked' && status === 'pass') status = 'fail'

  return {
    version:            FACT_CHECK_VERSION,
    status,
    checkedAt:          new Date().toISOString(),
    packRecipe:         pack.recipe,
    issues,
    numericAudit,
    checkedStudioHash:  opts.checkedStudioHash,
    autoCheck:          opts.autoCheck,
  }
}

function str(v: unknown, cap: number): string { return typeof v === 'string' ? v.slice(0, cap) : '' }
