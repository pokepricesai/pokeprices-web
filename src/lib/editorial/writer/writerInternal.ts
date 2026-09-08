// src/lib/editorial/writer/writerInternal.ts
//
// EIC — simplified internal-data Writer.
//
// Replaces the writer_plan → part1 → part2 → assemble → style chain
// with ONE Sonnet call over a compact deterministic brief. Output
// shape matches the external Writer so downstream CMS/adapter code
// can consume it unchanged. The deterministic research/data layer
// remains strict; the AI writing layer becomes simple.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import { stripCitationMarkup } from './sanitizeCitations'
import type { EvidencePack } from '../research/types'

// ─────────────────────────────────────────────────────────────────
// System prompt — internal-data house style
// ─────────────────────────────────────────────────────────────────

export const INTERNAL_WRITER_ROLE_RULES = `You are the PokePrices AI Writer, writing an INTERNAL DATA-DRIVEN article for a Pokémon collector audience from PokePrices proprietary data. The research pack has already been built and approved by a human.

TARGET

- 900-1,300 words. Bias short.
- 4-6 useful H2 sections. Short paragraphs. Vary rhythm.
- Strong 2-3-sentence opening that hooks a collector and sets expectations. Lead with the most interesting data-backed story, not a summary of methodology.
- Optional short closing thought. Do NOT add a "conclusion" section for its own sake.

VOICE

- Collector journalism grounded in real numbers.
- Concrete, energetic, easy to read.
- NOT a database dump sorted by percentage.
- Explain what the numbers mean for collectors, not just what they are.
- Restrained editorial opinion is welcome when data supports it.

FACTUAL DISCIPLINE — NON-NEGOTIABLE

- Every fact you state must come from the compact evidence brief. Do not invent prices, percentages, cards, sets, or dates.
- Prefer the FEATURED risers / fallers / sets over raw rankings. The featured lists are the editorial shortlist a human editor would use.
- Observation vs explanation:
  * Observation ("Charizard climbed 12% during August across a strong tracked sample") is allowed if the brief supports it.
  * Explanation ("Charizard climbed because collectors rushed back into vintage Pokémon") is NOT allowed unless the brief actually supports that cause. When cause is unknown, describe the movement plainly.
- Do NOT describe endpoint observation counts as "sales" / "sales volume" / "transactions". Safe language: "pricing observations", "tracked observations", "endpoint observations", "data coverage".
- Do NOT restate rejected claims (they are listed in the brief).
- No investment language ("must own", "guaranteed", "invest now").
- Do NOT manufacture drama on a quiet month — say so plainly.

FORMATTING RULES — READ CAREFULLY

- No em dashes.
- No bold formatting inside the article body (no **random words**, no bold Pokémon names, no bold prices).
- Italics are rare and only for product / publication titles.
- H2 (##) and H3 (###) headings are fine and encouraged.
- Normal Markdown links [anchor text](https://...) are fine.
- Do NOT include a "Methodology" or "Research methodology" section.
- Do NOT emit internal evidence identifiers in reader-facing prose: no fact-*, finding-*, src-*, blockIntent-*, featured-risers-YYYY-MM style ids. The brief's ids exist for the fact checker, not the reader.
- Do NOT surface research-system terminology like "evidence pack", "verified fact", "featured shortlist", "editorial score" in prose.

INTERNAL LINKS

- The brief includes an \`internalLinks\` list of existing PokePrices pages. Where genuinely useful, include 2-5 natural internal links using \`[anchor](/insights/…)\` or \`[anchor](/set/…)\` syntax.
- Do NOT invent an internal URL. Zero internal links is fine if none of the supplied pages are relevant.

OUTPUT FORMAT — RETURN EXACTLY THIS STRUCTURE

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing outside the block.

\`\`\`json
{
  "articleTitle":     string,
  "introSnippet":     string,
  "seoTitle":         string,
  "metaDescription":  string,
  "bodyMarkdown":     string
}
\`\`\`

- articleTitle: the article H1 (60-70 chars).
- introSnippet: short 1-2 sentence standfirst / excerpt (~150 chars). Will render under the H1.
- seoTitle: ~50-60 chars for search engines. May vary from articleTitle.
- metaDescription: 140-160 chars.
- bodyMarkdown: finished article starting directly with the opening paragraph. Do NOT repeat the article title at the top of the body.

If for any reason you cannot produce the JSON exactly, still emit the article as plain Markdown starting with the title as \`# Title\` — a downstream salvage path will recover it. But JSON is strongly preferred.`

