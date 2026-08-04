// Block 5A-W-51A — static contract tests. Assert that:
//
//   1. migrations/2026-08-04-scan-card-match-language-signal.sql has
//      the exact shape the edge function relies on: p_language param
//      with DEFAULT NULL (backward compat), language_match column,
//      language_bonus in scoring, language tiebreaker BEFORE the
//      alphabetic card_name ASC tiebreak.
//
//   2. supabase/functions/scan-card/index.ts uses bilingual Vision
//      hints, has a Haiku prompt that mentions Japanese cards and
//      includes a language output field, threads language through
//      ParsedSignals, passes p_language to the RPC, and logs the
//      inferred language.
//
//   3. The two copies of detectCardLanguageFromText (one in
//      src/lib/scanner/parseHelpers.ts, one in the edge function)
//      stay in sync — same CJK regex, same branch order.
//
//   4. The client-facing scanner (src/components/CardScanner.tsx)
//      does not need to change — it already renders both English
//      and Japanese candidates via displaySetName().

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-04-scan-card-match-language-signal.sql'),
  'utf8',
)
const EDGE_FN = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'scan-card', 'index.ts'),
  'utf8',
)
const PURE_HELPERS = readFileSync(
  join(process.cwd(), 'src', 'lib', 'scanner', 'parseHelpers.ts'),
  'utf8',
)
const CARD_SCANNER = readFileSync(
  join(process.cwd(), 'src', 'components', 'CardScanner.tsx'),
  'utf8',
)

// ── Migration contract ─────────────────────────────────

describe('migration — scan_card_match signature + behaviour', () => {
  it('drops the v10 5-arg signature before adding the 6-arg one', () => {
    expect(MIGRATION).toMatch(/DROP FUNCTION IF EXISTS scan_card_match\(text, text, text, integer, boolean\)/)
  })

  it('adds p_language TEXT DEFAULT NULL (backward compat when caller omits it)', () => {
    expect(MIGRATION).toMatch(/p_language\s+text\s+DEFAULT\s+NULL/i)
  })

  it('returns a language_match boolean column so callers can see when routing fired', () => {
    expect(MIGRATION).toMatch(/language_match\s+boolean/i)
  })

  it('computes language_match only when caller supplied p_language (NULL preserves current behaviour)', () => {
    // The scoring CTE must gate the boolean on p.lang IS NOT NULL AND c.language matches.
    expect(MIGRATION).toMatch(/p\.lang IS NOT NULL[\s\S]{0,200}lower\(c\.language\)\s*=\s*p\.lang/)
  })

  it('adds a +0.05 language bonus to confidence — small enough not to override a strong number match in the wrong language', () => {
    expect(MIGRATION).toMatch(/language_match\s+THEN\s+0\.05::real/)
  })

  it('ORDER BY breaks ties by language_match DESC BEFORE the alphabetic card_name ASC tiebreak', () => {
    // The relevant chunk: confidence DESC → name_similarity DESC → language_match DESC → card_name ASC.
    expect(MIGRATION).toMatch(/confidence DESC,\s*\n\s*w\.name_similarity DESC,\s*\n\s*[\s\S]{0,600}\n\s*w\.language_match DESC,\s*\n\s*w\.card_name ASC/)
  })

  it('grants EXECUTE to anon, authenticated, service_role on the 6-arg signature', () => {
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION scan_card_match\(text, text, text, integer, boolean, text\) TO anon/)
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION scan_card_match\(text, text, text, integer, boolean, text\) TO authenticated/)
    expect(MIGRATION).toMatch(/GRANT EXECUTE ON FUNCTION scan_card_match\(text, text, text, integer, boolean, text\) TO service_role/)
  })

  it('runs inside a transaction (BEGIN + COMMIT)', () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m)
    expect(MIGRATION).toMatch(/^COMMIT;/m)
  })

  it('does NOT drop or recreate any table (purely a function replacement)', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE/)
    expect(MIGRATION).not.toMatch(/CREATE TABLE/)
    expect(MIGRATION).not.toMatch(/ALTER TABLE/)
  })
})

// ── Edge function contract ─────────────────────────────

