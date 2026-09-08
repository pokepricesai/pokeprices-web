// src/lib/editorial/writer/externalWriter.ts
//
// EIC — simplified external-research Writer.
//
// The heavyweight WriterDraft pipeline (plan → part1 → part2 →
// assemble → style → fact_check with block intents / evidence
// traces / claim traces / evidenceRefs) is right for internal-data
// articles, where every price and count must be provable line by
// line. For external SEO / collector pieces it is over-engineered
// and fragile: "writer_plan produced no parsable plan" now fails
// the whole run at zero yards.
//
// This module implements the deletion-of-complexity path:
//   * ONE Sonnet call
//   * Tiny output shape { title, metaTitle, metaDescription, bodyMarkdown }
//   * Salvage if JSON is malformed — take the raw text as Markdown
//   * Deterministic Markdown -> TipTap conversion
//   * No block intents / claim traces / evidence refs for external
//
// Internal-data paths are untouched.

import type { EvidencePack } from '../research/types'
import type { StudioDocument } from '@/lib/studio/types'
import { STUDIO_DOCUMENT_VERSION } from '@/lib/studio/types'
import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'

// ─────────────────────────────────────────────────────────────────
// System prompt — collector journalist, not analyst
// ─────────────────────────────────────────────────────────────────

export const EXTERNAL_WRITER_ROLE_RULES = `You are the PokePrices AI Writer, writing an external-research article for a real Pokémon collector audience. The job is straightforward:

Write an excellent Pokémon collector article about the supplied topic. Make it useful, entertaining, and SEO-friendly. Use the supplied research as your factual source. Focus on the most interesting details rather than including everything. Explain why things matter to collectors. Keep rumors and unconfirmed information clearly labelled. Do not invent facts.

TARGET

  * 700-1,200 words. Bias short. A tight 800-word article beats a 1,500-word one that repeats itself.
  * 4-6 sections with useful H2 headings. Short paragraphs. Vary rhythm — mix punchy lines with longer explanatory ones.
  * Strong intro: 2-3 sentences that hook a collector and set expectations. Open with the most interesting confirmed element.
  * A brief closing thought is fine. It is not required. Do not add a "conclusion" section merely to have one.

VOICE

  * Collector journalism. Concrete. Energetic. Easy to read. Real personality.
  * NOT academic. NOT encyclopedic. NOT a research report.
  * Tell the reader why each important fact matters to them.
  * Restrained editorial opinion is welcome when the facts support it. Frame opinion as opinion.

FACTUAL DISCIPLINE (still non-negotiable)

  * Use only facts present in the supplied research. Do not invent dates, card counts, product names, prices, or sources.
  * "Confirmed" claims can be stated directly. "Reported"/"rumored" claims must stay marked — natural attributive phrasing is enough. Examples: "Pokémon has confirmed…", "TCGplayer is reporting…", "Community leaks suggest…", "Pokémon has not confirmed this yet."
  * Where the research shows material disagreement, mention both sides briefly. Do not silently pick one.
  * External links may only use URLs present in the supplied sources list.
  * No investment language ("must own", "guaranteed", "invest now").

SEO

  * title: article H1, ideally ~60 characters, natural not clickbait.
  * metaTitle: ~50-60 characters for search engines. May vary from title.
  * metaDescription: ~140-160 characters. Concise summary of what the reader will get.

OUTPUT FORMAT — READ CAREFULLY

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing else.

\`\`\`json
{
  "title":           string,
  "metaTitle":       string,
  "metaDescription": string,
  "bodyMarkdown":    string
}
\`\`\`

bodyMarkdown is Markdown — headings with \`##\`, subheadings with \`###\`, paragraphs separated by blank lines, bullet lists with \`-\`, and links written \`[anchor text](https://...)\`. Do NOT include the H1 title inside bodyMarkdown — the title field is the H1.

If for any reason you cannot produce the JSON exactly, still emit the article as plain Markdown starting with the title as \`# Title\` — a downstream salvage path will recover it. But JSON is strongly preferred.`

