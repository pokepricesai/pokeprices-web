// src/lib/editorial/strategistPrompt.ts
//
// EIC Block 5 — assembles the system prompt + compact structured
// context the Editorial Strategist consumes. Kept pure/deterministic
// so we can unit-test the assembly.
//
// The strategist's WORLD MODEL is exactly this file's output. It has
// no other view of PokePrices data. That is deliberate — the model
// must not invent prices, releases or previously-published articles
// from its own memory.

import type { EditorialContext, EditorialContextArticle } from './context'
import type { ReleaseItem } from './releaseContext'
import type { OpportunityRadar, Opportunity } from './opportunityRadar'

// ── Recommendation output schema ─────────────────────────────────
// This is the JSON contract the strategist must return on "recommend"
// requests. On free-form chat replies, the same shape is optional.

export type StrategistRecommendation = {
  headline:                    string
  angle:                       string
  whyNow:                      string
  whyUseful:                   string
  evidenceAvailable:           string[]
  evidenceStillNeeded:         string[]
  citationPotential:           'high' | 'medium' | 'low'
  searchOrEditorialIntent:     string
  suggestedVisualsOrDataBlocks: string[]
  existingContentOverlap:      { risk: 'high' | 'medium' | 'low' | 'none'; related: Array<{ slug: string; headline: string }> }
  recommendedPublishDay:       string   // e.g. 'Tuesday' or an ISO date
  confidence:                  'high' | 'medium' | 'low'
  suggestedArticleType?:       string
  radarOpportunityId?:         string | null   // when derived from a Radar item
  radarScore?:                 number | null
}

export type StrategistResponse = {
  assistantMessage:   string                            // free-form editorial commentary
  recommendations?:   {                                 // present on `recommend` mode; may be present on chat
    summary:          string                            // one-line "why these two" or "why only one" note
    primary:          StrategistRecommendation[]        // length 0, 1 or 2
    alternatives:     StrategistRecommendation[]        // 0..5
  }
  actions?:           StrategistActionHint[]            // small hints the UI may pre-fill
}

export type StrategistActionHint = {
  kind:    'plan'|'save_idea'|'combine'|'reject'|'discuss'
  message: string
}

// ── Prompt assembly ──────────────────────────────────────────────

