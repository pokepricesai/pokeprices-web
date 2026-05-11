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

// Backup name-based sealed filter — cards.is_sealed is mis-flagged on some
// products (e.g. "Binder Collection", "Mini Tin", "Booster Box" sometimes
// land with is_sealed=false). Used by Card Battle when product_mode='cards'
// to keep obvious sealed products out of the battle.
const NON_CARD_NAME_PATTERN = /\b(booster\s*box|booster\s*pack|elite\s*trainer\s*box|\bETB\b|mini[-\s]*tin|premium\s*collection|premium\s*figure\s*collection|build\s*&\s*battle|blister|bundle|binder\s*collection|trainer\s*box|collection\s*box|2[-\s]*pack|3[-\s]*pack|deluxe\s*pin|gift\s*set|jumbo\s*card|poster\s*collection|tech\s*sticker)/i
function looksLikeSealedProduct(cardName: string | null | undefined): boolean {
  if (!cardName) return false
  return NON_CARD_NAME_PATTERN.test(cardName)
}


function cleanCardName(s: string): string {
  return s.replace(/\s*#\d+\w*\s*$/, "").replace(/\[.*?\]/g, "").trim()
}

function gbpBudgetToUsdCents(gbp: number): number {
  // GBP to USD cents — using the same rate the app uses elsewhere (0.79).
  return Math.round((gbp / 0.79) * 100)
}

function priceTierBounds(tier: string, customTargetGbp?: number, customTolerancePct?: number): { min: number; max: number | null } {
  if (tier === "custom" && customTargetGbp != null && customTargetGbp > 0) {
    const targetCents = gbpBudgetToUsdCents(customTargetGbp)
    const tol = Math.max(1, customTolerancePct ?? 20) / 100
    return {
      min: Math.max(0, Math.round(targetCents * (1 - tol))),
      max: Math.round(targetCents * (1 + tol)),
    }
  }
  switch (tier) {
    case "under_25":   return { min: 0,      max: 2500   }
    case "25_60":      return { min: 2500,   max: 6000   }
    case "60_150":     return { min: 6000,   max: 15000  }
    case "150_400":    return { min: 15000,  max: 40000  }
    case "400_1000":   return { min: 40000,  max: 100000 }
    case "1000_2500":  return { min: 100000, max: 250000 }
    case "2500_plus":  return { min: 250000, max: null   }
    default:           return { min: 0,      max: null   }
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

// Optional tone overlays. The caller can pass options.tone to nudge the AI
// toward a specific engagement style. Default = the neutral voice above.
const TONE_OVERLAY: Record<string, string> = {
  default: '',
  bold: `\n\nTONE OVERLAY: BOLD AND CONTRARIAN. Take a strong, opinionated stance — even against popular opinion. Avoid nuance. Make readers either agree hard or disagree hard. One sharp argument beats three balanced ones. Still no em-dashes, still no fake certainty, but lean into a clear position.`,
  educational: `\n\nTONE OVERLAY: EDUCATIONAL AND HIGH-CURIOSITY. Frame as a quick lesson with one juicy insight collectors might miss. Hooks like "Most collectors miss this..." or "Here is what the data actually shows..." work well. End on the engagement question.`,
  humorous: `\n\nTONE OVERLAY: RELATABLE AND WITTY. Short, observational, slightly self-deprecating. Make the reader feel seen as a collector. One sharp line beats a paragraph. No corny jokes — just honest, dry collector humour.`,
}

function voicePrompt(tone?: string): string {
  return VOICE_PROMPT + (TONE_OVERLAY[tone || 'default'] || '')
}

// ── Template: Card Battle ───────────────────────────────────────────────────

async function generateCardBattle(options: any) {
  const { min, max } = priceTierBounds(
    options.price_tier || "any",
    options.custom_target_gbp,
    options.custom_tolerance_pct,
  )
  const productMode = options.product_mode || "cards"  // 'cards' | 'sealed' | 'mixed'

  // popular_card_trends view does the join + Topps filter + volume gate
  // server-side. Single query, no URL bloat.
  const buildQ = (withSealedFilter: boolean) => {
    let q = supabase.from("popular_card_trends")
      .select("*")
      .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
    if (max != null) q = q.lte("current_raw", max)
    if (withSealedFilter) {
      if (productMode === "cards")  q = q.eq("is_sealed", false)
      if (productMode === "sealed") q = q.eq("is_sealed", true)
    }
    return q.order("sales_30d", { ascending: false }).limit(80)
  }
  let { data: cands, error } = await buildQ(true)
  // If the view predates migration 2026-05-11d (no is_sealed column yet),
  // retry without the sealed filter so generation still works.
  if (error && /is_sealed.+does not exist/i.test(error.message || "")) {
    const r2 = await buildQ(false)
    cands = r2.data
    error = r2.error
  }
  if (error) throw error

  let reliable = (cands || []).filter((c: any) => passesConfidence(c))
  // Belt-and-braces sealed filter — cards.is_sealed is wrong on some
  // products. When user wants cards only, drop anything whose name looks
  // like a sealed product.
  if (productMode === "cards") {
    reliable = reliable.filter((c: any) => !looksLikeSealedProduct(c.card_name))
  } else if (productMode === "sealed") {
    reliable = reliable.filter((c: any) => looksLikeSealedProduct(c.card_name) || c.is_sealed)
  }
  if (reliable.length < 2) throw new Error("Not enough popular cards in this price band")

  // Already sorted by volume desc — pick 2 from the top 30 for variety.
  const pool = reliable.slice(0, Math.min(30, reliable.length))
  const picks = sample(pool, 2)

  const cards = picks.map((p: any) => ({
    card_name:           cleanCardName(p.card_name),
    raw_card_name:       p.card_name,
    set_name:            p.set_name,
    image_url:           p.image_url,
    card_url_slug:       p.card_url_slug,
    card_number:         p.card_number,
    card_number_display: p.card_number_display,
    set_printed_total:   p.set_printed_total,
    is_sealed:           !!p.is_sealed,
    raw_usd:             p.current_raw,
    psa10_usd:           p.current_psa10,
    raw_pct_30d:         p.raw_pct_30d,
    raw_pct_365d:        p.raw_pct_365d,
    sales_30d:           p.sales_30d || 0,
  }))

  const sys = voicePrompt(options.tone)
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
  const { min, max } = priceTierBounds(
    options.price_tier || "any",
    options.custom_target_gbp,
    options.custom_tolerance_pct,
  )
  const trendKey = timeWindowKey(options.time_window || "30d")
  const direction = options.direction === "down" ? "down" : "up"
  // Minimum raw price floor — keeps bulk junk out even when price_tier is 'any'.
  const minRawCents = Math.max(min, MIN_RAW_CENTS, Math.round(Number(options.min_raw_usd ?? 20) * 100))

  let q = supabase.from("popular_card_trends")
    .select("*")
    .not(trendKey, "is", null)
    .gte("current_raw", minRawCents)
  if (max != null) q = q.lte("current_raw", max)
  q = direction === "up"
    ? q.order(trendKey, { ascending: false })
    : q.order(trendKey, { ascending: true })
  const { data: cands, error } = await q.limit(80)
  if (error) throw error

  const reliable = (cands || []).filter((c: any) => passesConfidence(c))
  if (reliable.length === 0) throw new Error("No reliable popular movers for that window")

  const pool = reliable.slice(0, Math.min(10, reliable.length))
  const picked = pool[Math.floor(Math.random() * pool.length)] as any

  const card = {
    card_name:           cleanCardName(picked.card_name),
    raw_card_name:       picked.card_name,
    set_name:            picked.set_name,
    image_url:           picked.image_url,
    card_url_slug:       picked.card_url_slug,
    card_number:         picked.card_number,
    card_number_display: picked.card_number_display,
    set_printed_total:   picked.set_printed_total,
    raw_usd:             picked.current_raw,
    psa10_usd:           picked.current_psa10,
    raw_pct_7d:          picked.raw_pct_7d,
    raw_pct_30d:         picked.raw_pct_30d,
    raw_pct_90d:         picked.raw_pct_90d,
    raw_pct_365d:        picked.raw_pct_365d,
    sales_30d:           picked.sales_30d || 0,
  }

  const move = picked[trendKey] as number
  const moveText = `${move > 0 ? "+" : ""}${move.toFixed(0)}%`
  const windowLabel: Record<string, string> = { "7d": "this week", "30d": "this month", "90d": "this quarter", "1y": "this year" }
  const wt = windowLabel[options.time_window || "30d"]

  const sys = voicePrompt(options.tone)
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
  const { min, max } = priceTierBounds(
    options.price_tier || "200_1000",
    options.custom_target_gbp,
    options.custom_tolerance_pct,
  )

  let q = supabase.from("popular_card_trends")
    .select("*")
    .not("current_psa10", "is", null)
    .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
  if (max != null) q = q.lte("current_raw", max)
  const { data: cands, error } = await q.limit(120)
  if (error) throw error

  const enriched = (cands || [])
    .filter((c: any) => passesConfidence(c) && c.current_raw > 0 && c.current_psa10)
    .map((c: any) => ({ ...c, multiple: c.current_psa10 / c.current_raw }))
    .sort((a: any, b: any) => b.multiple - a.multiple)
  if (enriched.length === 0) throw new Error("No reliable popular cards with a PSA 10 spread")

  const picked = enriched[Math.floor(Math.random() * Math.min(15, enriched.length))] as any
  const cardRow = { card_slug: picked.card_slug, image_url: picked.image_url, card_url_slug: picked.card_url_slug, sales_30d: picked.sales_30d }

  // Pull the FULL grade ladder from daily_prices (latest row)
  const { data: dpRows } = await supabase
    .from("daily_prices")
    .select("raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd, cgc95_usd, cgc10_usd, bgs10_usd, bgs10black_usd, cgc10pristine_usd, sgc10_usd, tag10_usd, ace10_usd")
    .eq("card_slug", `pc-${cardRow.card_slug}`)
    .order("date", { ascending: false })
    .limit(1)
  const dp = (dpRows && dpRows[0]) as any || {}

  // The interesting Grading Gap story is across the various "10" tiers
  // (PSA 10 vs CGC 10 vs BGS 10 Black vs ACE 10 etc.) — that's where the
  // big swings sit. Keep Raw as the floor reference but skip PSA 7-9, CGC
  // 9.5 etc. since they aren't the headline.
  const tiers = [
    { key: "raw_usd",            label: "Raw" },
    { key: "psa10_usd",          label: "PSA 10" },
    { key: "cgc10_usd",          label: "CGC 10" },
    { key: "bgs10_usd",          label: "BGS 10" },
    { key: "sgc10_usd",          label: "SGC 10" },
    { key: "ace10_usd",          label: "ACE 10" },
    { key: "tag10_usd",          label: "TAG 10" },
    { key: "bgs10black_usd",     label: "BGS 10 Black" },
    { key: "cgc10pristine_usd",  label: "CGC 10 Pristine" },
  ].filter(t => dp[t.key] != null && dp[t.key] > 0)

  // Require at least 3 populated tiers (Raw + 2 grade-10 variants) for a
  // meaningful comparison — otherwise the post is just "PSA 10 vs Raw"
  // which is what Grading Calculator already shows.
  if (tiers.length < 3) throw new Error("Not enough graded-10 data on that card for a Grading Gap post")

  let biggestGap = { top: tiers[0], bottom: tiers[0], ratio: 1 }
  for (const top of tiers) {
    for (const bot of tiers) {
      if (top.key === bot.key) continue
      const r = dp[top.key] / dp[bot.key]
      if (r > biggestGap.ratio) biggestGap = { top, bottom: bot, ratio: r }
    }
  }

  const card = {
    card_name:           cleanCardName(picked.card_name),
    raw_card_name:       picked.card_name,
    set_name:            picked.set_name,
    image_url:           cardRow.image_url,
    card_url_slug:       cardRow.card_url_slug,
    card_number:         picked.card_number,
    card_number_display: picked.card_number_display,
    set_printed_total:   picked.set_printed_total,
    grades:              Object.fromEntries(tiers.map(t => [t.label, dp[t.key]])),
  }

  const sys = voicePrompt(options.tone)
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
  // span → minimum required year-range in get_card_price_history
  const minYears = span === "2y" ? 2 : span === "3y" ? 3 : 5
  const trendKey = span === "2y" ? "raw_pct_2y" : "raw_pct_5y"  // no 3y column; use 5y as proxy for picking
  const { min, max } = priceTierBounds(
    options.price_tier || "any",
    options.custom_target_gbp,
    options.custom_tolerance_pct,
  )

  let picked: any
  // If user pinned a card via the picker, look it up by card_url_slug
  // (that's what search_global returns and the picker stores).
  if (options.card_slug) {
    const urlSlug = String(options.card_slug).replace(/^pc-/, "")
    const { data: directRows } = await supabase.from("popular_card_trends")
      .select("*").eq("card_url_slug", urlSlug).limit(1)
    picked = (directRows || [])[0]
    if (!picked) {
      // Fallback: card might be excluded from popular_card_trends
      // (low volume or no trend data). Look it up directly.
      const { data: cardRow } = await supabase.from("cards")
        .select("card_slug, card_name, set_name, image_url, card_url_slug, card_number, card_number_display, set_printed_total, is_sealed")
        .eq("card_url_slug", urlSlug).maybeSingle()
      if (!cardRow) throw new Error("Pinned card not found by url slug: " + urlSlug)
      const { data: trendRow } = await supabase.from("card_trends")
        .select("*").eq("card_name", cardRow.card_name).eq("set_name", cardRow.set_name).maybeSingle()
      picked = { ...cardRow, ...(trendRow || {}), sales_30d: 0 }
    }
  } else {
    let q = supabase.from("popular_card_trends")
      .select("*")
      .not(trendKey, "is", null)
      .gte("current_raw", Math.max(min, MIN_RAW_CENTS))
    if (max != null) q = q.lte("current_raw", max)
    const { data: cands, error } = await q.order(trendKey, { ascending: false }).limit(120)
    if (error) throw error

    const enriched = (cands || []).filter((c: any) => passesConfidence(c))
    if (enriched.length === 0) throw new Error("No reliable popular long-term movers")

    picked = enriched[Math.floor(Math.random() * Math.min(15, enriched.length))]
  }
  const cardRow = { card_slug: picked.card_slug, image_url: picked.image_url, card_url_slug: picked.card_url_slug, sales_30d: picked.sales_30d || 0 }

  // Pull oldest historical price (first non-null in the time series).
  const { data: hist } = await supabase.rpc("get_card_price_history", { slug: cardRow.card_slug })
  const sorted = (hist || []).filter((r: any) => r.raw_usd != null && r.raw_usd > 0)
  if (sorted.length === 0) throw new Error("No price history for that card")

  // Find a historical point AT LEAST `minYears` years before now, or the
  // oldest available if the card isn't that old. This keeps "5y" honest —
  // a card from 2024 won't show a fake "5y" headline.
  const newest = sorted[sorted.length - 1]
  const newestDate = new Date(newest.date)
  const minTargetMs = newestDate.getTime() - (minYears * 365.25 * 24 * 3600 * 1000)
  const oldEnough = sorted.filter((r: any) => new Date(r.date).getTime() <= minTargetMs)
  if (oldEnough.length === 0 && !options.card_slug) {
    throw new Error(`Card history doesn't reach ${minYears} years; try a shorter span or different card`)
  }
  const oldest = oldEnough[0] || sorted[0]

  const thenPrice = oldest?.raw_usd ?? null
  const nowPrice  = newest?.raw_usd ?? picked.current_raw
  const thenDate  = oldest?.date || null
  const nowDate   = newest?.date || null
  const growth    = thenPrice && nowPrice ? Math.round(((nowPrice - thenPrice) / thenPrice) * 100) : null

  const card = {
    card_name:           cleanCardName(picked.card_name),
    raw_card_name:       picked.card_name,
    set_name:            picked.set_name,
    image_url:           cardRow.image_url,
    card_url_slug:       cardRow.card_url_slug,
    card_number:         picked.card_number,
    card_number_display: picked.card_number_display,
    set_printed_total:   picked.set_printed_total,
    then_price:          thenPrice,
    now_price:           nowPrice,
    then_date:           thenDate,
    now_date:            nowDate,
    growth_pct:          growth,
    sales_30d:           cardRow.sales_30d || 0,
  }

  const yrLabel = span === "2y" ? "2 years" : span === "3y" ? "3 years" : "5 years"
  const sys = voicePrompt(options.tone)
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
  // Budget is now USD (matches the rest of the platform's currency).
  // Falls back to legacy budget_gbp if present so old saved options
  // don't break — converts to USD on the fly.
  const budgetUsd = Number(options.budget_usd ?? (options.budget_gbp ? options.budget_gbp / 0.79 : 100))
  const budgetCents = Math.round(budgetUsd * 100)

  const perCardMin = Math.floor(budgetCents / 8)
  const perCardMax = Math.floor(budgetCents / 2)

  const { data: cands, error } = await supabase.from("popular_card_trends")
    .select("*")
    .gte("current_raw", Math.max(perCardMin, MIN_RAW_CENTS))
    .lte("current_raw", perCardMax)
    .order("sales_30d", { ascending: false })
    .limit(120)
  if (error) throw error

  let reliable = (cands || []).filter((c: any) => passesConfidence(c))
  // Budget Builder is always cards-only — the basket is meant to be 4
  // tradable cards, not sealed product. Backup name-based sealed filter.
  reliable = reliable.filter((c: any) => !looksLikeSealedProduct(c.card_name))
  if (reliable.length < 4) throw new Error("Not enough reliable popular cards in budget band")

  // Greedy random pick: shuffle the top 60 (most popular), take cards summing < budget
  const shuffled = sample(reliable.slice(0, Math.min(60, reliable.length)), Math.min(60, reliable.length))
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
    const cheapest = [...reliable].sort((a, b) => a.current_raw - b.current_raw).slice(0, 4)
    picks.length = 0
    picks.push(...cheapest)
    running = picks.reduce((s, c) => s + c.current_raw, 0)
  }

  const cards = picks.map((p: any) => ({
    card_name:           cleanCardName(p.card_name),
    raw_card_name:       p.card_name,
    set_name:            p.set_name,
    image_url:           p.image_url,
    card_url_slug:       p.card_url_slug,
    card_number:         p.card_number,
    card_number_display: p.card_number_display,
    set_printed_total:   p.set_printed_total,
    raw_usd:             p.current_raw,
  }))

  const sys = voicePrompt(options.tone)
  const usr = `Write a Budget Builder social post: a $${budgetUsd.toFixed(0)} basket of 4 Pokemon cards.

Total raw value of basket: $${(running / 100).toFixed(2)}

Cards in basket:
${cards.map((c, i) => `  ${i + 1}. ${c.card_name} (${c.set_name}) — raw $${(c.raw_usd / 100).toFixed(2)}`).join("\n")}

CTA: "Pick your four."

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, frame it as a budget pitch (e.g. 'You have $${budgetUsd.toFixed(0)}. What are you buying?')",
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
    data_payload: { cards, budget_usd: budgetUsd, total_raw_usd_cents: running },
  }
}

// ── Template: Collector Pulse ───────────────────────────────────────────────

async function generateCollectorPulse(options: any) {
  const trendKey = timeWindowKey(options.time_window || "7d")
  // Minimum raw price floor — default $20 so we don't surface bulk movers.
  const minRawUsdDollars = Number(options.min_raw_usd ?? 20)
  const minRawCents = Math.max(MIN_RAW_CENTS, Math.round(minRawUsdDollars * 100))

  const { data: cands, error } = await supabase.from("popular_card_trends")
    .select("*")
    .not(trendKey, "is", null)
    .gte("current_raw", minRawCents)
    .order(trendKey, { ascending: false })
    .limit(80)
  if (error) throw error

  const reliable = (cands || []).filter((c: any) => passesConfidence(c))
  if (reliable.length < 4) throw new Error("Not enough reliable popular risers")

  const top = reliable.slice(0, 5)
  const cards = top.map((p: any) => ({
    card_name:           cleanCardName(p.card_name),
    raw_card_name:       p.card_name,
    set_name:            p.set_name,
    image_url:           p.image_url,
    card_url_slug:       p.card_url_slug,
    card_number:         p.card_number,
    card_number_display: p.card_number_display,
    set_printed_total:   p.set_printed_total,
    raw_usd:             p.current_raw,
    pct_change:          p[trendKey] as number,
    sales_30d:           p.sales_30d || 0,
  }))

  const windowLabel: Record<string, string> = { "7d": "this week", "30d": "this month", "90d": "this quarter", "1y": "this year" }
  const wt = windowLabel[options.time_window || "7d"]

  const sys = voicePrompt(options.tone)
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

// ── Template: Most Traded ───────────────────────────────────────────────────

async function generateMostTraded(options: any) {
  const minRawUsd = Number(options.min_raw_usd ?? 20)
  const minRawCents = Math.max(MIN_RAW_CENTS, Math.round(minRawUsd * 100))
  const productMode = options.product_mode || "cards"

  // popular_card_trends is already sorted by sales_30d desc when we order
  // by it. Pull the top 40 reliable rows so we have variety to sample.
  const { data: cands, error } = await supabase.from("popular_card_trends")
    .select("*")
    .gte("current_raw", minRawCents)
    .order("sales_30d", { ascending: false })
    .limit(40)
  if (error) throw error

  let reliable = (cands || []).filter((c: any) => passesConfidence(c))
  if (productMode === "cards") {
    reliable = reliable.filter((c: any) => !looksLikeSealedProduct(c.card_name))
  } else if (productMode === "sealed") {
    reliable = reliable.filter((c: any) => looksLikeSealedProduct(c.card_name) || c.is_sealed)
  }
  if (reliable.length === 0) throw new Error("No reliable top-traded cards found")

  // Pick from top 10 most-traded for variety.
  const pool = reliable.slice(0, Math.min(10, reliable.length))
  const picked = pool[Math.floor(Math.random() * pool.length)] as any

  const card = {
    card_name:           cleanCardName(picked.card_name),
    raw_card_name:       picked.card_name,
    set_name:            picked.set_name,
    image_url:           picked.image_url,
    card_url_slug:       picked.card_url_slug,
    card_number:         picked.card_number,
    card_number_display: picked.card_number_display,
    set_printed_total:   picked.set_printed_total,
    raw_usd:             picked.current_raw,
    psa10_usd:           picked.current_psa10,
    raw_pct_30d:         picked.raw_pct_30d,
    sales_30d:           picked.sales_30d || 0,
  }

  const sys = voicePrompt(options.tone)
  const usr = `Write a Most Traded social post about the highest-volume Pokemon ${productMode === 'sealed' ? 'sealed product' : 'card'} right now.

CARD:    ${card.card_name} (${card.set_name})
SALES (30d): ${card.sales_30d}
RAW:     $${(card.raw_usd / 100).toFixed(2)}
PSA 10:  ${card.psa10_usd ? "$" + (card.psa10_usd / 100).toFixed(2) : "—"}
30d %:   ${card.raw_pct_30d != null ? card.raw_pct_30d.toFixed(1) + "%" : "—"}

Frame: volume is truth. This is what collectors are actually trading right now, not what pundits are talking about.

CTA: "Are collectors fighting over this one?"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars — lead with the sales count, e.g. '${card.sales_30d} sales this month'",
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
    data_payload: { card, time_window: "30d" },
  }
}

// ── PokeAPI helpers (for Pokémon Battle + Guess the Pokémon) ────────────────

const GEN_RANGES: Record<string, [number, number]> = {
  any: [1,    1025],
  '1': [1,    151],
  '2': [152,  251],
  '3': [252,  386],
  '4': [387,  493],
  '5': [494,  649],
  '6': [650,  721],
  '7': [722,  809],
  '8': [810,  905],
  '9': [906,  1025],
}

async function fetchPokemon(idOrName: string | number): Promise<any> {
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${idOrName}`)
  if (!res.ok) throw new Error(`PokeAPI ${idOrName}: ${res.status}`)
  return await res.json()
}

function randomPokemonId(gen: string): number {
  const [min, max] = GEN_RANGES[gen] || GEN_RANGES.any
  return min + Math.floor(Math.random() * (max - min + 1))
}

function generationOf(id: number): string {
  for (const [k, [mn, mx]] of Object.entries(GEN_RANGES)) {
    if (k === 'any') continue
    if (id >= mn && id <= mx) return k
  }
  return '?'
}

// Modern Pokémon type effectiveness chart. Lookup:
// TYPE_CHART[attacker][defender] = multiplier (1 if not listed).
const TYPE_CHART: Record<string, Record<string, number>> = {
  normal:   { rock: 0.5, ghost: 0,  steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
}

function effVs(attackerType: string, defenderTypes: string[]): number {
  let m = 1
  for (const dt of defenderTypes) m *= (TYPE_CHART[attackerType]?.[dt] ?? 1)
  return m
}
function bestAdvantage(attackerTypes: string[], defenderTypes: string[]): number {
  let best = 0
  for (const at of attackerTypes) best = Math.max(best, effVs(at, defenderTypes))
  return best
}

function summarisePokemon(p: any) {
  const stats: Record<string, number> = {}
  for (const s of p.stats) stats[s.stat.name] = s.base_stat
  const types = p.types.map((t: any) => t.type.name)
  const total = p.stats.reduce((sum: number, x: any) => sum + x.base_stat, 0)
  const sprite = p.sprites?.other?.['official-artwork']?.front_default
    || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`
  return {
    id: p.id,
    name: p.name.charAt(0).toUpperCase() + p.name.slice(1),
    types,
    stats,
    total,
    sprite,
  }
}

// ── Template: Pokémon Battle ────────────────────────────────────────────────

// Pick from the top-N Pokémon by TCG card count for the chosen generation.
// pokemon_species.total_cards is our popularity proxy — Pikachu / Charizard /
// Eevee / Mewtwo etc. surface first; obscure species are excluded so the
// posts feature Pokémon people recognise.
async function pickPopularPokemonIds(gen: string, count: number): Promise<number[]> {
  let q = supabase.from('pokemon_species')
    .select('id, total_cards, generation')
    .gt('total_cards', 10)
  if (gen !== 'any') q = q.eq('generation', Number(gen))
  const { data } = await q.order('total_cards', { ascending: false }).limit(150)
  const pool = (data || []).map((r: any) => r.id as number)
  if (pool.length === 0) {
    // Fallback: just pick from the generation range.
    return Array.from({ length: count }, () => randomPokemonId(gen))
  }
  // Sample without replacement.
  const out: number[] = []
  const copy = [...pool]
  while (out.length < count && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy.splice(idx, 1)[0])
  }
  return out
}

