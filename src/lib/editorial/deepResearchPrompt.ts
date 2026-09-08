// src/lib/editorial/deepResearchPrompt.ts
//
// EIC — deterministic generator for the Deep Research prompt.
//
// Delete-complexity change: for external opportunities (upcoming
// sets / news / product announcements / evergreen guides) the EIC
// no longer researches, writes, or fact-checks. It surfaces the
// opportunity and hands admin a clean prompt to paste into ChatGPT
// Deep Research. This module produces that prompt.
//
// Pure text — no AI call, no DB writes. Everything the caller needs
// to pass into a chat is present in the returned string.

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export type DeepResearchPromptInput = {
  project: {
    id:              number
    title:           string
    angle:           string | null
    articleType:     string
    targetPublishAt: string | null
  }
  /** Today, YYYY-MM-DD. Included in the prompt so time-sensitive
   *  research uses the right cutoff. */
  today:         string
  /** Curated internal PokePrices links the article can weave in. */
  internalLinks: ReadonlyArray<{ title: string; url: string }>
  /** Optional editorial note about timeliness — e.g. "Set releases
   *  in 34 days on 2026-11-15". Overrides the article-type default. */
  whyNow?:       string
}

export function buildDeepResearchPrompt(args: DeepResearchPromptInput): string {
  const angle = (args.project.angle ?? '').trim() || '(no angle specified — infer from title)'
  const whyNow = args.whyNow ?? defaultWhyNow(args)
  const questions = defaultResearchQuestions(args.project.articleType)
  const internalLinksBlock = args.internalLinks.length === 0
    ? '(none — do not invent PokePrices URLs)'
    : args.internalLinks.map(l => `- ${l.title} — https://www.pokeprices.io${l.url.startsWith('/') ? l.url : '/' + l.url}`).join('\n')

  return TEMPLATE
    .replace('{{topic}}',             args.project.title)
    .replace('{{title}}',             args.project.title)
    .replace('{{angle}}',             angle)
    .replace('{{whyNow}}',            whyNow)
    .replace('{{currentDate}}',       args.today)
    .replace('{{researchQuestions}}', questions.map((q, i) => `${i + 1}. ${q}`).join('\n'))
    .replace('{{internalLinks}}',     internalLinksBlock)
}

// ─────────────────────────────────────────────────────────────────
// Template — the exact shape from spec
// ─────────────────────────────────────────────────────────────────

const TEMPLATE = `You are writing a finished SEO article for PokePrices, a Pokémon TCG pricing and collector website.

TOPIC:
{{topic}}

PROPOSED TITLE:
{{title}}

ANGLE:
{{angle}}

WHY NOW:
{{whyNow}}

CURRENT DATE:
{{currentDate}}

Research this topic thoroughly using the live web, then write the finished article.

Prioritize sources in this order:

1. Official Pokémon / Pokémon TCG / Pokémon Center sources
2. Established Pokémon TCG publications such as PokeBeach, Bulbapedia and TCGplayer
3. Reputable specialist sources where needed

KEY QUESTIONS TO ANSWER:

{{researchQuestions}}

Writing requirements:

- Write for Pokémon card collectors and investors
- Make it factual, useful and entertaining
- Do not write like a research report or encyclopedia
- Lead with the most interesting collector angle
- Explain why important facts matter
- Use restrained editorial opinion where helpful
- Clearly distinguish confirmed information from rumor or unconfirmed reporting
- Do not invent facts
- Prefer current information where the topic is time-sensitive
- Use American English
- Do not use em dashes
- Avoid generic AI-style introductions and conclusions
- Use short readable paragraphs
- Aim for roughly 900–1,300 words unless the topic genuinely needs more
- Use 4–6 useful H2 sections
- Optimize naturally for search without keyword stuffing

INTERNAL POKEPRICES LINKS AVAILABLE:

{{internalLinks}}

Use these naturally where useful. Do not invent PokePrices URLs.

Before finalizing:

- Re-check dates
- Re-check product names
- Re-check card/set numbers
- Re-check anything described as officially confirmed
- Remove unsupported claims

Return:

- Final article title
- SEO title
- Meta description
- Finished article body
- Source list used
`

