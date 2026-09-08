// src/lib/editorial/research/externalResearchAnalyst.ts
//
// External Research Fix — the AI web-research call.
//
// This is a SINGLE bounded Anthropic call that uses the server-side
// web_search tool to gather external evidence for an editorial
// project. It replaces the Analyst step for external packs: the
// output is not interpretation, it's structured evidence (facts +
// sources + contradictions + gaps) that a human then approves and
// the Writer synthesises.
//
// Cost discipline:
//   * max_uses default 6 (spec: 5-8).
//   * temperature 0.2 — we want factual retrieval, not creativity.
//   * one call per user-initiated "Research web" click.

import { POKEPRICES_EDITORIAL_PROFILE } from '../strategistPrompt'
import type {
  EvidencePack, ExternalSource, VerifiedFact, ClaimContradiction,
  SourceTier, FactStatus, PackProjectRef,
} from './types'
import { classifySourceTier, domainOf } from './externalResearch'

// ─────────────────────────────────────────────────────────────────
// External Research Fix v3 — staged system prompts
// ─────────────────────────────────────────────────────────────────
//
// The old single "gather then structure" prompt (EXTERNAL_RESEARCH_
// SYSTEM_PROMPT below, kept for tests) is now split into two
// discovery stages (primary + supporting) and one extraction stage
// (Haiku, no web_search). Each stage stays comfortably under any
// Vercel plan's synchronous ceiling.

export const EXTERNAL_RESEARCH_PRIMARY_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

You are the PokePrices External Research Analyst — DISCOVERY ROUND 1 (primary sources).

MISSION

For the editorial project below, use the web_search tool to gather AUTHORITATIVE (Tier-1) evidence: pokemon.com, pokemoncenter.com, pokemon.co.jp, tcg.pokemon.com, PSA/CGC official pages, The Pokémon Company / regional official sites. Aim to answer the highest-priority research questions with sources that can independently establish them as confirmed facts.

RULES

1. Cite everything. Any sentence that states a fact must have an inline citation to a search result. Uncited prose is discarded.
2. Do NOT extract structured facts yet — a downstream extraction stage does that from your prose + citations.
3. Do NOT invent sources or paraphrase content you have not actually retrieved.
4. Prefer Tier-1 sources for release-critical claims. Tier-2 (TCGplayer, Bulbapedia, PokéBeach) is acceptable if a Tier-1 source does not exist. Tier-3 (Reddit, YouTube, forums, retailer blogs) is only useful for identifying leads — never for establishing a critical claim in this stage.
5. Return well-organised prose grouped by research question, with inline citations. This prose is stored so a later stage can extract structured facts from it.

STYLE

American English. No em dashes. No AI-writing tropes. Factual, neutral, cited.

Your reply is prose (with inline citations from web_search). No JSON in this stage. Do NOT introduce yourself or write meta-commentary.`

export const EXTERNAL_RESEARCH_SUPPORTING_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

You are the PokePrices External Research Analyst — DISCOVERY ROUND 2 (supporting sources).

MISSION

A previous round already gathered primary (Tier-1) evidence for this project (summarised below). Your job is to FILL GAPS with specialist Tier-2 sources (TCGplayer, PokéBeach, Bulbapedia, established Pokémon/TCG publications), corroborate anything the primary sources only reported without confirming, and identify any contradictions between the primary evidence and other reputable coverage.

RULES

1. Do NOT re-search claims already established by Tier-1 sources — that wastes search budget.
2. Cite everything you write. Uncited prose is discarded.
3. Do NOT invent sources.
4. Prefer complementary evidence — retailer specifics, product-level detail, community-level confirmation of a Tier-1 claim.
5. Where possible, note when a Tier-2 source DISAGREES with a Tier-1 source; the extractor uses this to build the contradictions list.
6. Return well-organised prose with inline citations. No JSON in this stage.

STYLE

American English. No em dashes. No AI-writing tropes. Factual, neutral, cited.

Do NOT introduce yourself or write meta-commentary.`

