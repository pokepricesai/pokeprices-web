// src/lib/editorial/research/types.ts
//
// EIC Block 6 — canonical shapes for the Research & Evidence Engine.
//
// One EvidencePack per project (deterministic, snapshot).
// One ResearchAnalysis per pack version (AI interpretation).
//
// These types are the contract between:
//   * research recipes (populationScarcity, monthlyMarketReport, ...)
//   * the Research Analyst prompt
//   * the Research Room UI
//   * the editorial_research table (evidence_json / analyst_json)
//
// Do not evolve these types without bumping `version` and handling
// old rows in the loaders.

export type ResearchRecipeId =
  | 'population_scarcity'
  | 'monthly_market_report'
  | 'external_research'
  | 'generic_fallback'

export type ResearchStatus =
  | 'not_started'
  | 'gathering'
  | 'review_required'
  | 'blocked'
  | 'approved'

// ─────────────────────────────────────────────────────────────────
// EvidencePack — the deterministic snapshot
// ─────────────────────────────────────────────────────────────────

export type EvidencePack = {
  version:     1
  recipe:      ResearchRecipeId
  project:     PackProjectRef
  generatedAt: string   // ISO datetime this snapshot was built
  dataAsOf:    string   // ISO date the underlying data represents

  methodology: PackMethodology

  verifiedFacts:       VerifiedFact[]
  derivedFindings:     DerivedFinding[]
  dataTables:          DataTable[]

  internalSources:     InternalSource[]
  externalSources:     ExternalSource[]
  internalLinks:       InternalLink[]
  visualOpportunities: string[]

  warnings:            Warning[]
  researchGaps:        string[]
  rejectedClaims:      RejectedClaim[]
  notes:               ResearchNote[]

  /** Block 6B — rows the recipe considered but excluded from every
   *  publishable table because they fail a deterministic integrity
   *  check (contradiction between data sources, implausible movement,
   *  identity mismatch). Kept in the pack so reviewers can see what
   *  was removed and why. Never enters `dataTables[].rows`. */
  quarantinedRows:     QuarantineEntry[]

  quality:             PackQuality

  /** Final Cleanup — story-strength signal for monthly reports.
   *  Optional; only monthlyMarketReport populates it today. */
  marketSignalStrength?: MarketSignalStrength
  marketSignalReason?:   string

  /** Final Data Trust Patch — human-approved large movers survive
   *  into the Writer as if they were high-confidence. Stored on
   *  the pack itself so the Research Room can add/remove them and
   *  the approval travels with the evidence. Rebuilds reset it. */
  approvedLargeMoverSlugs?: string[]

  /** External Research Fix — a bounded list of article-specific
   *  research questions the external Research Analyst answered (or
   *  tried to). Persists across rebuilds so reviewers can re-run
   *  discovery against a stable brief. */
  researchQuestions?: string[]

  /** External Research Fix — sourced positions that disagree on a
   *  release-critical claim. The Writer must surface, not silently
   *  pick, when this list is non-empty. */
  contradictions?: ClaimContradiction[]

  /** External Research Fix — telemetry from the last web-research
   *  run. Powers the "Research checked X days ago" UI and the
   *  preflight staleness warning. Undefined = never researched. */
  webResearch?: WebResearchMeta

  /** External Research Fix v3 — in-flight or last-completed staged
   *  research run. Persists between stages so a browser refresh can
   *  resume without re-spending already-completed searches. Cleared
   *  is fine on 'complete' + subsequent Rebuild. */
  externalResearchRun?: ExternalResearchRun

  /** External Research Fix v5 — human-facing synthesis of the
   *  external research run. Derived from run.primaryText +
   *  run.supportingText at finalize time (no AI call). What editors
   *  actually read to make an approval decision. */
  researchSummary?: string

  /** External Research Fix v5 — optional structured findings, only
   *  populated when the Advanced Re-extract runs the Haiku
   *  extractor. Not required for approval; useful for future
   *  downstream tooling. */
  researchFindings?: {
    confirmed:        string[]
    reportedOrLikely: string[]
    unknown:          string[]
  }
}