const STATIC_SYSTEM_PROMPT = `You are the PokePrices Editorial Strategist — an internal senior editor + market researcher for pokeprices.io.

PokePrices is a UK-focused Pokémon TCG price and market-intelligence site. This is an internal admin conversation between you and Luke (the sole editor).

── Mission ─────────────────────────────────────────────────────
Publish two exceptional articles per week that:
  * attract organic search traffic
  * are genuinely useful to collectors
  * contain original PokePrices data where possible
  * become information other websites and AI systems can cite
  * strengthen internal links into card / set / species pages
  * establish PokePrices as a market-data authority

Prefer:
  * original data analysis (rankings, cohort studies, spreads)
  * monthly market reports
  * timely set analysis (launch guides, retrospectives)
  * upcoming-set guides
  * meaningful market trends with proper qualifiers
  * strong evergreen search opportunities

Downrank:
  * generic listicles
  * SEO filler
  * repetitive topics we have already covered
  * weak "investment picks" unsupported by data
  * sensational or unqualified claims

── Data-safety rules — non-negotiable ─────────────────────────
1. The Context and Radar payloads below are the ONLY authoritative
   PokePrices facts you may reason with. Do NOT invent card prices,
   release dates, PSA populations, article histories or trends from
   your own memory.

2. A data SIGNAL is not automatically a publishable factual claim.
   For example: a 32× median PSA10/raw multiple in a tracked subset
   of 135 cards is an interesting signal — it is NOT the claim
   "grading Pokémon cards makes them worth 32× more". Never upgrade
   a qualified signal to an unqualified headline.

3. Preserve every qualifier the Radar provides — "tracked subset",
   "sample of N", "high/medium/low confidence", "weak/medium/strong
   data strength", "unconfirmed release", etc.

4. If the card_trends surface is small (tens or a few hundred rows),
   describe results as covering "our tracked sample" or "high-
   confidence cards in the PokePrices sample" — never as "the whole
   Pokémon market".

5. When something IS worth publishing but needs more research, say
   so and put the specific missing pieces under "Evidence still
   needed".

── Voice ──────────────────────────────────────────────────────
Direct, confident, occasionally opinionated. British spelling.
Concise — internal working conversation, not marketing copy. No AI
filler ("Certainly!", "Great question!", "Let's dive in"). No fake
personal experience. No hype language. Use uncertainty freely when
the evidence supports it.

── How to use the Radar ──────────────────────────────────────
The Opportunity Radar gives you deterministic signals with scores.
Scores are useful inputs, not commands. You may recommend a lower-
scoring opportunity over a higher-scoring one when the editorial
case is stronger — but you must explain the reason. You may
recommend against a high-scoring Radar item if the evidence base
is too thin or coverage overlaps existing content.

── When to disagree with the user ──────────────────────────
This matters. Do not just obey. If Luke asks for something that:
  * has no evidence base
  * would duplicate existing content unnecessarily
  * would require inventing figures
  * would be a weaker use of a weekly slot than an available data-
    led alternative
then push back, explain why, and propose a stronger alternative.

If Luke rejects an idea in this conversation, remember and do not
re-recommend the same idea unless the underlying evidence has
changed.

── Output modes ────────────────────────────────────────────
The user turn will indicate one of two modes.

MODE = recommend
  Reply with a JSON object matching this TypeScript type:

  {
    "assistantMessage": string,     // 2–4 sentences of editorial framing
    "recommendations": {
      "summary": string,            // 1 sentence explaining the two picks or why only one
      "primary": Recommendation[],  // length 0, 1 or 2 — quality over quota
      "alternatives": Recommendation[] // up to 5 further ideas
    }
  }

  Where Recommendation = {
    "headline": string,
    "angle": string,
    "whyNow": string,
    "whyUseful": string,
    "evidenceAvailable": string[],       // grounded bullets, cite Radar/Context items by name
    "evidenceStillNeeded": string[],     // concrete gaps
    "citationPotential": "high"|"medium"|"low",
    "searchOrEditorialIntent": string,
    "suggestedVisualsOrDataBlocks": string[],
    "existingContentOverlap": { "risk": "high"|"medium"|"low"|"none", "related": [{ "slug": string, "headline": string }] },
    "recommendedPublishDay": string,     // "Tuesday" / "Friday" / ISO date
    "confidence": "high"|"medium"|"low",
    "suggestedArticleType": string,      // one of: monthly_market_report | new_set | upcoming_set | data_study | evergreen | market_analysis
    "radarOpportunityId": string|null,
    "radarScore": number|null
  }

  If there is only one genuinely strong data-led opportunity, put
  exactly ONE item in primary and say so in assistantMessage +
  summary. Do not force two.

  Wrap the entire JSON object in a fenced code block tagged with
  \`json\` so the client can parse it reliably.

MODE = chat
  Reply with a single JSON object:
  {
    "assistantMessage": string,          // your normal reply
    "recommendations": { ... } | null,   // include when you are updating the primary/alternatives list
    "actions": [ ... ] | null            // optional small hints
  }
  Same fenced-json convention. If you are only chatting (no changes
  to the recommendations list), set "recommendations": null.

── Boundaries ────────────────────────────────────────────
You do NOT write finished articles in this conversation. You produce
titles, angles, evidence checklists, visual recommendations, and
editorial judgement calls. Article drafting is a separate future
step that will consume your recommendations.`

const CENTS_TO_USD = 100

// ── Public entry point ──────────────────────────────────────────

export type BuildStrategistPromptOptions = {
  rejectedRadarIds?: readonly string[]
  rejectedTitleHashes?: readonly string[]
}

export type StrategistPromptBundle = {
  system:      string
  contextJson: string   // stringified so the model sees exactly what we send
}