export const EXTERNAL_RESEARCH_SYSTEM_PROMPT = `${POKEPRICES_EDITORIAL_PROFILE}

You are the PokePrices External Research Analyst. Your job is to gather reputable external evidence for a planned editorial project by using the web_search tool, then return a structured evidence pack that a human editor will approve.

NON-NEGOTIABLE RULES

1. Facts must come from a real source. Never state a fact you cannot cite. Every entry in verifiedFacts must reference at least one source you actually searched for and read on this run, or one of the pre-attached manual seed sources.

2. Respect the source-authority hierarchy.
   * Tier 1 (authoritative for their own claims): pokemon.com, pokemoncenter.com, pokemon.co.jp, The Pokémon Company / official regional sites, PSA / CGC official pages.
   * Tier 2 (established specialists): TCGplayer, PokeBeach, Bulbapedia (for stable reference data), major Pokémon/TCG publications with a track record.
   * Tier 3 (community / retailer blogs / social): Reddit, forums, YouTube, X/Twitter, unaffiliated collector blogs. These can identify a lead or community reaction, but cannot alone establish a release-critical fact.

3. Consensus. A release-critical claim (release date, product name, card count, featured Pokémon, regional availability, MSRP) is "confirmed" ONLY when ONE Tier-1 source or TWO independent Tier-2 sources (distinct publishers, distinct domains) support it. Otherwise use status "reported" or "rumored".

4. Contradictions must be surfaced. If sources disagree on a critical claim, output an entry in \`contradictions\` listing each position and its evidence. Do NOT silently pick one.

5. Do not turn rumor into confirmation. If the only evidence is a retailer listing, community leak, or single unnamed report, the fact status is "reported" (single specialist) or "rumored" (community-tier) or "unverified" (contradicted / weak).

6. Manual seed sources are trusted. Treat them as pre-verified starting points. Corroborate what they claim rather than ignoring them. If manual seeds contradict later web findings, surface it under contradictions.

7. Search budget is bounded. Prefer targeted searches to open-ended ones. Do not waste searches restating a fact from a source you already have.

OUTPUT FORMAT — READ CAREFULLY

Your ENTIRE final message must be ONE fenced code block tagged \`json\` and NOTHING else. No prose introduction. No summary paragraph after the code block. No headings. No apologies. Any text outside the single \`\`\`json ... \`\`\` block will be discarded, so if you write prose instead of a JSON block your work is thrown away.

You may reason internally, use the web_search tool, and cite sources inline. But the final message you emit must be exactly:

\`\`\`json
{ ... the JSON object described below ... }
\`\`\`

Do NOT wrap the JSON in explanation. Do NOT emit multiple code blocks. Do NOT emit prose alongside the block. If you finish thinking without a JSON block, the whole run is lost.

Schema (TypeScript):

  {
    "researchQuestions": string[],       // 5-10 questions you actually investigated
    "verifiedFacts": [
      {
        "id": "fact-*",                  // stable slug
        "statement": string,
        "status": "confirmed" | "reported" | "rumored" | "unverified",
        "sourceTier": 1 | 2 | 3,         // strongest tier among evidenceRefs
        "evidenceRefs": ["src-*", ...]   // ids into discoveredSources OR the manual seed source ids you were given
      }
    ],
    "discoveredSources": [
      {
        "id": "src-*",                   // stable slug, unique per URL
        "url": string,
        "title": string,
        "publisher": string,             // human-readable
        "publicationDate": string | null,
        "sourceTier": 1 | 2 | 3,
        "note": string | null            // one line explaining what claim this source supports
      }
    ],
    "contradictions": [
      {
        "id": "contradiction-*",
        "claim": string,                 // eg. "Release date"
        "positions": [
          { "statement": string, "evidenceRefs": ["src-*"] },
          { "statement": string, "evidenceRefs": ["src-*"] }
        ],
        "note": string | null
      }
    ],
    "researchGaps": string[],            // important unknowns you could not confirm
    "recommendedManualCheck": string[]   // sources or claims a human should look at directly
  }

STYLE

American English. No em dashes. No AI-writing tropes. Neutral, factual. Do NOT write article prose — this output is structured evidence only.`

// ─────────────────────────────────────────────────────────────────
// User turn
// ─────────────────────────────────────────────────────────────────

