// scan-card — diagnostic test harness for /scan-test.
//
// Two actions:
//   { image_base64, feature? }                          -> recognise a card scan
//   { action: "confirm", scan_log_id, card_slug }       -> mark which candidate
//                                                          the user accepted, so
//                                                          we accumulate labelled
//                                                          tuning data over time.
//
// Env vars (set via `supabase secrets set ...`):
//   SUPABASE_URL                — auto-set
//   SUPABASE_SERVICE_ROLE_KEY   — auto-set
//   GOOGLE_VISION_API_KEY       — manual, add this one

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

async function callVision(
  imageBase64: string,
  feature: VisionFeature,
  numberStripBase64?: string | null,
  cornerBase64?: string | null,
): Promise<{ full: any; numberStrip: any | null; corner: any | null }> {
  // Batch request: up to three images in one round-trip.
  //   [0] full card        — name + general text
  //   [1] bottom strip     — modern bottom-LEFT collector number
  //   [2] bottom-R corner  — vintage bottom-RIGHT collector number,
  //                           contrast-boosted, max zoom
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`
  const requests: any[] = [
    {
      image: { content: imageBase64 },
      features: [{ type: feature, maxResults: 50 }],
      imageContext: { languageHints: ["en"] },
    },
  ]
  const stripIdx = numberStripBase64 ? requests.length : -1
  if (numberStripBase64) {
    requests.push({
      image: { content: numberStripBase64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 20 }],
      imageContext: { languageHints: ["en"] },
    })
  }
  const cornerIdx = cornerBase64 ? requests.length : -1
  if (cornerBase64) {
    requests.push({
      image: { content: cornerBase64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 20 }],
      imageContext: { languageHints: ["en"] },
    })
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Vision ${res.status}: ${txt.slice(0, 400)}`)
  }
  const data = await res.json()
  return {
    full:        data?.responses?.[0] ?? {},
    numberStrip: stripIdx  >= 0 ? (data?.responses?.[stripIdx]  ?? null) : null,
    corner:      cornerIdx >= 0 ? (data?.responses?.[cornerIdx] ?? null) : null,
  }
}

// ── Parsing helpers ─────────────────────────────────────────────────────────

// Promo-prefix codes that appear in modern Pokemon collector numbers.
// Optional dash / underscore between prefix and digits — Vision and the
// scraper format these inconsistently. Downstream normalisation strips
// the separator so "SWSH123" and "SWSH-123" match the same DB row.
const PROMO_PREFIXES = "TG|GG|SV|SVP|SWSH|XY|SM|BW|DP|HGSS|POP|BS"

const NUMBER_PATTERNS: { name: string; re: RegExp; reassemble?: (m: RegExpMatchArray) => string }[] = [
  { name: "fraction-prefixed", re: new RegExp(`\\b((?:${PROMO_PREFIXES})[-_]?\\d{1,3}\\s*\\/\\s*(?:${PROMO_PREFIXES})[-_]?\\d{1,3})\\b`, "i") },
  { name: "fraction-numeric",  re: /\b(\d{1,3}\s*\/\s*\d{1,3})\b/ },
  // Loose separator: Vision sometimes reads the slash as -, |, _, or even
  // a space. Reassemble as N/M so downstream normalisation handles it.
  { name: "fraction-loose",    re: /\b(\d{1,3})\s*[\-_|]\s*(\d{1,3})\b/, reassemble: (m) => `${m[1]}/${m[2]}` },
  // "130 086" with whitespace only — only when both look like valid card
  // numbers (1-3 digit each, denom >= 30 to avoid noise like year fragments).
  { name: "fraction-space",    re: /\b(\d{1,3})\s+(\d{2,3})\b/, reassemble: (m) => parseInt(m[2], 10) >= 30 ? `${m[1]}/${m[2]}` : "" },
  { name: "promo-prefixed",    re: new RegExp(`\\b((?:${PROMO_PREFIXES})[-_]?\\d{1,3})\\b`, "i") },
]

// Modern set abbreviations printed on the bottom-right of cards (Sword & Shield
// onwards). Strong set signal when present. Word/group split so the regex stays
// readable.
const SET_ABBREVIATIONS = [
  // Scarlet & Violet
  "SVI", "PAL", "OBF", "MEW", "PAR", "PAF", "TEF", "TWM", "SFA", "SCR", "SSP", "PRE", "JTG",
  // Sword & Shield
  "SSH", "RCL", "DAA", "VIV", "BST", "CRE", "EVS", "FST", "BRS", "ASR", "LOR", "SIT", "CRZ", "SVE",
  // Sun & Moon (less common, included for completeness)
  "SUM", "GRI", "BUS", "CIN", "UPR", "FLI", "CES", "LOT", "TEU", "DRM", "UNB", "UNM", "CEC", "HIF",
]

