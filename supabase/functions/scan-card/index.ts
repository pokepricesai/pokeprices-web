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
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY")

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
  // Block 5A-W-51A — language hints extended to ["en", "ja"]. Google
  // Vision's OCR model returns Japanese-language card text (Kanji /
  // Hiragana / Katakana) when "ja" is included as a hint. Keeping "en"
  // first preserves the existing English behaviour — the hint list is
  // an ORDER OF PREFERENCE, not a filter. English cards still OCR
  // exactly as before; Japanese cards now return real Japanese text
  // instead of garbled Latin approximations.
  const LANG_HINTS = ["en", "ja"]
  const requests: any[] = [
    {
      image: { content: imageBase64 },
      features: [{ type: feature, maxResults: 50 }],
      imageContext: { languageHints: LANG_HINTS },
    },
  ]
  const stripIdx = numberStripBase64 ? requests.length : -1
  if (numberStripBase64) {
    requests.push({
      image: { content: numberStripBase64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 20 }],
      imageContext: { languageHints: LANG_HINTS },
    })
  }
  const cornerIdx = cornerBase64 ? requests.length : -1
  if (cornerBase64) {
    requests.push({
      image: { content: cornerBase64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 20 }],
      imageContext: { languageHints: LANG_HINTS },
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

// ── AI vision (alternative recognition path) ───────────────────────────────
// Single Haiku 4.5 call that takes the full card image and returns
// structured JSON. Replaces the entire Google Vision + parse pipeline
// when engine === "ai_vision". Designed to be a drop-in alternative so
// downstream matching is identical.

const HAIKU_VISION_PROMPT = `You are an expert Pokemon TCG card identifier. This card may be from any language market — English, Japanese, or another. Look at the photo and return a JSON object describing what you see.

Return ONLY this JSON shape. No preamble, no markdown code fence.

{
  "language": "en" | "jp" | null,        // "jp" if you see Kanji, Hiragana or Katakana anywhere; "en" for an English-market card; null if truly ambiguous
  "pokemon_name": string | null,         // the Pokemon or card's PRINTED name — Japanese OK; verbatim from the card
  "canonical_pokemon_name": string | null, // the English Pokemon species name if you can identify the species from artwork (used to match translated database records)
  "printed_name": string | null,         // if language=jp, the visible Japanese card name verbatim; else same as pokemon_name
  "collector_number": string | null,     // exact format printed, e.g. "4/102", "016/165", "102/100" (real printed JP Battle Partners), "SWSH-123". Some vintage JP cards show NO N/M number — return null in that case
  "set_name": string | null,             // best guess at the full set name if you recognize it; for a JP card give the English translation of the set name if you know it (e.g. "Rocket Gang" for ロケット団, "Battle Partners" for バトルパートナーズ)
  "set_symbol_description": string | null, // brief description of the set symbol visible on the card (e.g. "black R inside a red circle" for Team Rocket, "silver crescent moon" for Neo Genesis)
  "set_abbreviation": string | null,     // 3-letter code if visible (SVI, PAR, OBF, PAF, etc)
  "copyright_year": number | null,       // 4-digit year from copyright line
  "card_era": string | null,             // one of: "vintage-1996-2001", "e-card-2002-2003", "ex-2003-2007", "dp-2007-2010", "black-white-2010-2013", "xy-2013-2016", "sun-moon-2016-2019", "sword-shield-2019-2022", "scarlet-violet-2023-present"; use visual + copyright cues
  "is_promo": boolean,                   // PROMO badge, black star, or promo-prefixed number (SWSH/XY/SM/SVP...)
  "rarity_hint": string | null,          // e.g. "common", "uncommon", "rare-holo", "ultra-rare", "secret-rare", "special-art-rare", "1st-edition"
  "variant": "regular" | "holo" | "reverse_holo" | "full_art" | "textured" | "unknown",
  "variant_confidence": "high" | "medium" | "low",
  "notes": string                        // one short sentence about anything unclear in your reading
}

Language guidance:
- Japanese cards have Japanese script (Kanji / Hiragana / Katakana) somewhere on the card — usually in the flavour text or move descriptions, even if the Pokemon name looks similar to English.
- English cards contain only Latin script.
- Some vintage Japanese cards (1996-2001) do NOT print a collector number in N/M form on the card face — return collector_number=null in that case rather than guessing.

Pokemon name guidance:
- canonical_pokemon_name should be the English species name (Charizard, Moltres, Espeon, etc.) — this matches how PokePrices stores Japanese cards translated by species.
- If the card shows a special-form Pokemon (e.g. Galarian, Alolan, Team Rocket's, Dark), include the qualifier in canonical_pokemon_name (e.g. "Rocket's Moltres", "Team Rocket's Moltres ex", "Dark Charizard", "Galarian Moltres").

Era + rarity guidance:
- card_era + rarity_hint help resolve which specific printing this is when multiple sets contain the same Pokemon at the same number.

Variant guidance:
- holo:         foil pattern visible IN the artwork window only
- reverse_holo: foil pattern visible in the frame/border but NOT in the artwork
- full_art:     whole card is foil (ex / V / VMAX / modern ex / Special Illustration Rare)
- textured:     physical texture/embossing visible (Special Illustration Rare, Ultra Rare textured)
- regular:      plain matte non-foil

Output ONLY the JSON object.`

async function callAIVision(imageBase64: string): Promise<{ signals: ParsedSignals; raw: any; variant: string | null; variantConfidence: string | null }> {
  if (!CLAUDE_API_KEY) throw new Error("CLAUDE_API_KEY not set on edge function")
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: HAIKU_VISION_PROMPT },
        ],
      }],
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Haiku ${res.status}: ${txt.slice(0, 400)}`)
  }
  const data = await res.json()
  const text = String(data?.content?.[0]?.text || "")

  let parsed: any
  try {
    const cleaned = text.replace(/```json|```/g, "").trim()
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start < 0 || end < 0) throw new Error("no JSON braces")
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch (e: any) {
    throw new Error(`Could not parse Haiku JSON: ${e?.message || e}. Raw: ${text.slice(0, 200)}`)
  }

  // Block 5A-W-51A — trust the model's language field when it commits
  // to "en" or "jp"; fall back to text-based CJK detection on the
  // pokemon_name / set_name / notes fields so we still get a signal
  // when the model returned language: null.
  const modelLang = parsed.language === "en" || parsed.language === "jp" ? parsed.language : null
  const textJoined = [parsed.pokemon_name, parsed.printed_name, parsed.set_name, parsed.notes]
    .filter(Boolean).map((s: unknown) => String(s)).join(" ")
  const language: "en" | "jp" | null = modelLang ?? detectCardLanguageFromText(textJoined)

  // Block 5A-W-51B — prefer the canonical English name for RPC matching
  // (PokePrices stores Japanese cards under their English translation).
  // Fall back to pokemon_name / printed_name for older prompts that
  // don't return the canonical field.
  const nameForMatching = parsed.canonical_pokemon_name
    ? String(parsed.canonical_pokemon_name).trim()
    : (parsed.pokemon_name ? String(parsed.pokemon_name).trim() : null)

  const signals: ParsedSignals = {
    collector_number: parsed.collector_number ? String(parsed.collector_number).trim() : null,
    collector_number_pattern: parsed.collector_number ? "ai-vision" : null,
    name: nameForMatching,
    set_hint: parsed.set_name ? String(parsed.set_name).trim() : null,
    set_abbreviation: parsed.set_abbreviation ? String(parsed.set_abbreviation).trim().toUpperCase() : null,
    copyright_year: typeof parsed.copyright_year === "number" ? parsed.copyright_year : null,
    is_promo: !!parsed.is_promo,
    language,
    // Block 5A-W-51B — extra diagnostic fields for hybrid merging + logs.
    canonical_pokemon_name: parsed.canonical_pokemon_name ? String(parsed.canonical_pokemon_name).trim() : null,
    printed_name:           parsed.printed_name ? String(parsed.printed_name).trim() : null,
    card_era:               parsed.card_era ? String(parsed.card_era).trim() : null,
    rarity_hint:            parsed.rarity_hint ? String(parsed.rarity_hint).trim() : null,
    set_symbol_description: parsed.set_symbol_description ? String(parsed.set_symbol_description).trim() : null,
    full_text: JSON.stringify(parsed, null, 2),
  }
  return {
    signals,
    raw: parsed,
    variant: parsed.variant ?? null,
    variantConfidence: parsed.variant_confidence ?? null,
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
  // Block 5A-W-51A — 'jp' when OCR text contains CJK unicode (Kanji /
  // Hiragana / Katakana) or the Haiku model returned language: 'jp'.
  // 'en' when text is Latin-only with at least one letter. null when
  // OCR returned nothing usable. Passed as p_language to
  // scan_card_match — see migrations/2026-08-04-scan-card-match-
  // language-signal.sql for how the RPC uses it.
  language: "en" | "jp" | null
  // Block 5A-W-51B — additional diagnostic fields populated only by
  // the AI vision path. Downstream matching still uses `name` (which
  // is set to canonical_pokemon_name when available) so no RPC
  // signature change is needed. These carry through into scan_logs
  // for offline analysis of which fields the AI extracted.
  canonical_pokemon_name?: string | null
  printed_name?: string | null
  card_era?: string | null
  rarity_hint?: string | null
  set_symbol_description?: string | null
  full_text: string
}

// ── Language detection (mirrors src/lib/scanner/parseHelpers.ts) ─
//
// Kept as a copy here because Deno edge functions cannot import from
// src/. The boundary test in
// src/lib/scanner/__tests__/scanMatchMigration.test.ts asserts that
// the regex + function shape match the src/ copy so the two paths
// stay in sync.
const CJK_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/

function detectCardLanguageFromText(text: string | null | undefined): "en" | "jp" | null {
  if (!text) return null
  if (CJK_RE.test(text)) return "jp"
  if (/[A-Za-z]/.test(text)) return "en"
  return null
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
    // Block 5A-W-51A — inspect ALL three OCR passes for CJK unicode.
    // Even a single Hiragana or Kanji character anywhere is a strong
    // "this is a Japanese-market card" signal. English cards never
    // contain CJK, so this is unambiguous.
    language: detectCardLanguageFromText(combinedText),
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
  // Block 5A-W-51A — p_language routes ranking preference toward the
  // detected language. When signals.language is null (OCR gave no
  // signal) the RPC behaves exactly as pre-51A. See
  // migrations/2026-08-04-scan-card-match-language-signal.sql.
  const { data, error } = await supabase.rpc("scan_card_match", {
    p_collector_number: signals.collector_number,
    p_name:             signals.name,
    p_set_hint:         setHint,
    p_copyright_year:   signals.copyright_year,
    p_is_promo:         signals.is_promo,
    p_language:         signals.language,
  })
  if (error) throw new Error(`scan_card_match RPC failed: ${error.message}`)
  return data || []
}

// ── Logging ─────────────────────────────────────────────────────────────────

async function logScan(opts: {
  feature: VisionFeature
  engine: "vision_ocr" | "ai_vision"
  signals: ParsedSignals
  candidates: any[]
  timing: Record<string, number>
  holoAnalysis: any | null
  aiVariant: string | null
  aiVariantConfidence: string | null
  userId: string | null
  deviceId: string | null
  autoAiInvoked?: boolean
  aiMergedFields?: string[]
}): Promise<number | null> {
  const top = opts.candidates[0]
  try {
    const { data, error } = await supabase.from("scan_logs").insert([{
      user_id:         opts.userId,
      device_id:       opts.deviceId,
      feature_used:    opts.engine === "ai_vision" ? "AI_VISION" : opts.feature,
      vision_full_text: opts.signals.full_text?.slice(0, 4000) ?? null,
      parsed_signals: {
        engine: opts.engine,
        collector_number: opts.signals.collector_number,
        collector_number_pattern: opts.signals.collector_number_pattern,
        name: opts.signals.name,
        set_hint: opts.signals.set_hint,
        set_abbreviation: opts.signals.set_abbreviation,
        copyright_year: opts.signals.copyright_year,
        is_promo: opts.signals.is_promo,
        // Block 5A-W-51A — inferred language passed to the matcher.
        // Never contains user PII; safe to log.
        language: opts.signals.language,
        // Block 5A-W-51B — extended AI fields recorded for offline
        // analysis of which fields the model provides. None are
        // sensitive; all originate from the card image.
        canonical_pokemon_name: opts.signals.canonical_pokemon_name ?? null,
        printed_name: opts.signals.printed_name ?? null,
        card_era: opts.signals.card_era ?? null,
        rarity_hint: opts.signals.rarity_hint ?? null,
        set_symbol_description: opts.signals.set_symbol_description ?? null,
        // Block 5A-W-51B — records whether the OCR path auto-invoked
        // AI and merged its output.
        auto_ai_invoked: opts.autoAiInvoked ?? false,
        ai_merged_fields: opts.aiMergedFields ?? [],
        ai_variant: opts.aiVariant,
        ai_variant_confidence: opts.aiVariantConfidence,
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
  const imageBase64: string = String(body.image_base64 || "").replace(/^data:image\/\w+;base64,/, "")
  if (!imageBase64) return json({ error: "Missing image_base64" }, 400)

  // Identity for quota: prefer authenticated user, fall back to anonymous
  // device id from the browser's localStorage. At least one must be set
  // or quota cannot be tracked and we reject the request.
  const userId:   string | null = body.user_id   ? String(body.user_id)   : null
  const deviceId: string | null = body.device_id ? String(body.device_id) : null
  if (!userId && !deviceId) {
    return json({ error: "user_id or device_id required for quota tracking" }, 400)
  }

  // Quota check (100/month). Diagnostic /scan-test page can bypass with
  // body.skip_quota = true so internal testing does not eat the limit.
  if (body.skip_quota !== true) {
    try {
      const { data: quotaRow, error: quotaErr } = await supabase.rpc("scan_quota_remaining", {
        p_user_id:   userId,
        p_device_id: deviceId,
      }).single()
      if (quotaErr) {
        console.error("[scan-card] quota lookup failed:", quotaErr.message)
      } else if (quotaRow && (quotaRow as any).scans_remaining <= 0) {
        return json({
          error: "quota_exceeded",
          message: `Free tier limit of ${(quotaRow as any).monthly_limit} scans per month reached. Resets on the 1st.`,
          scans_used:      (quotaRow as any).scans_used,
          scans_remaining: 0,
          monthly_limit:   (quotaRow as any).monthly_limit,
        }, 429)
      }
    } catch (e: any) {
      console.error("[scan-card] quota exception:", e?.message || e)
    }
  }

  const engine: "vision_ocr" | "ai_vision" =
    body.engine === "ai_vision" ? "ai_vision" : "vision_ocr"

  let signals: ParsedSignals
  let visionMs = 0
  let parseMs = 0
  let aiVariant: string | null = null
  let aiVariantConfidence: string | null = null
  let visionResult: { full: any; numberStrip: any | null; corner: any | null } = { full: null, numberStrip: null, corner: null }
  const feature: VisionFeature =
    body.feature === "TEXT_DETECTION" ? "TEXT_DETECTION" : "DOCUMENT_TEXT_DETECTION"

  if (engine === "ai_vision") {
    if (!CLAUDE_API_KEY) return json({ error: "CLAUDE_API_KEY not set on edge function" }, 500)
    const tAIStart = Date.now()
    try {
      const aiResult = await callAIVision(imageBase64)
      signals = aiResult.signals
      aiVariant = aiResult.variant
      aiVariantConfidence = aiResult.variantConfidence
    } catch (e: any) {
      console.error("AI vision error", e?.message || e)
      return json({ error: String(e?.message || e), stage: "ai_vision" }, 500)
    }
    visionMs = Date.now() - tAIStart
    console.log("[scan-card] engine=ai_vision haikuMs=", visionMs, " signals:", JSON.stringify({
      collector_number: signals.collector_number,
      name: signals.name,
      set_hint: signals.set_hint,
      is_promo: signals.is_promo,
      language: signals.language,
      variant: aiVariant,
    }))
  } else {
    if (!GOOGLE_VISION_API_KEY) return json({ error: "GOOGLE_VISION_API_KEY not set on edge function" }, 500)

    const numberStripBase64: string | null = body.image_base64_number
      ? String(body.image_base64_number).replace(/^data:image\/\w+;base64,/, "")
      : null
    const cornerBase64: string | null = body.image_base64_corner
      ? String(body.image_base64_corner).replace(/^data:image\/\w+;base64,/, "")
      : null

    const tVisionStart = Date.now()
    try {
      visionResult = await callVision(imageBase64, feature, numberStripBase64, cornerBase64)
    } catch (e: any) {
      console.error("Vision error", e?.message || e)
      return json({ error: String(e?.message || e), stage: "vision" }, 500)
    }
    visionMs = Date.now() - tVisionStart

    const previewText   = String(visionResult.full?.fullTextAnnotation?.text   || "").slice(0, 600)
    const stripPreview  = String(visionResult.numberStrip?.fullTextAnnotation?.text || "").slice(0, 200)
    const cornerPreview = String(visionResult.corner?.fullTextAnnotation?.text || "").slice(0, 200)
    console.log("[scan-card] engine=vision_ocr feature=", feature, " visionMs=", visionMs,
      " full preview:\n", previewText,
      "\n strip preview:\n", stripPreview,
      "\n corner preview:\n", cornerPreview)

    const tParseStart = Date.now()
    signals = parseSignals(visionResult.full, visionResult.numberStrip, visionResult.corner)
    parseMs = Date.now() - tParseStart
  }

  // Block 5A-W-51B — auto-invoke AI when OCR detected Japanese and OCR
  // signals are weak. Symptom this fixes: the id=426 scan of a vintage
  // JP Team Rocket Moltres returned 0 candidates because OCR read
  // Japanese text ("R団のファイヤー") that doesn't match English
  // `cards.card_name`. AI can supply the canonical English name
  // ("Rocket's Moltres" or "Moltres"), plus era/rarity hints for
  // ranking. Adds one Haiku call (~$0.0025) to JP scans only —
  // English scans skip the AI path entirely.
  let autoAiInvoked = false
  const aiMergedFields: string[] = []
  const shouldAutoInvokeAI = (
    engine === "vision_ocr"                          // only auto-augment the OCR path
    && CLAUDE_API_KEY                                 // AI is available
    && signals.language === "jp"                      // OCR saw CJK → definitely Japanese
    && (
      // Weak OCR signal — either no number, or no Latin-friendly name.
      !signals.collector_number
      || !signals.name
      || (signals.name != null && CJK_RE.test(signals.name) && !/[A-Za-z]{3,}/.test(signals.name))
    )
  )
  if (shouldAutoInvokeAI) {
    const tAIStart = Date.now()
    try {
      const aiResult = await callAIVision(imageBase64)
      autoAiInvoked = true
      // Merge signals per the 51B priority list:
      //   1. Collector number — OCR wins when it produced a valid
      //      pattern (fraction / promo-prefixed); AI fills in when OCR
      //      returned null.
      if (!signals.collector_number && aiResult.signals.collector_number) {
        signals.collector_number = aiResult.signals.collector_number
        signals.collector_number_pattern = aiResult.signals.collector_number_pattern
        aiMergedFields.push("collector_number")
      }
      //   2. Name — prefer AI's canonical English name whenever OCR's
      //      name is missing or CJK-only (untranslatable by the RPC).
      const ocrNameUsable = signals.name && /[A-Za-z]{3,}/.test(signals.name)
      if (!ocrNameUsable && aiResult.signals.name) {
        signals.name = aiResult.signals.name
        aiMergedFields.push("name")
      }
      //   3. Language — keep OCR's CJK-derived value (definitive; the
      //      OCR text saw raw script). Only overwrite null → AI value.
      if (!signals.language && aiResult.signals.language) {
        signals.language = aiResult.signals.language
        aiMergedFields.push("language")
      }
      //   4. Set hint — AI is stronger here (can recognise set art);
      //      only take it when OCR gave nothing.
      if (!signals.set_hint && aiResult.signals.set_hint) {
        signals.set_hint = aiResult.signals.set_hint
        aiMergedFields.push("set_hint")
      }
      if (!signals.set_abbreviation && aiResult.signals.set_abbreviation) {
        signals.set_abbreviation = aiResult.signals.set_abbreviation
        aiMergedFields.push("set_abbreviation")
      }
      //   5. Copyright year — OCR read the actual text; keep it when
      //      present, otherwise take AI's.
      if (!signals.copyright_year && aiResult.signals.copyright_year) {
        signals.copyright_year = aiResult.signals.copyright_year
        aiMergedFields.push("copyright_year")
      }
      //   6. Promo — OR both sides.
      signals.is_promo = signals.is_promo || aiResult.signals.is_promo
      //   7. Extended AI diagnostic fields — always populated by AI.
      signals.canonical_pokemon_name = aiResult.signals.canonical_pokemon_name ?? null
      signals.printed_name           = aiResult.signals.printed_name           ?? null
      signals.card_era               = aiResult.signals.card_era               ?? null
      signals.rarity_hint            = aiResult.signals.rarity_hint            ?? null
      signals.set_symbol_description = aiResult.signals.set_symbol_description ?? null
      aiVariant           = aiResult.variant
      aiVariantConfidence = aiResult.variantConfidence
      console.log("[scan-card] auto_ai_invoked=true merged=", aiMergedFields.join(","), " haikuMs=", Date.now() - tAIStart)
    } catch (e: any) {
      // Auto-AI failure is non-fatal — the original OCR signals stand
      // and we still attempt the match. The Haiku key not being set is
      // guarded by `CLAUDE_API_KEY` above; other failures (network,
      // 5xx) are logged but do not fail the whole scan.
      console.error("[scan-card] auto AI vision error (non-fatal):", e?.message || e)
    }
  }

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
    feature, engine, signals, candidates, timing,
    holoAnalysis: body.holo_analysis ?? null,
    aiVariant, aiVariantConfidence,
    autoAiInvoked, aiMergedFields,
    userId, deviceId,
  })
  const logMs = Date.now() - tLogStart

  return json({
    scan_log_id: scanLogId,
    engine,
    feature_used: feature,
    ai_variant: aiVariant,
    ai_variant_confidence: aiVariantConfidence,
    // Block 5A-W-51B — surface auto-AI provenance to the client so the
    // portfolio scanner can show "Enhanced with AI" or similar.
    auto_ai_invoked: autoAiInvoked,
    ai_merged_fields: aiMergedFields,
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