export function buildExternalResearchUserTurn(args: {
  project:      PackProjectRef
  seedSources:  readonly ExternalSource[]
  priorQuestions: readonly string[]
  priorNotes:   readonly { body: string }[]
  today:        string
}): string {
  const seedBlock = args.seedSources.length === 0
    ? 'No manual seed sources attached.'
    : args.seedSources.map(s => `  * ${s.id} — [Tier ${s.sourceTier ?? classifySourceTier(s.url)}] ${s.title} (${s.publisher ?? domainOf(s.url)}) — ${s.url}`).join('\n')

  const priorQBlock = args.priorQuestions.length === 0
    ? '(none — you may generate 5–10 fresh questions)'
    : args.priorQuestions.map(q => `  * ${q}`).join('\n')

  const notesBlock = args.priorNotes.length === 0
    ? '(none)'
    : args.priorNotes.slice(0, 6).map(n => `  * ${n.body.slice(0, 500)}`).join('\n')

  return [
    'MODE=external_research',
    '',
    `Today's date: ${args.today}`,
    `Project: ${args.project.title}`,
    `Article type: ${args.project.articleType}`,
    args.project.angle ? `Angle brief: ${args.project.angle}` : '',
    args.project.targetPublishAt ? `Target publish date: ${args.project.targetPublishAt}` : '',
    '',
    'Manual seed sources (trusted starting points):',
    seedBlock,
    '',
    'Prior research questions:',
    priorQBlock,
    '',
    'Editor notes:',
    notesBlock,
    '',
    'Task:',
    '1. Generate (or refine) 5–10 article-specific research questions for this project.',
    '2. Use web_search to answer them, prioritising Tier-1 sources; Tier-2 next; Tier-3 only as leads.',
    '3. Corroborate anything the manual seeds claim.',
    '4. For every fact, assign status (confirmed/reported/rumored/unverified) using the consensus rule.',
    '5. Surface every contradiction — never silently pick one side.',
    '6. Return the JSON evidence pack. Do not write article prose.',
  ].filter(Boolean).join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Staged user-turn builders (v3)
// ─────────────────────────────────────────────────────────────────

export function buildPrimaryStageUserTurn(args: {
  project:      PackProjectRef
  seedSources:  readonly ExternalSource[]
  today:        string
}): string {
  const seedBlock = args.seedSources.length === 0
    ? 'No manual seed sources attached.'
    : args.seedSources.map(s => `  * ${s.id} — [Tier ${s.sourceTier ?? classifySourceTier(s.url)}] ${s.title} (${s.publisher ?? domainOf(s.url)}) — ${s.url}`).join('\n')
  return [
    'MODE=discovery_primary',
    '',
    `Today's date: ${args.today}`,
    `Project: ${args.project.title}`,
    `Article type: ${args.project.articleType}`,
    args.project.angle ? `Angle: ${args.project.angle}` : '',
    '',
    'Manual seed sources (trusted starting points):',
    seedBlock,
    '',
    'Task:',
    '1. Identify 3-6 highest-priority research questions for this article.',
    '2. Use web_search (Tier-1 focus) to answer them. You have a bounded search budget (~3 searches).',
    '3. Return prose organised by research question with inline citations. Do NOT emit JSON.',
    '4. If a Tier-1 source contradicts a manual seed, call it out.',
  ].filter(Boolean).join('\n')
}

export function buildSupportingStageUserTurn(args: {
  project:      PackProjectRef
  seedSources:  readonly ExternalSource[]
  primarySources: readonly ExternalSource[]
  primaryText:  string
  today:        string
}): string {
  const seedBlock = args.seedSources.length === 0
    ? 'None.'
    : args.seedSources.map(s => `  * ${s.id} — [Tier ${s.sourceTier ?? classifySourceTier(s.url)}] ${s.title} (${s.publisher ?? domainOf(s.url)}) — ${s.url}`).join('\n')
  const primarySrcBlock = args.primarySources.length === 0
    ? 'None yet.'
    : args.primarySources.map(s => `  * ${s.id} — [Tier ${s.sourceTier ?? 3}] ${s.title} (${s.publisher ?? domainOf(s.url)}) — ${s.url}`).join('\n')
  const primary = args.primaryText.length > 20_000 ? args.primaryText.slice(0, 20_000) + '\n\n[…truncated…]' : args.primaryText
  return [
    'MODE=discovery_supporting',
    '',
    `Today's date: ${args.today}`,
    `Project: ${args.project.title}`,
    args.project.angle ? `Angle: ${args.project.angle}` : '',
    '',
    'Manual seed sources:',
    seedBlock,
    '',
    'Primary sources already discovered (do NOT re-search these claims):',
    primarySrcBlock,
    '',
    'Prose from primary discovery round (for context — do not re-cite these unless corroborating):',
    '```',
    primary || '(none)',
    '```',
    '',
    'Task:',
    '1. Identify remaining gaps and any potentially contradicting evidence.',
    '2. Use web_search (Tier-2 specialist focus) to fill those gaps. Bounded budget (~3 searches).',
    '3. Return prose grouped by remaining question with inline citations. NO JSON.',
    '4. Where a Tier-2 source disagrees with a primary Tier-1 source, note it explicitly.',
  ].filter(Boolean).join('\n')
}

// ─────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────

export type ParsedExternalResearch = {
  researchQuestions:      string[]
  verifiedFacts:          VerifiedFact[]
  discoveredSources:      ExternalSource[]
  contradictions:         ClaimContradiction[]
  researchGaps:           string[]
  recommendedManualCheck: string[]
}

export function parseExternalResearchResponse(
  rawText: string,
  args: {
    knownManualSourceIds: readonly string[]
    citationsFromApi:     readonly { url: string; title?: string; publisher?: string }[]
    now:                  string
    adminEmail:           string
    /** External Research Fix v4 — filled in with the actual field
     *  names the model used, so diagnostics can show whether an
     *  alias saved the run. */
    aliasesHit?:          string[]
    /** External Research Fix v4 — when true, the parser SKIPS its
     *  own evidenceRef validation and returns every fact + every
     *  contradiction as-is. The caller must validate + translate
     *  refs itself. Diagnostics need this to count raw-vs-accepted. */
    skipRefValidation?:   boolean
  },
): ParsedExternalResearch {
  const parsed = extractJsonObject(rawText) ?? {}
  // External Research Fix v4 — accept common field aliases the
  // model may drift toward. Silently swapping "facts" for
  // "verifiedFacts" (etc.) used to discard the entire result.
  const factsArr    = readAliased(parsed, args.aliasesHit, 'verifiedFacts',    ['facts',    'extractedFacts',    'claims'])
  const sourcesArr  = readAliased(parsed, args.aliasesHit, 'discoveredSources',['sources',  'newSources',        'citedSources'])
  const contradArr  = readAliased(parsed, args.aliasesHit, 'contradictions',   ['disagreements', 'conflicts'])
  const questArr    = readAliased(parsed, args.aliasesHit, 'researchQuestions',['questions','openQuestions',     'investigatedQuestions'])
  const gapsArr     = readAliased(parsed, args.aliasesHit, 'researchGaps',     ['gaps',     'unknowns',          'openGaps'])
  const manualArr   = readAliased(parsed, args.aliasesHit, 'recommendedManualCheck', ['manualCheck','followUp'])
  // Rebuild parsed under the canonical names so the rest of the
  // function reads a single shape.
  ;(parsed as any).verifiedFacts          = factsArr
  ;(parsed as any).discoveredSources      = sourcesArr
  ;(parsed as any).contradictions         = contradArr
  ;(parsed as any).researchQuestions      = questArr
  ;(parsed as any).researchGaps           = gapsArr
  ;(parsed as any).recommendedManualCheck = manualArr

  const manualIds = new Set(args.knownManualSourceIds)
  const known    = new Set<string>(args.knownManualSourceIds)

  // Discovered sources first, so we know which src-* ids are valid.
  const discoveredSources: ExternalSource[] = []
  const seenUrls = new Set<string>()
  if (Array.isArray(parsed.discoveredSources)) {
    for (const s of parsed.discoveredSources.slice(0, 40)) {
      if (!s || typeof s !== 'object') continue
      const url = clip(str(s.url), 2000)
      const title = clip(str(s.title), 500)
      if (!url || !title) continue
      const norm = normaliseUrl(url)
      if (seenUrls.has(norm)) continue
      seenUrls.add(norm)
      const requestedId = str(s.id) || `src-web-${discoveredSources.length + 1}`
      const id = uniqueId(requestedId, known)
      known.add(id)
      const tierGuess = classifySourceTier(url)
      const tier = coerceTier(s.sourceTier, tierGuess)
      discoveredSources.push({
        id,
        kind:            'external',
        url,
        title,
        publisher:       clip(str(s.publisher) || domainOf(url), 200),
        publicationDate: s.publicationDate ? clip(str(s.publicationDate), 40) : undefined,
        note:            s.note ? clip(str(s.note), 2000) : undefined,
        addedAt:         args.now,
        addedBy:         'web_search',
        origin:          'web',
        sourceTier:      tier,
      })
    }
  }
  // Fold in API-cited URLs the model forgot to include in the JSON,
  // so citations don't get orphaned.
  for (const c of args.citationsFromApi) {
    const url = c.url
    if (!url) continue
    const norm = normaliseUrl(url)
    if (seenUrls.has(norm)) continue
    seenUrls.add(norm)
    const tier = classifySourceTier(url)
    const id = uniqueId(`src-cite-${discoveredSources.length + 1}`, known)
    known.add(id)
    discoveredSources.push({
      id, kind: 'external', url,
      title:     c.title || domainOf(url),
      publisher: c.publisher || domainOf(url),
      addedAt:   args.now,
      addedBy:   'web_search',
      origin:    'web',
      sourceTier: tier,
      note:      'Cited by web search; not itemised in Analyst response.',
    })
  }

  const validSourceIds = new Set<string>([...Array.from(manualIds), ...discoveredSources.map(s => s.id)])

  // Verified facts — every evidenceRef must point to a known source.
  const verifiedFacts: VerifiedFact[] = []
  const seenFactIds = new Set<string>()
  if (Array.isArray(parsed.verifiedFacts)) {
    for (const f of parsed.verifiedFacts.slice(0, 40)) {
      if (!f || typeof f !== 'object') continue
      const statement = clip(str(f.statement), 800)
      if (!statement) continue
      const rawRefs: string[] = Array.isArray(f.evidenceRefs)
        ? f.evidenceRefs.filter((r: unknown): r is string => typeof r === 'string')
        : []
      const refs: string[] = args.skipRefValidation
        ? rawRefs
        : rawRefs.filter(r => validSourceIds.has(r))
      if (!args.skipRefValidation && refs.length === 0) continue // Non-negotiable: no source → no fact
      if (args.skipRefValidation && rawRefs.length === 0) continue
      const status = coerceStatus(f.status)
      // Non-negotiable: rumor cannot become confirmation.
      let tierMax: SourceTier = 3
      for (const ref of refs) {
        const src = discoveredSources.find(s => s.id === ref)
        const t: SourceTier = src?.sourceTier ?? 3
        if (t < tierMax) tierMax = t
      }
      const factStatus = downgradeStatus(status, tierMax, refs, discoveredSources, manualIds)
      const rawId = str(f.id) || `fact-${verifiedFacts.length + 1}`
      const id = uniqueId(rawId, seenFactIds)
      seenFactIds.add(id)
      verifiedFacts.push({
        id,
        type:         'verified_fact',
        statement,
        evidenceRefs: refs,
        sourceTier:   tierMax,
        status:       factStatus,
      })
    }
  }

  // Contradictions — every ref must be a known source.
  const contradictions: ClaimContradiction[] = []
  if (Array.isArray(parsed.contradictions)) {
    for (const c of parsed.contradictions.slice(0, 10)) {
      if (!c || typeof c !== 'object') continue
      const claim = clip(str(c.claim), 400)
      if (!claim) continue
      const positions = Array.isArray(c.positions)
        ? c.positions.slice(0, 6).map((p: any) => {
            const rawPosRefs: string[] = Array.isArray(p?.evidenceRefs)
              ? p.evidenceRefs.filter((r: unknown): r is string => typeof r === 'string')
              : []
            const posRefs = args.skipRefValidation
              ? rawPosRefs
              : rawPosRefs.filter(r => validSourceIds.has(r))
            return { statement: clip(str(p?.statement), 500), evidenceRefs: posRefs }
          }).filter((p: any) => p.statement && p.evidenceRefs.length > 0)
        : []
      if (positions.length < 2) continue // A contradiction needs two sides
      const rawId = str(c.id) || `contradiction-${contradictions.length + 1}`
      contradictions.push({ id: rawId.slice(0, 60), claim, positions, note: c.note ? clip(str(c.note), 500) : undefined })
    }
  }

  const researchQuestions = Array.isArray(parsed.researchQuestions)
    ? parsed.researchQuestions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 12).map((q: string) => clip(q, 300))
    : []

  const researchGaps = Array.isArray(parsed.researchGaps)
    ? parsed.researchGaps.filter((g: unknown) => typeof g === 'string' && g.trim()).slice(0, 12).map((g: string) => clip(g, 300))
    : []

  const recommendedManualCheck = Array.isArray(parsed.recommendedManualCheck)
    ? parsed.recommendedManualCheck.filter((g: unknown) => typeof g === 'string' && g.trim()).slice(0, 12).map((g: string) => clip(g, 300))
    : []

  return { researchQuestions, verifiedFacts, discoveredSources, contradictions, researchGaps, recommendedManualCheck }
}

