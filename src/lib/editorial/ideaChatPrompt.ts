// src/lib/editorial/ideaChatPrompt.ts
//
// Small, focused prompt for the simplified Editorial HQ idea chat.
// Given a lane (external | internal) the model returns candidate
// article ideas as structured JSON. Candidates are NOT persisted
// until the admin clicks Yes on the corresponding card, so the
// model must never claim it saved anything.

import { POKEPRICES_EDITORIAL_PROFILE } from './strategistPrompt'
import type { EditorialArticleType } from './projects'

// ── Response shape ────────────────────────────────────────────────

export type CandidateIdea = {
  title:        string
  mode:         'external' | 'internal'
  articleType:  EditorialArticleType
  angle:        string        // 1-2 sentences
  why:          string        // 1 sentence: why it could work
}

export type IdeaChatResponse = {
  message:  string
  ideas:    CandidateIdea[]
}

// ── System prompt ─────────────────────────────────────────────────

const IDEA_CHAT_ROLE_RULES = `You are the PokePrices Editorial Idea Assistant. The admin has already chosen a lane (external or internal) and is looking for candidate article ideas.

TWO LANES

  * EXTERNAL: SEO / evergreen / news / release / collector-guide articles. Facts come from live web research (ChatGPT Deep Research). No proprietary PokePrices data is required for these to succeed. Judge them on likely search demand, timeliness, collector interest, topical relevance, and internal-linking potential.

  * INTERNAL: articles grounded in PokePrices proprietary data. The user turn will include a compact analytics summary (market trends, movers, PSA population signals, set momentum, freshness). Ground every internal idea in something concrete from that summary.

Return exactly the number of ideas the admin asked for. When they ask for one specific article, return one candidate. When they ask for N, return N. If the request is open-ended ("give me a few"), return three to five.

FIELDS PER IDEA

  * title: 60-70 char reader-facing headline
  * mode: "external" or "internal" — must match the selected lane
  * articleType: one canonical article_type value:
      internal: monthly_market_report, population_scarcity, data_study, market_analysis, price_analysis, grading_analysis, search_trends, movers
      external: upcoming_set, new_set, news, release_news, product_announcement, set_preview, evergreen_guide, external_research
  * angle: 1-2 sentences describing the piece
  * why: 1 sentence on why it could work (search demand for external, specific data signal for internal)

STYLE

  * American English. No em dashes. Do not use AI-writing filler ("in the world of", "not just X but Y", "it's worth noting", etc.).
  * Do not invent PokePrices numbers. If the internal summary does not support a claim, do not make it.
  * Do not claim anything was saved, added, planned, or created. Persistence is triggered by the admin clicking Yes on a candidate card — you cannot save anything from prose.

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing outside the block.

\`\`\`json
{
  "message": string,       // short conversational reply, 1-2 sentences
  "ideas": [
    { "title": string, "mode": "external"|"internal", "articleType": string, "angle": string, "why": string }
  ]
}
\`\`\`

If for any reason you cannot produce structured JSON, still return a JSON object with an empty \`ideas\` array and an explanatory message.`

export const IDEA_CHAT_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${IDEA_CHAT_ROLE_RULES}`

// ── User-turn builders ────────────────────────────────────────────

export function buildDiscoverUserTurn(args: {
  lane: 'external' | 'internal'
  userMessage: string
  internalSummary?: string     // present when lane === 'internal'
}): string {
  const laneLine = `LANE=${args.lane}`
  const summary = args.lane === 'internal' && args.internalSummary
    ? `\n\nPOKEPRICES ANALYTICS SUMMARY (authoritative — do not invent additions):\n${args.internalSummary}`
    : ''
  return `${laneLine}${summary}\n\nADMIN REQUEST:\n${args.userMessage}`
}

export function buildDevelopUserTurn(args: {
  lane: 'external' | 'internal'
  existingIdea: { title: string; angle: string | null; articleType: string }
  userMessage: string
  internalSummary?: string
}): string {
  const laneLine = `LANE=${args.lane}\nMODE=develop_existing`
  const summary = args.lane === 'internal' && args.internalSummary
    ? `\n\nPOKEPRICES ANALYTICS SUMMARY (authoritative — do not invent additions):\n${args.internalSummary}`
    : ''
  return [
    laneLine,
    summary,
    '',
    'EXISTING IDEA (refine this — return ONE candidate that replaces it):',
    '```json',
    JSON.stringify(args.existingIdea, null, 2),
    '```',
    '',
    'ADMIN REQUEST:',
    args.userMessage,
  ].join('\n')
}

