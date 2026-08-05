// Block 5A-W-52A.2 — contract tests on the wire between the chat
// client and the smart-endpoint edge function.
//
// Locks:
//   * request/response shape;
//   * retrieval priority
//     (cards.id → cards.card_slug → cards.card_url_slug+set+lang → set+num+lang+variant);
//   * single-row guards on composite lookups;
//   * legacy [Context: ...] payload compatibility;
//   * matched_card_name provenance;
//   * DB-short column naming on chat_logs inserts;
//   * legacy-shape log fallback on missing columns.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const INLINE_CHAT = readFileSync(join(process.cwd(), 'src', 'components', 'InlineChat.tsx'), 'utf8')
const CARD_PAGE_CLIENT = readFileSync(join(process.cwd(), 'src', 'app', 'set', '[slug]', 'card', '[cardSlug]', 'CardPageClient.tsx'), 'utf8')
const SET_PAGE_CLIENT = readFileSync(join(process.cwd(), 'src', 'app', 'set', '[slug]', 'SetPageClient.tsx'), 'utf8')
const AI_ASSISTANT_CLIENT = readFileSync(join(process.cwd(), 'src', 'app', 'ai-assistant', 'AIAssistantClient.tsx'), 'utf8')
const SMART_EP = readFileSync(join(process.cwd(), 'supabase', 'functions', 'smart-endpoint', 'index.ts'), 'utf8')
const MIGRATION = readFileSync(join(process.cwd(), 'migrations', '2026-08-05-chat-logs-structured-context.sql'), 'utf8')
const CARD_CONTEXT_MOD = readFileSync(join(process.cwd(), 'src', 'lib', 'chat', 'cardContext.ts'), 'utf8')

// ── The malformed-prefix regression ────────────────────

