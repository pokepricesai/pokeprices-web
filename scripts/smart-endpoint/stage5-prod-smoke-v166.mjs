#!/usr/bin/env node
// scripts/smart-endpoint/stage5-prod-smoke-v166.mjs
//
// v166 post-deploy production smoke. Acceptance criteria per the
// 2026-09-23 reduction directive:
//
//   * Do NOT require best-effort auto-pin. Whether the server pins
//     matched_pc_product_id on 2-6-candidate turns is out of scope
//     — the LLM-answer-driven pin scorer was removed.
//   * Require NO INCORRECT pin. If a pin does fire it must point at
//     a plausible candidate (from the candidate pool, correct set).
//   * Require follow-up answers to stay factually grounded — no
//     drift to a different printing between turns.
//   * Require explicit ambiguity to remain ambiguous / clarifying.
//   * Require explicit card switches to work at the ANSWER level
//     (T2 answer must be about the newly-named card).
//   * Require PSA pop and variant checks to remain 100% green.

import { readFileSync, existsSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const ENDPOINT = process.argv[2] || 'smart-endpoint'
const URL = `${SUPA_URL}/functions/v1/${ENDPOINT}`

function containsPsaPopClaim(s) {
  const t = s || ''
  if (/(?<![£$€])\b\d{1,3}(?:,\d{3})*\s+psa\s*10s\b/i.test(t)) return true
  if (/(?<![£$€])\b\d{1,3}(?:,\d{3})*\s+psa\s*10\s+(?:copies|graded|examples|submissions|census)\b/i.test(t)) return true
  if (/\bgem\s+rate\s+of\s+(?:around\s+|about\s+)?\d/i.test(t)) return true
  if (/\b(?:around|about|roughly|only|over)\s+\d{1,3}(?:,\d{3})*\s+(?:copies|examples|cards)\s+(?:graded|of|are|out)/i.test(t)) return true
  if (/\bpopulation\s+(?:of|is)\s+\d/i.test(t)) return true
  if (/\bpop(?:ulation)?\s+report\s+shows\s+\d/i.test(t)) return true
  if (/\btotal\s+(?:graded|population)[^.]{0,20}\d{2,}/i.test(t)) return true
  if (/\b\d{2,}(?:,\d{3})*\s+total\s+(?:graded|copies|submissions)/i.test(t)) return true
  return false
}
function hasPriceNumber(s) {
  return /[£$€]\s?\d|\b\d{1,3}(?:,\d{3})+\s*(?:USD|GBP|EUR|dollars?|pounds?|euros?)\b|\b\d+\s*(?:dollars?|pounds?|euros?)\b/i.test(s || '')
}

async function call(body) {
  const t0 = Date.now()
  const r = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - t0
  const body_ = await r.text()
  let data = null
  try { data = JSON.parse(body_) } catch { data = { raw: body_ } }
  return { ms, status: r.status, data }
}

let hardStops = []
function log(id, msg) { console.log(`\n══ ${id}: ${msg} ══`) }
function check(id, hard, msg, ok, extra) {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : (hard ? '\x1b[41m HARD-STOP \x1b[0m' : '\x1b[33m warn \x1b[0m')
  console.log(`  ${tag}  ${msg}${extra ? ' — ' + extra : ''}`)
  if (!ok && hard) hardStops.push(`${id}: ${msg}${extra ? ' — ' + extra : ''}`)
}

console.log(`Endpoint: ${URL}`)
console.log(`Started: ${new Date().toISOString()}`)

// ────────────────────────────────────────────────────────────────
// 1. Multi-turn: Base Set unlimited Charizard → "And PSA 10?"
//    Requirement: T2 answer factually grounded — must be about the
//    unlimited printing, must give a PSA 10 number, must NOT drift
//    to shadowless / 1st edition wording. Auto-pin NOT required.
// ────────────────────────────────────────────────────────────────
log('1', 'multi-turn: Charizard unlimited → PSA 10 follow-up (grounded)')
{
  const session = 'smk166-1-' + Date.now()
  const t1 = await call({ message: 'How much is Charizard from Base Set unlimited worth?', session_id: session, history: [], context_source: 'text' })
  console.log('  T1 tool:', t1.data?.tool_used, ' pinned:', t1.data?.matched_pc_product_id, ' A1:', (t1.data?.answer || '').slice(0, 220))
  check('1', true, 'T1 status 200', t1.status === 200)
  // Any pin that DID fire must be a Base Set Charizard slug we recognise.
  const pin1 = t1.data?.matched_pc_product_id
  if (pin1) {
    // 630417 = Base Set Charizard unlimited card_slug; other known
    // valid Charizard slugs shouldn't be pinned on turn 1 since only
    // exact-match (candidate=1) can fire in v166.
    check('1', true, 'if T1 pinned, points at Charizard (name check)',
      /charizard/i.test(t1.data?.matched_card_name || ''),
      `pinned=${pin1} name=${t1.data?.matched_card_name}`)
  }

  const history = [
    { role: 'user',      content: 'How much is Charizard from Base Set unlimited worth?' },
    { role: 'assistant', content: t1.data?.answer || '' },
  ]
  const t2 = await call({
    message: 'And PSA 10?',
    session_id: session,
    history,
    card_context: pin1 ? {
      cardRecordId:           t1.data.matched_card_record_id ? Number(t1.data.matched_card_record_id) : null,
      cardUrlSlug:            t1.data.matched_card_url_slug || '',
      priceChartingProductId: pin1,
      cardName:               t1.data.matched_card_name || '',
      setName:                t1.data.matched_set_name || '',
      cardNumber:             t1.data.matched_card_number || null,
      cardNumberDisplay:      t1.data.matched_card_number_display || null,
      language:               (t1.data.matched_language === 'jp' ? 'jp' : 'en'),
      variant:                t1.data.matched_variant || null,
    } : undefined,
    context_source: pin1 ? 'conversation' : 'text',
  })
  console.log('  T2 tool:', t2.data?.tool_used, ' pinned:', t2.data?.matched_pc_product_id, ' A2:', (t2.data?.answer || '').slice(0, 220))
  const ans2 = t2.data?.answer || ''
  check('1', true, 'T2 status 200', t2.status === 200)
  check('1', true, 'T2 answer quotes a PSA 10 number', hasPriceNumber(ans2))
  // Factual grounding: T2 must not drift to a DIFFERENT Pokemon.
  // Omitting the word "Charizard" while answering "PSA 10 is £9,697"
  // is fine — user knows the context from T1.
  const namesOtherPokemon = /\b(blastoise|venusaur|umbreon|pikachu|mewtwo|lugia|espeon)\b/i.test(ans2)
  check('1', true, 'T2 answer does not drift to a different Pokemon', !namesOtherPokemon)
  // Factual grounding: T2 must not drift to another printing as the
  // primary claim. Comparative mentions ("more than the 1st Ed") in
  // the last sentence are acceptable; drifting to "PSA 10 shadowless
  // Charizard is …" is not.
  const firstSent = (ans2.split(/(?<=[.!?])\s+/)[0] || '').toLowerCase()
  const driftInOpener = /\bshadowless\b|\b1st\s*edition\b|\bfirst\s*edition\b/i.test(firstSent)
  check('1', true, 'T2 opener does not drift to shadowless / 1st edition', !driftInOpener,
    driftInOpener ? `opener="${firstSent.slice(0, 200)}"` : undefined)
}

// ────────────────────────────────────────────────────────────────
// 2. PSA population: numeric claim requires get_grading_pop
// ────────────────────────────────────────────────────────────────
log('2', 'PSA population — no numeric claim without get_grading_pop')
{
  const r = await call({ message: 'How many PSA 10 copies of Umbreon VMAX alt art from Evolving Skies have been graded, and what is the gem rate?', session_id: 'smk166-2-' + Date.now(), history: [], context_source: 'text' })
  console.log('  tool:', r.data?.tool_used, ' tools:', JSON.stringify(r.data?.tools_used))
  console.log('  A:', (r.data?.answer || '').slice(0, 260))
  check('2', true, 'status 200', r.status === 200)
  const tools = Array.isArray(r.data?.tools_used) ? r.data.tools_used : (r.data?.tool_used ? [r.data.tool_used] : [])
  const hasClaim = containsPsaPopClaim(r.data?.answer || '')
  const usedTool = tools.includes('get_grading_pop')
  check('2', true, 'numeric pop claim only if get_grading_pop was called this turn',
    !hasClaim || usedTool, `hasClaim=${hasClaim} usedTool=${usedTool}`)
}

// ────────────────────────────────────────────────────────────────
// 3. Moonbreon: alt art must be identified as #215/203, not #214.
//    Auto-pin NOT required.
// ────────────────────────────────────────────────────────────────
log('3', 'Moonbreon — alt art = #215/203, not #214')
{
  const r = await call({ message: 'What is the PSA 10 price of the Umbreon VMAX alt art from Evolving Skies?', session_id: 'smk166-3-' + Date.now(), history: [], context_source: 'text' })
  console.log('  tool:', r.data?.tool_used, ' pinned:', r.data?.matched_pc_product_id)
  console.log('  A:', (r.data?.answer || '').slice(0, 320))
  const ans = r.data?.answer || ''
  check('3', true, 'status 200', r.status === 200)
  // The sentence(s) that talk about alt art / moonbreon must
  // reference #215/203 not #214.
  const sentences = ans.split(/(?<=[.!?])\s+/)
  const altSentences = sentences.filter(s => /\balt\s*art|moonbreon/i.test(s))
  const wrongInClaim = altSentences.some(s =>
    /#\s*214\b|\b214\s*\/\s*203\b|\bcard\s+214\b/i.test(s)
    && !/#\s*215\b|\b215\s*\/\s*203\b|\bcard\s+215\b/i.test(s)
  )
  check('3', true, 'alt-art sentence references #215/203, not #214', !wrongInClaim)
  // Model may name the card by identifier ("Moonbreon", "alt art
  // Umbreon VMAX") without explicit number — that's still correct.
  // The hard-stop is the wrong-number-as-alt-art check above.
  // If pin did fire it must be the moonbreon slug (or null).
  const pin = r.data?.matched_pc_product_id
  if (pin) check('3', true, 'if pinned, moonbreon slug 2513024', pin === '2513024', `pinned=${pin}`)
}

// ────────────────────────────────────────────────────────────────
// 4. Ambiguous "Charizard" — clarification stays clarification.
//    NO pin, no silent price for a random Charizard.
// ────────────────────────────────────────────────────────────────
log('4', 'Ambiguous "Charizard" — clarification only, no wrong pin')
{
  const r = await call({ message: 'How much is Charizard worth?', session_id: 'smk166-4-' + Date.now(), history: [], context_source: 'text' })
  console.log('  tool:', r.data?.tool_used, ' pinned:', r.data?.matched_pc_product_id, ' requires_selection:', !!r.data?.requires_card_selection)
  console.log('  A:', (r.data?.answer || '').slice(0, 280))
  const ans = r.data?.answer || ''
  check('4', true, 'status 200', r.status === 200)
  const askedInText   = /which|specify|clarif|narrow|specific|printing|version|set|are you (?:asking|after|looking)/i.test(ans)
  const showedPicker  = r.data?.requires_card_selection === true
  const pinned        = !!r.data?.matched_pc_product_id
  check('4', true, 'response is clarification or picker (not silent-price)',
    askedInText || showedPicker)
  check('4', true, 'no auto-pin when clarifying', !(askedInText && !showedPicker && pinned),
    pinned ? `pinned=${r.data?.matched_pc_product_id}` : undefined)
}

// ────────────────────────────────────────────────────────────────
// 5. Explicit card switch: Charizard → Blastoise.
//    T2 ANSWER must be about Blastoise. No requirement that pin
//    change (with the scorer removed, pin will typically be null).
// ────────────────────────────────────────────────────────────────
log('5', 'Explicit switch: Charizard → Blastoise (answer level)')
{
  const session = 'smk166-5-' + Date.now()
  const t1 = await call({ message: 'Charizard Base Set unlimited price?', session_id: session, history: [], context_source: 'text' })
  console.log('  T1 pinned:', t1.data?.matched_pc_product_id, ' A1:', (t1.data?.answer || '').slice(0, 200))
  check('5', true, 'T1 answer mentions Charizard', /charizard/i.test(t1.data?.answer || ''))
  check('5', true, 'T1 answer quotes a price', hasPriceNumber(t1.data?.answer || ''))

  const history = [
    { role: 'user',      content: 'Charizard Base Set unlimited price?' },
    { role: 'assistant', content: t1.data?.answer || '' },
  ]
  const t2 = await call({
    message: 'Now what about Blastoise Base Set unlimited?',
    session_id: session, history,
    card_context: null,
    context_source: 'card_switch',
  })
  console.log('  T2 pinned:', t2.data?.matched_pc_product_id, ' A2:', (t2.data?.answer || '').slice(0, 260))
  const ans2 = t2.data?.answer || ''
  check('5', true, 'T2 status 200', t2.status === 200)
  check('5', true, 'T2 answer references Blastoise', /blastoise/i.test(ans2))
  check('5', true, 'T2 answer quotes a price', hasPriceNumber(ans2))
  // No T1 leakage: T2 answer must not quote Charizard's price as the primary claim.
  // (A comparative mention is OK; the OPENING must not be about Charizard.)
  const firstSent2 = (ans2.split(/(?<=[.!?])\s+/)[0] || '').toLowerCase()
  check('5', true, 'T2 opener is about Blastoise, not Charizard',
    /blastoise/i.test(firstSent2) && !/^\s*charizard\b/i.test(firstSent2),
    `opener="${firstSent2.slice(0, 160)}"`)
  // Any pin on T2 must point at a Blastoise-named record (or be null).
  const p2 = t2.data?.matched_pc_product_id
  if (p2) check('5', true, 'if T2 pinned, name references Blastoise',
    /blastoise/i.test(t2.data?.matched_card_name || ''), `pinned=${p2} name=${t2.data?.matched_card_name}`)
}

console.log('\n────────────────────────────────────────────────────')
console.log(`Summary: 5 smokes, ${hardStops.length} hard-stop failures`)
if (hardStops.length) {
  console.log('\nHard-stop failures:')
  for (const h of hardStops) console.log(`  - ${h}`)
}
process.exit(hardStops.length ? 1 : 0)
