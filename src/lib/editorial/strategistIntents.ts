// src/lib/editorial/strategistIntents.ts
//
// Deterministic detection of "create / save / plan this" intents in
// the admin's Strategist chat message + extraction of the most recent
// article brief from the conversation history.
//
// The Strategist chat used to be pure text. When the admin asked it
// to actually create a project, the model would generate a confident
// "Added to editorial projects" reply without any DB write ever
// happening. This module lets the route detect a write intent
// deterministically (no AI call) and pair it with the last brief the
// model produced, so the server can perform the real mutation and
// respond with a grounded confirmation.

import { parseStrategistResponse, type StrategistRecommendation } from './strategistPrompt'
import type { EditorialArticleType } from './projects'
import { getEditorialMode } from './editorialMode'

export type StrategistWriteIntent = {
  kind: 'create'
  /** When the admin explicitly asks for planned status vs. an idea. */
  targetStatus: 'planned' | 'idea'
}

// ── Intent detection ──────────────────────────────────────────────

// Phrases that indicate the admin wants a real project write. Trigger
// words + verbs. Deliberately narrow to avoid false positives on
// discussion turns ("could we create..." is not an instruction).
const CREATE_PATTERNS: RegExp[] = [
  /\b(please\s+)?(create|make|add|save|plan|put|set\s+up|store|log)\b[^.]*\b(this|the|it|these|that)\b/i,
  /\b(please\s+)?(create|make|add|save|plan)\b\s*$/i,
  /\bsave\s+(this\s+)?(idea|article|brief|piece)\b/i,
  /\badd\s+(this\s+)?(to|as)\b/i,
  /\b(put|store)\s+(this\s+)?(in|into)\b/i,
  /\b(create|add|save|plan|log)\s+(this|it|the article|the brief|the idea)\b/i,
  /\bmake\s+this\s+(an?\s+)?(external|internal|planned)\b/i,
]

// Once we know the admin wants a write, decide whether it should be
// created as `planned` or `idea`. Phrases like "add to plan" imply
// planned. Phrases like "save as idea" / "backlog" imply idea.
const PLANNED_HINTS = /\b(plan|planned|pipeline|this\s+week|schedule)\b/i
const IDEA_HINTS    = /\b(idea|backlog|later|save\s+as\s+idea|save\s+idea)\b/i

/** A message that opens with an interrogative or auxiliary
 *  ("should we", "could we", "do you think", "what if") is a
 *  discussion turn, not an instruction — even if it contains verbs
 *  like "save" or "create". */
const INTERROGATIVE_LEAD = /^\s*(please\s+)?(do|does|did|should|could|would|can|will|shall|what|how|why|when|where|which|who|is|are|was|were|may|might)\b/i

export function detectStrategistWriteIntent(userMessage: string): StrategistWriteIntent | null {
  if (!userMessage || typeof userMessage !== 'string') return null
  const text = userMessage.trim()
  if (!text) return null
  // "Please" + interrogative is still an instruction ("please create
  // this"). Bare interrogative is not. Detect an interrogative that
  // is NOT immediately followed by "please" or a command verb.
  if (INTERROGATIVE_LEAD.test(text) && !/^\s*please\b/i.test(text)) return null
  const matches = CREATE_PATTERNS.some(rx => rx.test(text))
  if (!matches) return null
  // Prefer "planned" when either the plan-hint fires OR the message
  // says "make this an external article" (no explicit lifecycle) —
  // adding without a lifecycle is closer to planned than backlog on
  // this workflow. IDEA hints override.
  if (IDEA_HINTS.test(text) && !PLANNED_HINTS.test(text)) return { kind: 'create', targetStatus: 'idea' }
  return { kind: 'create', targetStatus: 'planned' }
}

// ── Brief extraction ─────────────────────────────────────────────

export type ExtractedBrief = {
  headline:             string
  angle:                string | null
  mode:                 'internal' | 'external'
  articleType:          EditorialArticleType
  whyNow?:              string
  whyUseful?:           string
  intent?:              string
  citationPotential?:   'high' | 'medium' | 'low'
  confidence?:          'high' | 'medium' | 'low'
  publishDayHint?:      string
  evidenceAvailable?:   string[]
  evidenceStillNeeded?: string[]
  visuals?:             string[]
  radarOpportunityId?:  string | null
  radarScore?:          number | null
  /** Which assistant turn (0-indexed) produced this brief. Purely
   *  diagnostic. */
  sourceTurnIndex?:     number
}