export type SourceTier = 1 | 2 | 3

export type FactStatus = 'confirmed' | 'reported' | 'rumored' | 'unverified'

// ─────────────────────────────────────────────────────────────────
// External Research Fix v3 — resumable stage machine
// ─────────────────────────────────────────────────────────────────
//
// The single-request "Research web" flow (~102s on the first live
// run) hit Cloudflare's edge idle limit and returned HTTP 524 on the
// second production attempt. This mirrors the Writer's Block 9B fix:
// split into bounded stages, persist state per stage, poll from the
// UI. Each stage does AT MOST one Claude call and completes well
// under any Vercel plan's ceiling.

export type ExternalResearchStage =
  | 'queued'
  | 'researching_primary'
  | 'researching_supporting'
  | 'extracting'
  | 'finalizing'
  | 'complete'
  | 'failed'

export type ExternalResearchRun = {
  id:          string
  stage:       ExternalResearchStage
  stageLabel:  string
  startedAt:   string
  updatedAt:   string
  /** Cumulative telemetry across every stage of THIS run. */
  searchesUsed: number
  costUsd:      number
  tokens: {
    input:  number
    output: number
  }
  /** Sources accumulated across primary + supporting stages. Merged
   *  into pack.externalSources during finalize. */
  discoveredSources: ExternalSource[]
  /** Bounded raw prose from each research stage — used by the
   *  extractor to build structured facts without hitting the web
   *  again. Bounded ~30KB per stage. */
  primaryText?:    string
  supportingText?: string
  /** Structured evidence produced by the extraction stage. */
  extractedFacts?:          VerifiedFact[]
  extractedContradictions?: ClaimContradiction[]
  extractedQuestions?:      string[]
  extractedGaps?:           string[]
  /** Per-stage wall-clock in ms. */
  stageTimings: Partial<Record<ExternalResearchStage, number>>
  /** On failure, which stage broke + concise reason. */
  failedStage?: ExternalResearchStage
  error?:       string
  /** External Research Fix v4 — extractor diagnostics from the most
   *  recent extraction stage of THIS run. Mirrored onto
   *  webResearch.extractionDiagnostics at finalize. */
  extractionDiagnostics?: ExtractionDiagnostics
}

export type WebResearchMeta = {
  researchedAt: string
  searchesUsed: number
  costUsd:      number
  model:        string
  latencyMs?:   number
  /** External Research Fix v2 — bounded raw text of the primary
   *  web-research call, so a later fact-extraction fallback can
   *  re-parse without hitting the web again. Truncated to ~30KB. */
  responsePreview?: string
  /** External Research Fix v2 — true when the Haiku fact-extraction
   *  fallback ran on top of the primary call. Adds a small extra
   *  entry to costUsd. */
  fallbackUsed?: boolean
  /** External Research Fix v2 — cost of the fallback call, if any. */
  fallbackCostUsd?: number
  /** External Research Fix v2 — Haiku model id used for fallback. */
  fallbackModel?: string
  /** External Research Fix v4 — extractor diagnostics from the most
   *  recent extraction pass (staged run or standalone re-extract).
   *  Powers the Advanced diagnostics panel and turns "44 sources → 0
   *  facts" into an inspectable dropout report. */
  extractionDiagnostics?: ExtractionDiagnostics
}

// ─────────────────────────────────────────────────────────────────
// External Research Fix v4 — extractor diagnostics
// ─────────────────────────────────────────────────────────────────
//
// Persisted after every fact-extraction pass so a future "N sources
// → 0 facts" failure is immediately explainable. Stable IDs (idMap)
// are the biggest reliability lever — Haiku must reproduce them
// exactly in evidenceRefs; drift-tolerant field aliases handle small
// schema deviations that used to silently drop the whole result.