export const EXTERNAL_WRITER_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${EXTERNAL_WRITER_ROLE_RULES}`

// ─────────────────────────────────────────────────────────────────
// Small user-turn brief — no provenance machinery
// ─────────────────────────────────────────────────────────────────
//
// We deliberately omit:
//   * fact IDs / evidence IDs / claim traces / block intents
//   * source tier language ("Tier 1"/"Tier 2"/"Tier 3")
//   * research-pack methodology, quarantine, quality reasons
//   * researchQuestions, extractor diagnostics, run state
//
// We include:
//   * project title + articleType
//   * a short researchSummary (bounded)
//   * up to ~15 useful facts drawn from verifiedFacts + prose
//   * up to ~12 usable source URLs (title + publisher only)
//   * a "not yet confirmed" list drawn from researchGaps + rumored facts

export function buildExternalArticleUserTurn(args: {
  project: { id: number; title: string; angle: string | null; articleType: string }
  pack:    EvidencePack
  today?:  string
}): string {
  const { project, pack } = args

  // Best source URLs — prefer Tier 1, then Tier 2, then anything
  // else. Cap the list at 12 to keep the brief tight.
  const rankedSources = [...pack.externalSources]
    .sort((a, b) => ((a.sourceTier ?? 3) - (b.sourceTier ?? 3)))
    .slice(0, 12)
    .map(s => ({
      url:       s.url,
      title:     s.title || s.url,
      publisher: s.publisher || undefined,
    }))

  // Useful facts — verifiedFacts marked confirmed/reported first,
  // ignore rumored/unverified for the "known" list. Bounded at 15.
  const usefulFacts = pack.verifiedFacts
    .filter(f => {
      if (f.evidenceRefs.length === 0) return false   // skip the bootstrap fact
      const s = f.status
      return !s || s === 'confirmed' || s === 'reported'
    })
    .slice(0, 15)
    .map(f => ({
      statement: f.statement,
      status:    f.status ?? 'reported',
    }))

  // Things not yet confirmed — researchGaps + rumored/unverified facts.
  const uncertain = [
    ...pack.researchGaps.slice(0, 6).map(g => ({ point: g, kind: 'gap' as const })),
    ...pack.verifiedFacts
      .filter(f => f.status === 'rumored' || f.status === 'unverified')
      .slice(0, 6)
      .map(f => ({ point: f.statement, kind: 'rumor' as const })),
  ]

  // Contradictions — flatten to a simple "sources disagree on X"
  // line each. Cap at 3.
  const disagreements = (pack.contradictions ?? []).slice(0, 3).map(c => ({
    on:        c.claim,
    positions: c.positions.map(p => p.statement),
  }))

  // Research summary — bounded 8KB. This is the primary factual
  // artefact. If missing, fall back to concatenated primary +
  // supporting prose (bounded).
  const researchSummary = (pack.researchSummary && pack.researchSummary.trim())
    || [
      pack.externalResearchRun?.primaryText    ?? '',
      pack.externalResearchRun?.supportingText ?? '',
    ].filter(Boolean).join('\n\n')
  const cappedSummary = researchSummary.length > 8_000
    ? researchSummary.slice(0, 8_000) + '\n\n[…summary truncated]'
    : researchSummary

  const brief = {
    topic:              project.title,
    articleType:        project.articleType,
    angle:              project.angle || undefined,
    researchSummary:    cappedSummary || '(no summary available — write from the useful facts + sources below)',
    usefulFacts,
    sources:            rankedSources,
    notYetConfirmed:    uncertain.length > 0 ? uncertain : undefined,
    sourcesDisagreeOn:  disagreements.length > 0 ? disagreements : undefined,
  }

  return [
    'MODE=external_article',
    '',
    'Write a Pokémon collector article on the topic below using the supplied research. Return ONE JSON object matching the schema in the system prompt.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing + salvage
// ─────────────────────────────────────────────────────────────────

export type ExternalArticleResponse = {
  title:           string
  metaTitle:       string
  metaDescription: string
  bodyMarkdown:    string
  /** True when the response was salvaged from raw prose because JSON
   *  extraction failed. Used to note "salvaged" in run telemetry. */
  salvaged:        boolean
}

/** Try to parse the model's response as our tiny JSON schema. If
 *  JSON extraction fails but there is usable prose in the response,
 *  salvage it as Markdown rather than throwing. */
export function parseExternalArticleResponse(rawText: string): ExternalArticleResponse | null {
  if (!rawText || typeof rawText !== 'string') return null

  // 1) Fenced ```json block
  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, /* salvaged */ false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }

  // 2) Unlabeled fence around an object
  const anyFence = rawText.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFence) {
    const j = safeParse(anyFence[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
      if (built.bodyMarkdown.trim().length > 0) return built
    }
  }

  // 3) Whole-text JSON
  const whole = safeParse(rawText.trim())
  if (whole && typeof whole === 'object') {
    const built = fromParsed(whole, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }

  // 4) Balanced-brace substring extraction (for lightly wrapped JSON)
  const balanced = extractBalancedObject(rawText)
  if (balanced) {
    const built = fromParsed(balanced, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }

  // 5) SALVAGE — treat the whole response as Markdown prose.
  //    Extract a title from the first `# Heading` if present, else
  //    from the first non-empty line.
  const salvaged = salvageMarkdownArticle(rawText)
  if (salvaged) return salvaged

  return null
}

function fromParsed(parsed: any, salvaged: boolean): ExternalArticleResponse {
  const title           = clip(str(parsed.title ?? parsed.headline), 300)
  const metaTitle       = clip(str(parsed.metaTitle ?? parsed.seoTitle ?? title), 200)
  const metaDescription = clip(str(parsed.metaDescription ?? parsed.seoDescription), 400)
  const bodyMarkdown    = clip(str(parsed.bodyMarkdown ?? parsed.body ?? parsed.markdown), 40_000)
  return { title, metaTitle, metaDescription, bodyMarkdown, salvaged }
}

function salvageMarkdownArticle(rawText: string): ExternalArticleResponse | null {
  const clean = rawText.trim()
  if (clean.length < 120) return null   // too short to be an article

  // Try to extract the first-line title, whether "# Title" or plain
  const lines = clean.split(/\r?\n/)
  let title = ''
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim()
    if (!ln) continue
    if (ln.startsWith('# ')) {
      title = ln.slice(2).trim()
      bodyStart = i + 1
    } else {
      // Use first non-empty line as title if no H1 was emitted
      title = ln.replace(/^#+\s*/, '').slice(0, 300)
      bodyStart = i + (ln.startsWith('#') ? 1 : 0)
    }
    break
  }
  const bodyMarkdown = lines.slice(bodyStart).join('\n').trim()
  if (bodyMarkdown.length < 100) return null

  // Derive a reasonable meta description from the first paragraph
  const firstPara = bodyMarkdown.split(/\n\s*\n/, 1)[0] ?? ''
  const metaDescription = firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim()

  return {
    title:           title || 'Untitled article',
    metaTitle:       (title || 'Untitled article').slice(0, 60),
    metaDescription,
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

// ─────────────────────────────────────────────────────────────────
// Deterministic Markdown -> TipTap body doc
// ─────────────────────────────────────────────────────────────────
//
// Supports:
//   * headings (## → h2, ### → h3)
//   * paragraphs (blank-line separated)
//   * bullet lists (lines starting with `-` or `*`)
//   * ordered lists (lines starting with `1.` / `2.` ...)
//   * links [text](https://...) with mark rendering
//   * inline **bold** and *italic* (light — bold and italic marks)
// Anything unrecognised becomes a paragraph. Never throws.

type TipTapText = { type: 'text'; text: string; marks?: any[] }
type TipTapNode = any

export function markdownToStudioBodyDoc(markdown: string, allowedExternalUrls?: ReadonlySet<string>): TipTapNode {
  const content: TipTapNode[] = []
  const lines = (markdown ?? '').split(/\r?\n/)

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const line = raw.trimEnd()
    // skip blank lines between blocks
    if (line.trim() === '') { i++; continue }

    // Heading ## or ###
    const h = line.match(/^(#{2,4})\s+(.*)$/)
    if (h) {
      const level = Math.min(3, Math.max(2, h[1].length)) as 2 | 3
      const text = h[2].trim()
      content.push({ type: 'heading', attrs: { level }, content: renderInline(text, allowedExternalUrls) })
      i++
      continue
    }

    // Bullet list — collect consecutive `- ` / `* ` lines
    if (/^\s*[-*]\s+/.test(line)) {
      const items: TipTapNode[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const t = lines[i].replace(/^\s*[-*]\s+/, '')
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: renderInline(t, allowedExternalUrls) }] })
        i++
      }
      content.push({ type: 'bulletList', content: items })
      continue
    }

    // Ordered list — `1.` / `2.` prefixes
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: TipTapNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const t = lines[i].replace(/^\s*\d+\.\s+/, '')
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: renderInline(t, allowedExternalUrls) }] })
        i++
      }
      content.push({ type: 'orderedList', content: items })
      continue
    }

    // Paragraph — collect until blank line or block boundary
    const paraLines: string[] = []
    while (i < lines.length) {
      const ln = lines[i]
      if (ln.trim() === '') break
      if (/^#{2,4}\s+/.test(ln.trimStart())) break
      if (/^\s*([-*]|\d+\.)\s+/.test(ln)) break
      paraLines.push(ln.trim())
      i++
    }
    const paraText = paraLines.join(' ').replace(/\s+/g, ' ').trim()
    if (paraText) {
      content.push({ type: 'paragraph', content: renderInline(paraText, allowedExternalUrls) })
    }
  }

  // Ensure at least one paragraph so downstream editors don't break
  if (content.length === 0) content.push({ type: 'paragraph' })
  return { type: 'doc', content }
}

