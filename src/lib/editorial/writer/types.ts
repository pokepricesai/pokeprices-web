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