export type ExtractionDiagnostics = {
  /** ISO timestamp of when this extraction ran. */
  timestamp:                  string
  /** Character length of the user turn passed to the extractor. */
  extractorInputChars:        number
  /** Number of facts the extractor emitted in JSON before validation. */
  extractorRawFactCount:      number
  /** Facts that survived evidenceRef validation. */
  extractorAcceptedFactCount: number
  /** Facts dropped because at least one evidenceRef did not resolve
   *  to a known source id. */
  extractorRejectedFactCount: number
  /** Per-fact rejection notes (bounded). */
  rejectionReasons:           Array<{ factId?: string; refs: string[]; reason: string }>
  /** Bounded raw text of the extractor response for admin inspection. */
  rawResponsePreview:         string
  /** The stable ids we passed in to the extractor, paired with the
   *  original persistent source ids, so an admin can decode the
   *  mapping when reading raw extractor output. */
  idMap:                      Array<{ stableId: string; originalId: string; url: string }>
  /** Which schema variants the parser accepted from the response, if
   *  the model drifted from the canonical field names. */
  fieldAliasesHit?:           string[]
}

export type ClaimContradiction = {
  id:        string
  /** Human-readable claim under dispute, e.g. "Release date". */
  claim:     string
  /** Each disagreeing position with the source(s) that support it. */
  positions: Array<{ statement: string; evidenceRefs: string[] }>
  note?:     string
}

export type MarketSignalStrength = 'strong' | 'moderate' | 'weak'

export type QuarantineReason =
  | 'zero_pop_with_price'
  | 'extreme_monthly_move'
  | 'identity_unverified'
  | 'other'

export type QuarantineEntry = {
  id:                     string
  /** Which data table this row would have belonged to. Reviewers use
   *  this to locate what the row is meant to say. */
  wouldHaveJoined:        string
  reason:                 QuarantineReason
  severity:               'critical' | 'major' | 'minor'
  /** Human-readable one-liner shown in the UI. */
  message:                string
  /** The row itself as it would have appeared, so the reviewer can
   *  see the actual numbers without having to re-run the recipe. */
  rowSnapshot:            Record<string, string | number | null>
  /** When TRUE, an approved pack that intends to use this table CAN
   *  still ship because the row was cleanly isolated. When FALSE, the
   *  approval gate refuses until the contradiction is resolved. Set
   *  by the recipe based on whether the row is a passive contaminant
   *  (top-mover artifact) or a load-bearing contradiction (identity
   *  collision on a card the article names). */
  contaminatesPublishable: boolean
}

export type PackProjectRef = {
  id:              number
  title:           string
  articleType:     string
  angle:           string | null
  targetPublishAt: string | null
}

export type PackMethodology = {
  /** Human-readable narrative of exactly how the sample was selected. */
  summary:        string
  /** Machine-readable filter list, one per constraint. */
  filters:        Array<{ label: string; value: string }>
  /** Groups explicitly excluded from the sample and why. */
  excludedGroups: Array<{ label: string; reason: string }>
  /** How rows were deduplicated (which column/composite key). */
  dedupKey:       string
}

// A statement whose truth is directly readable from a specific data
// source or external citation. Not interpretation.
export type VerifiedFact = {
  id:            string
  type:          'verified_fact'
  statement:     string
  evidenceRefs:  string[]  // ids into dataTables / internalSources / externalSources
  asOf?:         string
  /** External Research Fix — quality signal on externally-sourced
   *  facts. Missing on internal-data facts. */
  sourceTier?:   SourceTier
  /** External Research Fix — factual status. 'confirmed' when at
   *  least one Tier-1 source or two independent Tier-2 sources
   *  support it; 'reported' for single Tier-2 sourcing; 'rumored'
   *  for community-tier claims; 'unverified' for anything the
   *  Analyst could not corroborate. */
  status?:       FactStatus
}

