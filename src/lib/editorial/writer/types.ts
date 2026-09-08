// src/lib/editorial/writer/types.ts
//
// EIC Block 9 — canonical shapes for the Writer + Fact Checker.
//
// The AI Writer produces a structured WriterDraft (JSON), never
// TipTap. Deterministic server code assembles the actual Studio
// document from that plan. This gives us the boundary the spec
// requires:
//
//   AI decides editorial structure and prose
//   code decides valid document structure and data-block payloads

import type { DataBlockVariant } from '@/lib/studio/dataBlocks/types'

export const WRITER_DRAFT_VERSION = 1
export const WRITER_METADATA_VERSION = 1
export const FACT_CHECK_VERSION = 1

// ─────────────────────────────────────────────────────────────────
// WriterDraft — the AI's output shape
// ─────────────────────────────────────────────────────────────────

export type WriterHeadingLevel = 2 | 3

export type WriterSection = {
  id:            string
  heading?:      string
  headingLevel?: WriterHeadingLevel
  paragraphs:    string[]     // plain text; anchors are linkified server-side
  blockIntents:  BlockIntent[]
}

export type WriterDraft = {
  version:              typeof WRITER_DRAFT_VERSION
  headline:             string
  intro:                string
  seoTitle:             string
  seoDescription:       string
  sections:             WriterSection[]
  conclusion?:          string
  internalLinkIntents:  WriterLinkIntent[]
  externalLinkIntents:  WriterLinkIntent[]
  evidenceTrace:        WriterClaimTrace[]
}

export type WriterLinkIntent = {
  /** Internal path ("/insights/foo") or a URL from the pack's
   *  externalSources. Anything else is dropped at assembly time. */
  url:        string
  /** The exact anchor substring the Writer wants to link inside prose. */
  anchor:     string
  /** Optional: restrict linking to a particular section. */
  sectionId?: string
}

export type WriterClaimTrace = {
  sectionId:    string
  claim:        string
  evidenceRefs: string[]   // ids: 'fact-*', 'finding-*', 'table-*', 'source-*'
}

// ─────────────────────────────────────────────────────────────────
// Block intents — the Writer requests blocks; factories build them
// ─────────────────────────────────────────────────────────────────

export type BlockIntent =
  | { kind: 'methodology' }
  | { kind: 'stat_callout'; evidenceRefId: string; value: string; label: string; context?: string }
  | { kind: 'ranking_table'; sourceTableId: string; title?: string; intro?: string; limit?: number; columns?: string[] }
  | { kind: 'card_grid'; cardSlugs: string[]; title?: string }
  | { kind: 'card_block'; cardSlug: string; mode?: 'live' | 'snapshot' }
  | { kind: 'raw_psa_comparison'; cardSlugs: string[]; showRatios?: boolean; title?: string }
  | { kind: 'price_chart'; cardSlug: string; series: Array<'raw' | 'psa9' | 'psa10'>; days?: number; title?: string }

export function isBlockIntentKind(v: unknown): v is BlockIntent['kind'] {
  return typeof v === 'string' && ['methodology','stat_callout','ranking_table','card_grid','card_block','raw_psa_comparison','price_chart'].includes(v)
}

// ─────────────────────────────────────────────────────────────────
// Writer metadata (writer_json)
// ─────────────────────────────────────────────────────────────────

export type WriterUsage = {
  input_tokens:          number
  output_tokens:         number
  cache_creation_tokens: number
  cache_read_tokens:     number
  cost_usd:              number
  latency_ms:            number
}

export type WriterAssemblyWarning = {
  kind: 'dropped_block_intent' | 'dropped_link' | 'unsupported' | 'other'
  detail: string
}