// ── Response parser ──────────────────────────────────────────────
//
// Forgiving parser mirroring the external Writer + internal Writer
// parsers: fenced json → unlabeled fence → whole text → balanced
// brace. Never throws. Silently drops candidate ideas missing a
// title or with an unknown articleType (safer than surfacing broken
// cards to the admin).

const KNOWN_ARTICLE_TYPES: readonly EditorialArticleType[] = [
  'monthly_market_report','population_scarcity','data_study','market_analysis','price_analysis','grading_analysis','search_trends','movers',
  'upcoming_set','new_set','news','release_news','product_announcement','set_preview','evergreen_guide','external_research','evergreen',
]

export function parseIdeaChatResponse(rawText: string, lane: 'external' | 'internal'): IdeaChatResponse {
  const fallback: IdeaChatResponse = { message: '', ideas: [] }
  if (!rawText || typeof rawText !== 'string') return fallback

  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j && typeof j === 'object') return normalise(j, lane, rawText)
  }
  const anyFence = rawText.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFence) {
    const j = safeParse(anyFence[1])
    if (j && typeof j === 'object') return normalise(j, lane, rawText)
  }
  const whole = safeParse(rawText.trim())
  if (whole && typeof whole === 'object') return normalise(whole, lane, rawText)
  const balanced = extractBalancedObject(rawText)
  if (balanced) return normalise(balanced, lane, rawText)

  // No structured content — return the raw text as a conversational
  // message with no candidates. The admin sees something rather than
  // nothing.
  return { message: rawText.trim().slice(0, 600), ideas: [] }
}

function normalise(parsed: any, lane: 'external' | 'internal', rawText: string): IdeaChatResponse {
  const message = typeof parsed.message === 'string' ? parsed.message.trim().slice(0, 800) : ''
  const rawIdeas = Array.isArray(parsed.ideas) ? parsed.ideas : []
  const ideas: CandidateIdea[] = []
  for (const raw of rawIdeas.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) continue
    // Prefer the candidate's own mode if the model set one, otherwise
    // fall back to the lane the admin selected. Use the resolved mode
    // to pick a lane-appropriate default articleType so a stray
    // "internal" candidate on an external turn still lands in a sane
    // shape.
    const mode: 'external' | 'internal' = raw.mode === 'external' || raw.mode === 'internal' ? raw.mode : lane
    const articleType = typeof raw.articleType === 'string' && KNOWN_ARTICLE_TYPES.includes(raw.articleType as EditorialArticleType)
      ? raw.articleType as EditorialArticleType
      : mode === 'external' ? 'evergreen_guide' : 'data_study'
    ideas.push({
      title: title.slice(0, 300),
      mode,
      articleType,
      angle: typeof raw.angle === 'string' ? raw.angle.trim().slice(0, 500) : '',
      why:   typeof raw.why   === 'string' ? raw.why.trim().slice(0, 400)   : '',
    })
  }
  // If parsing produced no ideas AND no message, salvage the raw text
  // as the message so the admin still sees something.
  if (!message && ideas.length === 0) return { message: rawText.trim().slice(0, 600), ideas: [] }
  return { message, ideas }
}

function safeParse(s: string): any {
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : null }
  catch { return null }
}
function extractBalancedObject(raw: string): any {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0, inString = false, escape = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return safeParse(raw.slice(start, i + 1)) }
  }
  return null
}
