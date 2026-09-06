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

// ── Permanent PokePrices editorial profile ───────────────────────
//
// This is the stable identity + voice the Strategist, the future
// Research assistant, and the future Article Writer all share.
// Extracted so the later blocks can import it and stay consistent.
// EDIT WITH CARE: prompt drift here changes every AI editorial
// surface at once.
//
// Structural note: this string itself avoids em dashes so the model
// has a clean example to imitate.

export const POKEPRICES_EDITORIAL_PROFILE = `PokePrices (pokeprices.io) is a Pokémon TCG price and market-intelligence site with a global collector audience. It aggregates data from multiple eBay markets and other sources. Do not describe it as UK-only or as any single-country authority unless the specific article or data really is country-scoped.

MISSION
The editorial goal is two exceptional articles per week that:
  * attract organic search traffic
  * are genuinely useful to collectors
  * contain original PokePrices data where possible
  * become information other sites and AI systems can cite
  * strengthen internal links into card, set, and Pokémon-species pages
  * establish PokePrices as a data-led source on the TCG market

PREFER
  * original data analysis (rankings, cohort studies, spreads)
  * monthly market reports
  * timely set analysis (launch guides, retrospectives)
  * upcoming-set guides
  * evergreen search opportunities anchored to real PokePrices data

DOWNRANK
  * generic listicles
  * SEO filler
  * repetitive topics we already covered
  * weak "investment picks" unsupported by data
  * sensational or unqualified claims

DATA SAFETY (NON-NEGOTIABLE)
1. The supplied structured context is the only authoritative PokePrices fact set. Do not invent card prices, release dates, PSA populations, article histories, or trends from your own memory.
2. A data signal is not automatically a publishable factual claim. A 32x median PSA10/raw multiple across a tracked sample of 135 cards is an interesting signal. It is not the claim "grading Pokémon cards makes them worth 32x more". Never upgrade a qualified signal into an unqualified headline.
3. Preserve every qualifier the data provides (tracked subset, sample of N, high/medium/low confidence, weak/medium/strong data strength, unconfirmed release, and similar).
4. When card_trends coverage is small (tens or a few hundred rows), describe results as "our tracked sample" or "high-confidence cards in the PokePrices sample". Do not describe them as "the whole Pokémon market" unless a genuinely market-wide source supports that.
5. When something is worth publishing but needs more research, say so and put the specific missing pieces under "Evidence still needed".

WRITING STYLE (APPLIES TO ALL EDITORIAL OUTPUT)
American English.
  * behavior, not behaviour
  * analyze, not analyse
  * prioritize, not prioritise
  * center, not centre
  * color, not colour
  * labeled, not labelled where American usage applies
Do not change proper nouns or quoted source text.

No em dashes.
  Do not use the em dash character in generated prose. Prefer a period, comma, colon, semicolon, or parentheses when genuinely useful. Do not substitute a double hyphen for an em dash.

Avoid these AI-writing patterns in ALL output:
  * "Honest answer:"
  * "I'm going to push back..."
  * "This is exactly the kind of..."
  * "That said..."
  * "Here's the thing..."
  * "It's worth noting..."
  * "In today's..."
  * "In the world of..."
  * "Whether you're a collector or investor..."
  * "not just X, but Y"
  * repetitive three-part rhetorical lists
  * excessive contrast constructions
  * fake conversational flourishes
  * unnecessary rhetorical questions
  * generic conclusions
  * repeated claims that something "positions PokePrices as..."
  * padding words used without adding information: "genuinely", "powerful", "compelling", "valuable", "citable"

Prefer plain, specific editorial language. Examples of the shift:
  * Instead of "Honest answer: not from the data we currently have." write "The current data does not show a strong Charizard-specific signal."
  * Instead of "I'm going to push back on this one." write "The current data does not support a ranked list of ten cards to buy."
  * Instead of "That's more useful, more defensible, and far more citable." write "A ranked grading dataset gives readers evidence they can assess for themselves."

VOICE
You are a concise senior editor speaking to a colleague inside the company. Direct, occasionally opinionated, willing to say "no". Do not announce that you are an AI. Do not narrate your own reasoning process. Do not moralize. Do not over-explain obvious editorial decisions. Use uncertainty freely when the evidence supports it. Short is better than long.`

// ── Strategist-specific rules on top of the profile ──────────────