export function buildStrategistSystemPrompt(
  context: EditorialContext,
  radar: OpportunityRadar,
  options: BuildStrategistPromptOptions = {},
): StrategistPromptBundle {
  const compact = compactContextForModel(context, radar, options)
  const contextJson = JSON.stringify(compact, null, 2)
  const system = `${STATIC_SYSTEM_PROMPT}

── PokePrices Editorial Context (authoritative — do not invent additions) ──

\`\`\`json
${contextJson}
\`\`\`
`
  return { system, contextJson }
}

// ── Context compaction ──────────────────────────────────────────

function compactContextForModel(
  context: EditorialContext,
  radar: OpportunityRadar,
  options: BuildStrategistPromptOptions,
) {
  const rejectedRadarIds = new Set(options.rejectedRadarIds ?? [])
  return {
    today: context.meta.today,
    weeklyGoal: 'two exceptional articles per week',
    editorialLibrary: context.articles.map(compactArticle),
    editorialProjects: context.projects.map(p => ({
      id:              p.id,
      title:           p.title,
      angle:           p.angle,
      articleType:     p.articleType,
      status:          p.status,
      priority:        p.priority,
      targetPublishAt: p.targetPublishAt,
      insightsId:      p.insightsId,
    })),
    thisWeekPlanned: context.projects
      .filter(p => p.targetPublishAt && p.status !== 'archived' && p.status !== 'published' && isInCurrentWeekIso(p.targetPublishAt, context.meta.today))
      .map(p => ({ id: p.id, title: p.title, targetPublishAt: p.targetPublishAt, status: p.status })),
    release: {
      windowDaysBack:    context.release.windowDaysBack,
      windowDaysForward: context.release.windowDaysForward,
      recent:            context.release.recent.map(compactRelease),
      upcoming:          context.release.upcoming.map(compactRelease),
      upcomingCoverageIsThin: context.release.upcomingCoverageIsThin,
      gapNote:           context.release.gapNote,
    },
    summary: context.summary,
    radar: {
      generatedAt:         radar.meta.generatedAt,
      dataFreshness:       radar.meta.dataFreshness,
      detectorsRun:        radar.meta.detectorsRun,
      detectorsSuppressed: radar.meta.detectorsSuppressed,
      opportunities: radar.opportunities
        .filter(o => !rejectedRadarIds.has(o.id))
        .map(compactOpportunity),
      rejectedIdsThisSession: Array.from(rejectedRadarIds),
    },
  }
}

function compactArticle(a: EditorialContextArticle) {
  return {
    slug:            a.slug,
    headline:        a.headline,
    intro:           a.intro,
    publishedAt:     a.publishedAt,
    themeLabel:      a.themeLabel,
    setRefs:         a.setRefs,
    cardRefs:        a.cardRefs,
    wordCount:       a.wordCount,
    bodyExcerpt:     a.bodyExcerpt,
    publicUrl:       a.publicUrl,
  }
}

function compactRelease(r: ReleaseItem) {
  return {
    setName:       r.setName,
    altSetNames:   r.altSetNames,
    setCode:       r.setCode,
    releaseDate:   r.releaseDate,
    jpReleaseDate: r.jpReleaseDate,
    region:        r.region,
    confirmed:     r.confirmed,
    cardCount:     r.cardCount,
    daysDelta:     r.daysDelta,
    pokePricesSetUrl: r.pokePricesSetUrl,
    sources:       r.sources,
    coverage:      r.coverage,
    timingOpportunities: r.timingOpportunities.filter(o => o.applicable),
    notes:         r.notes,
  }
}

function compactOpportunity(o: Opportunity) {
  return {
    id:                  o.id,
    kind:                o.kind,
    headlineSuggestion:  o.headlineSuggestion,
    angle:               o.angle,
    whyNow:              o.whyNow,
    score:               o.score,
    scoreReasons:        o.scoreReasons,
    dataStrength:        o.dataStrength,
    citationPotential:   o.citationPotential,
    suggestedArticleType: o.suggestedArticleType,
    suggestedTiming:     o.suggestedTiming,
    relatedSets:         o.relatedSets,
    relatedCards:        o.relatedCards.slice(0, 8),
    metrics:             o.metrics,
    evidenceSummary:     o.evidenceSummary,
    overlap:             o.overlap,
    visuals:             o.visuals,
  }
}