async function generatePokemonBattle(options: any) {
  const gen = String(options.generation || 'any')
  const [leftId, rightId] = await pickPopularPokemonIds(gen, 2)

  const [leftRaw, rightRaw] = await Promise.all([fetchPokemon(leftId), fetchPokemon(rightId)])
  const L = summarisePokemon(leftRaw)
  const R = summarisePokemon(rightRaw)

  // Combine total stats with best type advantage in either direction.
  const lAdv = bestAdvantage(L.types, R.types) || 1
  const rAdv = bestAdvantage(R.types, L.types) || 1
  const lScore = L.total * lAdv
  const rScore = R.total * rAdv
  const lProb = Math.round((lScore / (lScore + rScore)) * 100)
  const rProb = 100 - lProb

  const sys = voicePrompt(options.tone)
  const usr = `Write a Pokemon Battle social post comparing two Pokemon side by side.

LEFT:  ${L.name} (${L.types.join('/')}) — total stats ${L.total}: HP ${L.stats.hp}, Atk ${L.stats.attack}, Def ${L.stats.defense}, SpA ${L.stats['special-attack']}, SpD ${L.stats['special-defense']}, Spe ${L.stats.speed}
RIGHT: ${R.name} (${R.types.join('/')}) — total stats ${R.total}: HP ${R.stats.hp}, Atk ${R.stats.attack}, Def ${R.stats.defense}, SpA ${R.stats['special-attack']}, SpD ${R.stats['special-defense']}, Spe ${R.stats.speed}

Quick model says: ${L.name} ${lProb}% vs ${R.name} ${rProb}%. Don't read that as gospel — the question is meant to be fun, not a literal forecast.

CTA: "Who wins?"

Return JSON with this exact shape:
{
  "title": "short internal title, max 60 chars",
  "hook": "headline on the image, max 50 chars, e.g. 'Who wins this one?'",
  "twitter_copy": "X/Twitter post (under 240 chars) ending with the CTA",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags)"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { left: L, right: R, left_prob: lProb, right_prob: rProb },
  }
}

// ── Template: Guess the Pokémon ─────────────────────────────────────────────

async function generateGuessThePokemon(options: any) {
  const gen = String(options.generation || 'any')
  const difficulty = options.difficulty === 'blurred' ? 'blurred' : 'silhouette'
  const [id] = await pickPopularPokemonIds(gen, 1)
  const p = await fetchPokemon(id)
  const P = summarisePokemon(p)

  const highestStat = Object.entries(P.stats).sort((a, b) => b[1] - a[1])[0]
  const generationNumber = generationOf(id)

  const clues = [
    `Type: ${P.types.join(' / ')}`,
    `Generation: ${generationNumber}`,
    `Strongest stat: ${highestStat[0].replace('-', ' ')} (${highestStat[1]})`,
  ]

  const sys = voicePrompt(options.tone)
  const usr = `Write a "Guess the Pokemon" social post. The Pokemon will appear as a ${difficulty} in the image.

Answer (internal only — DO NOT mention the name in any copy): ${P.name}

Clues shown on the image:
  - ${clues[0]}
  - ${clues[1]}
  - ${clues[2]}

CTA: "Who is it?"

Frame it as a fun guessing game. NEVER reveal the answer in any copy.

Return JSON with this exact shape:
{
  "title": "short internal title (can include the answer for your own reference)",
  "hook": "headline on the image, max 50 chars, e.g. 'Who is it?'",
  "twitter_copy": "X/Twitter post — playful, ends with the CTA, no answer reveal",
  "instagram_caption": "Instagram caption (2 short paragraphs + 3-5 hashtags) — no answer reveal"
}`
  const aiRaw = await callHaiku(sys, usr)
  const ai = parseJsonFromAi(aiRaw)

  return {
    title: ai.title,
    hook: ai.hook,
    twitter_copy: ai.twitter_copy,
    instagram_caption: ai.instagram_caption,
    data_payload: { pokemon: P, generation: generationNumber, clues, difficulty },
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response("Invalid JSON", { status: 400, headers: CORS_HEADERS })
  }

  // AI Image Workshop branch — separate experimental tool. Generates an
  // editorial-style image from a free-form prompt using OpenAI gpt-image-1.
  // Strict style prefix to avoid generic-AI looking output.
  if (body.action === "ai_image") {
    const apiKey = Deno.env.get("OPENAI_API_KEY")
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set on edge function" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
    }
    const userPrompt = String(body.prompt || "").trim()
    if (!userPrompt) {
      return new Response(JSON.stringify({ error: "Empty prompt" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
    }
    // Constraint-heavy style prefix. Keeps output close to editorial /
    // documentary look — minimal composition, no AI-pop, no text.
    const stylePrefix = [
      "Editorial archival product photography.",
      "Minimal composition. Soft, natural lighting from one direction.",
      "Neutral solid backdrop, no clutter, no props.",
      "Documentary realism, not stylized. Subtle film grain.",
      "Absolutely NO text, NO numbers, NO logos, NO watermarks anywhere in the image.",
      "Photorealistic. Avoid the generic glossy/oversaturated AI look.",
    ].join(" ")
    const finalPrompt = `${stylePrefix}\n\nSubject: ${userPrompt}`

    try {
      const aiRes = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-image-1", prompt: finalPrompt, size: "1024x1024", n: 1 }),
      })
      if (!aiRes.ok) {
        const txt = await aiRes.text()
        return new Response(JSON.stringify({ error: `OpenAI ${aiRes.status}: ${txt.slice(0, 400)}` }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
      }
      const data = await aiRes.json()
      const item = data?.data?.[0]
      const image = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : (item?.url || null)
      if (!image) {
        return new Response(JSON.stringify({ error: "No image returned" }),
          { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
      }
      return new Response(JSON.stringify({ image, prompt: userPrompt, final_prompt: finalPrompt }),
        { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
    } catch (e: any) {
      return new Response(JSON.stringify({ error: String(e?.message || e) }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
    }
  }

  const template_type: string = body.template_type
  const options: any = body.options || {}

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
    } else if (template_type === "pokemon_battle") {
      generated = await generatePokemonBattle(options)
    } else if (template_type === "guess_the_pokemon") {
      generated = await generateGuessThePokemon(options)
    } else if (template_type === "most_traded") {
      generated = await generateMostTraded(options)
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