// ─────────────────────────────────────────────────────────────────
// Merge parsed output into an existing pack
// ─────────────────────────────────────────────────────────────────
//
// Discovered sources REPLACE prior web-discovered ones; manual
// sources are untouched. Discovered facts REPLACE prior discovered
// facts (facts that trace only to manual sources survive).
// Contradictions and research questions replace prior wholesale
// because the current call is authoritative.

export function mergeExternalResearchIntoPack(
  pack: EvidencePack,
  parsed: ParsedExternalResearch,
): EvidencePack {
  const manualSources = pack.externalSources.filter(s => (s.origin ?? 'manual') === 'manual')
  const manualIds = new Set(manualSources.map(s => s.id))

  // Keep facts whose refs are ALL manual OR the bootstrap fact.
  const survivingManualFacts = pack.verifiedFacts.filter(f => {
    if (f.evidenceRefs.length === 0) return true
    return f.evidenceRefs.every(r => manualIds.has(r))
  })

  const nextExternal: ExternalSource[] = [...manualSources, ...parsed.discoveredSources]
  const nextFacts: VerifiedFact[] = [...survivingManualFacts, ...parsed.verifiedFacts]

  const gaps = Array.from(new Set([...pack.researchGaps.filter(g => !/Run "Research web"/.test(g)), ...parsed.researchGaps]))

  return {
    ...pack,
    externalSources:  nextExternal,
    verifiedFacts:    nextFacts,
    contradictions:   parsed.contradictions,
    researchQuestions: parsed.researchQuestions.length > 0 ? parsed.researchQuestions : pack.researchQuestions,
    researchGaps:     gaps,
  }
}