function isInCurrentWeekIso(dateIso: string, todayIso: string): boolean {
  const t = new Date(todayIso + 'T00:00:00Z')
  const monDelta = (t.getUTCDay() + 6) % 7
  const start = new Date(t); start.setUTCDate(t.getUTCDate() - monDelta)
  const end   = new Date(start); end.setUTCDate(start.getUTCDate() + 6)
  return dateIso >= start.toISOString().slice(0, 10) && dateIso <= end.toISOString().slice(0, 10)
}

// ── Response parsing ────────────────────────────────────────────
//
// Extracts a fenced ```json block; falls back to the whole message
// if no fence found. Silently returns the free-form assistantMessage
// when the model doesn't emit structured output.

export function parseStrategistResponse(rawText: string): StrategistResponse {
  const fenceMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/)
  const jsonText = fenceMatch ? fenceMatch[1] : rawText
  try {
    const parsed = JSON.parse(jsonText)
    if (parsed && typeof parsed === 'object') {
      const msg = typeof parsed.assistantMessage === 'string' ? parsed.assistantMessage : ''
      const recs = parsed.recommendations && typeof parsed.recommendations === 'object'
        ? {
            summary:      String(parsed.recommendations.summary ?? ''),
            primary:      sanitiseRecs(parsed.recommendations.primary),
            alternatives: sanitiseRecs(parsed.recommendations.alternatives),
          }
        : undefined
      const actions = Array.isArray(parsed.actions) ? parsed.actions.filter(isValidAction) : undefined
      return { assistantMessage: msg || rawText.replace(/```json[\s\S]*?```/, '').trim(), recommendations: recs, actions }
    }
  } catch { /* fall through */ }
  // No parsable JSON — treat the whole thing as an assistant message.
  return { assistantMessage: rawText.trim() }
}

function sanitiseRecs(raw: unknown): StrategistRecommendation[] {
  if (!Array.isArray(raw)) return []
  const out: StrategistRecommendation[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const rr = r as any
    if (typeof rr.headline !== 'string' || !rr.headline.trim()) continue
    out.push({
      headline:                    String(rr.headline),
      angle:                       String(rr.angle ?? ''),
      whyNow:                      String(rr.whyNow ?? ''),
      whyUseful:                   String(rr.whyUseful ?? ''),
      evidenceAvailable:           toStringArray(rr.evidenceAvailable),
      evidenceStillNeeded:         toStringArray(rr.evidenceStillNeeded),
      citationPotential:           coerceEnum(rr.citationPotential, ['high','medium','low'] as const, 'medium'),
      searchOrEditorialIntent:     String(rr.searchOrEditorialIntent ?? ''),
      suggestedVisualsOrDataBlocks: toStringArray(rr.suggestedVisualsOrDataBlocks),
      existingContentOverlap: {
        risk: coerceEnum(rr.existingContentOverlap?.risk, ['high','medium','low','none'] as const, 'none'),
        related: Array.isArray(rr.existingContentOverlap?.related)
          ? rr.existingContentOverlap.related
              .filter((x: any) => x && typeof x === 'object')
              .map((x: any) => ({ slug: String(x.slug ?? ''), headline: String(x.headline ?? '') }))
          : [],
      },
      recommendedPublishDay:       String(rr.recommendedPublishDay ?? ''),
      confidence:                  coerceEnum(rr.confidence, ['high','medium','low'] as const, 'medium'),
      suggestedArticleType:        typeof rr.suggestedArticleType === 'string' ? rr.suggestedArticleType : undefined,
      radarOpportunityId:          rr.radarOpportunityId ? String(rr.radarOpportunityId) : null,
      radarScore:                  typeof rr.radarScore === 'number' ? rr.radarScore : null,
    })
  }
  return out
}

function isValidAction(a: unknown): a is StrategistActionHint {
  return !!a && typeof a === 'object'
    && ['plan','save_idea','combine','reject','discuss'].includes((a as any).kind)
    && typeof (a as any).message === 'string'
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter(x => typeof x === 'string' && x.trim()).map(String)
}
function coerceEnum<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return (typeof v === 'string' && (options as readonly string[]).includes(v)) ? v as T : fallback
}
