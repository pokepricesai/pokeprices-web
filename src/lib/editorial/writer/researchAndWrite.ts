// src/lib/editorial/writer/researchAndWrite.ts
//
// EIC two-stage external Writer — Stage 1.
//
// Deliberate delete-complexity change. Everything the old external
// pipeline persisted (EvidencePack, staged research runs, plans,
// parts, block intents, evidence traces, claim traces, source-tier
// bookkeeping) is BYPASSED for normal external SEO article
// generation. This stage does the entire research + drafting in
// ONE Sonnet call using the web_search tool.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import { stripCitationMarkup } from './sanitizeCitations'
import type { EditorialContextArticle } from '../context'

export const RESEARCH_AND_WRITE_ROLE_RULES = `You are the PokePrices AI Writer. Your job is to research and write ONE Pokémon collector article in a single pass.

You have the web_search tool. Use it to gather live facts. Prefer:
  * Official Pokémon sources (pokemon.com, pokemoncenter.com, tcg.pokemon.com, The Pokémon Company / official regional sites)
  * Established Pokémon TCG publications (TCGplayer, PokéBeach, Bulbapedia)
  * Useful supporting sources when they add real detail

You may keep a mental model of source authority, but do NOT expose that machinery in the article. Never write "Tier 1", "Tier 2", "authoritative source", "evidence pack", "research summary", or similar internal language in reader-facing prose.

ARTICLE TARGET

  * 800-1,300 words. Bias short.
  * 4-6 sections with useful H2 headings. Short paragraphs. Mix punchy lines with longer explanatory ones.
  * Strong 2-3-sentence intro that hooks a collector and sets expectations.
  * Optional short closing thought. Not required. Do NOT add a "conclusion" section just to have one.

VOICE

  * Collector journalism. Concrete, energetic, easy to read, actual personality.
  * NOT academic. NOT encyclopedic. NOT a research report.
  * Explain WHY each important fact matters to a collector.
  * Restrained editorial opinion is welcome when the facts support it — frame opinion as opinion.
  * No investment language ("must own", "guaranteed", "invest now").

FACTUAL DISCIPLINE

  * Use only facts you actually verified via web_search. Do not invent dates, prices, card counts, product names, or sources.
  * Do NOT include <cite>, citation-index, tool-citation, or source-reference markup in the article body. Use normal Markdown links only when useful. Any such markup will be stripped downstream anyway.
  * Confirmed claims (backed by an official source you searched) can be stated directly.
  * Reported claims (single specialist source) use natural attributive phrasing: "TCGplayer reports…", "PokéBeach is saying…".
  * Rumor / leak / unconfirmed information MUST be clearly labelled: "Community leaks suggest…", "Not yet confirmed by Pokémon…".
  * Where credible sources materially disagree, mention both sides briefly in prose. Do not silently pick one.

INTERNAL LINKS

  * The brief includes an \`internalLinks\` list of existing PokePrices pages (title + URL) that may be relevant to this topic. Where genuinely useful, include 2-5 natural internal links to those pages using normal Markdown link syntax: \`[anchor text](/insights/example)\`.
  * Do NOT invent an internal URL. If a URL is not in the supplied \`internalLinks\` list, do not link to it.
  * Do NOT force a link where it does not fit the sentence. Zero internal links is fine if none of the supplied pages are actually relevant.

SEO

  * title: article H1, ~60 characters, natural not clickbait.
  * metaTitle: ~50-60 characters for search engines. May vary from title.
  * metaDescription: ~140-160 characters. Concise summary of the reader's takeaway.

OUTPUT FORMAT

Reply with ONE JSON object wrapped in a fenced code block tagged \`json\`. Nothing outside the block.

\`\`\`json
{
  "title":           string,
  "metaTitle":       string,
  "metaDescription": string,
  "bodyMarkdown":    string,
  "sources":         [ { "url": string, "title": string, "publisher": string } ]
}
\`\`\`

  * bodyMarkdown uses \`##\` H2 headings, \`###\` for subheads, blank-line-separated paragraphs, \`-\` bullet lists, \`1.\` ordered lists, and \`[anchor](https://...)\` links to sources you actually used. Do NOT put the H1 title inside bodyMarkdown — the title field is the H1.
  * sources lists the URLs you consulted and cited. This becomes the article's References and feeds Stage 2 (fact-checker). List only URLs you actually searched.
  * If for any reason you cannot produce the JSON exactly, still emit the article as plain Markdown starting with the title as \`# Title\` — a downstream salvage path will recover it. But JSON is strongly preferred.`

