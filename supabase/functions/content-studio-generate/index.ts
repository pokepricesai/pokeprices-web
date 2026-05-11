// Content Studio — Generate a single social post.
// Input:  { template_type, options }
// Output: a fully-formed social_content_posts row (already inserted),
//         including data_payload + Haiku-written hook/tweet/caption.
//
// Selection logic lives here (per template) so the front-end just passes
// options and gets a post back. AI is used only for copy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const HAIKU = "claude-haiku-4-5"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// Sanity caps — pct moves beyond these are almost always bad data
// (e.g. a single mispriced sale on a bulk common can show "+12,000%").
// Used to filter candidate rows from card_trends before we pick from them.
const MIN_RAW_CENTS = 500 // $5 minimum, avoids bulk junk
const MAX_PCT: Record<string, number> = {
  raw_pct_7d:   200,
  raw_pct_30d:  500,
  raw_pct_90d:  1000,
  raw_pct_365d: 2000,
  raw_pct_2y:   3000,
  raw_pct_5y:   8000,
}

function withinPctSanity(row: any): boolean {
  for (const k of Object.keys(MAX_PCT)) {
    const v = row[k]
    if (v != null && Math.abs(v) > MAX_PCT[k]) return false
  }
  return true
}

function passesConfidence(row: any, minRaw = MIN_RAW_CENTS): boolean {
  if ((row.current_raw ?? 0) < minRaw) return false
  return withinPctSanity(row)
}

function cleanCardName(s: string): string {
  return s.replace(/\s*#\d+\w*\s*$/, "").replace(/\[.*?\]/g, "").trim()
}

function gbpBudgetToUsdCents(gbp: number): number {
  // GBP to USD cents — using the same rate the app uses elsewhere (0.79).
  return Math.round((gbp / 0.79) * 100)
}

function priceTierBounds(tier: string): { min: number; max: number | null } {
  switch (tier) {
    case "under_50":  return { min: 0,      max: 5000   }
    case "50_200":    return { min: 5000,   max: 20000  }
    case "200_1000":  return { min: 20000,  max: 100000 }
    case "1000_5000": return { min: 100000, max: 500000 }
    case "5000_plus": return { min: 500000, max: null   }
    default:          return { min: 0,      max: null   }
  }
}

function timeWindowKey(w: string): string {
  switch (w) {
    case "7d":  return "raw_pct_7d"
    case "30d": return "raw_pct_30d"
    case "90d": return "raw_pct_90d"
    case "1y":  return "raw_pct_365d"
    default:    return "raw_pct_30d"
  }
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  const out: T[] = []
  while (out.length < n && copy.length) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy.splice(idx, 1)[0])
  }
  return out
}

