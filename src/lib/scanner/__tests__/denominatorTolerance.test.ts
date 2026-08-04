// Block 5A-W-51B — contract tests for the denominator-tolerance
// migration + auto-AI merge behaviour in the edge function.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATION = readFileSync(
  join(process.cwd(), 'migrations', '2026-08-04-scan-card-match-denominator-tolerance.sql'),
  'utf8',
)
const EDGE_FN = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'scan-card', 'index.ts'),
  'utf8',
)

// ── Migration: denominator tolerance ───────────────────

describe('migration — denominator-tolerant candidate retrieval', () => {
  it('drops the 51A 6-arg signature so the 6-arg + new return column can replace it cleanly', () => {
    expect(MIGRATION).toMatch(/DROP FUNCTION IF EXISTS scan_card_match\(text, text, text, integer, boolean, text\)/)
  })

  it('keeps the same 6-argument signature (backward-compat with the deployed 51A edge function)', () => {
    expect(MIGRATION).toMatch(/CREATE OR REPLACE FUNCTION scan_card_match\(\s*p_collector_number text\s+DEFAULT NULL,\s*p_name\s+text\s+DEFAULT NULL,\s*p_set_hint\s+text\s+DEFAULT NULL,\s*p_copyright_year\s+integer DEFAULT NULL,\s*p_is_promo\s+boolean DEFAULT FALSE,\s*p_language\s+text\s+DEFAULT NULL\s*\)/)
  })

  it('adds denominator_conflict BOOLEAN column at the end of the return shape', () => {
    expect(MIGRATION).toMatch(/denominator_conflict\s+boolean/i)
  })

  it('candidate CTE NO LONGER filters by denominator match (the bug that dropped correct rows)', () => {
    // The 51A CTE had:
    //   AND (p.num_denom IS NULL OR b.norm_total = p.num_denom OR b.norm_total IS NULL)
    // The 51B CTE must NOT have that clause; the denom mismatch is handled downstream.
    const candidatesCte = MIGRATION.match(/candidates AS \(([\s\S]*?)scored AS/)
    expect(candidatesCte).not.toBeNull()
    const cte = candidatesCte![1]
    expect(cte).not.toMatch(/b\.norm_total = p\.num_denom/)
    expect(cte).not.toMatch(/b\.norm_total IS NULL/)
  })

  it('denominator_conflict is TRUE only when scanner supplied a denominator AND stored denom differs', () => {
    expect(MIGRATION).toMatch(/p\.num_full IS NOT NULL[\s\S]{0,150}p\.num_denom IS NOT NULL[\s\S]{0,150}c\.norm_total IS NOT NULL[\s\S]{0,300}c\.norm_total <> p\.num_denom[\s\S]{0,60}\) AS denominator_conflict/)
  })

  it('applies a small penalty (-0.03) for denominator_conflict — enough to prefer a clean match but small enough that the correct card can still surface', () => {
    expect(MIGRATION).toMatch(/denominator_conflict\s+THEN\s+0\.03::real/)
    expect(MIGRATION).toMatch(/-\s+\(CASE WHEN w\.denominator_conflict/)
  })

  it('applies a small bonus (+0.02) for language + numerator match without denom match — helps JP outrank EN when data is wrong', () => {
    expect(MIGRATION).toMatch(/w\.language_match AND w\.number_match AND NOT w\.denom_match\s+THEN\s+0\.02::real/)
  })

  it('numerator-only match_quality also covers the denom-mismatch case (so those rows are ranked in the "weak" pool, not the strong pool)', () => {
    // The CASE for match_quality gains a new branch: when numerator matches
    // but stored denom is present and differs, classify as 'numerator'.
    expect(MIGRATION).toMatch(/c\.norm_total <> p\.num_denom[\s\S]{0,300}THEN 'numerator'/)
  })

  it('grants EXECUTE on the same 6-arg signature to anon / authenticated / service_role', () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(MIGRATION).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION scan_card_match\\(text, text, text, integer, boolean, text\\) TO ${role}`))
    }
  })

  it('runs in a transaction and does not create/alter tables', () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m)
    expect(MIGRATION).toMatch(/^COMMIT;/m)
    expect(MIGRATION).not.toMatch(/CREATE TABLE/)
    expect(MIGRATION).not.toMatch(/ALTER TABLE/)
  })
})

// ── Edge function: auto-AI + merge ─────────────────────

describe('edge function — auto-AI on Japanese OCR paths', () => {
  it('auto-invokes Haiku when OCR path detected language=jp AND signals are weak', () => {
    expect(EDGE_FN).toMatch(/const shouldAutoInvokeAI = \(/)
    expect(EDGE_FN).toMatch(/engine === "vision_ocr"/)
    expect(EDGE_FN).toMatch(/signals\.language === "jp"/)
    // Weak-signal gate: no number, no name, or CJK-only name.
    expect(EDGE_FN).toMatch(/!signals\.collector_number/)
    expect(EDGE_FN).toMatch(/CJK_RE\.test\(signals\.name\)/)
  })

  it('does NOT auto-invoke AI for English scans (no cost regression for the existing English scanner behaviour)', () => {
    // The gate requires signals.language === "jp", so English signals never trigger.
    const gate = EDGE_FN.match(/shouldAutoInvokeAI = \([\s\S]*?\)$/m)
    expect(gate).not.toBeNull()
    expect(gate![0]).toMatch(/signals\.language === "jp"/)
  })

  it('OCR keeps its collector_number when it produced one (dedicated bottom crop is authoritative for numbers)', () => {
    expect(EDGE_FN).toMatch(/if \(!signals\.collector_number && aiResult\.signals\.collector_number\)/)
  })

  it('AI canonical name replaces OCR name only when OCR name is missing or CJK-only', () => {
    expect(EDGE_FN).toMatch(/const ocrNameUsable = signals\.name && \/\[A-Za-z\]\{3,\}\/\.test\(signals\.name\)/)
    expect(EDGE_FN).toMatch(/if \(!ocrNameUsable && aiResult\.signals\.name\)/)
  })

  it('OCR language is preserved when set — only overwrites null → AI value', () => {
    expect(EDGE_FN).toMatch(/if \(!signals\.language && aiResult\.signals\.language\)/)
  })

  it('logs which fields were merged from AI (offline analysis)', () => {
    expect(EDGE_FN).toMatch(/aiMergedFields\.push\("collector_number"\)/)
    expect(EDGE_FN).toMatch(/aiMergedFields\.push\("name"\)/)
    expect(EDGE_FN).toMatch(/aiMergedFields\.push\("set_hint"\)/)
  })

  it('auto-AI failures are non-fatal — the original OCR signals still attempt the match', () => {
    expect(EDGE_FN).toMatch(/auto AI vision error \(non-fatal\)/)
  })

  it('surfaces auto_ai_invoked + ai_merged_fields in the response body', () => {
    expect(EDGE_FN).toMatch(/auto_ai_invoked: autoAiInvoked/)
    expect(EDGE_FN).toMatch(/ai_merged_fields: aiMergedFields/)
  })
})

describe('edge function — extended Haiku schema (51B)', () => {
  it('prompt requests canonical_pokemon_name for translated-DB matching', () => {
    expect(EDGE_FN).toMatch(/"canonical_pokemon_name":/)
    expect(EDGE_FN).toMatch(/English species name/i)
  })

  it('prompt requests printed_name for diagnostics (verbatim JP)', () => {
    expect(EDGE_FN).toMatch(/"printed_name":/)
  })

  it('prompt requests set_symbol_description', () => {
    expect(EDGE_FN).toMatch(/"set_symbol_description":/)
  })

  it('prompt requests card_era with an enumerated set of options', () => {
    expect(EDGE_FN).toMatch(/"card_era":/)
    expect(EDGE_FN).toMatch(/vintage-1996-2001/)
    expect(EDGE_FN).toMatch(/scarlet-violet-2023-present/)
  })

  it('prompt requests rarity_hint', () => {
    expect(EDGE_FN).toMatch(/"rarity_hint":/)
  })

  it('prompt explicitly acknowledges vintage JP cards may have no N/M collector number', () => {
    // This addresses the id=426 failure — a Team Rocket JP Moltres card
    // that has no printed collector number should return
    // collector_number=null, not a hallucinated one.
    expect(EDGE_FN).toMatch(/vintage Japanese cards \(1996-2001\) do NOT print a collector number in N\/M form/i)
  })
})

describe('edge function — signals contract for downstream matching', () => {
  it('ParsedSignals carries the extended AI fields (nullable)', () => {
    expect(EDGE_FN).toMatch(/canonical_pokemon_name\?:\s*string \| null/)
    expect(EDGE_FN).toMatch(/printed_name\?:\s*string \| null/)
    expect(EDGE_FN).toMatch(/card_era\?:\s*string \| null/)
    expect(EDGE_FN).toMatch(/rarity_hint\?:\s*string \| null/)
    expect(EDGE_FN).toMatch(/set_symbol_description\?:\s*string \| null/)
  })

  it('callAIVision maps parsed.canonical_pokemon_name → signals.name for RPC compatibility', () => {
    expect(EDGE_FN).toMatch(/const nameForMatching = parsed\.canonical_pokemon_name/)
    expect(EDGE_FN).toMatch(/name: nameForMatching/)
  })

  it('scan_logs records the extended fields + auto_ai_invoked + ai_merged_fields (no user PII)', () => {
    expect(EDGE_FN).toMatch(/canonical_pokemon_name: opts\.signals\.canonical_pokemon_name/)
    expect(EDGE_FN).toMatch(/auto_ai_invoked: opts\.autoAiInvoked/)
    expect(EDGE_FN).toMatch(/ai_merged_fields: opts\.aiMergedFields/)
  })
})

// ── Reproduction fixtures (id=426, id=427) ─────────────

describe('production-log reproduction — id=426 / id=427', () => {
  // id=426: OCR read "R団のファイヤー Lv.26 HP60 ... NO 146" — Japanese
  // Team Rocket Moltres. Extracted language=jp, no collector_number,
  // Japanese name. Under 51A: 0 candidates.
  //
  // Under 51B: shouldAutoInvokeAI evaluates to TRUE because:
  //   - engine === "vision_ocr"
  //   - signals.language === "jp"
  //   - collector_number is null
  // → AI is called, which returns canonical_pokemon_name (e.g. "Moltres"
  // or "Rocket's Moltres"). Merge: signals.name becomes the canonical
  // English name, feeding the RPC's name-similarity path.
  it('id=426-style scan (JP OCR, no number, CJK name) satisfies the auto-AI gate', () => {
    const gateRegex = /const shouldAutoInvokeAI = \(([\s\S]*?)\)$/m
    const m = EDGE_FN.match(gateRegex)
    expect(m).not.toBeNull()
    // Static assertion: the three conditions the 426 scan meets are
    // present in the gate.
    const gate = m![1]
    expect(gate).toContain('engine === "vision_ocr"')
    expect(gate).toContain('signals.language === "jp"')
    expect(gate).toContain('!signals.collector_number')
  })

  // id=427: AI recognised "Moltres" but hallucinated set_name="Base Set"
  // and had no collector_number. Under 51A: 10 name_only Moltres
  // candidates ranked alphabetically at confidence 0.700 each — the
  // correct card (JP Rocket Gang Moltres) was not among them because it
  // may not be imported. Under 51B, we cannot fix an absent DB row,
  // but the extended AI schema now returns card_era + rarity_hint which
  // downstream ranking or the portfolio UX can use to filter.
  it('extended AI schema surfaces card_era + rarity_hint so ambiguous-name matches can be user-filtered', () => {
    expect(EDGE_FN).toMatch(/"card_era":/)
    expect(EDGE_FN).toMatch(/"rarity_hint":/)
  })
})

// ── No regression on prior 51A guarantees ──────────────

describe('51A guarantees preserved', () => {
  it('CJK_RE regex unchanged (source of truth for JP detection)', () => {
    expect(EDGE_FN).toMatch(/const CJK_RE = \/\[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ\]\//)
  })

  it('parseSignals still detects language from the combined OCR text (unchanged)', () => {
    expect(EDGE_FN).toMatch(/language: detectCardLanguageFromText\(combinedText\)/)
  })

  it('matchCards still passes p_language to the RPC (unchanged)', () => {
    expect(EDGE_FN).toMatch(/p_language:\s+signals\.language/)
  })

  it('Google Vision hints still use both en and ja (unchanged from 51A)', () => {
    expect(EDGE_FN).toMatch(/const LANG_HINTS = \["en", "ja"\]/)
  })
})