/** Render inline: split on [text](href) link markers, then apply
 *  optional bold/italic marks. Bold: **text**. Italic: *text*.
 *  Links: [anchor](url). Only allowed external URLs are linkified;
 *  disallowed URLs render as plain text (anchor kept). Internal
 *  URLs starting with '/' are always allowed. */
function renderInline(text: string, allowedExternalUrls?: ReadonlySet<string>): TipTapText[] {
  const out: TipTapText[] = []
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\)\s]+|\/[^\s\)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = linkPattern.exec(text)) !== null) {
    if (m.index > last) pushWithMarks(out, text.slice(last, m.index))
    const anchor = m[1]
    const href   = m[2]
    const isInternal = href.startsWith('/')
    const isAllowed  = isInternal || (allowedExternalUrls ? allowedExternalUrls.has(href) : true)
    if (isAllowed) {
      pushWithMarks(out, anchor, [{ type: 'link', attrs: { href } }])
    } else {
      // Drop the URL, keep the anchor as plain text
      pushWithMarks(out, anchor)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) pushWithMarks(out, text.slice(last))
  if (out.length === 0) out.push({ type: 'text', text })
  return out
}

function pushWithMarks(out: TipTapText[], span: string, extraMarks?: any[]): void {
  // **bold** and *italic* — non-nested, greedy. Bold takes precedence.
  const parts = splitByMarks(span)
  for (const p of parts) {
    if (!p.text) continue
    const marks: any[] = [...(extraMarks ?? [])]
    if (p.bold)   marks.push({ type: 'bold' })
    if (p.italic) marks.push({ type: 'italic' })
    out.push(marks.length > 0 ? { type: 'text', text: p.text, marks } : { type: 'text', text: p.text })
  }
}