describe('the [Context: asking about ...] prefix is gone from the client', () => {
  it('InlineChat no longer constructs the bracketed context string', () => {
    expect(INLINE_CHAT).not.toContain('[Context: asking about ')
    expect(INLINE_CHAT).not.toMatch(/\[Context:\s*asking about/)
  })

  it('InlineChat sends card_context / set_context / intent structurally in JSON', () => {
    expect(INLINE_CHAT).toContain('card_context: outgoingCard')
    expect(INLINE_CHAT).toContain('set_context: setContext')
    expect(INLINE_CHAT).toContain('intent: intent')
    expect(INLINE_CHAT).toContain('context_source: contextSource')
  })

  it('InlineChat carries card_context on EVERY message (follow-ups too)', () => {
    expect(INLINE_CHAT).toMatch(/const outgoingCard: CardContext \| null = explicitSwitch \? null : activeCard/)
  })
})

// ── Client request shape (52A.2 rename + cardName) ────

describe('client request shape — 52A.2 identifier naming', () => {
  it('CardPageClient passes STRUCTURED cardContext with the 52A.2 fields', () => {
    expect(CARD_PAGE_CLIENT).toMatch(/cardContext=\{\{[\s\S]{0,1200}cardRecordId:\s*null/)
    expect(CARD_PAGE_CLIENT).toMatch(/cardUrlSlug:\s*card\.card_url_slug/)
    expect(CARD_PAGE_CLIENT).toMatch(/priceChartingProductId:\s*String\(card\.card_slug\)/)
    expect(CARD_PAGE_CLIENT).toMatch(/cardName:\s*cleanCardName\(String\(card\.card_name/)
    expect(CARD_PAGE_CLIENT).toMatch(/setName:\s+String\(card\.set_name/)
    expect(CARD_PAGE_CLIENT).toMatch(/language:\s*\(card\.language === 'jp'/)
  })

  it('CardPageClient does not reintroduce the ambiguous cardId/cardSlug keys', () => {
    const mount = CARD_PAGE_CLIENT.slice(
      CARD_PAGE_CLIENT.indexOf('<InlineChat'),
      CARD_PAGE_CLIENT.indexOf('cardName={String(card.card_name'),
    )
    expect(mount).not.toMatch(/^\s*cardId:/m)
    expect(mount).not.toMatch(/^\s*cardSlug:/m)
    expect(mount).not.toMatch(/cardContext=\{`\$\{card\.card_name\} from \$\{card\.set_name\}`/)
  })

  it('SetPageClient still passes a STRUCTURED setContext (untouched)', () => {
    expect(SET_PAGE_CLIENT).toMatch(/setContext=\{\{[\s\S]{0,200}setName:\s*setName/)
    expect(SET_PAGE_CLIENT).toMatch(/language:\s*resolveLanguage/)
    expect(SET_PAGE_CLIENT).not.toMatch(/cardContext=\{setName\}/)
  })

  it('AIAssistantClient (scanner) uses the 52A.2 fields including cardName', () => {
    expect(AI_ASSISTANT_CLIENT).toMatch(/cardContext = scannedCard \? \{[\s\S]{0,600}cardUrlSlug:/)
    expect(AI_ASSISTANT_CLIENT).toMatch(/priceChartingProductId:\s*scannedCard\.card_slug/)
    expect(AI_ASSISTANT_CLIENT).toMatch(/cardName:\s*scannedCard\.clean_name/)
    expect(AI_ASSISTANT_CLIENT).not.toMatch(/cardId:\s*scannedCard\.card_slug/)
    expect(AI_ASSISTANT_CLIENT).not.toMatch(/scannedCard\.card_name\}\s+from\s+\$\{scannedCard\.set_name/)
  })
})

// ── Edge function retrieval order (52A.2) ────────────

describe('smart-endpoint — 52A.2 retrieval priority', () => {
  it('parses card_context / set_context / intent / context_source from the body', () => {
    expect(SMART_EP).toContain('const cardContextIn = body.card_context')
    expect(SMART_EP).toContain('const setContextIn = body.set_context')
    expect(SMART_EP).toContain('const intentIn: string | null = typeof body.intent === "string"')
    expect(SMART_EP).toContain('const contextSourceIn: string | null = typeof body.context_source === "string"')
  })

  it('Priority 1: cards.id via cardRecordId — never queries card_slug with a DB id', () => {
    expect(SMART_EP).toMatch(/Priority 1:\s*cards\.id via cardRecordId[\s\S]{0,600}\.eq\("id",\s*idNum\)/)
    expect(SMART_EP).toMatch(/matchMethod\s*=\s*"card_id"/)
    expect(SMART_EP).not.toMatch(/\.eq\("card_slug",\s*[^)]*cardRecordId/)
  })

  it('Priority 2: cards.card_slug via priceChartingProductId (globally unique, safer than URL slug)', () => {
    expect(SMART_EP).toMatch(/Priority 2:\s*cards\.card_slug \(the PriceCharting product id\)[\s\S]{0,500}\.eq\("card_slug",\s*String\(cardContextIn\.priceChartingProductId\)\)/)
    expect(SMART_EP).toMatch(/matchMethod\s*=\s*"card_slug"/)
  })

  it('Priority 3: cards.card_url_slug + set_name + language COMPOSITE, single-row guard', () => {
    expect(SMART_EP).toMatch(/Priority 3:\s*cards\.card_url_slug \+ set_name \+ language[\s\S]{0,1200}\.eq\("card_url_slug",\s*String\(cardContextIn\.cardUrlSlug\)\)/)
    const p3 = SMART_EP.slice(SMART_EP.indexOf('Priority 3:'))
      .slice(0, 1500)
    expect(p3).toMatch(/\.eq\("set_name",\s*String\(cardContextIn\.setName\)\)/)
    expect(p3).toMatch(/\.eq\("language",\s*lang\)/)
    expect(p3).toMatch(/matchMethod\s*=\s*"card_url_slug_composite"/)
    expect(p3).toMatch(/matchMethod\s*=\s*"card_url_slug_ambiguous"/)
    expect(SMART_EP).not.toMatch(/\.eq\("card_url_slug",[^)]*\)\s*\.maybeSingle\(\)/)
  })

  it('Priority 4: set_name + card_number + language (+variant) COMPOSITE, single-row guard', () => {
    expect(SMART_EP).toMatch(/Priority 4:\s*set_name \+ card_number \+ language[\s\S]{0,900}\.eq\("set_name", cardContextIn\.setName\)/)
    expect(SMART_EP).toMatch(/query = query\.eq\("variant", variant\)/)
    // Accept only when count === 1
    const p4 = SMART_EP.slice(SMART_EP.indexOf('Priority 4:')).slice(0, 1500)
    expect(p4).toMatch(/if \(count === 1\)[\s\S]{0,200}matchMethod = "set_number_language"/)
    expect(p4).toMatch(/count > 1[\s\S]{0,200}set_number_language_ambiguous/)
  })

  it('composite priorities count candidates and never select data[0] unguarded', () => {
    // Every `structuredCard = data![0]` line must sit inside a count===1 branch.
    const acceptLines = SMART_EP.matchAll(/structuredCard = data!\[0\]/g)
    let n = 0
    for (const m of acceptLines) {
      n++
      const before = SMART_EP.slice(Math.max(0, m.index! - 400), m.index!)
      expect(before).toMatch(/count === 1/)
    }
    expect(n).toBeGreaterThanOrEqual(2)
  })

  it('fails closed when no structured record can be loaded', () => {
    expect(SMART_EP).toMatch(/I couldn't retrieve the details for that card/)
  })

  it('fails closed on ambiguous composite match (either priority)', () => {
    expect(SMART_EP).toMatch(/I found more than one card that matches those details/)
    expect(SMART_EP).toMatch(/context_ambiguous/)
    expect(SMART_EP).toMatch(/set_number_language_ambiguous[\s\S]{0,120}card_url_slug_ambiguous/)
  })

  it('identifier-consistency guard rejects mismatched cardRecordId or priceChartingProductId', () => {
    expect(SMART_EP).toMatch(/idMismatch = requestedCardRecordId != null[\s\S]{0,200}requestedCardRecordId !== matchedCardRecordId/)
    expect(SMART_EP).toMatch(/pcMismatch = requestedPcProductId != null[\s\S]{0,200}requestedPcProductId !== matchedPcProductId/)
    expect(SMART_EP).toMatch(/I couldn't confirm the exact card for that request/)
  })

  it('does NOT hard-mismatch on card_url_slug when we resolved via url-slug composite', () => {
    // The URL slug is not globally unique; a bare mismatch is
    // uninformative. The guard only fires when we resolved via a
    // stronger identifier (card_id or card_slug).
    expect(SMART_EP).toMatch(/urlSlugMismatch = requestedCardUrlSlug != null[\s\S]{0,400}matchMethod === "card_id" \|\| matchMethod === "card_slug"/)
  })
})

// ── Structured wins over legacy [Context: ...] wrapper ─

describe('legacy payload compatibility', () => {
  it('the pre-52A [Context: asking about ...] parser still exists', () => {
    // Source contains: /^\[Context: asking about ([^\]]+)\]\s*(.*)/s
    // The `[^\]]` char class (any-except-close-bracket) is the load-
    // bearing shape — match the literal source with escaped backslash.
    expect(SMART_EP).toMatch(/\[Context: asking about \(\[\^\\\]\]\+\)\\\]/)
    expect(SMART_EP).toMatch(/let cleanMessage = message;/)
    expect(SMART_EP).toMatch(/let cardPageContext = "";/)
  })

  it('the legacy extraction only runs when NO structuredCard was loaded', () => {
    // The bracket parser is guarded by `if (!structuredCard)`.
    expect(SMART_EP).toMatch(/if \(!structuredCard\) \{[\s\S]{0,400}\[Context: asking about/)
  })

  it('structured card_context takes precedence: the LLM turn embeds the loaded card and skips the cardPageContext branch', () => {
    // Because structuredCard is truthy, the `if (structuredCard)`
    // branch in the userContent build is taken first — the
    // cardPageContext branch is the else-if.
    expect(SMART_EP).toMatch(/if \(structuredCard\) \{[\s\S]{0,500}EXACT card, do not search for a different one/)
    expect(SMART_EP).toMatch(/} else if \(setContextIn && setContextIn\.setName\)/)
    expect(SMART_EP).toMatch(/} else if \(cardPageContext\)/)
  })

  it('legacy-only requests keep behaving exactly as pre-52A (no structured logging fields required)', () => {
    // The logChat call at the end of the handler is unconditional
    // — but every 52A.2 provenance field is ?? null-safe, so a
    // legacy request lands with null provenance columns.
    expect(SMART_EP).toMatch(/matched_card_id: params\.matched_card_record_id \?\? null/)
    expect(SMART_EP).toMatch(/matched_card_slug: params\.matched_pc_product_id \?\? null/)
    expect(SMART_EP).toMatch(/matched_card_name: params\.matched_card_name \?\? null/)
  })
})

// ── Free-text single-exact-match capture ─────────────

describe('free-text single-exact-match capture', () => {
  it('populates matched_* provenance when search_cards returned exactly one card', () => {
    expect(SMART_EP).toMatch(/free-text single-exact-match capture/)
    expect(SMART_EP).toMatch(/tb\.name === "search_cards"/)
    expect(SMART_EP).toMatch(/candidateArr\.length === 1/)
    expect(SMART_EP).toMatch(/matchMethod\s*=\s*"fuzzy"/)
    expect(SMART_EP).toMatch(/exactMatchFound\s*=\s*true/)
    // matched_card_name is captured too (52A.2).
    expect(SMART_EP).toMatch(/matchedCardName\s*=[\s\S]{0,120}rawName\.replace/)
  })

  it('multiple candidates do NOT auto-select — matched_* stays null', () => {
    const capture = SMART_EP.slice(
      SMART_EP.indexOf('free-text single-exact-match capture'),
    ).slice(0, 3000)
    const multiBranch = capture.slice(capture.indexOf('candidateArr.length > 1'))
      .slice(0, 400)
    expect(multiBranch).not.toMatch(/matchedCardUrlSlug\s*=/)
    expect(multiBranch).not.toMatch(/exactMatchFound\s*=\s*true/)
  })
})

// ── Response provenance ─────────────────────────────

describe('response provenance shape', () => {
  it('response returns matched_card_name plus every 52A.1 provenance field', () => {
    expect(SMART_EP).toMatch(/matched_card_name: matchedCardName/)
    expect(SMART_EP).toMatch(/matched_card_url_slug: matchedCardUrlSlug/)
    expect(SMART_EP).toMatch(/matched_pc_product_id: matchedPcProductId/)
    expect(SMART_EP).toMatch(/matched_set_name: matchedSetName/)
    expect(SMART_EP).toMatch(/matched_card_number: matchedCardNumber/)
    expect(SMART_EP).toMatch(/matched_card_number_display: matchedCardNumberDisplay/)
    expect(SMART_EP).toMatch(/matched_language: matchedLanguage/)
    expect(SMART_EP).toMatch(/matched_variant: matchedVariant/)
    expect(SMART_EP).toMatch(/exact_match_found: exactMatchFound/)
    expect(SMART_EP).toMatch(/match_method: matchMethod/)
    expect(SMART_EP).toMatch(/candidate_count: candidateCount/)
  })

  it('mismatch response also includes matched_card_name', () => {
    const mismatch = SMART_EP.slice(SMART_EP.indexOf("I couldn't confirm the exact card"))
      .slice(0, 2000)
    expect(mismatch).toMatch(/matched_card_name: matchedCardName/)
  })
})

// ── Client activeCard reconstruction (with cardName) ─

describe('client activeCard reconstruction on free-text exact match', () => {
  it('InlineChat updates activeCard when the response has exact_match_found=true', () => {
    expect(INLINE_CHAT).toMatch(/server-returned activeCard reconstruction/)
    expect(INLINE_CHAT).toMatch(/data\?\.exact_match_found === true &&[\s\S]{0,200}data\.matched_card_url_slug/)
    expect(INLINE_CHAT).toMatch(/setActiveCard\(nextCard\)/)
  })

  it('reconstructed CardContext uses the 52A.2 fields (with cardName)', () => {
    const reconstructor = INLINE_CHAT.slice(
      INLINE_CHAT.indexOf('server-returned activeCard reconstruction'),
    ).slice(0, 2000)
    expect(reconstructor).toMatch(/cardRecordId:\s*data\.matched_card_record_id/)
    expect(reconstructor).toMatch(/cardUrlSlug:\s*data\.matched_card_url_slug/)
    expect(reconstructor).toMatch(/priceChartingProductId:\s*data\.matched_pc_product_id/)
    expect(reconstructor).toMatch(/cardName:\s*typeof data\.matched_card_name === 'string'/)
    expect(reconstructor).toMatch(/setName:\s*data\.matched_set_name/)
    expect(reconstructor).toMatch(/language:\s*data\.matched_language === 'jp'/)
  })
})

// ── Explicit switch signal ──────────────────────────

describe('client explicit-card-switch signal', () => {
  const EXPLICIT_SWITCH = readFileSync(join(process.cwd(), 'src', 'lib', 'chat', 'explicitSwitch.ts'), 'utf8')

  it('detectExplicitCardSwitch is a pure module (no supabase / no fetch)', () => {
    expect(EXPLICIT_SWITCH).toContain('export function detectExplicitCardSwitch')
    expect(EXPLICIT_SWITCH).not.toContain('@supabase')
    expect(EXPLICIT_SWITCH).not.toContain('CHAT_ENDPOINT')
  })

  it('InlineChat imports detectExplicitCardSwitch from the pure module', () => {
    expect(INLINE_CHAT).toMatch(/import \{ detectExplicitCardSwitch[\s\S]{0,80}from '@\/lib\/chat\/explicitSwitch'/)
  })

  it('the send() flow uses detectExplicitCardSwitch to drop card_context', () => {
    expect(INLINE_CHAT).toMatch(/const explicitSwitch =[\s\S]{0,200}detectExplicitCardSwitch\(visibleText, activeCard\)/)
    expect(INLINE_CHAT).toMatch(/const outgoingCard: CardContext \| null = explicitSwitch \? null : activeCard/)
  })

  it('pre-routed quick-action intents are exempt from the switch check', () => {
    expect(INLINE_CHAT).toMatch(/!intent && activeCard != null && detectExplicitCardSwitch/)
  })

  it('an explicit-switch turn sends context_source="card_switch"', () => {
    expect(INLINE_CHAT).toMatch(/explicitSwitch\s+\?\s+'card_switch'/)
  })

  it('the explicit-switch module includes card-name and language signals', () => {
    expect(EXPLICIT_SWITCH).toMatch(/extractProperNounTokens/)
    expect(EXPLICIT_SWITCH).toMatch(/mentionsJp/)
    expect(EXPLICIT_SWITCH).toMatch(/mentionsEn/)
  })
})

// ── logChat legacy-shape fallback ────────────────────

describe('edge function logChat — legacy-shape fallback on missing 52A.2 columns', () => {
  it('detects Postgres 42703 / PGRST204 / "column does not exist" / "could not find the column"', () => {
    expect(SMART_EP).toMatch(/error\.code === "42703"/)
    expect(SMART_EP).toMatch(/error\.code === "PGRST204"/)
    expect(SMART_EP).toMatch(/column .\+ does not exist/)
    expect(SMART_EP).toMatch(/could not find the \.\+ column/)
  })

  it('retries the insert with a legacy shape', () => {
    expect(SMART_EP).toMatch(/retrying with the legacy insert shape/)
    expect(SMART_EP).toMatch(/supabase\.from\("chat_logs"\)\.insert\(\[legacyRow\]\)/)
    const logChatBody = SMART_EP.slice(
      SMART_EP.indexOf('function logChat'),
      SMART_EP.indexOf('Deno.serve('),
    )
    const legacyRowDecl = logChatBody.slice(
      logChatBody.indexOf('const legacyRow'),
      logChatBody.indexOf('const extendedRow'),
    )
    for (const key of [
      'requested_card_id', 'requested_card_slug', 'requested_card_url_slug',
      'matched_card_id', 'matched_card_slug', 'matched_card_url_slug', 'matched_card_name',
      'matched_card_number', 'matched_card_number_display', 'matched_variant',
      'match_method', 'exact_match_found', 'candidate_count', 'match_confidence',
      'intent', 'context_source',
    ]) {
      expect(legacyRowDecl).not.toContain(key)
    }
  })

  it('does NOT swallow unrelated database errors', () => {
    expect(SMART_EP).toMatch(/chat_logs insert failed \(non-recoverable\)/)
    // The non-recoverable branch returns without retrying.
    const nonRecov = SMART_EP.slice(SMART_EP.indexOf('chat_logs insert failed (non-recoverable)'))
      .slice(0, 200)
    expect(nonRecov).toMatch(/return;/)
  })

  it('logs a loud warning naming the missing migration + original error + fallback action', () => {
    expect(SMART_EP).toMatch(/missing 52A\.2 provenance columns/)
    expect(SMART_EP).toMatch(/retrying with the legacy insert shape/)
    expect(SMART_EP).toMatch(/Apply\s+migrations\/2026-08-05-chat-logs-structured-context\.sql/)
  })

  it('extended row uses the DB-side short column names', () => {
    const logChatBody = SMART_EP.slice(
      SMART_EP.indexOf('function logChat'),
      SMART_EP.indexOf('Deno.serve('),
    )
    // The extendedRow maps code names (long) → DB column names (short).
    expect(logChatBody).toMatch(/matched_card_id: params\.matched_card_record_id/)
    expect(logChatBody).toMatch(/matched_card_slug: params\.matched_pc_product_id/)
    expect(logChatBody).toMatch(/matched_card_url_slug: params\.matched_card_url_slug/)
    expect(logChatBody).toMatch(/matched_card_name: params\.matched_card_name/)
    expect(logChatBody).toMatch(/requested_card_id: params\.requested_card_record_id/)
    expect(logChatBody).toMatch(/requested_card_slug: params\.requested_pc_product_id/)
  })
})

// ── Migration contract ────────────────────────────────

describe('chat_logs schema migration — 52A.2 columns and CHECKs', () => {
  it('adds every column the edge function writes', () => {
    for (const col of [
      'intent','context_source',
      'requested_card_id','requested_card_slug','requested_card_url_slug',
      'requested_set_name','requested_language',
      'matched_card_id','matched_card_slug','matched_card_url_slug','matched_card_name',
      'matched_set_name','matched_card_number','matched_card_number_display',
      'matched_language','matched_variant',
      'match_method','exact_match_found','candidate_count','match_confidence',
    ]) {
      expect(MIGRATION).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`))
    }
  })

  it('match_method CHECK enumerates every 52A.2 value', () => {
    for (const m of [
      'card_id','card_slug','card_url_slug_composite','card_url_slug_ambiguous',
      'set_number_language','set_number_language_ambiguous',
      'conversation_context','fuzzy','none',
    ]) {
      expect(MIGRATION).toContain(`'${m}'`)
    }
  })

  it('context_source CHECK enumerates every 52A.2 value', () => {
    for (const s of ['card_page','set_page','scanner','conversation','card_switch','text']) {
      expect(MIGRATION).toContain(`'${s}'`)
    }
  })

  it('adds a partial mismatch index on the DB-id axis', () => {
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS idx_chat_logs_mismatch/)
    expect(MIGRATION).toMatch(/WHERE requested_card_id IS NOT NULL[\s\S]{0,180}requested_card_id <> matched_card_id/)
  })

  it('adds a companion mismatch index on the card_slug axis', () => {
    expect(MIGRATION).toMatch(/CREATE INDEX IF NOT EXISTS idx_chat_logs_slug_mismatch/)
    expect(MIGRATION).toMatch(/WHERE requested_card_slug IS NOT NULL[\s\S]{0,180}requested_card_slug <> matched_card_slug/)
  })

  it('is transactional and reversible', () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m)
    expect(MIGRATION).toMatch(/^COMMIT;/m)
  })

  it('documents required deployment order (migration → edge function → client)', () => {
    expect(MIGRATION).toMatch(/Deployment order \(required\)/i)
    expect(MIGRATION).toMatch(/Apply this migration in the Supabase SQL Editor/)
  })

  it('operational rollback recommends leaving columns in place (not immediate drop)', () => {
    expect(MIGRATION).toMatch(/Operational rollback \(recommended\)/i)
    expect(MIGRATION).toMatch(/LEAVE the new nullable columns in place/)
    expect(MIGRATION).toMatch(/Exceptional rollback \(manual cleanup only\)/i)
  })

  it('includes verification queries in the file for post-migration checks', () => {
    expect(MIGRATION).toMatch(/Verification queries/i)
    expect(MIGRATION).toMatch(/information_schema\.columns/)
    expect(MIGRATION).toMatch(/pg_constraint/)
    expect(MIGRATION).toMatch(/pg_indexes/)
  })
})

// ── CardContext type contract ─────────────────────────

describe('CardContext type — 52A.2 shape', () => {
  it('exports the 52A.2 field set', () => {
    expect(CARD_CONTEXT_MOD).toMatch(/cardRecordId:\s*number \| string \| null/)
    expect(CARD_CONTEXT_MOD).toMatch(/cardUrlSlug:\s*string/)
    expect(CARD_CONTEXT_MOD).toMatch(/priceChartingProductId:\s*string \| null/)
    expect(CARD_CONTEXT_MOD).toMatch(/cardName:\s*string/)
    expect(CARD_CONTEXT_MOD).toMatch(/setName:\s*string/)
    expect(CARD_CONTEXT_MOD).toMatch(/cardNumber:\s*string \| null/)
  })

  it('CardContext no longer declares the ambiguous cardId/cardSlug fields', () => {
    expect(CARD_CONTEXT_MOD).not.toMatch(/^\s+cardId:/m)
    expect(CARD_CONTEXT_MOD).not.toMatch(/^\s+cardSlug:/m)
  })
})

// ── URL-slug cross-set collision regression ─────────

describe('URL-slug cross-set collision regression (52A.2)', () => {
  // Real-world observation (probed against production Supabase at
  // block time): the card_url_slug "charizard-4" resolves to FOUR
  // English cards:
  //   id=3546  set=Base Set
  //   id=3375  set=Base Set 2
  //   id=6426  set=Celebrations
  //   id=8614  set=Crystal Guardians
  //
  // Similarly, "pikachu-58" resolves to two records across languages
  // (Base Set / Japanese CD Promo). A bare
  //   .eq('card_url_slug', X).maybeSingle()
  // would either fail or silently pick an arbitrary row. The 52A.2
  // retrieval order pairs card_url_slug with set_name + language and
  // requires exactly one row.
  const CROSS_SET_FIXTURES = [
    { card_url_slug: 'charizard-4', sets: ['Base Set','Base Set 2','Celebrations','Crystal Guardians'], language: 'en' },
    { card_url_slug: 'pikachu-58',  sets: ['Base Set','Japanese CD Promo'], languages: ['en','jp'] },
  ]

  it('the collision fixtures are documented in the test file so future block authors can reproduce', () => {
    expect(CROSS_SET_FIXTURES.length).toBeGreaterThanOrEqual(2)
    expect(CROSS_SET_FIXTURES[0].sets.length).toBeGreaterThanOrEqual(3)
  })

  it('smart-endpoint NEVER runs a bare card_url_slug lookup', () => {
    // Any `.eq("card_url_slug", X).maybeSingle()` would allow one of
    // the four Charizard rows to answer arbitrarily.
    expect(SMART_EP).not.toMatch(/\.eq\("card_url_slug",[^)]*\)\s*\.maybeSingle\(\)/)
  })

  it('smart-endpoint pairs card_url_slug with set_name AND language on the composite lookup', () => {
    const p3 = SMART_EP.slice(SMART_EP.indexOf('Priority 3:')).slice(0, 1000)
    expect(p3).toMatch(/\.eq\("card_url_slug",\s*String\(cardContextIn\.cardUrlSlug\)\)/)
    expect(p3).toMatch(/\.eq\("set_name",\s*String\(cardContextIn\.setName\)\)/)
    expect(p3).toMatch(/\.eq\("language",\s*lang\)/)
  })

  it('smart-endpoint fails closed when the composite lookup returns >1 row', () => {
    const p3 = SMART_EP.slice(SMART_EP.indexOf('Priority 3:')).slice(0, 1000)
    expect(p3).toMatch(/count > 1[\s\S]{0,120}card_url_slug_ambiguous/)
  })
})

// ── Scope discipline ─────────────────────────────────

describe('scope: 52A.2 does not touch out-of-scope systems', () => {
  it('smart-endpoint changes preserve calcCost (grading fee calculations untouched)', () => {
    expect(SMART_EP).toContain('calcCost')
  })

  it('client scope: eBay affiliate wrapping is unchanged', () => {
    expect(INLINE_CHAT).toContain('affiliateWrapEbayUrl')
    expect(INLINE_CHAT).toContain("placement:       'ai_response'")
  })

  it('client scope: linkifyResponse is untouched', () => {
    expect(INLINE_CHAT).toContain('function linkifyResponse')
  })
})