export const RESEARCH_AND_WRITE_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

${RESEARCH_AND_WRITE_ROLE_RULES}`

/** Small user brief. No EvidencePack, no verifiedFacts, no source
 *  provenance — just what the model needs to research and write.
 *  Optionally includes a bounded internalLinks candidate list so
 *  the model can weave 2-5 natural PokePrices links where useful. */
export function buildResearchAndWriteUserTurn(args: {
  project:       { id: number; title: string; angle: string | null; articleType: string }
  today:         string
  internalLinks?: Array<{ title: string; url: string }>
}): string {
  const brief: Record<string, unknown> = {
    topic:       args.project.title,
    articleType: args.project.articleType,
    angle:       args.project.angle || undefined,
    todaysDate:  args.today,
  }
  if (args.internalLinks && args.internalLinks.length > 0) {
    brief.internalLinks = args.internalLinks
  }
  return [
    'MODE=research_and_write',
    '',
    'Research this topic on the live web and write a complete Pokémon collector article. Return one JSON object matching the schema in the system prompt.',
    '',
    '```json',
    JSON.stringify(brief, null, 2),
    '```',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Internal-link candidate picker
// ─────────────────────────────────────────────────────────────────
//
// Cheap keyword-overlap ranker over published PokePrices articles.
// No AI stage, no scoring framework, no schema — just an ordered
// list of { title, url } the Writer can link into where useful.
// Zero candidates is a fine result — the prompt already tells the
// model that zero links is acceptable.

const INTERNAL_LINK_STOP_WORDS = new Set([
  'the','and','for','with','from','that','this','have','been','will','their','other','more','some','into','they','than','when','where','which','about','across','over','under','through','among','while','also','only','many','most','both','made','make','around','after','before','because','though','what','know','still','ever','farm','pokemon','pokémon','tcg','pokeprices','article','update','guide','everything','collection',
])

export function pickInternalLinkCandidates(args: {
  project:  { title: string; angle: string | null; articleType: string }
  articles: readonly EditorialContextArticle[]
  limit?:   number
}): Array<{ title: string; url: string }> {
  const limit = args.limit ?? 10
  if (!args.articles || args.articles.length === 0) return []
  const projectTokens = tokenizeForInternalLinks(`${args.project.title} ${args.project.angle ?? ''} ${args.project.articleType}`)
  if (projectTokens.size === 0) {
    // Fall back to the most recently published articles (up to
    // limit) — better than empty when we can't score.
    return [...args.articles]
      .sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')))
      .slice(0, limit)
      .map(a => ({ title: a.headline, url: a.publicUrl }))
  }
  const scored = args.articles.map(a => {
    const t = tokenizeForInternalLinks(`${a.headline} ${a.intro ?? ''} ${a.themeLabel ?? ''}`)
    let overlap = 0
    for (const tok of Array.from(projectTokens)) if (t.has(tok)) overlap += 1
    return { a, overlap, published: String(a.publishedAt ?? '') }
  })
  scored.sort((x, y) => (y.overlap - x.overlap) || y.published.localeCompare(x.published))
  return scored
    .filter(s => s.overlap > 0)          // any overlap qualifies; zero-overlap articles omitted
    .slice(0, limit)
    .map(s => ({ title: s.a.headline, url: s.a.publicUrl }))
}