export type WriterMetadata = {
  version:               typeof WRITER_METADATA_VERSION
  generatedAt:           string     // ISO datetime
  model:                 string
  researchId?:           number
  researchGeneratedAt?:  string     // pack.generatedAt when the Writer ran
  packRecipe?:           string
  claimTrace:            WriterClaimTrace[]
  blockIntents:          BlockIntent[]           // the intents that actually made it into the doc
  assemblyWarnings:      WriterAssemblyWarning[] // dropped-link / dropped-block traces
  factCheck?:            FactCheckResult
  checkedStudioHash?:    string
  generationCost:        WriterUsage
  styleRepairFired?:     boolean
  repairFired?:          boolean
  /** EIC two-stage external — short summary of what the check_and_fix
   *  stage changed (or "No changes needed."). Never a forensic list. */
  correctionsSummary?:   string
  /** EIC two-stage external — source URLs the research_and_write
   *  stage found via web_search, so the checker + downstream tooling
   *  can render sources without re-searching. */
  externalSourceUrls?:   string[]
  /** Block 9B — generation state machine.
   *  When present and not in {complete, failed}, generation is
   *  in progress and Studio should keep polling. When complete,
   *  the other fields on WriterMetadata are the authoritative
   *  final output. When failed, `run.error` explains why. */
  currentRun?:           GenerationRun
}

// ─────────────────────────────────────────────────────────────────
// Block 9B — generation stage machine (resumable)
// ─────────────────────────────────────────────────────────────────

export type GenerationStage =
  | 'queued'          // just created; next call transitions to first drafting stage
  | 'writer'          // LEGACY: single-shot Writer Claude call (kept for in-flight runs; not created for new runs)
  // Block 9C — Writer split. New runs use plan → part1 → part2 →
  // assemble so no single Claude call has to produce the entire
  // article at once (which was hitting Cloudflare's ~100s edge
  // idle limit on real 1,500-2,500-word external articles).
  | 'writer_plan'     // pending: small planning Claude call — headline + section outline + evidence assignment
  | 'writer_part1'    // pending: draft sections assignedTo=part1
  | 'writer_part2'    // pending: draft sections assignedTo=part2
  | 'writer_assemble' // pending: deterministic merge of plan + parts into one WriterDraft
  // EIC — external_research uses a single simple path. One Sonnet
  // call → tiny JSON → deterministic Markdown-to-TipTap. No plan,
  // no parts, no evidence-ref bookkeeping.
  | 'writer_external' // pending: single Sonnet call for external_research articles
  // EIC — external articles now use exactly TWO AI calls total, no
  // EvidencePack, no research approval gate. Everything else in
  // this file is legacy and stays only for internal-data articles
  // and for in-flight runs created under the old machines.
  | 'research_and_write' // pending: Sonnet + web_search researches AND drafts in one call
  | 'check_and_fix'      // pending: Sonnet + bounded web_search directly fixes meaningful issues
  | 'style'           // pending: style guard + optional style repair + assemble + numeric audit
  | 'fact_check'      // pending: Fact Checker Claude call
  | 'repair'          // pending: Writer repair Claude call + reassemble + re-audit
  | 'finalize'        // pending: Fact Checker on repaired doc + accept/revert repair
  | 'complete'
  | 'failed'

export type GenerationRun = {
  id:            string
  startedAt:     string
  updatedAt:     string
  stage:         GenerationStage
  stageLabel:    string
  /** Non-null when stage === 'failed'. */
  error?:        string
  /** On failure, which stage broke (mirrors the external-research
   *  run shape). Set by the runNextStage error handler. */
  failedStage?:  GenerationStage
  /** Preserved between stages so a poll can resume without redoing
   *  the previous Claude calls. Raw Writer text is 10-40 KB JSON. */
  rawWriterText?: string
  usage:         WriterUsage
  styleRepairFired: boolean
  repairFired:      boolean
  /** Per-stage timing telemetry so the report + UI can show real
   *  numbers rather than cosmetic ones. Milliseconds. */
  stageTimings:  Record<string, number>
  /** Block 9C — plan produced by stageWriterPlan and consumed by
   *  the two part stages + assembler. */
  plan?:          WriterPlan
  /** Block 9C — sections drafted in each part. Stored per part so a
   *  failed part2 retries without re-running part1. */
  part1Sections?: WriterSection[]
  part2Sections?: WriterSection[]
}