async function callHaiku(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Haiku call failed: ${res.status} ${txt}`)
  }
  const data = await res.json()
  return data.content?.[0]?.text || ""
}

// Strip code fences and grab the first JSON object in the string.
function parseJsonFromAi(s: string): any {
  const cleaned = s.replace(/```json|```/g, "").trim()
  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")
  if (start < 0 || end < 0) throw new Error("No JSON in AI response")
  return JSON.parse(cleaned.slice(start, end + 1))
}

// ── Voice prompt (shared across every template) ─────────────────────────────

const VOICE_PROMPT = `You write social posts for PokePrices, a free Pokemon TCG price intelligence site.

Voice rules — non-negotiable:
- Human, casual, slightly punchy.
- Drive engagement with questions, not statements.
- No corporate or hypey language.
- No em-dashes anywhere ("--" or hyphens are fine).
- No fake certainty ("guaranteed", "always", "best ever").
- No emoji unless explicitly asked.
- Speak like a collector talking to other collectors.
- Keep it tight. Twitter: under 240 chars including the question. Instagram: 2 short paragraphs max, plus 3-5 hashtags.

Output: JSON object exactly matching the schema asked. No commentary, no preamble.`

// ── Template: Card Battle ───────────────────────────────────────────────────

async function generateCardBattle(options: any) {
  const { min, max } = priceTierBounds(options.price_tier || "any")

  // Pick 50 candidates in tier, ordered by something interesting then random.
  let q = supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
  if (max != null) q = q.lte("current_raw", max)
  const { data: candidates, error } = await q.order("raw_pct_30d", { ascending: false }).limit(200)
  if (error) throw error

  // Confidence filter: drop bad-data rows (wild pct moves likely from a
  // single mispriced sale on a low-volume card).
  const reliable = (candidates || []).filter(c => passesConfidence(c))
  if (reliable.length < 2) throw new Error("Not enough reliable candidates in price tier")

  const picks = sample(reliable, 2)

  // Hydrate images + url slug from cards table
  const names = picks.map(p => p.card_name)
  const sets  = picks.map(p => p.set_name)
  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_name, set_name, image_url, card_url_slug")
    .in("card_name", names)
    .in("set_name", sets)
  const cardByKey = new Map<string, any>()
  for (const c of (cardRows || [])) cardByKey.set(`${c.card_name}::${c.set_name}`, c)

  const cards = picks.map(p => ({
    card_name:           cleanCardName(p.card_name),
    raw_card_name:       p.card_name,
    set_name:            p.set_name,
    image_url:           cardByKey.get(`${p.card_name}::${p.set_name}`)?.image_url || null,
    card_url_slug:       cardByKey.get(`${p.card_name}::${p.set_name}`)?.card_url_slug || null,
    raw_usd:             p.current_raw,
    psa10_usd:           p.current_psa10,
    raw_pct_30d:         p.raw_pct_30d,
    raw_pct_365d:        p.raw_pct_365d,
  }))

  const sys = VOICE_PROMPT
  const usr = `Write a Card Battle social post comparing these two Pokemon cards:

LEFT:  ${cards[0].card_name} (${cards[0].set_name}) - raw $${(cards[0].raw_usd / 100).toFixed(2)}, PSA 10 $${cards[0].psa10_usd ? (cards[0].psa10_usd / 100).toFixed(2) : "—"}, 30d ${cards[0].raw_pct_30d ?? "—"}%, 1y ${cards[0].raw_pct_365d ?? "—"}%
RIGHT: ${cards[1].card_name} (${cards[1].set_name}) - raw $${(cards[1].raw_usd / 100).toFixed(2)}, PSA 10 $${cards[1].psa10_usd ? (cards[1].psa10_usd / 100).toFixed(2) : "—"}, 30d ${cards[1].raw_pct_30d ?? "—"}%, 1y ${cards[1].raw_pct_365d ?? "—"}%

CTA: "Which are you taking?"

Return JSON with this exact shape:
{
  "title": "short internal title for our admin list, max 60 chars",
  "hook": "the headline shown on the image, max 50 chars, no em-dash",
  "twitter_copy": "the X/Twitter post text, ends with the CTA question",
  "instagram_caption": "the Instagram caption (2 short paragraphs + 3-5 hashtags at the end)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { left: cards[0], right: cards[1] },
  }
}

// ── Template: Market Mover ──────────────────────────────────────────────────