export const INTERNAL_WRITER_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${INTERNAL_WRITER_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// Compact deterministic brief builder
// ─────────────────────────────────────────────────────────────────
//
// Sends only publishable evidence. No huge raw mover tables. No
// quarantined-row dumps. No source metadata / debug fields.

export type InternalWriterBriefFeaturedCard = {
  cardName: string
  cardNumber?: string | null
  setName: string
  startUsd: number
  endUsd: number
  pctMove: number
  observations: number
  whyFeatured?: string | null
}

export type InternalWriterBriefFeaturedSet = {
  setName: string
  moverCount: number
  medianPct: number
  combinedEndUsd: number
  editorialScore?: number | null
}

export type InternalWriterBrief = {
  project: {
    title: string
    articleType: string
    angle: string | null
    reportingPeriod: string | null
  }
  market: {
    sampleSize: number
    medianPct?: number | null
    iqrLowPct?: number | null
    iqrHighPct?: number | null
    risingCount?: number | null
    fallingCount?: number | null
    flatCount?: number | null
    signalStrength?: string | null
    signalReason?: string | null
  }
  featuredRisers: InternalWriterBriefFeaturedCard[]
  featuredFallers: InternalWriterBriefFeaturedCard[]
  featuredSets: InternalWriterBriefFeaturedSet[]
  approvedManualRows: InternalWriterBriefFeaturedCard[]
  warnings: string[]
  rejectedClaims: string[]
  internalLinks: Array<{ title: string; url: string }>
}

export function buildInternalWriterBrief(args: {
  project: { title: string; articleType: string; angle: string | null; targetPublishAt: string | null }
  pack:    EvidencePack
  internalLinks: Array<{ title: string; url: string }>
}): InternalWriterBrief {
  const { pack } = args

  // Featured tables — created by the recipe (monthly_market_report).
  const featuredRisers  = findTableRows(pack, /^featured-risers-/)
  const featuredFallers = findTableRows(pack, /^featured-fallers-/)
  const featuredSets    = findTableRows(pack, /^featured-sets-/)

  // Approved manual-review rows — only those humans explicitly approved.
  const approvedSlugs = new Set(pack.approvedLargeMoverSlugs ?? [])
  const approvedManual: any[] = []
  for (const t of pack.dataTables) {
    if (!/^mover-review-/.test(t.id)) continue
    for (const r of t.rows) if (approvedSlugs.has(String((r as any).cardSlug ?? ''))) approvedManual.push(r)
  }

  // Aggregate stats — pull from derivedFindings rather than
  // recomputing. Text search on statement is more robust than
  // asserting shape.
  const findByPattern = (rx: RegExp): string | undefined => pack.derivedFindings.find(f => rx.test(f.statement))?.statement
  const medianStatement  = findByPattern(/median monthly/i)
  const iqrStatement     = findByPattern(/interquartile range/i)
  const directionStatement = findByPattern(/cards rose more than 1%/i)

  const medianPct = parseFirstSignedPct(medianStatement)
  const [iqrLow, iqrHigh] = parseFirstTwoSignedPct(iqrStatement)
  const [rising, falling, flat] = parseThreeCounts(directionStatement)

  return {
    project: {
      title:       args.project.title,
      articleType: args.project.articleType,
      angle:       args.project.angle,
      reportingPeriod: inferReportingPeriod(args.project.title, pack.dataAsOf),
    },
    market: {
      sampleSize:     pack.quality.sampleSize,
      medianPct,
      iqrLowPct:      iqrLow,
      iqrHighPct:     iqrHigh,
      risingCount:    rising,
      fallingCount:   falling,
      flatCount:      flat,
      signalStrength: pack.marketSignalStrength ?? null,
      signalReason:   pack.marketSignalReason ?? null,
    },
    featuredRisers:  featuredRisers.map(toBriefCard),
    featuredFallers: featuredFallers.map(toBriefCard),
    featuredSets:    featuredSets.map(toBriefSet),
    approvedManualRows: approvedManual.map(toBriefCard),
    // Writer-facing cautions only (skip debug/telemetry warnings).
    warnings: pack.warnings
      .filter(w => w.severity === 'critical' || w.severity === 'major')
      .map(w => w.message)
      .slice(0, 8),
    rejectedClaims: pack.rejectedClaims.map(r => r.claim).slice(0, 8),
    internalLinks:  args.internalLinks,
  }
}

function findTableRows(pack: EvidencePack, pattern: RegExp): any[] {
  const t = pack.dataTables.find(x => pattern.test(x.id))
  return t ? t.rows : []
}
function toBriefCard(row: any): InternalWriterBriefFeaturedCard {
  return {
    cardName:     String(row.cardName ?? ''),
    cardNumber:   row.cardNumber != null ? String(row.cardNumber) : null,
    setName:      String(row.setName ?? ''),
    startUsd:     Number(row.startUsd ?? 0),
    endUsd:       Number(row.endUsd ?? 0),
    pctMove:      Number(row.pct ?? 0),
    observations: Number(row.totalObs ?? ((row.startObs != null && row.endObs != null) ? (row.startObs ?? 0) + (row.endObs ?? 0) : 0)),
    whyFeatured:  typeof row.reasons === 'string' ? row.reasons : null,
  }
}
function toBriefSet(row: any): InternalWriterBriefFeaturedSet {
  return {
    setName:        String(row.setName ?? ''),
    moverCount:     Number(row.moverCount ?? 0),
    medianPct:      Number(row.medianPct ?? 0),
    combinedEndUsd: Number(row.totalEndUsd ?? 0),
    editorialScore: row.editorialScore != null ? Number(row.editorialScore) : null,
  }
}

function parseFirstSignedPct(s: string | undefined): number | null {
  if (!s) return null
  const m = s.match(/[-+]?\d+(?:\.\d+)?\s?%/)
  return m ? Number(m[0].replace(/\s?%$/, '')) : null
}
function parseFirstTwoSignedPct(s: string | undefined): [number | null, number | null] {
  if (!s) return [null, null]
  const matches = s.match(/[-+]?\d+(?:\.\d+)?\s?%/g)
  if (!matches || matches.length < 2) return [null, null]
  return [Number(matches[0].replace(/\s?%$/, '')), Number(matches[1].replace(/\s?%$/, ''))]
}
function parseThreeCounts(s: string | undefined): [number | null, number | null, number | null] {
  if (!s) return [null, null, null]
  // Expected shape: "N cards rose more than 1%, M fell more than 1%, K were within ±1%".
  // Skip numbers that are part of a percentage — "1%" is a threshold,
  // not a count. Also skip decimals (any digit that is preceded by
  // "." or followed by ".<digit>").
  const nums: number[] = []
  const rx = /\b(\d+)(?!\.\d|\s?%)/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(s)) !== null) {
    nums.push(Number(m[1]))
    if (nums.length === 3) break
  }
  if (nums.length < 3) return [null, null, null]
  return [nums[0], nums[1], nums[2]]
}
function inferReportingPeriod(title: string, dataAsOf: string): string | null {
  // Matches e.g. "August 2026" in the title. Falls back to null.
  const m = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i)
  return m ? m[0] : dataAsOf.slice(0, 7)
}

