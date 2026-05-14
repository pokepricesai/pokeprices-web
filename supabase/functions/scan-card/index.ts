// scan-card — diagnostic test harness for /scan-test.
//
// Takes a base64 JPEG of a Pokemon card, runs it through Google Cloud
// Vision text detection, parses out candidate signals (collector number,
// name, set hint), and ranks the top 5 matches from the `cards` table
// via the scan_card_match RPC.
//
// Returns the raw Vision output AND the parsed signals AND the
// candidates AND timing — the whole point of this function is letting
// us see exactly which stage failed when a scan goes wrong.
//
// Env vars expected (set via `supabase secrets set ...`):
//   SUPABASE_URL                — auto-set
//   SUPABASE_SERVICE_ROLE_KEY   — auto-set
//   GOOGLE_VISION_API_KEY       — manual, add this one
//
// Request body:
//   {
//     "image_base64": "iVBORw0KGgo..."   // no data: prefix
//     "feature": "DOCUMENT_TEXT_DETECTION" | "TEXT_DETECTION"  // optional, default DOCUMENT_TEXT_DETECTION
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const GOOGLE_VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY")

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

// ── Vision call ─────────────────────────────────────────────────────────────

type VisionFeature = "TEXT_DETECTION" | "DOCUMENT_TEXT_DETECTION"

async function callVision(imageBase64: string, feature: VisionFeature): Promise<any> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`
  const body = {
    requests: [
      {
        image: { content: imageBase64 },
        features: [{ type: feature, maxResults: 50 }],
        imageContext: { languageHints: ["en"] },
      },
    ],
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Vision ${res.status}: ${txt.slice(0, 400)}`)
  }
  const data = await res.json()
  return data?.responses?.[0] ?? {}
}

// ── Parsing helpers ─────────────────────────────────────────────────────────
// Kept in clearly separated functions so the regex set is easy to iterate
// on as we find real cards that fail.

// Collector-number patterns, ordered most-specific first.
// Examples handled:
//   123/198, 045/102            standard set numbers
//   TG12/TG30, GG01/GG70        trainer gallery / galarian gallery
//   SV123, SWSH123, XY12        promo prefixes
//   SM01, BW01, DP01, HGSS01    older promo prefixes
const NUMBER_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "fraction-prefixed", re: /\b((?:TG|GG|SV|SWSH|XY|SM|BW|DP|HGSS)\d{1,3}\s*\/\s*(?:TG|GG|SV|SWSH|XY|SM|BW|DP|HGSS)\d{1,3})\b/i },
  { name: "fraction-numeric",  re: /\b(\d{1,3}\s*\/\s*\d{1,3})\b/ },
  { name: "promo-prefixed",    re: /\b((?:TG|GG|SV|SWSH|XY|SM|BW|DP|HGSS)\d{1,3})\b/i },
]

export interface ParsedSignals {
  collector_number: string | null
  collector_number_pattern: string | null
  name: string | null
  set_hint: string | null
  copyright_year: number | null
  full_text: string
}

function extractCollectorNumber(text: string): { value: string | null; pattern: string | null } {
  // Vision tends to put a space between digits and slash. Normalise.
  const norm = text.replace(/\s*\/\s*/g, "/")
  for (const p of NUMBER_PATTERNS) {
    const m = norm.match(p.re)
    if (m) {
      return { value: m[1].toUpperCase().replace(/\s+/g, ""), pattern: p.name }
    }
  }
  return { value: null, pattern: null }
}

function extractCopyrightYear(text: string): number | null {
  // "©2023 Pokémon" / "(C) 2024 Nintendo" / loose "2022 Pokemon"
  const m = text.match(/(?:©|\(c\)|\bcopyright\b)?\s*((?:19|20)\d{2})\s*(?:pok[eé]?mon|nintendo|creatures|game\s*freak)/i)
  if (m) return parseInt(m[1], 10)
  return null
}

