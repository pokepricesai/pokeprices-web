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