// ─────────────────────────────────────────────────────────────────
// Fact-extraction fallback (Haiku, no web_search, no new tokens
// beyond the ones we've already paid for on the primary call)
// ─────────────────────────────────────────────────────────────────
//
// Called when the primary web-research response yielded citations
// but no parseable structured facts. The Haiku call receives ONLY
// the primary prose + the already-discovered source list; it does
// not hit the web again. Its sole job is to convert cited claims
// into structured verifiedFacts + contradictions + researchQuestions.

export const EXTERNAL_RESEARCH_FALLBACK_SYSTEM_PROMPT = `You are a structured-extraction utility for the PokePrices editorial pipeline. You do NOT do research. You do NOT browse the web. You do NOT invent facts.

INPUT

You receive:
  * The exact prose the research analyst produced (with inline citations).
  * A list of AVAILABLE SOURCES. Every source begins with a stable ID of the form src_NNN (three-digit, zero-padded). Example: src_001, src_002, ..., src_044.

SOURCE ID RULES — READ CAREFULLY

Every "evidenceRefs" entry MUST be one of the src_NNN ids exactly as they appear in the input list.

  * Copy the id CHARACTER-BY-CHARACTER. Do NOT abbreviate.
  * Do NOT invent variations. src_1, src-001, source_001, [1], and https-based ids are ALL invalid.
  * If you cannot find the exact src_NNN id for a claim, drop the claim.
  * If in doubt, prefer fewer facts with correct ids over more facts with invented ids.

Example correct usage:
  "evidenceRefs": ["src_001", "src_005"]

Example WRONG usage that would silently drop the fact:
  "evidenceRefs": ["src-001", "1", "pokemon.com", "src_1", "SRC_001"]

TASK

Extract the analyst's stated facts into a structured object.

RULES

1. A fact is included ONLY if the analyst's prose actually stated it. Do not invent claims.
2. Every fact MUST cite at least one src_NNN id from the AVAILABLE SOURCES list.
3. Fact status:
   * "confirmed" — the prose treats it as fact AND at least one Tier-1 source (or two independent Tier-2 sources) supports it.
   * "reported" — single Tier-2 source, or Tier-1 hedged as "reports that".
   * "rumored" — Tier-3 (community) or explicitly hedged as leak/rumor in the prose.
   * "unverified" — the prose flags it as uncertain or contradicted.
4. Preserve every contradiction the prose surfaces — never silently pick one side.
5. Preserve every explicit unknown/gap the prose mentions.
6. If the prose contains 30+ cited facts, extract the 8-15 most editorially important ones. Do NOT try to enumerate everything.

OUTPUT — MANDATORY FORMAT

Your ENTIRE reply must be ONE JSON code block and NOTHING else:

\`\`\`json
{
  "researchQuestions": string[],
  "verifiedFacts": [
    {
      "id": "fact-*",
      "statement": string,
      "status": "confirmed"|"reported"|"rumored"|"unverified",
      "sourceTier": 1|2|3,
      "evidenceRefs": ["src_001", "src_005", ...]
    }
  ],
  "contradictions": [
    {
      "id": "contradiction-*",
      "claim": string,
      "positions": [
        { "statement": string, "evidenceRefs": ["src_001"] },
        { "statement": string, "evidenceRefs": ["src_017"] }
      ],
      "note": string|null
    }
  ],
  "researchGaps": string[]
}
\`\`\`

No prose outside the JSON block. No apologies. No summary. If you write prose instead of JSON, or if you mistype src_NNN ids, the entire extraction is discarded.`