// ─────────────────────────────────────────────────────────────────
// User turn
// ─────────────────────────────────────────────────────────────────

export function buildInternalWriterUserTurn(brief: InternalWriterBrief): string {
  return [
    'MODE=internal_article',
    '',
    'Write a finished PokePrices data-driven article from the compact evidence brief below. Return one JSON object matching the schema in the system prompt.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing + salvage — same shape family as external
// ─────────────────────────────────────────────────────────────────

export type InternalArticleResponse = {
  title:           string
  metaTitle:       string
  metaDescription: string
  bodyMarkdown:    string
  salvaged:        boolean
}

export function parseInternalArticleResponse(rawText: string): InternalArticleResponse | null {
  if (!rawText || typeof rawText !== 'string') return null

  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }

  const anyFence = rawText.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFence) {
    const j = safeParse(anyFence[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }

  const whole = safeParse(rawText.trim())
  if (whole && typeof whole === 'object') {
    const built = fromParsed(whole, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }

  const balanced = extractBalancedObject(rawText)
  if (balanced) {
    const built = fromParsed(balanced, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }

  // Salvage: treat the whole text as Markdown starting with "# Title".
  const salvaged = salvageMarkdown(rawText)
  if (salvaged) return salvaged

  return null
}

function fromParsed(parsed: any, salvaged: boolean): InternalArticleResponse {
  // Accept common alternate field names — model may drift.
  const title           = clip(stripCitationMarkup(str(parsed.articleTitle ?? parsed.title ?? parsed.headline)), 300)
  const metaTitle       = clip(stripCitationMarkup(str(parsed.seoTitle ?? parsed.metaTitle ?? title)), 200)
  const metaDescription = clip(stripCitationMarkup(str(parsed.metaDescription ?? parsed.seoDescription)), 400)
  const bodyMarkdown    = clip(stripCitationMarkup(str(parsed.bodyMarkdown ?? parsed.body ?? parsed.markdown)), 40_000)
  return { title, metaTitle, metaDescription, bodyMarkdown, salvaged }
}

function salvageMarkdown(rawText: string): InternalArticleResponse | null {
  const clean = rawText.trim()
  if (clean.length < 120) return null
  const lines = clean.split(/\r?\n/)
  let title = ''
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln) continue
    if (ln.startsWith('# ')) { title = ln.slice(2).trim(); bodyStart = i + 1 }
    else                     { title = ln.replace(/^#+\s*/, '').slice(0, 300); bodyStart = i + (ln.startsWith('#') ? 1 : 0) }
    break
  }
  const bodyMarkdown = stripCitationMarkup(lines.slice(bodyStart).join('\n').trim())
  if (bodyMarkdown.length < 100) return null
  const firstPara = bodyMarkdown.split(/\n\s*\n/, 1)[0] ?? ''
  const cleanTitle = stripCitationMarkup(title)
  return {
    title:           cleanTitle || 'Untitled article',
    metaTitle:       (cleanTitle || 'Untitled article').slice(0, 60),
    metaDescription: firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim(),
    bodyMarkdown,
    salvaged:        true,
  }
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

function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function clip(s: string, cap: number): string { return s.slice(0, cap) }