describe('edge function — bilingual OCR + language routing', () => {
  it('uses Google Vision languageHints ["en", "ja"] instead of English only', () => {
    expect(EDGE_FN).toMatch(/const LANG_HINTS = \["en", "ja"\]/)
    // Confirm all three request builders reference the shared constant,
    // so a future edit can't accidentally reintroduce English-only hints.
    const langHintsUsageCount = (EDGE_FN.match(/languageHints: LANG_HINTS/g) || []).length
    expect(langHintsUsageCount).toBe(3)
    expect(EDGE_FN).not.toMatch(/languageHints:\s*\["en"\]/)
  })

  it('Haiku prompt commits to Japanese guidance and a language output field', () => {
    expect(EDGE_FN).toMatch(/"language":\s*"en"\s*\|\s*"jp"\s*\|\s*null/)
    expect(EDGE_FN).toMatch(/Kanji \/ Hiragana \/ Katakana/i)
    expect(EDGE_FN).toMatch(/Japanese Battle Partners|102\/130/)
  })

  it('ParsedSignals carries an inferred language field', () => {
    expect(EDGE_FN).toMatch(/language: "en" \| "jp" \| null/)
  })

  it('detectCardLanguageFromText is duplicated verbatim from parseHelpers.ts (same CJK regex)', () => {
    // The regex is the security-critical piece — if the two copies
    // drift, the client-tested behaviour won't match production. Assert
    // that the exact regex literal appears in both files.
    const sharedRe = /const CJK_RE = \/\[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ\]\//
    expect(PURE_HELPERS).toMatch(sharedRe)
    expect(EDGE_FN).toMatch(sharedRe)
  })

  it('detectCardLanguageFromText branch order is identical (CJK first, Latin second, null default)', () => {
    // Both files must apply the same fall-through: any CJK → jp; any
    // Latin letter → en; otherwise null. A drift in ordering (e.g. a
    // future edit checking Latin first) would silently misclassify
    // mixed-script OCR.
    for (const src of [PURE_HELPERS, EDGE_FN]) {
      expect(src).toMatch(/if \(CJK_RE\.test\(text\)\) return ["']jp["']/)
      expect(src).toMatch(/if \(\/\[A-Za-z\]\/\.test\(text\)\) return ["']en["']/)
    }
  })

  it('parseSignals passes CJK detection over ALL three OCR passes (full + strip + corner)', () => {
    // Detecting language only from the full-card text would miss the
    // frequent case where the bottom strip picks up the collector
    // number BUT the full-card OCR silently drops the Japanese art
    // text. The combined-text detection covers this.
    expect(EDGE_FN).toMatch(/language: detectCardLanguageFromText\(combinedText\)/)
  })

  it('AI-vision path prefers the model language then falls back to CJK detection', () => {
    // If Haiku commits to "jp" or "en" we trust it. If the model
    // returns language: null we scan the model's own text fields for
    // CJK so a language signal still reaches the RPC.
    expect(EDGE_FN).toMatch(/const modelLang = parsed\.language === "en" \|\| parsed\.language === "jp" \? parsed\.language : null/)
    expect(EDGE_FN).toMatch(/modelLang \?\? detectCardLanguageFromText\(textJoined\)/)
  })

  it('matchCards passes p_language to the RPC (not just the number/name)', () => {
    expect(EDGE_FN).toMatch(/p_language:\s+signals\.language/)
  })

  it('scan_logs.parsed_signals records the inferred language for future analytics', () => {
    expect(EDGE_FN).toMatch(/language: opts\.signals\.language/)
  })

  it('server-side log shows the inferred language on the AI-vision path', () => {
    expect(EDGE_FN).toMatch(/language: signals\.language,\s*\n\s*variant: aiVariant/)
  })

  it('does NOT log the raw image payload (privacy — only OCR text stored, capped at 4000 chars)', () => {
    // Sanity check that we haven't accidentally added something like
    // `image_base64: imageBase64` to scan_logs.
    expect(EDGE_FN).not.toMatch(/image_base64:\s*(?:image)?[Bb]ase64/)
  })
})

// ── Client contract ────────────────────────────────────

describe('CardScanner client — no change required for 51A', () => {
  it('still reads language off each candidate for display', () => {
    // Pre-51A comment/field lives on the Candidate type. If a future
    // refactor drops this, JP results will render as English.
    expect(CARD_SCANNER).toMatch(/language\??:\s*string \| null/)
  })

  it('does NOT invent card URLs from the model output — routes come from the RPC', () => {
    // Guard against a well-meaning "trust the AI" refactor. The client
    // renders candidates from scan_card_match; it never constructs a
    // card slug from AI output.
    expect(CARD_SCANNER).not.toMatch(/href=\{`\/set\/\$\{[^}]*ai/)
    expect(CARD_SCANNER).not.toMatch(/const\s+aiSlug\s*=/)
  })
})

// ── Fail-safe: newly-imported cards remain candidates ─

describe('scanner is data-driven — new cards need no scanner-specific code change', () => {
  it('the RPC queries cards live (no build-time cache to invalidate)', () => {
    expect(MIGRATION).toMatch(/FROM cards c\s*\n\s*WHERE c\.is_sealed IS NOT TRUE/)
  })

  it('no hardcoded catalogue of set names in the edge function that would gate new sets', () => {
    // SET_HINT_WORDS_RE and SET_ABBREVIATIONS are HINTS (they help
    // scoring) — never filters. The RPC's set match is ILIKE %hint%,
    // and if no hint matches, no filter is applied. New sets stay
    // scannable without touching this file.
    //
    // Confirm neither list appears as a hard WHERE-filter clause.
    expect(EDGE_FN).not.toMatch(/WHERE.*(?:SET_HINT_WORDS_RE|SET_ABBREVIATIONS)/)
  })
})
