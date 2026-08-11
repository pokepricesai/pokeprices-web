// app/api/deep-search/parse/route.ts
//
// Block 5A-W-56A — Deep Card Search natural-language → filter parser.
//
// Small dedicated endpoint (not the general conversational chat) that
// takes a single natural-language query and returns a strict JSON
// filter payload matching the client-side DeepCardSearchFilters type.
// The model NEVER returns card records — it only produces filters +
// sort + a list of unsupported terms.

import { NextResponse } from 'next/server'
import { poundsToUsdCents, SORT_KEYS } from '@/lib/deepSearch/filters'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || ''
const HAIKU_MODEL = 'claude-haiku-4-5'

// Anonymous rate limit — per-instance in-memory. Not shared across
// serverless invocations, so this is a soft cap not a strict limit;
// good enough to blunt casual abuse without needing Redis. Cost cap
// is ultimately Anthropic's own quota.
const RATE_LIMIT_PER_HOUR = 20
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

type RateLimitResult = { ok: true; retryAfter?: undefined } | { ok: false; retryAfter: number }

function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now()
  const bucket = rateBuckets.get(ip)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 })
    return { ok: true }
  }
  if (bucket.count >= RATE_LIMIT_PER_HOUR) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  bucket.count += 1
  return { ok: true }
}

const SYSTEM_PROMPT = `You are a filter-extraction parser for PokePrices Deep Card Search. You NEVER return card records or invent data — you only extract the filters expressed in the user's query.

Return a JSON object with this exact shape (all keys optional):

{
  "filters": {
    "pokemonSlug": string,         // lowercase Pokémon species slug, e.g. "pikachu", "charizard", "mr-mime"
    "cardName":    string,         // free-text substring for card name, e.g. "gold star"
    "setName":     string,         // free-text substring for set, e.g. "base set"
    "language":    "en" | "jp",
    "releaseYearMin": number,      // inclusive year, e.g. 2000
    "releaseYearMax": number,
    "rawMinGbp":   number,         // GBP (£). Server converts to USD cents.
    "rawMaxGbp":   number,
    "psa7MinGbp":  number,
    "psa7MaxGbp":  number,
    "psa8MinGbp":  number,
    "psa8MaxGbp":  number,
    "psa9MinGbp":  number,
    "psa9MaxGbp":  number,
    "psa10MinGbp": number,
    "psa10MaxGbp": number,
    "change7dMin":  number,        // percent, e.g. 20 or -25
    "change7dMax":  number,
    "change30dMin": number,
    "change30dMax": number,
    "change90dMin": number,
    "change90dMax": number,
    "psa9UpliftMinGbp":  number,
    "psa10UpliftMinGbp": number,
    "psa9MultipleMin":   number,   // e.g. 4 means PSA 9 is at least 4× raw
    "psa10MultipleMin":  number
  },
  "sort": "name_asc" | "name_desc" | "pokemon_asc" | "set_asc" | "release_desc" | "release_asc" | "raw_asc" | "raw_desc" | "psa7_asc" | "psa7_desc" | "psa8_asc" | "psa8_desc" | "psa9_asc" | "psa9_desc" | "psa10_asc" | "psa10_desc" | "change_7d_desc" | "change_7d_asc" | "change_30d_desc" | "change_30d_asc" | "change_90d_desc" | "change_90d_asc" | "psa9_uplift_desc" | "psa10_uplift_desc" | "psa9_multiple_desc" | "psa10_multiple_desc",
  "unsupported_terms": string[]    // human-readable list of ANY terms in the query that this filter set does not model, e.g. ["liquidity", "sales volume"]
}

Rules:
- Only include filter keys you can extract with high confidence.
- If the user asked for something the schema does not cover (liquidity, popularity, sales volume, grading probability, quantity, availability, region, seller, condition beyond PSA grades), add a natural-language phrase to unsupported_terms — never fake it into another filter.
- "under £X" → *MaxGbp = X. "over £X" → *MinGbp = X. "less than X%" → *Max = X.
- "down X%" over N days → change{N}dMax = -X.  "up X%" → change{N}dMin = X.
- "before YEAR" → releaseYearMax = YEAR - 1.  "after YEAR" → releaseYearMin = YEAR + 1.
- Return ONLY the JSON object, no prose, no markdown fences.`

interface ParsedModelOutput {
  filters?: Record<string, unknown>
  sort?:    string
  unsupported_terms?: unknown[]
}