// ─────────────────────────────────────────────────────────────────
// Defaults per article type
// ─────────────────────────────────────────────────────────────────

function defaultWhyNow(args: DeepResearchPromptInput): string {
  const t = (args.project.articleType || '').toLowerCase()
  const target = args.project.targetPublishAt
  if (target) {
    const days = daysBetween(args.today, target)
    if (Number.isFinite(days) && days > 0) return `Target publish in ${days} day(s), on ${target}. Time-sensitive coverage.`
    if (Number.isFinite(days) && days <= 0) return `Target publish date (${target}) has passed — refresh with the latest information.`
  }
  if (t === 'upcoming_set' || t === 'new_set' || t === 'set_preview' || t === 'product_announcement' || t === 'release_news' || t === 'news') {
    return 'Time-sensitive coverage — collectors are actively searching for confirmed information.'
  }
  return 'Editorial opportunity identified by the PokePrices content pipeline.'
}

/** Article-type-appropriate research questions. Kept small and
 *  concrete. Deep Research runs will always augment these; this
 *  scaffolding just ensures the model doesn't miss the basics. */
function defaultResearchQuestions(articleType: string): string[] {
  const t = (articleType || '').toLowerCase()
  if (t === 'upcoming_set' || t === 'new_set' || t === 'set_preview' || t === 'product_announcement' || t === 'release_news') {
    return [
      'Has the set / product been officially announced? By whom and when?',
      'What is the confirmed release date, and does it differ by region?',
      'Which products are confirmed to be in the release (booster boxes, ETBs, tins, special collections)? What are the MSRPs where announced?',
      'How many cards are in the set? What are the rarity tiers and any new rarities?',
      'Which specific cards are already revealed, and which are the likely chase cards?',
      'Is there a Japanese counterpart? What are the notable differences (card counts, exclusives, timing)?',
      'What is genuinely unusual or notable about this release compared to prior ones?',
      'Has The Pokémon Company confirmed availability at Pokémon Center, TCGplayer, big-box retail, or LGS?',
      'Are there any reported issues, delays, or supply constraints?',
      'What do reputable Pokémon TCG publications currently say about this release?',
    ]
  }
  if (t === 'news') {
    return [
      'What exactly happened, according to which sources, and when?',
      'Which collectors, products, or storefronts are affected?',
      'What has The Pokémon Company confirmed vs what remains reported or unconfirmed?',
      'What actions, if any, can collectors take now?',
      'What is the likely near-term impact on pricing, availability, or grading?',
    ]
  }
  if (t === 'evergreen_guide' || t === 'evergreen') {
    return [
      'What are the key facts a collector needs to know about this topic?',
      'What are the common misconceptions or myths?',
      'What sources are considered authoritative on this topic?',
      'What has changed in the last 12 months, and does anything in older sources need updating?',
      'What examples or comparisons make the topic concrete for a Pokémon collector?',
    ]
  }
  if (t === 'external_research') {
    return [
      'What is the topic actually about? Provide a clean, current summary.',
      'What has been officially confirmed vs reported vs rumored?',
      'What are the key facts a collector needs to know now?',
      'Which sources are the most authoritative on this topic today?',
      'What has changed recently or is expected to change soon?',
    ]
  }
  return [
    'What is the topic actually about? Provide a clean, current summary from live sources.',
    'What are the key facts a collector needs to know?',
    'What has been officially confirmed vs reported vs rumored?',
    'What are the most authoritative sources on this topic today?',
  ]
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso)
  const to   = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN
  return Math.round((to - from) / (24 * 60 * 60 * 1000))
}