// A deterministic calculation from verified facts. Includes the
// formula so a future reviewer can recompute.
export type DerivedFinding = {
  id:            string
  type:          'derived_finding'
  statement:     string
  formula?:      string
  evidenceRefs:  string[]
  asOf?:         string
}

export type DataTableColumn = {
  key:    string
  label:  string
  align?: 'left' | 'right'
  hint?:  string
}

export type DataTable = {
  id:      string
  title:   string
  columns: DataTableColumn[]
  rows:    Array<Record<string, string | number | null>>
  source:  string   // "psa_population + card_trends", etc
  asOf:    string
  note?:   string
}

export type InternalSource = {
  id:       string
  kind:     'internal'
  label:    string
  table:    string
  rpc?:     string
  filters?: string
  asOf:     string
  rowCount?: number
  note?:    string
}

export type ExternalSource = {
  id:               string
  kind:             'external'
  url:              string
  title:            string
  publisher?:       string
  publicationDate?: string
  note?:            string
  supportsFactId?:  string
  addedAt:          string
  addedBy?:         string
  /** External Research Fix — 'manual' (human-attached, survives
   *  rebuild) or 'web' (discovered by the web-research call, may be
   *  replaced on a fresh discovery run). Missing = treat as manual
   *  for back-compat with pre-fix rows. */
  origin?:          'manual' | 'web'
  /** External Research Fix — source-authority tier (1 authoritative,
   *  2 specialist, 3 supporting). Set on discovered sources by the
   *  external Analyst; set on manual sources by an optional editor
   *  choice. */
  sourceTier?:      SourceTier
  /** External Research Fix — marked TRUE by the recipe when this
   *  manual source was used as a seed for a web-research run. */
  isSeed?:          boolean
}

export type InternalLink = {
  label: string
  slug:  string
  url:   string
}

export type Warning = {
  id:       string
  severity: 'critical' | 'major' | 'minor' | 'info'
  message:  string
  affects?: string
}

export type RejectedClaim = {
  claim:  string
  reason: string
}

export type ResearchNote = {
  id:      string
  addedAt: string
  addedBy?: string
  body:    string
}

export type PackQuality = {
  status:       'ok' | 'needs_review' | 'weak' | 'blocked'
  dataStrength: 'strong' | 'medium' | 'weak'
  sampleSize:   number
  freshness: {
    asOf:    string
    daysOld: number
    isStale: boolean
  }
  publishable:  boolean   // must be false when status = 'blocked'
  reasons:     string[]
}

// ─────────────────────────────────────────────────────────────────
// ResearchAnalysis — AI Analyst output
// ─────────────────────────────────────────────────────────────────

export type PublishRecommendation =
  | 'ready'
  | 'ready_with_caveats'
  | 'more_research_needed'
  | 'blocked'

export type ResearchAnalysis = {
  version:         1
  generatedAt:     string
  packRecipe:      ResearchRecipeId
  packGeneratedAt: string   // invalidates automatically if the pack is rebuilt

  summary:              string
  strongestFindings:    Array<{ finding: string; reason: string }>
  weakerFindings:       Array<{ finding: string; reason: string }>
  contradictions:       Array<{ description: string; involves: string[] }>
  missingResearch:      string[]
  recommendedAngle:     string
  headlineCandidates:   string[]
  requiredCaveats:      string[]
  unresolvedQuestions:  string[]
  recommendedVisuals:   string[]
  publishRecommendation:        PublishRecommendation
  publishRecommendationReasons: string[]

  usage?: {
    input_tokens:  number
    output_tokens: number
    cost_usd:      number
    latency_ms:    number
  }
}

// ─────────────────────────────────────────────────────────────────
// editorial_research row shape (server-side)
// ─────────────────────────────────────────────────────────────────

export type EditorialResearchRow = {
  id:           number
  project_id:   number
  status:       ResearchStatus
  evidence_json: EvidencePack | null
  analyst_json:  ResearchAnalysis | null
  approved_at:  string | null
  approved_by:  string | null
  created_at:   string
  updated_at:   string
}