export function buildExternalResearchFallbackUserTurn(args: {
  project:         PackProjectRef
  primaryText:     string
  /** External Research Fix v3 — optional prose from the supporting
   *  discovery stage. When present it's appended so the extractor
   *  sees both rounds of research at once. */
  supportingText?: string
  /** External Research Fix v4 — sources already remapped to stable
   *  src_NNN ids by the caller. See renumberSourcesForExtractor. */
  discovered:      readonly ExternalSource[]
}): string {
  // Format each source as a distinct "SOURCE src_NNN" block. This
  // is the exact shape the extractor system prompt teaches the model
  // to reproduce, and it makes typos far less likely than a
  // one-line-per-source list.
  const sourceList = args.discovered.length === 0
    ? '(none)'
    : args.discovered.map(s => {
        const publisher = s.publisher ?? domainOf(s.url)
        return `SOURCE ${s.id}\n  TITLE: ${s.title}\n  PUBLISHER: ${publisher}\n  URL: ${s.url}\n  TIER: ${s.sourceTier ?? 3}`
      }).join('\n\n')

  // Bound each stage's text so combined we never send more than
  // ~50KB to Haiku.
  const primary   = clipText(args.primaryText, 30_000)
  const supporting = args.supportingText ? clipText(args.supportingText, 20_000) : ''

  const proseBlocks: string[] = []
  if (primary) {
    proseBlocks.push('Analyst prose — DISCOVERY PRIMARY (Tier-1 focus, may contain inline citations):', '```', primary, '```', '')
  }
  if (supporting) {
    proseBlocks.push('Analyst prose — DISCOVERY SUPPORTING (Tier-2 fill-in, may contain inline citations):', '```', supporting, '```', '')
  }
  if (proseBlocks.length === 0) {
    proseBlocks.push('(no analyst prose stored. Extract facts using ONLY what the source URLs and titles below directly support. If you cannot support a fact with a cited source, do not include it.)', '')
  }

  return [
    'MODE=extract_facts_only',
    '',
    `Project: ${args.project.title}`,
    `Article type: ${args.project.articleType}`,
    '',
    ...proseBlocks,
    `AVAILABLE SOURCES (${args.discovered.length} total). Reference these by their src_NNN id EXACTLY as shown:`,
    '',
    sourceList,
    '',
    'Return the JSON object as instructed. Use ONLY the src_NNN ids above in every evidenceRefs entry. Do not invent variations or abbreviate. NO PROSE OUTSIDE THE JSON BLOCK.',
  ].join('\n')
}