function tokenizeForInternalLinks(s: string): Set<string> {
  const out = new Set<string>()
  for (const raw of String(s ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue
    if (INTERNAL_LINK_STOP_WORDS.has(raw)) continue
    out.add(raw)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
// Parser + salvage
// ─────────────────────────────────────────────────────────────────

export type ResearchAndWriteArticle = {
  title:           string
  metaTitle:       string
  metaDescription: string
  bodyMarkdown:    string
  sources:         Array<{ url: string; title?: string; publisher?: string }>
  salvaged:        boolean
}

export function parseResearchAndWriteResponse(rawText: string): ResearchAndWriteArticle | null {
  if (!rawText || typeof rawText !== 'string') return null

  // 1) Fenced ```json
  const fenced = rawText.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j && typeof j === 'object') {
      const built = fromParsed(j, false)
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

  // 4) Balanced-brace extraction
  const balanced = extractBalancedObject(rawText)
  if (balanced) {
    const built = fromParsed(balanced, false)
    if (built.bodyMarkdown.trim().length > 0) return built
  }

  // 5) Salvage: treat as Markdown starting with # Title
  const salvaged = salvageMarkdown(rawText)
  if (salvaged) return salvaged

  return null
}

function fromParsed(parsed: any, salvaged: boolean): ResearchAndWriteArticle {
  // Deterministic sanitizer removes any web-search citation markup
  // the model emitted (e.g. `(cite index="21-14">text</cite>`) so
  // it never reaches Studio or the published article. Prompt
  // guidance discourages it, but compliance is not guaranteed.
  const title           = clip(stripCitationMarkup(str(parsed.title ?? parsed.headline)), 300)
  const metaTitle       = clip(stripCitationMarkup(str(parsed.metaTitle ?? parsed.seoTitle ?? title)), 200)
  const metaDescription = clip(stripCitationMarkup(str(parsed.metaDescription ?? parsed.seoDescription)), 400)
  const bodyMarkdown    = clip(stripCitationMarkup(str(parsed.bodyMarkdown ?? parsed.body ?? parsed.markdown)), 40_000)
  const sources         = normaliseSources(parsed.sources ?? parsed.references)
  return { title, metaTitle, metaDescription, bodyMarkdown, sources, salvaged }
}

function normaliseSources(v: unknown): Array<{ url: string; title?: string; publisher?: string }> {
  if (!Array.isArray(v)) return []
  const out: Array<{ url: string; title?: string; publisher?: string }> = []
  const seen = new Set<string>()
  for (const s of v.slice(0, 40)) {
    if (!s) continue
    const url = typeof s === 'string' ? s : str((s as any).url)
    if (!url || !/^https?:\/\//i.test(url)) continue
    const key = url.toLowerCase().replace(/\/$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    if (typeof s === 'string') {
      out.push({ url })
    } else {
      out.push({
        url,
        title:     (s as any).title     ? clip(str((s as any).title), 300)     : undefined,
        publisher: (s as any).publisher ? clip(str((s as any).publisher), 200) : undefined,
      })
    }
  }
  return out
}

function salvageMarkdown(rawText: string): ResearchAndWriteArticle | null {
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
  const rawBody = lines.slice(bodyStart).join('\n').trim()
  const bodyMarkdown = stripCitationMarkup(rawBody)
  if (bodyMarkdown.length < 100) return null

  const firstPara = bodyMarkdown.split(/\n\s*\n/, 1)[0] ?? ''
  const metaDescription = firstPara.replace(/[#*_`>]/g, '').slice(0, 160).trim()

  // Salvage: scan the raw text for bare https URLs — Anthropic's
  // web_search citations often round-trip as plain URLs in the prose.
  const urls: string[] = []
  const seen = new Set<string>()
  const urlPattern = /https:\/\/[^\s\)\]}]+/g
  let m: RegExpExecArray | null
  while ((m = urlPattern.exec(clean)) !== null) {
    const u = m[0].replace(/[.,;:!?)\]}]+$/, '')
    const key = u.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    urls.push(u)
    if (urls.length >= 30) break
  }

  const cleanTitle = stripCitationMarkup(title)
  return {
    title:           cleanTitle || 'Untitled article',
    metaTitle:       (cleanTitle || 'Untitled article').slice(0, 60),
    metaDescription,
    bodyMarkdown,
    sources:         urls.map(url => ({ url })),
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