function extractSetHint(text: string): string | null {
  // Look for known set abbreviations / series words. Loose on purpose — this
  // is only a soft tie-breaker for ranking, never a hard filter.
  const candidates: string[] = []
  const setHintRe = /\b(scarlet\s*&?\s*violet|sword\s*&?\s*shield|sun\s*&?\s*moon|black\s*&?\s*white|paldea(?:n)?(?:\s*evolved)?|paradox\s*rift|obsidian\s*flames|151|crown\s*zenith|silver\s*tempest|lost\s*origin|brilliant\s*stars|fusion\s*strike|evolving\s*skies|chilling\s*reign|battle\s*styles|vivid\s*voltage|champion's\s*path|darkness\s*ablaze|rebel\s*clash|hidden\s*fates|cosmic\s*eclipse|unified\s*minds|unbroken\s*bonds|temporal\s*forces|twilight\s*masquerade|shrouded\s*fable|stellar\s*crown|surging\s*sparks|prismatic\s*evolutions)\b/gi
  let m: RegExpExecArray | null
  while ((m = setHintRe.exec(text)) !== null) candidates.push(m[1])
  if (candidates.length === 0) return null
  // Return longest match (most specific).
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

// Pick the most likely card-name string from Vision's per-word detection.
// Strategy: the card name is normally the largest text in the top third of
// the image. We use the bounding-box height of each detected word as a
// proxy for font size, then group neighbouring large words on the same
// y-row into a single phrase.
function extractName(response: any): string | null {
  // text_annotations[0] is the full detected text. [1..] are per-word.
  const ann = response?.textAnnotations
  if (!Array.isArray(ann) || ann.length < 2) return null

  const words = ann.slice(1).map((w: any) => {
    const verts = w?.boundingPoly?.vertices ?? []
    if (verts.length < 3) return null
    const ys = verts.map((v: any) => v.y ?? 0)
    const xs = verts.map((v: any) => v.x ?? 0)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    const left = Math.min(...xs)
    const height = bottom - top
    return { text: String(w.description || "").trim(), top, bottom, left, height }
  }).filter(Boolean) as Array<{ text: string; top: number; bottom: number; left: number; height: number }>

  if (words.length === 0) return null

  // Restrict to top 40% of the image.
  const imageMaxY = Math.max(...words.map(w => w.bottom))
  const topZone = words.filter(w => w.top < imageMaxY * 0.4)
  if (topZone.length === 0) return null

  // Take only the largest-font words (within 70% of the max height in zone).
  const maxH = Math.max(...topZone.map(w => w.height))
  const big = topZone.filter(w => w.height >= maxH * 0.7)
  if (big.length === 0) return null

  // Group by y-row (within half a word-height of each other), then take the
  // group with the most large words and string them left-to-right.
  const rowTol = maxH * 0.6
  const rows: typeof big[] = []
  for (const w of big.sort((a, b) => a.top - b.top)) {
    const row = rows.find(r => Math.abs(r[0].top - w.top) <= rowTol)
    if (row) row.push(w)
    else rows.push([w])
  }
  rows.sort((a, b) => b.length - a.length)
  const chosen = rows[0].sort((a, b) => a.left - b.left)

  // Drop obvious non-name tokens (HP numbers, energy types).
  const cleaned = chosen
    .map(w => w.text)
    .filter(t => !/^\d+$/.test(t))
    .filter(t => !/^HP$/i.test(t))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned || null
}

function parseSignals(visionResponse: any): ParsedSignals {
  const fullText = String(visionResponse?.fullTextAnnotation?.text || visionResponse?.textAnnotations?.[0]?.description || "")
  const number = extractCollectorNumber(fullText)
  return {
    collector_number: number.value,
    collector_number_pattern: number.pattern,
    name: extractName(visionResponse),
    set_hint: extractSetHint(fullText),
    copyright_year: extractCopyrightYear(fullText),
    full_text: fullText,
  }
}

// ── Matching ────────────────────────────────────────────────────────────────

async function matchCards(signals: ParsedSignals): Promise<any[]> {
  const { data, error } = await supabase.rpc("scan_card_match", {
    p_collector_number: signals.collector_number,
    p_name:             signals.name,
    p_set_hint:         signals.set_hint,
  })
  if (error) throw new Error(`scan_card_match RPC failed: ${error.message}`)
  return data || []
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  if (!GOOGLE_VISION_API_KEY) {
    return json({ error: "GOOGLE_VISION_API_KEY not set on edge function" }, 500)
  }

  let body: any
  try { body = await req.json() } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const imageBase64: string = String(body.image_base64 || "").replace(/^data:image\/\w+;base64,/, "")
  if (!imageBase64) return json({ error: "Missing image_base64" }, 400)

  const feature: VisionFeature =
    body.feature === "TEXT_DETECTION" ? "TEXT_DETECTION" : "DOCUMENT_TEXT_DETECTION"

  // ── Vision stage ─────────────────────────────────────────────────────────
  const tVisionStart = Date.now()
  let vision: any
  try {
    vision = await callVision(imageBase64, feature)
  } catch (e: any) {
    console.error("Vision error", e?.message || e)
    return json({ error: String(e?.message || e), stage: "vision" }, 500)
  }
  const visionMs = Date.now() - tVisionStart

  // Server-side log so we can debug from Supabase function logs.
  const previewText = String(vision?.fullTextAnnotation?.text || "").slice(0, 600)
  console.log("[scan-card] feature=", feature, " visionMs=", visionMs, " preview:\n", previewText)

  // ── Parse stage ──────────────────────────────────────────────────────────
  const tParseStart = Date.now()
  const signals = parseSignals(vision)
  const parseMs = Date.now() - tParseStart
  console.log("[scan-card] parsed:", JSON.stringify({
    collector_number: signals.collector_number,
    name: signals.name,
    set_hint: signals.set_hint,
    copyright_year: signals.copyright_year,
  }))

  // ── Match stage ──────────────────────────────────────────────────────────
  const tMatchStart = Date.now()
  let candidates: any[] = []
  let matchError: string | null = null
  if (signals.collector_number || signals.name) {
    try {
      candidates = await matchCards(signals)
    } catch (e: any) {
      matchError = String(e?.message || e)
      console.error("Match error", matchError)
    }
  }
  const matchMs = Date.now() - tMatchStart

  return json({
    feature_used: feature,
    vision: {
      full_text: String(vision?.fullTextAnnotation?.text || vision?.textAnnotations?.[0]?.description || ""),
      // Per-word boxes are big; include count only by default. Set
      // `body.include_words=true` if you want them for deeper debugging.
      word_count: Array.isArray(vision?.textAnnotations) ? vision.textAnnotations.length - 1 : 0,
      words: body.include_words === true ? vision?.textAnnotations?.slice(1) : undefined,
    },
    parsed: signals,
    candidates,
    match_error: matchError,
    timing_ms: {
      vision: visionMs,
      parse:  parseMs,
      match:  matchMs,
      total:  visionMs + parseMs + matchMs,
    },
  })
})