function splitByMarks(s: string): Array<{ text: string; bold?: boolean; italic?: boolean }> {
  const parts: Array<{ text: string; bold?: boolean; italic?: boolean }> = []
  let cursor = 0
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let m: RegExpExecArray | null
  while ((m = pattern.exec(s)) !== null) {
    if (m.index > cursor) parts.push({ text: s.slice(cursor, m.index) })
    if (m[1] != null) parts.push({ text: m[1], bold: true })
    else if (m[2] != null) parts.push({ text: m[2], italic: true })
    cursor = m.index + m[0].length
  }
  if (cursor < s.length) parts.push({ text: s.slice(cursor) })
  return parts
}

// ─────────────────────────────────────────────────────────────────
// StudioDocument assembly (deterministic)
// ─────────────────────────────────────────────────────────────────

export function buildStudioDocFromExternalArticle(args: {
  parsed:  ExternalArticleResponse
  pack:    EvidencePack
  today?:  string
}): StudioDocument {
  const { parsed, pack } = args

  const allowedExternal = new Set<string>()
  for (const s of pack.externalSources) if (/^https:\/\//.test(s.url)) allowedExternal.add(s.url)

  const bodyDoc = markdownToStudioBodyDoc(parsed.bodyMarkdown, allowedExternal)

  return {
    version:    STUDIO_DOCUMENT_VERSION,
    headline:   parsed.title,
    // First paragraph as intro — otherwise fall back to metaDescription.
    intro:      deriveIntro(parsed.bodyMarkdown, parsed.metaDescription),
    themeKey:   'market',
    themeLabel: 'Market',
    authorName: 'PokePrices',
    seo:        { title: parsed.metaTitle || parsed.title, description: parsed.metaDescription },
    heroImage:  null,
    bodyDoc,
    updatedAt:  new Date().toISOString(),
  }
}

function deriveIntro(markdown: string, fallback: string): string {
  // Prefer a lead paragraph that appears BEFORE the first heading —
  // that's what a Writer should produce as the article's "deck".
  // If the body opens with a heading (the model went straight into
  // its first section), fall back to metaDescription rather than
  // pulling the first section's paragraph up as a duplicate.
  const blocks = (markdown ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  for (const block of blocks) {
    if (block.startsWith('#')) break            // hit a heading first → no lead
    if (/^\s*([-*]|\d+\.)\s+/.test(block)) break // hit a list first → no lead
    return block.replace(/[*_`>]/g, '').slice(0, 500)
  }
  return (fallback || '').slice(0, 500)
}