// ─────────────────────────────────────────────────────────────────
// Block 9C — Writer plan (produced by stageWriterPlan)
// ─────────────────────────────────────────────────────────────────

export type WriterPlanSection = {
  id:            string
  heading:       string | null
  headingLevel?: WriterHeadingLevel
  /** One-to-two-sentence guide telling the drafter what this
   *  section should cover. Not the article prose. */
  brief:         string
  /** Evidence ids (fact-*, finding-*, table-*, source-*) the drafter
   *  should reference in this section. Enables per-part evidence
   *  filtering so we don't resend the entire 44-source pack. */
  evidenceRefs:  string[]
  /** Block intents planned for this section — the drafter can extend
   *  or refine but should not remove them silently. */
  blockIntents:  BlockIntent[]
  /** Which drafting call produces this section. */
  assignedTo:    'part1' | 'part2'
}

export type WriterPlan = {
  headline:            string
  intro:               string
  seoTitle:            string
  seoDescription:      string
  sections:            WriterPlanSection[]
  /** When true, part2 is allowed (and encouraged) to emit a
   *  conclusion string. When false, no conclusion is generated. */
  hasConclusion:       boolean
  internalLinkIntents: WriterLinkIntent[]
  externalLinkIntents: WriterLinkIntent[]
}

// ─────────────────────────────────────────────────────────────────
// Fact Checker
// ─────────────────────────────────────────────────────────────────

export type FactCheckSeverity = 'critical' | 'major' | 'minor'

export type FactCheckIssueKind =
  | 'unsupported_numeric_claim'
  | 'unsupported_factual_claim'
  | 'rejected_claim_detected'
  | 'missing_required_caveat'
  | 'sample_scope_overstated'
  | 'external_source_misused'
  | 'quarantined_row_referenced'
  | 'inconsistent_with_evidence'
  | 'other'

export type FactCheckIssue = {
  kind:                 FactCheckIssueKind
  severity:             FactCheckSeverity
  claim:                string       // the offending sentence / phrase
  location?:            string       // sectionId or a rough path
  reason:               string
  evidenceRefs:         string[]
  suggestedCorrection?: string
}

export type FactCheckStatus = 'pass' | 'review_required' | 'fail'

export type FactCheckResult = {
  version:      typeof FACT_CHECK_VERSION
  status:       FactCheckStatus
  checkedAt:    string
  packRecipe?:  string
  issues:       FactCheckIssue[]
  numericAudit: NumericAuditResult
  /** Hash of the assembled bodyDoc the checker actually inspected.
   *  When Studio changes after this run, the top-level Studio UI
   *  shows "Fact check: Out of date". */
  checkedStudioHash: string
  /** True while the fact check was run automatically after Writer
   *  generation. Human-invoked checks set this false. */
  autoCheck:    boolean
}

// ─────────────────────────────────────────────────────────────────
// Numeric audit
// ─────────────────────────────────────────────────────────────────

export type NumericToken = {
  raw:      string          // exact substring, e.g. "$62,645"
  value:    number          // normalised numeric value
  kind:     'currency' | 'percent' | 'count' | 'ratio' | 'date' | 'other'
  location: string          // sectionId / path
}

export type NumericAuditIssue = {
  token:  NumericToken
  reason: string
  /** Best guess at what evidence value the Writer might have meant,
   *  useful for the repair prompt. */
  nearest?: { value: number; source: string }
}

export type NumericAuditResult = {
  status:  'pass' | 'review_required'
  checked: number       // total tokens extracted
  matched: number       // count that traced cleanly to evidence
  issues:  NumericAuditIssue[]
}