async function generateMarketMover(options: any) {
  const { min, max } = priceTierBounds(options.price_tier || "any")
  const trendKey = timeWindowKey(options.time_window || "30d")
  const direction = options.direction === "down" ? "down" : "up"

  let q = supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .not(trendKey, "is", null)
    .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
  if (max != null) q = q.lte("current_raw", max)
  // For "up" sort descending by pct, for "down" sort ascending.
  q = direction === "up"
    ? q.order(trendKey, { ascending: false })
    : q.order(trendKey, { ascending: true })
  const { data: candidates, error } = await q.limit(200)
  if (error) throw error

  const reliable = (candidates || []).filter(c => passesConfidence(c))
  if (reliable.length === 0) throw new Error("No reliable movers found for that window")

  // Pick from the top 10 reliable movers so we don't always grab the same one.
  const pool = reliable.slice(0, 10)
  const picked = pool[Math.floor(Math.random() * pool.length)] as any

  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_name, set_name, image_url, card_url_slug")
    .eq("card_name", picked.card_name)
    .eq("set_name", picked.set_name)
    .limit(1)
  const cardRow = (cardRows || [])[0] || null

  const card = {
    card_name:    cleanCardName(picked.card_name),
    raw_card_name: picked.card_name,
    set_name:     picked.set_name,
    image_url:    cardRow?.image_url || null,
    card_url_slug: cardRow?.card_url_slug || null,
    raw_usd:      picked.current_raw,
    psa10_usd:    picked.current_psa10,
    raw_pct_7d:   picked.raw_pct_7d,
    raw_pct_30d:  picked.raw_pct_30d,
    raw_pct_90d:  picked.raw_pct_90d,
    raw_pct_365d: picked.raw_pct_365d,
  }

  const move = picked[trendKey] as number
  const moveText = `${move > 0 ? "+" : ""}${move.toFixed(0)}%`
  const windowLabel: Record<string, string> = { "7d": "this week", "30d": "this month", "90d": "this quarter", "1y": "this year" }
  const wt = windowLabel[options.time_window || "30d"]

  const sys = VOICE_PROMPT
  const usr = `Write a Market Mover social post about this card whose raw price has moved ${moveText} ${wt}:

CARD:      ${card.card_name} (${card.set_name})
RAW PRICE: $${(card.raw_usd / 100).toFixed(2)}
PSA 10:    ${card.psa10_usd ? "$" + (card.psa10_usd / 100).toFixed(2) : "—"}
7d:        ${card.raw_pct_7d ?? "—"}%
30d:       ${card.raw_pct_30d ?? "—"}%
90d:       ${card.raw_pct_90d ?? "—"}%
1y:        ${card.raw_pct_365d ?? "—"}%

Direction: ${direction === "up" ? "rising — frame it as collectors waking up to the card, don't overhype" : "falling — frame it as a possible entry point, don't make absolute predictions"}.
CTA: "${direction === "up" ? "Still room to run?" : "Buying the dip?"}"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, lead with the move (e.g. '${moveText} ${wt}')",
  "twitter_copy": "X/Twitter post ending with the CTA question",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { card, time_window: options.time_window || "30d", direction, move_pct: move },
  }
}

// ── Template: Grading Gap ───────────────────────────────────────────────────

async function generateGradingGap(options: any) {
  const { min, max } = priceTierBounds(options.price_tier || "200_1000")

  // Pull cards where we have a meaningful PSA 10 / Raw spread AND multiple
  // tiers populated. We use card_trends for the price tier filter + sanity,
  // then hydrate the FULL grade ladder from daily_prices.
  let q = supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .not("current_psa10", "is", null)
    .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
  if (max != null) q = q.lte("current_raw", max)
  const { data: cands, error } = await q.limit(200)
  if (error) throw error

  const reliable = (cands || []).filter(c => passesConfidence(c))
  // Sort by raw->psa10 multiple, desc, so the biggest gaps surface first.
  const ranked = reliable.filter((c: any) => c.current_raw > 0 && c.current_psa10)
    .map((c: any) => ({ ...c, multiple: c.current_psa10 / c.current_raw }))
    .sort((a: any, b: any) => b.multiple - a.multiple)
  if (ranked.length === 0) throw new Error("No reliable cards with a PSA 10 spread")

  // Pick from top 15 to keep variety
  const picked = ranked[Math.floor(Math.random() * Math.min(15, ranked.length))] as any

  // Get card_url_slug, image, AND the bare card_slug for daily_prices lookup
  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_slug, card_name, set_name, image_url, card_url_slug")
    .eq("card_name", picked.card_name)
    .eq("set_name", picked.set_name)
    .limit(1)
  const cardRow = (cardRows || [])[0] as any
  if (!cardRow) throw new Error("Could not hydrate card metadata")

  // Pull the FULL grade ladder from daily_prices (latest row)
  const { data: dpRows } = await supabase
    .from("daily_prices")
    .select("raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd, cgc95_usd, cgc10_usd, bgs10_usd, bgs10black_usd, cgc10pristine_usd, sgc10_usd, tag10_usd, ace10_usd")
    .eq("card_slug", `pc-${cardRow.card_slug}`)
    .order("date", { ascending: false })
    .limit(1)
  const dp = (dpRows && dpRows[0]) as any || {}

  // Find biggest gap among populated tier pairs for the headline
  const tiers = [
    { key: "raw_usd",            label: "Raw" },
    { key: "psa7_usd",           label: "PSA 7" },
    { key: "psa8_usd",           label: "PSA 8" },
    { key: "psa9_usd",           label: "PSA 9" },
    { key: "psa10_usd",          label: "PSA 10" },
    { key: "cgc95_usd",          label: "CGC 9.5" },
    { key: "cgc10_usd",          label: "CGC 10" },
    { key: "bgs10_usd",          label: "BGS 10" },
    { key: "ace10_usd",          label: "ACE 10" },
    { key: "bgs10black_usd",     label: "BGS 10 Black" },
    { key: "cgc10pristine_usd",  label: "CGC 10 Pristine" },
  ].filter(t => dp[t.key] != null && dp[t.key] > 0)

  let biggestGap = { top: tiers[0], bottom: tiers[0], ratio: 1 }
  for (const top of tiers) {
    for (const bot of tiers) {
      if (top.key === bot.key) continue
      const r = dp[top.key] / dp[bot.key]
      if (r > biggestGap.ratio) biggestGap = { top, bottom: bot, ratio: r }
    }
  }

  const card = {
    card_name:     cleanCardName(picked.card_name),
    raw_card_name: picked.card_name,
    set_name:      picked.set_name,
    image_url:     cardRow.image_url,
    card_url_slug: cardRow.card_url_slug,
    grades:        Object.fromEntries(tiers.map(t => [t.label, dp[t.key]])),
  }

  const sys = VOICE_PROMPT
  const usr = `Write a Grading Gap social post about ${card.card_name} (${card.set_name}).

Grade prices (USD):
${tiers.map(t => `  ${t.label}: $${(dp[t.key] / 100).toFixed(2)}`).join("\n")}

Biggest gap detected: ${biggestGap.top.label} is ${biggestGap.ratio.toFixed(1)}x ${biggestGap.bottom.label}.

CTA: "Which grade would you buy?"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 60 chars, lead with the biggest gap stat",
  "twitter_copy": "X/Twitter post (under 240 chars) ending with the CTA question",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { card, biggest_gap: { top: biggestGap.top.label, bottom: biggestGap.bottom.label, ratio: biggestGap.ratio } },
  }
}