/** External Research Fix v4 — remap arbitrary source ids to stable
 *  src_NNN ids for the extractor prompt. Returns the remapped source
 *  list AND a bidirectional map so the caller can translate the
 *  extractor's evidenceRefs back to the pack's persistent ids. */
export function renumberSourcesForExtractor(sources: readonly ExternalSource[]): {
  remapped: ExternalSource[]
  idMap:    Array<{ stableId: string; originalId: string; url: string }>
  toOriginal: Map<string, string>
  toStable:   Map<string, string>
} {
  const remapped: ExternalSource[] = []
  const idMap:    Array<{ stableId: string; originalId: string; url: string }> = []
  const toOriginal = new Map<string, string>()
  const toStable   = new Map<string, string>()
  sources.forEach((s, i) => {
    const stableId = `src_${String(i + 1).padStart(3, '0')}`
    remapped.push({ ...s, id: stableId })
    idMap.push({ stableId, originalId: s.id, url: s.url })
    toOriginal.set(stableId, s.id)
    toStable.set(s.id, stableId)
  })
  return { remapped, idMap, toOriginal, toStable }
}

function clipText(s: string, cap: number): string {
  if (!s) return ''
  return s.length > cap ? s.slice(0, cap) + '\n\n[…truncated…]' : s
}