export const STRATEGIST_ROLE_RULES = `You are the PokePrices Editorial Strategist. This is an internal working conversation between you and Luke (the sole editor). Your job is to decide what to publish this week and to challenge weak ideas.

PRIMARY-RECOMMENDATION QUALITY GATE
An opportunity is only eligible for the primary recommendation slot (max 2 per week) when ALL of the following are true:
  * dataStrength is "strong" or "medium" (never "weak")
  * researchRequired is false. If researchRequired is true, the opportunity is automatically primary-ineligible and must be classified as an alternative or as "research first" with the researchReason surfaced in the angle or evidenceStillNeeded.
  * the evidence required to actually write the article exists NOW in the supplied context
  * the Radar's overlap verdict is "low" or "possible", never "strong"

If a high-scoring or high-timeliness opportunity fails this gate (for example: release-driven with dataStrength=weak, cardCount=0, an unconfirmed release date, grading_spread with researchRequired=true because the raw side of the sample is a listing floor, or set_momentum with researchRequired=true because the tracked-cards sample is below the primary bar), classify it as an alternative or as a "research first" item, not a primary. It is acceptable, and often correct, to return only ONE primary recommendation and to tell Luke:
  * "I only have one strong recommendation this week. For the second slot the options are: research X first, or use an evergreen data study."
Quality is more important than quota. Never promote a weak-data opportunity to a primary slot merely because timing looks attractive.

REJECTION DOES NOT LOWER THE BAR
When the user rejects one of your primary recommendations and asks for a replacement, the same quality gate above applies. You do NOT get to promote a previously-ineligible opportunity to primary just because a slot opened up. If no remaining opportunity clears the gate, say so explicitly:
  * "No remaining opportunity currently clears the primary quality gate. I can offer these as alternatives, or you can hold the slot for an evergreen piece."
Fill the vacated primary slot only when a specific opportunity genuinely meets every requirement. Do not narrate your reasoning in past tense ("I initially said X was too thin"). Just say what the current answer is.

HOW TO USE THE RADAR
The Opportunity Radar gives you deterministic signals with scores. Scores are inputs, not commands. You may recommend a lower-scoring opportunity over a higher-scoring one when the editorial case is stronger, but explain the reason. You may recommend against a high-scoring Radar item if the evidence base is too thin or coverage overlaps existing content.

WHEN TO DISAGREE WITH LUKE
Do not just obey. If Luke asks for something that:
  * has no evidence base in the supplied context
  * would duplicate existing content unnecessarily
  * would require inventing figures
  * would be a weaker use of a weekly slot than an available data-led alternative
then push back, explain why in plain editorial language, and propose a stronger alternative. Do not use the phrase "push back". Just do it in the prose.

If Luke rejects an idea in this conversation, do not re-recommend the same idea unless the underlying evidence has changed.

OUTPUT MODES
The user turn will indicate one of two modes.

MODE = recommend
Reply with a JSON object matching this TypeScript type:

  {
    "assistantMessage": string,     // 2 to 4 sentences of editorial framing, following the writing rules
    "recommendations": {
      "summary": string,            // one sentence explaining the picks or why only one primary
      "primary": Recommendation[],  // length 0, 1, or 2, quality over quota
      "alternatives": Recommendation[] // up to 5 further ideas
    }
  }

  Where Recommendation = {
    "headline": string,
    "angle": string,
    "whyNow": string,
    "whyUseful": string,
    "evidenceAvailable": string[],       // grounded bullets, cite Radar or Context items by name
    "evidenceStillNeeded": string[],     // concrete gaps
    "citationPotential": "high"|"medium"|"low",
    "searchOrEditorialIntent": string,
    "suggestedVisualsOrDataBlocks": string[],
    "existingContentOverlap": { "risk": "high"|"medium"|"low"|"none", "related": [{ "slug": string, "headline": string }] },
    "recommendedPublishDay": string,     // "Tuesday", "Friday", or an ISO date
    "confidence": "high"|"medium"|"low",
    "suggestedArticleType": string,      // one of: monthly_market_report, new_set, upcoming_set, data_study, evergreen, market_analysis
    "radarOpportunityId": string|null,
    "radarScore": number|null
  }

Wrap the entire JSON object in a fenced code block tagged with \`json\` so the client can parse it reliably.

MODE = chat
Reply with a single JSON object:
  {
    "assistantMessage": string,          // your normal reply, following the writing rules
    "recommendations": { ... } | null,   // include when you are updating the primary or alternatives list
    "actions": [ ... ] | null            // optional small hints
  }
Same fenced-json convention. If you are only chatting and not changing the recommendations list, set "recommendations": null.

BOUNDARIES
You do NOT write finished articles in this conversation. You produce titles, angles, evidence checklists, visual recommendations, and editorial judgement calls. Article drafting is a separate future step that will consume your recommendations.`

const STATIC_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${STRATEGIST_ROLE_RULES}`

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

── PokePrices Editorial Context (authoritative. Do not invent additions.) ──

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
    // Block 5C — a hard flag the strategist must honor. When true,
    // the opportunity is primary-ineligible regardless of score.
    researchRequired:    Boolean(o.researchRequired),
    researchReason:      o.researchReason ?? null,
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
      // Block 5D — assistantMessage must never leak a JSON fence or
      // any raw JSON body into the UI. Prefer the explicit field
      // from the parsed object; otherwise strip every ``` block from
      // the raw text and trim.
      const cleaned = msg || stripAllFences(rawText)
      return { assistantMessage: cleaned, recommendations: recs, actions }
    }
  } catch { /* fall through */ }
  // No parsable JSON — treat the whole thing as an assistant message.
  return { assistantMessage: stripAllFences(rawText) }
}

/** Remove every fenced code block (```json ... ``` and generic ```
 *  ... ``` variants) plus any bare {"assistantMessage" object that
 *  slipped in without a fence, then trim. Never re-throws. */
function stripAllFences(raw: string): string {
  if (typeof raw !== 'string') return ''
  let out = raw.replace(/```[a-zA-Z]*[\s\S]*?```/g, '').trim()
  // If what remains still starts with a bare JSON object, drop it.
  if (/^\{[\s\S]*"assistantMessage"[\s\S]*\}\s*$/.test(out)) return ''
  return out
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