// ── Template: Then vs Now ───────────────────────────────────────────────────

async function generateThenVsNow(options: any) {
  const span: string = options.span || "5y"
  const trendKey = span === "2y" ? "raw_pct_2y" : "raw_pct_5y"
  const { min, max } = priceTierBounds(options.price_tier || "any")

  let q = supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .not(trendKey, "is", null)
    .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
  if (max != null) q = q.lte("current_raw", max)
  // Sort by the span pct desc — biggest long-term winners surface first.
  const { data: cands, error } = await q.order(trendKey, { ascending: false }).limit(200)
  if (error) throw error

  const reliable = (cands || []).filter(c => passesConfidence(c))
  if (reliable.length === 0) throw new Error("No reliable long-term movers")

  const picked = reliable[Math.floor(Math.random() * Math.min(15, reliable.length))] as any

  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_slug, card_name, set_name, image_url, card_url_slug")
    .eq("card_name", picked.card_name)
    .eq("set_name", picked.set_name)
    .limit(1)
  const cardRow = (cardRows || [])[0] as any
  if (!cardRow) throw new Error("Could not hydrate card metadata")

  // Pull oldest historical price (first non-null in the time series).
  const { data: hist } = await supabase.rpc("get_card_price_history", { slug: cardRow.card_slug })
  const sorted = (hist || []).filter((r: any) => r.raw_usd != null && r.raw_usd > 0)
  const oldest = sorted[0]
  const newest = sorted[sorted.length - 1]
  const thenPrice = oldest?.raw_usd ?? null
  const nowPrice  = newest?.raw_usd ?? picked.current_raw
  const thenDate  = oldest?.date || null
  const nowDate   = newest?.date || null
  const growth    = thenPrice && nowPrice ? Math.round(((nowPrice - thenPrice) / thenPrice) * 100) : null

  const card = {
    card_name:     cleanCardName(picked.card_name),
    raw_card_name: picked.card_name,
    set_name:      picked.set_name,
    image_url:     cardRow.image_url,
    card_url_slug: cardRow.card_url_slug,
    then_price:    thenPrice,
    now_price:     nowPrice,
    then_date:     thenDate,
    now_date:      nowDate,
    growth_pct:    growth,
  }

  const yrLabel = span === "2y" ? "2 years" : "5 years"
  const sys = VOICE_PROMPT
  const usr = `Write a Then vs Now social post for ${card.card_name} (${card.set_name}).

THEN (${thenDate}): $${thenPrice ? (thenPrice / 100).toFixed(2) : "—"}
NOW  (${nowDate}):  $${nowPrice  ? (nowPrice  / 100).toFixed(2) : "—"}
Growth: ${growth != null ? (growth > 0 ? "+" : "") + growth + "%" : "—"} over roughly ${yrLabel}

CTA: "Would you have held?"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, lead with the growth (e.g. 'Up ${growth ?? "X"}% in ${yrLabel}')",
  "twitter_copy": "X/Twitter post ending with the CTA question",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { card, span },
  }
}

// ── Template: Budget Builder ────────────────────────────────────────────────

async function generateBudgetBuilder(options: any) {
  const budgetGbp = Number(options.budget_gbp || 100)
  const budgetCents = gbpBudgetToUsdCents(budgetGbp)

  // We want 4 cards summing under budget. Each card should be roughly
  // budget/8 .. budget/2 so the mix isn't all bulk or one chase.
  const perCardMin = Math.floor(budgetCents / 8)
  const perCardMax = Math.floor(budgetCents / 2)

  // Pull a generous pool of candidates in that price band
  const { data: cands, error } = await supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .gte("current_raw", Math.max(perCardMin, MIN_RAW_CENTS))
    .lte("current_raw", perCardMax)
    .limit(300)
  if (error) throw error
  const reliable = (cands || []).filter(c => passesConfidence(c))
  if (reliable.length < 4) throw new Error("Not enough reliable cards in budget band")

  // Greedy random pick: shuffle, then take cards summing < budget
  const shuffled = sample(reliable, reliable.length)
  const picks: any[] = []
  let running = 0
  for (const c of shuffled) {
    if (picks.length >= 4) break
    if (running + c.current_raw <= budgetCents) {
      picks.push(c)
      running += c.current_raw
    }
  }
  if (picks.length < 4) {
    // Fallback: take the four cheapest reliable ones
    const cheapest = [...reliable].sort((a, b) => a.current_raw - b.current_raw).slice(0, 4)
    picks.length = 0
    picks.push(...cheapest)
    running = picks.reduce((s, c) => s + c.current_raw, 0)
  }

  // Hydrate images
  const names = picks.map(p => p.card_name)
  const sets  = picks.map(p => p.set_name)
  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_name, set_name, image_url, card_url_slug")
    .in("card_name", names)
    .in("set_name", sets)
  const cardByKey = new Map<string, any>()
  for (const c of (cardRows || [])) cardByKey.set(`${c.card_name}::${c.set_name}`, c)

  const cards = picks.map(p => {
    const meta = cardByKey.get(`${p.card_name}::${p.set_name}`) || {}
    return {
      card_name:     cleanCardName(p.card_name),
      raw_card_name: p.card_name,
      set_name:      p.set_name,
      image_url:     meta.image_url || null,
      card_url_slug: meta.card_url_slug || null,
      raw_usd:       p.current_raw,
    }
  })

  const sys = VOICE_PROMPT
  const usr = `Write a Budget Builder social post: a £${budgetGbp} basket of 4 Pokemon cards.

Total raw value of basket: $${(running / 100).toFixed(2)} (approx £${(running / 127).toFixed(0)})

Cards in basket:
${cards.map((c, i) => `  ${i + 1}. ${c.card_name} (${c.set_name}) — raw $${(c.raw_usd / 100).toFixed(2)}`).join("\n")}

CTA: "Pick your four."

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, frame it as a budget pitch (e.g. 'You have £${budgetGbp}. What are you buying?')",
  "twitter_copy": "X/Twitter post ending with the CTA",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { cards, budget_gbp: budgetGbp, total_raw_usd_cents: running },
  }
}