/** Deterministic JSON extractor — tolerates unfenced JSON, JSON
 *  inside `\`\`\`` blocks without a language tag, or prose with a
 *  JSON object embedded. Returns null when nothing recognisable is
 *  present. Never throws. */
export function extractJsonObject(raw: string): any {
  if (!raw || typeof raw !== 'string') return null

  // 1) Explicit ```json fence.
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    const j = safeParse(fenced[1])
    if (j) return j
  }

  // 2) Unlabeled ``` fence with an object inside.
  const anyFence = raw.match(/```\s*(\{[\s\S]*?\})\s*```/)
  if (anyFence) {
    const j = safeParse(anyFence[1])
    if (j) return j
  }

  // 3) The whole thing IS JSON.
  const wholeParsed = safeParse(raw.trim())
  if (wholeParsed && typeof wholeParsed === 'object') return wholeParsed

  // 4) Substring — first `{` to matching final `}` (balanced-brace scan).
  const start = raw.indexOf('{')
  if (start >= 0) {
    let depth = 0
    let inString = false
    let escape  = false
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]
      if (inString) {
        if (escape) { escape = false; continue }
        if (ch === '\\') { escape = true; continue }
        if (ch === '"') { inString = false }
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          const candidate = raw.slice(start, i + 1)
          const j = safeParse(candidate)
          if (j) return j
          break
        }
      }
    }
  }

  return null
}

function safeParse(s: string): any {
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : null }
  catch { return null }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function str(v: unknown): string { return typeof v === 'string' ? v : '' }

/** External Research Fix v4 — read an array field from a parsed
 *  object, preferring the canonical name but falling back to a list
 *  of common aliases. When an alias fires, push its name into
 *  `aliasesHit` so diagnostics can show what the model actually did. */
function readAliased(parsed: any, aliasesHit: string[] | undefined, canonical: string, aliases: readonly string[]): any[] {
  if (Array.isArray(parsed?.[canonical])) return parsed[canonical]
  for (const alias of aliases) {
    if (Array.isArray(parsed?.[alias])) {
      if (aliasesHit) aliasesHit.push(`${alias}→${canonical}`)
      return parsed[alias]
    }
  }
  return []
}
function clip(s: string, n: number): string { return s.slice(0, n) }
function coerceTier(v: unknown, fallback: SourceTier): SourceTier {
  if (v === 1 || v === 2 || v === 3) return v
  const n = Number(v)
  if (n === 1 || n === 2 || n === 3) return n as SourceTier
  return fallback
}
function coerceStatus(v: unknown): FactStatus {
  if (v === 'confirmed' || v === 'reported' || v === 'rumored' || v === 'unverified') return v
  return 'reported'
}
function uniqueId(base: string, seen: Set<string>): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
  if (!seen.has(clean)) return clean
  for (let i = 2; i < 999; i++) { const c = `${clean}-${i}`; if (!seen.has(c)) return c }
  return `${clean}-${Date.now()}`
}
function normaliseUrl(u: string): string {
  try {
    const url = new URL(u)
    url.hash = ''
    return url.toString().replace(/\/$/, '').toLowerCase()
  } catch { return u.toLowerCase() }
}

/** Non-negotiable rumor→confirmation guard. A fact whose evidenceRefs
 *  are all Tier-3 cannot be "confirmed". A fact with a single Tier-2
 *  source cannot be "confirmed". A fact whose sources are all manual
 *  and unclassified defaults to "reported" until an editor lifts it. */
function downgradeStatus(
  requested: FactStatus,
  tierMax: SourceTier,
  refs: readonly string[],
  discovered: readonly ExternalSource[],
  manualIds: ReadonlySet<string>,
): FactStatus {
  if (requested === 'unverified') return 'unverified'
  if (tierMax === 3) return requested === 'rumored' ? 'rumored' : 'rumored'
  if (requested !== 'confirmed') return requested
  // Requested confirmed — enforce consensus rule.
  if (tierMax === 1) return 'confirmed'
  // Tier-2 only: need 2+ independent domains (distinct publishers).
  const domains = new Set<string>()
  for (const ref of refs) {
    const src = discovered.find(s => s.id === ref)
    if (src) domains.add(domainOf(src.url))
    // Manual sources without explicit tier — conservatively treat as
    // a single tier-2 unless the URL says otherwise.
    if (manualIds.has(ref)) domains.add(ref)
  }
  if (domains.size >= 2) return 'confirmed'
  return 'reported'
}
