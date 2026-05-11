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
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function cleanCardName(s: string): string {
  return s.replace(/\s*#\d+\w*\s*$/, "").replace(/\[.*?\]/g, "").trim()
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
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_30d, raw_pct_365d")
    .not("current_raw", "is", null)
    .gte("current_raw", min)
  if (max != null) q = q.lte("current_raw", max)
  const { data: candidates, error } = await q.order("raw_pct_30d", { ascending: false }).limit(80)
  if (error) throw error
  if (!candidates || candidates.length < 2) throw new Error("Not enough candidates in price tier")

  const picks = sample(candidates as any[], 2)

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
    .select("card_name, set_name, current_raw, current_psa10, raw_pct_7d, raw_pct_30d, raw_pct_90d, raw_pct_365d")
    .not("current_raw", "is", null)
    .not(trendKey, "is", null)
    .gte("current_raw", min)
  if (max != null) q = q.lte("current_raw", max)
  // For "up" sort descending by pct, for "down" sort ascending.
  q = direction === "up"
    ? q.order(trendKey, { ascending: false })
    : q.order(trendKey, { ascending: true })
  const { data: candidates, error } = await q.limit(30)
  if (error) throw error
  if (!candidates || candidates.length === 0) throw new Error("No movers found for that window")

  // Pick from the top 10 movers so we don't always grab the #1.
  const pool = candidates.slice(0, 10)
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