// ── Template: Collector Pulse ───────────────────────────────────────────────

async function generateCollectorPulse(options: any) {
  const trendKey = timeWindowKey(options.time_window || "7d")

  const { data: cands, error } = await supabase.from("card_trends")
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d, raw_pct_2y, raw_pct_5y")
    .not("current_raw", "is", null)
    .not(trendKey, "is", null)
    .gte("current_raw", MIN_RAW_CENTS)
    .order(trendKey, { ascending: false })
    .limit(100)
  if (error) throw error

  const reliable = (cands || []).filter(c => passesConfidence(c))
  if (reliable.length < 4) throw new Error("Not enough reliable trending cards")

  // Take top 5 reliable risers (broader story than Market Mover's one card)
  const top = reliable.slice(0, 5)

  const names = top.map(p => p.card_name)
  const sets  = top.map(p => p.set_name)
  const { data: cardRows } = await supabase
    .from("cards")
    .select("card_name, set_name, image_url, card_url_slug")
    .in("card_name", names)
    .in("set_name", sets)
  const cardByKey = new Map<string, any>()
  for (const c of (cardRows || [])) cardByKey.set(`${c.card_name}::${c.set_name}`, c)

  const cards = top.map(p => {
    const meta = cardByKey.get(`${p.card_name}::${p.set_name}`) || {}
    return {
      card_name:     cleanCardName(p.card_name),
      raw_card_name: p.card_name,
      set_name:      p.set_name,
      image_url:     meta.image_url || null,
      card_url_slug: meta.card_url_slug || null,
      raw_usd:       p.current_raw,
      pct_change:    p[trendKey] as number,
    }
  })

  const windowLabel: Record<string, string> = { "7d": "this week", "30d": "this month", "90d": "this quarter", "1y": "this year" }
  const wt = windowLabel[options.time_window || "7d"]

  const sys = VOICE_PROMPT
  const usr = `Write a Collector Pulse social post — what's trending ${wt}.

Top 5 risers ${wt}:
${cards.map((c, i) => `  ${i + 1}. ${c.card_name} (${c.set_name}) — raw $${(c.raw_usd / 100).toFixed(2)}, ${c.pct_change > 0 ? "+" : ""}${c.pct_change.toFixed(0)}%`).join("\n")}

CTA: "What are collectors watching?"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, e.g. 'What collectors are watching ${wt}'",
  "twitter_copy": "X/Twitter post ending with the CTA — name 1-2 specific cards from the list",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { cards, time_window: options.time_window || "7d" },
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
  }

  let template_type: string, options: any
  try {
    const body = await req.json()
    template_type = body.template_type
    options = body.options || {}
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS })
  }

  let generated: any
  try {
    if (template_type === "card_battle") {
      generated = await generateCardBattle(options)
    } else if (template_type === "market_mover") {
      generated = await generateMarketMover(options)
    } else if (template_type === "grading_gap") {
      generated = await generateGradingGap(options)
    } else if (template_type === "then_vs_now") {
      generated = await generateThenVsNow(options)
    } else if (template_type === "budget_builder") {
      generated = await generateBudgetBuilder(options)
    } else if (template_type === "collector_pulse") {
      generated = await generateCollectorPulse(options)
    } else {
      return new Response(JSON.stringify({ error: `Template '${template_type}' not implemented yet` }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
  }

  const { data: row, error: insErr } = await supabase
    .from("social_content_posts")
    .insert([{
      template_type,
      title:             generated.title,
      hook:              generated.hook,
      twitter_copy:      generated.twitter_copy,
      instagram_caption: generated.instagram_caption,
      data_payload:      generated.data_payload,
      generated_options: options,
      status:            "draft",
    }])
    .select("*")
    .single()

  if (insErr) {
    return new Response(JSON.stringify({ error: insErr.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
  }

  return new Response(JSON.stringify({ post: row }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
})