// Whitelist maps directly to DeepCardSearchFilters keys or GBP-suffixed
// variants that we convert to USD cents here. Anything the model
// returns outside this list is silently dropped.
const NUMERIC_KEY_MAP: Record<string, { targetKey: string; convertPoundsToCents: boolean }> = {
  releaseYearMin:    { targetKey: 'releaseYearMin',    convertPoundsToCents: false },
  releaseYearMax:    { targetKey: 'releaseYearMax',    convertPoundsToCents: false },
  rawMinGbp:         { targetKey: 'rawMin',            convertPoundsToCents: true  },
  rawMaxGbp:         { targetKey: 'rawMax',            convertPoundsToCents: true  },
  psa7MinGbp:        { targetKey: 'psa7Min',           convertPoundsToCents: true  },
  psa7MaxGbp:        { targetKey: 'psa7Max',           convertPoundsToCents: true  },
  psa8MinGbp:        { targetKey: 'psa8Min',           convertPoundsToCents: true  },
  psa8MaxGbp:        { targetKey: 'psa8Max',           convertPoundsToCents: true  },
  psa9MinGbp:        { targetKey: 'psa9Min',           convertPoundsToCents: true  },
  psa9MaxGbp:        { targetKey: 'psa9Max',           convertPoundsToCents: true  },
  psa10MinGbp:       { targetKey: 'psa10Min',          convertPoundsToCents: true  },
  psa10MaxGbp:       { targetKey: 'psa10Max',          convertPoundsToCents: true  },
  change7dMin:       { targetKey: 'change7dMin',       convertPoundsToCents: false },
  change7dMax:       { targetKey: 'change7dMax',       convertPoundsToCents: false },
  change30dMin:      { targetKey: 'change30dMin',      convertPoundsToCents: false },
  change30dMax:      { targetKey: 'change30dMax',      convertPoundsToCents: false },
  change90dMin:      { targetKey: 'change90dMin',      convertPoundsToCents: false },
  change90dMax:      { targetKey: 'change90dMax',      convertPoundsToCents: false },
  psa9UpliftMinGbp:  { targetKey: 'psa9UpliftMin',     convertPoundsToCents: true  },
  psa10UpliftMinGbp: { targetKey: 'psa10UpliftMin',    convertPoundsToCents: true  },
  psa9MultipleMin:   { targetKey: 'psa9MultipleMin',   convertPoundsToCents: false },
  psa10MultipleMin:  { targetKey: 'psa10MultipleMin',  convertPoundsToCents: false },
}
const STRING_KEYS = ['pokemonSlug', 'cardName', 'setName']

/** Validate + coerce the model's raw output into the strict client
 *  filter schema. Discards unknown keys, drops NaN/Infinity, rejects
 *  the sort if it isn't in the enum. Pure. */
export function validateParsedOutput(raw: ParsedModelOutput): {
  filters: Record<string, unknown>
  sort: string | undefined
  unsupported_terms: string[]
} {
  const outFilters: Record<string, unknown> = {}
  const inputFilters = (raw?.filters ?? {}) as Record<string, unknown>
  for (const k of STRING_KEYS) {
    const v = inputFilters[k]
    if (typeof v === 'string' && v.trim()) {
      outFilters[k] = k === 'pokemonSlug' ? v.trim().toLowerCase() : v.trim()
    }
  }
  const lang = inputFilters['language']
  if (lang === 'en' || lang === 'jp') outFilters.language = lang
  for (const [modelKey, spec] of Object.entries(NUMERIC_KEY_MAP)) {
    const v = inputFilters[modelKey]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (spec.convertPoundsToCents) {
      const cents = poundsToUsdCents(v)
      if (cents == null) continue
      outFilters[spec.targetKey] = cents
    } else {
      outFilters[spec.targetKey] = v
    }
  }
  const sort = typeof raw?.sort === 'string' && (SORT_KEYS as readonly string[]).includes(raw.sort)
    ? raw.sort
    : undefined
  const unsupported_terms = Array.isArray(raw?.unsupported_terms)
    ? (raw.unsupported_terms as unknown[]).filter(t => typeof t === 'string' && t.trim()).map(t => (t as string).trim())
    : []
  return { filters: outFilters, sort, unsupported_terms }
}

export async function POST(req: Request) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI parser not configured on this environment.' }, { status: 503 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
  const rl = checkRateLimit(ip)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit reached. Try again in a moment or set filters manually.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let body: { query?: unknown } = {}
  try { body = await req.json() } catch { /* body remains empty */ }
  const query = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return NextResponse.json({ error: 'Missing query.' }, { status: 400 })
  if (query.length > 500) return NextResponse.json({ error: 'Query too long (500 chars max).' }, { status: 400 })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':          ANTHROPIC_API_KEY,
        'anthropic-version':  '2023-06-01',
      },
      body: JSON.stringify({
        model:       HAIKU_MODEL,
        max_tokens:  400,
        temperature: 0,
        system:      SYSTEM_PROMPT,
        messages: [{ role: 'user', content: query }],
      }),
    })
    if (!res.ok) {
      return NextResponse.json({ error: 'Parser upstream error.' }, { status: 502 })
    }
    const payload = await res.json()
    const text = (payload?.content?.[0]?.text ?? '').toString().trim()
    // Some models wrap in ```json ... ```; strip if present.
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let parsed: ParsedModelOutput
    try { parsed = JSON.parse(jsonText) as ParsedModelOutput }
    catch { return NextResponse.json({ error: 'Parser returned unreadable output.' }, { status: 502 }) }

    const validated = validateParsedOutput(parsed)
    return NextResponse.json(validated)
  } catch {
    return NextResponse.json({ error: 'Parser failed. Set filters manually instead.' }, { status: 502 })
  }
}