const SET_HINT_WORDS_RE = /\b(scarlet\s*&?\s*violet|sword\s*&?\s*shield|sun\s*&?\s*moon|black\s*&?\s*white|paldea(?:n)?(?:\s*evolved)?|paradox\s*rift|obsidian\s*flames|151|crown\s*zenith|silver\s*tempest|lost\s*origin|brilliant\s*stars|fusion\s*strike|evolving\s*skies|chilling\s*reign|battle\s*styles|vivid\s*voltage|champion's\s*path|darkness\s*ablaze|rebel\s*clash|hidden\s*fates|cosmic\s*eclipse|unified\s*minds|unbroken\s*bonds|temporal\s*forces|twilight\s*masquerade|shrouded\s*fable|stellar\s*crown|surging\s*sparks|prismatic\s*evolutions|journey\s*together)\b/gi

export interface ParsedSignals {
  collector_number: string | null
  collector_number_pattern: string | null
  name: string | null
  set_hint: string | null
  set_abbreviation: string | null
  copyright_year: number | null
  is_promo: boolean
  full_text: string
}

function extractCollectorNumber(text: string): { value: string | null; pattern: string | null } {
  const norm = text.replace(/\s*\/\s*/g, "/")
  for (const p of NUMBER_PATTERNS) {
    const m = norm.match(p.re)
    if (m) {
      const raw = p.reassemble ? p.reassemble(m) : m[1]
      if (!raw) continue
      return { value: raw.toUpperCase().replace(/\s+/g, ""), pattern: p.name }
    }
  }
  return { value: null, pattern: null }
}

function extractCopyrightYear(text: string): number | null {
  const m = text.match(/(?:©|\(c\)|\bcopyright\b)?\s*((?:19|20)\d{2})\s*(?:pok[eé]?mon|nintendo|creatures|game\s*freak)/i)
  if (m) return parseInt(m[1], 10)
  // Loose fallback: any 19xx/20xx year near a copyright symbol.
  const m2 = text.match(/[©Cc]\s*((?:19|20)\d{2})/)
  if (m2) return parseInt(m2[1], 10)
  return null
}

function extractSetAbbreviation(text: string): string | null {
  // Set abbreviations appear bottom-right alongside the collector number, often
  // as standalone 3-letter all-caps tokens. Match against the curated list to
  // avoid false positives on random uppercase noise.
  const upper = text.toUpperCase()
  for (const abbr of SET_ABBREVIATIONS) {
    const re = new RegExp(`\\b${abbr}\\b`)
    if (re.test(upper)) return abbr
  }
  return null
}

// Promo signals: the bottom-left of a Pokemon promo card carries one of
// these markers. Vision sometimes also catches a "PROMO" word in the
// rarity slot. Promo-prefixed numbers (SWSH123, XY12, SM01...) imply promo
// too — we treat any of these as positive signal.
function extractIsPromo(text: string, collectorPattern: string | null): boolean {
  if (collectorPattern === 'promo-prefixed') return true
  return /\bpromo(?:tional)?\b/i.test(text)
      || /\bblack\s*star\b/i.test(text)
}

function extractSetHint(text: string): string | null {
  // Series/set words anywhere in the text. Loose — soft signal only.
  const candidates: string[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(SET_HINT_WORDS_RE.source, SET_HINT_WORDS_RE.flags)
  while ((m = re.exec(text)) !== null) candidates.push(m[1])
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.length - a.length)
  return candidates[0]
}

function extractName(response: any): string | null {
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

  const imageMaxY = Math.max(...words.map(w => w.bottom))
  const topZone = words.filter(w => w.top < imageMaxY * 0.4)
  if (topZone.length === 0) return null

  const maxH = Math.max(...topZone.map(w => w.height))
  const big = topZone.filter(w => w.height >= maxH * 0.7)
  if (big.length === 0) return null

  const rowTol = maxH * 0.6
  const rows: typeof big[] = []
  for (const w of big.sort((a, b) => a.top - b.top)) {
    const row = rows.find(r => Math.abs(r[0].top - w.top) <= rowTol)
    if (row) row.push(w)
    else rows.push([w])
  }
  rows.sort((a, b) => b.length - a.length)
  const chosen = rows[0].sort((a, b) => a.left - b.left)

  let cleaned = chosen
    .map(w => w.text)
    .filter(t => !/^\d+$/.test(t))
    .filter(t => !/^HP$/i.test(t))
    .join(" ")
  // Vision sometimes returns "Name 70" as a single annotation that passes
  // the per-token filters above. Strip "HP NN", "HP", and a trailing 2-3
  // digit number (HP is always 30-340 on a Pokemon card).
  cleaned = cleaned
    .replace(/\bHP\s*\d{1,3}\b/gi, "")
    .replace(/\bHP\b/gi, "")
    .replace(/\s+\d{2,3}\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned || null
}

function parseSignals(fullResponse: any, numberStripResponse: any | null, cornerResponse: any | null): ParsedSignals {
  const fullText   = String(fullResponse?.fullTextAnnotation?.text   || fullResponse?.textAnnotations?.[0]?.description   || "")
  const stripText  = String(numberStripResponse?.fullTextAnnotation?.text || numberStripResponse?.textAnnotations?.[0]?.description || "")
  const cornerText = String(cornerResponse?.fullTextAnnotation?.text || cornerResponse?.textAnnotations?.[0]?.description || "")

  // Try all three OCR passes; prefer whichever returned a denominator
  // (N/M form). Order of preference when no denom is found:
  //   corner (high-zoom bottom-right, best for vintage)
  //   strip  (bottom 35%, good for modern bottom-left)
  //   full   (whole card, last resort)
  const cornerNum = cornerText ? extractCollectorNumber(cornerText) : { value: null, pattern: null }
  const stripNum  = stripText  ? extractCollectorNumber(stripText)  : { value: null, pattern: null }
  const fullNum   = fullText   ? extractCollectorNumber(fullText)   : { value: null, pattern: null }
  const hasDenom = (v: string | null) => v != null && v.includes("/")
  let number: { value: string | null; pattern: string | null }
  if      (hasDenom(cornerNum.value)) number = cornerNum
  else if (hasDenom(stripNum.value))  number = stripNum
  else if (hasDenom(fullNum.value))   number = fullNum
  else if (cornerNum.value)           number = cornerNum
  else if (stripNum.value)            number = stripNum
  else                                number = fullNum

  // Set abbreviation is printed near the number; check corner, then strip,
  // then full.
  let abbreviation: string | null = cornerText ? extractSetAbbreviation(cornerText) : null
  if (!abbreviation && stripText) abbreviation = extractSetAbbreviation(stripText)
  if (!abbreviation)              abbreviation = extractSetAbbreviation(fullText)

  const combinedText = fullText + (stripText ? "\n" + stripText : "") + (cornerText ? "\n" + cornerText : "")
  return {
    collector_number: number.value,
    collector_number_pattern: number.pattern,
    name: extractName(fullResponse),
    set_hint: extractSetHint(fullText),
    set_abbreviation: abbreviation,
    copyright_year: extractCopyrightYear(fullText),
    is_promo: extractIsPromo(combinedText, number.pattern),
    full_text: fullText
      + (stripText  ? `\n--- bottom strip ---\n${stripText}`     : "")
      + (cornerText ? `\n--- bottom-right corner ---\n${cornerText}` : ""),
  }
}

// ── Matching ────────────────────────────────────────────────────────────────

async function matchCards(signals: ParsedSignals): Promise<any[]> {
  // Set hint passed to the RPC is the abbreviation if present (stronger
  // signal: it maps to the printed set code), otherwise the long-form
  // series words. Both get an ILIKE %hint% against cards.set_name.
  const setHint = signals.set_abbreviation || signals.set_hint
  const { data, error } = await supabase.rpc("scan_card_match", {
    p_collector_number: signals.collector_number,
    p_name:             signals.name,
    p_set_hint:         setHint,
    p_copyright_year:   signals.copyright_year,
    p_is_promo:         signals.is_promo,
  })
  if (error) throw new Error(`scan_card_match RPC failed: ${error.message}`)
  return data || []
}

// ── Logging ─────────────────────────────────────────────────────────────────

async function logScan(opts: {
  feature: VisionFeature
  signals: ParsedSignals
  candidates: any[]
  timing: Record<string, number>
  holoAnalysis: any | null
}): Promise<number | null> {
  const top = opts.candidates[0]
  try {
    const { data, error } = await supabase.from("scan_logs").insert([{
      feature_used:    opts.feature,
      vision_full_text: opts.signals.full_text?.slice(0, 4000) ?? null,
      parsed_signals: {
        collector_number: opts.signals.collector_number,
        collector_number_pattern: opts.signals.collector_number_pattern,
        name: opts.signals.name,
        set_hint: opts.signals.set_hint,
        set_abbreviation: opts.signals.set_abbreviation,
        copyright_year: opts.signals.copyright_year,
      },
      candidates:       opts.candidates,
      top_card_slug:    top?.card_slug ?? null,
      top_confidence:   top?.confidence ?? null,
      timing_ms:        opts.timing,
      holo_analysis:    opts.holoAnalysis ?? null,
    }]).select("id").single()
    if (error) {
      console.error("[scan-card] scan_logs insert failed:", error.message)
      return null
    }
    return data?.id ?? null
  } catch (e: any) {
    console.error("[scan-card] scan_logs insert threw:", e?.message || e)
    return null
  }
}

async function confirmScan(scanLogId: number, cardSlug: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("scan_logs")
    .update({ confirmed_card_slug: cardSlug, confirmed_at: new Date().toISOString() })
    .eq("id", scanLogId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: any
  try { body = await req.json() } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  // ── Confirm branch ───────────────────────────────────────────────────────
  if (body.action === "confirm") {
    const id = Number(body.scan_log_id)
    const slug = String(body.card_slug || "")
    if (!id || !slug) return json({ error: "scan_log_id and card_slug required" }, 400)
    const result = await confirmScan(id, slug)
    if (!result.ok) return json({ error: result.error }, 500)
    return json({ ok: true })
  }

  // ── Recognise branch ─────────────────────────────────────────────────────
  if (!GOOGLE_VISION_API_KEY) {
    return json({ error: "GOOGLE_VISION_API_KEY not set on edge function" }, 500)
  }

  const imageBase64: string = String(body.image_base64 || "").replace(/^data:image\/\w+;base64,/, "")
  if (!imageBase64) return json({ error: "Missing image_base64" }, 400)

  const numberStripBase64: string | null = body.image_base64_number
    ? String(body.image_base64_number).replace(/^data:image\/\w+;base64,/, "")
    : null

  const cornerBase64: string | null = body.image_base64_corner
    ? String(body.image_base64_corner).replace(/^data:image\/\w+;base64,/, "")
    : null

  const feature: VisionFeature =
    body.feature === "TEXT_DETECTION" ? "TEXT_DETECTION" : "DOCUMENT_TEXT_DETECTION"

  // Vision (batch: full card + optional bottom-strip + optional corner)
  const tVisionStart = Date.now()
  let visionResult: { full: any; numberStrip: any | null; corner: any | null }
  try {
    visionResult = await callVision(imageBase64, feature, numberStripBase64, cornerBase64)
  } catch (e: any) {
    console.error("Vision error", e?.message || e)
    return json({ error: String(e?.message || e), stage: "vision" }, 500)
  }
  const visionMs = Date.now() - tVisionStart

  const previewText  = String(visionResult.full?.fullTextAnnotation?.text   || "").slice(0, 600)
  const stripPreview = String(visionResult.numberStrip?.fullTextAnnotation?.text || "").slice(0, 200)
  const cornerPreview = String(visionResult.corner?.fullTextAnnotation?.text || "").slice(0, 200)
  console.log("[scan-card] feature=", feature, " visionMs=", visionMs,
    " full preview:\n", previewText,
    "\n strip preview:\n", stripPreview,
    "\n corner preview:\n", cornerPreview)

  // Parse
  const tParseStart = Date.now()
  const signals = parseSignals(visionResult.full, visionResult.numberStrip, visionResult.corner)
  const parseMs = Date.now() - tParseStart
  console.log("[scan-card] parsed:", JSON.stringify({
    collector_number: signals.collector_number,
    name: signals.name,
    set_hint: signals.set_hint,
    set_abbreviation: signals.set_abbreviation,
    copyright_year: signals.copyright_year,
    is_promo: signals.is_promo,
  }))

  // Match
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

  const timing = {
    vision: visionMs,
    parse:  parseMs,
    match:  matchMs,
    total:  visionMs + parseMs + matchMs,
  }

  // Log (non-blocking on failure — we still return the result to the user).
  const tLogStart = Date.now()
  const scanLogId = await logScan({
    feature, signals, candidates, timing,
    holoAnalysis: body.holo_analysis ?? null,
  })
  const logMs = Date.now() - tLogStart

  return json({
    scan_log_id: scanLogId,
    feature_used: feature,
    vision: {
      full_text: signals.full_text,
      word_count: Array.isArray(visionResult.full?.textAnnotations) ? visionResult.full.textAnnotations.length - 1 : 0,
      words: body.include_words === true ? visionResult.full?.textAnnotations?.slice(1) : undefined,
      number_strip_text: String(visionResult.numberStrip?.fullTextAnnotation?.text || visionResult.numberStrip?.textAnnotations?.[0]?.description || ""),
      corner_text:       String(visionResult.corner?.fullTextAnnotation?.text || visionResult.corner?.textAnnotations?.[0]?.description || ""),
    },
    parsed: signals,
    candidates,
    match_error: matchError,
    timing_ms: { ...timing, log: logMs },
  })
})