export type HistoryTurn = { role: 'user' | 'assistant'; content: string }

/** Walk the chat history from newest to oldest looking for the last
 *  assistant turn that produced a parseable StrategistRecommendation.
 *  Returns null when nothing matches. */
export function extractLatestBriefFromHistory(history: readonly HistoryTurn[]): ExtractedBrief | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]
    if (!turn || turn.role !== 'assistant') continue
    const parsed = parseStrategistResponse(String(turn.content ?? ''))
    if (!parsed.recommendations) continue
    const rec = parsed.recommendations.primary[0] ?? parsed.recommendations.alternatives[0]
    if (!rec) continue
    const built = briefFromRecommendation(rec)
    if (built) return { ...built, sourceTurnIndex: i }
  }
  return null
}

function briefFromRecommendation(rec: StrategistRecommendation): ExtractedBrief | null {
  const headline = rec.headline?.trim()
  if (!headline) return null
  const articleType = coerceArticleType(rec.suggestedArticleType, rec.mode)
  const mode = rec.mode ?? getEditorialMode({ article_type: articleType, title: headline, angle: rec.angle })
  return {
    headline,
    angle:                rec.angle?.trim() || null,
    mode,
    articleType,
    whyNow:               rec.whyNow || undefined,
    whyUseful:            rec.whyUseful || undefined,
    intent:               rec.searchOrEditorialIntent || undefined,
    citationPotential:    rec.citationPotential,
    confidence:           rec.confidence,
    publishDayHint:       rec.recommendedPublishDay || undefined,
    evidenceAvailable:    rec.evidenceAvailable?.length ? rec.evidenceAvailable : undefined,
    evidenceStillNeeded:  rec.evidenceStillNeeded?.length ? rec.evidenceStillNeeded : undefined,
    visuals:              rec.suggestedVisualsOrDataBlocks?.length ? rec.suggestedVisualsOrDataBlocks : undefined,
    radarOpportunityId:   rec.radarOpportunityId ?? null,
    radarScore:           rec.radarScore ?? null,
  }
}

/** Coerce a strategist-supplied article_type string to the canonical
 *  EditorialArticleType. Falls back to a lane-appropriate default
 *  when the string is missing or unknown. Never throws. */
function coerceArticleType(supplied: string | undefined | null, mode: 'internal' | 'external' | undefined): EditorialArticleType {
  const s = typeof supplied === 'string' ? supplied.trim().toLowerCase() : ''
  const KNOWN: EditorialArticleType[] = [
    'monthly_market_report','population_scarcity','data_study','market_analysis','price_analysis','grading_analysis','search_trends','movers',
    'upcoming_set','new_set','news','release_news','product_announcement','set_preview','evergreen_guide','external_research','evergreen',
  ]
  if (KNOWN.includes(s as EditorialArticleType)) return s as EditorialArticleType
  return mode === 'external' ? 'evergreen_guide' : mode === 'internal' ? 'data_study' : 'evergreen'
}

// ── Grounded confirmation message ────────────────────────────────

export function buildGroundedConfirmation(
  result:
    | { kind: 'created';   projectId: number; title: string; articleType: EditorialArticleType; mode: 'internal' | 'external'; status: string }
    | { kind: 'duplicate'; projectId: number; title: string; status: string }
    | { kind: 'no_brief' }
    | { kind: 'failed';    error: string },
): string {
  if (result.kind === 'created') {
    const typeLabel = result.articleType.replace(/_/g, ' ')
    const where = result.status === 'idea' ? 'Idea Backlog' : 'Pipeline'
    return `Added as ${result.status} ${result.mode} article. Project #${result.projectId}. Type: ${typeLabel}. It is now in ${where}.`
  }
  if (result.kind === 'duplicate') {
    return `That project already exists as #${result.projectId} ("${result.title}", status: ${result.status}). Nothing new was created.`
  }
  if (result.kind === 'no_brief') {
    return `I couldn't find a structured brief to create from this conversation. Ask me to propose the article as a recommendation first, then I can create it.`
  }
  return `I couldn't create the project: ${result.error}`
}
