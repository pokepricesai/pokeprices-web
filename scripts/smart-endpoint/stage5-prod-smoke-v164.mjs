#!/usr/bin/env node
// scripts/smart-endpoint/stage5-prod-smoke-v164.mjs
//
// v164 post-deploy production smoke. Five prompts targeting the
// three v164 focus areas plus one ambiguous + one explicit switch.
//
// Coverage:
//   1. Base Set unlimited Charizard → "And PSA 10?" — exact printing
//      must stay pinned via matched_pc_product_id.
//   2. PSA population question — no numeric pop claim without
//      get_grading_pop being called this turn.
//   3. Moonbreon / Umbreon VMAX alt art — must land on #215/203
//      and pin the moonbreon slug (2513024).
//   4. Ambiguous "Charizard" — auto-pin MUST NOT fire when the
//      answer is asking for clarification.
//   5. Explicit card switch turn 2 (Charizard → Blastoise) — the
//      old pin must be replaced with the new card's pin.

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

// --- 1. Base Set unlimited Charizard + follow-up ---
log('1', 'Base Set unlimited Charizard → "And PSA 10?"')
{
  const session = 'smk164-1-' + Date.now()
  const t1 = await call({ message: 'How much is Charizard from Base Set unlimited worth?', session_id: session, history: [], context_source: 'text' })
  console.log('  T1 status:', t1.status, ' ms:', t1.ms, ' tool:', t1.data?.tool_used, ' pinned:', t1.data?.matched_pc_product_id)
  console.log('    A1:', (t1.data?.answer || '').slice(0, 260))
  check('1', true, 'T1 status 200', t1.status === 200)
  check('1', true, 'T1 pinned a card_slug (auto-pin fired)', !!t1.data?.matched_pc_product_id, 'got=' + (t1.data?.matched_pc_product_id || 'null'))

  const pin1 = t1.data?.matched_pc_product_id
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
  console.log('  T2 status:', t2.status, ' ms:', t2.ms, ' tool:', t2.data?.tool_used, ' pinned:', t2.data?.matched_pc_product_id)
  console.log('    A2:', (t2.data?.answer || '').slice(0, 260))
  check('1', true, 'T2 status 200', t2.status === 200)
  check('1', true, 'T2 retained the same card_slug', pin1 && t2.data?.matched_pc_product_id === pin1, `T1=${pin1} T2=${t2.data?.matched_pc_product_id}`)
  const ans2 = t2.data?.answer || ''
  // No drift to a different printing wording
  const noDriftWord = !/shadowless|1st\s*edition|first\s*edition/i.test(ans2)
  check('1', true, 'T2 answer stays on unlimited (no shadowless / 1st-ed drift)', noDriftWord)
  // Accept all common price notations: symbol prefix ($401.27, £317),
  // suffix code ("12,275 USD", "9,697 GBP"), or spelled-out
  // ("12,275 dollars", "9,697 pounds").
  const hasPrice = /[£$€]\s?\d|\b\d{1,3}(?:,\d{3})+\s*(?:USD|GBP|EUR|dollars?|pounds?|euros?)\b|\b\d+\s*(?:dollars?|pounds?|euros?)\b/i.test(ans2)
  check('1', true, 'T2 quotes a PSA 10 GBP or USD amount', hasPrice)
}

// --- 2. PSA population question ---
log('2', 'PSA population — no numeric claim without get_grading_pop')
{
  const r = await call({ message: 'How many PSA 10 copies of Umbreon VMAX alt art from Evolving Skies have been graded, and what is the gem rate?', session_id: 'smk164-2-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' ms:', r.ms, ' tool:', r.data?.tool_used, ' tools:', JSON.stringify(r.data?.tools_used))
  console.log('  A:', (r.data?.answer || '').slice(0, 320))
  check('2', true, 'status 200', r.status === 200)
  const tools = Array.isArray(r.data?.tools_used) ? r.data.tools_used : (r.data?.tool_used ? [r.data.tool_used] : [])
  const hasClaim = containsPsaPopClaim(r.data?.answer || '')
  const usedTool = tools.includes('get_grading_pop')
  check('2', true, 'either no numeric pop claim OR get_grading_pop was called', !hasClaim || usedTool, `hasClaim=${hasClaim} usedTool=${usedTool}`)
}

// --- 3. Moonbreon (Umbreon VMAX alt art) ---
log('3', 'Moonbreon: alt art → #215/203 + pinned=2513024')
{
  const r = await call({ message: 'What is the PSA 10 price of the Umbreon VMAX alt art from Evolving Skies?', session_id: 'smk164-3-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' ms:', r.ms, ' tool:', r.data?.tool_used, ' pinned:', r.data?.matched_pc_product_id)
  console.log('  A:', (r.data?.answer || '').slice(0, 320))
  const ans = r.data?.answer || ''
  check('3', true, 'status 200', r.status === 200)
  // Sentence containing "alt art" or "moonbreon" must reference #215/203, not #214.
  const sentences = ans.split(/(?<=[.!?])\s+/)
  const claimSentences = sentences.filter(s => /\balt\s*art|moonbreon/i.test(s))
  const wrongInClaim = claimSentences.some(s => /#\s*214\b|\b214\s*\/\s*203\b|\bcard\s+214\b/i.test(s) && !/#\s*215\b|\b215\s*\/\s*203\b|\bcard\s+215\b/i.test(s))
  check('3', true, 'alt-art sentence references #215/203, not #214', !wrongInClaim)
  check('3', true, 'answer mentions #215/203 or card 215', /215\s*\/\s*203|#\s*215\b|\bcard\s+215\b/i.test(ans))
  check('3', true, 'pinned Moonbreon slug (2513024)', r.data?.matched_pc_product_id === '2513024', `got=${r.data?.matched_pc_product_id}`)
}

// --- 4. Ambiguous — auto-pin MUST NOT fire when asking for clarification ---
log('4', 'Ambiguous "Charizard" — auto-pin must not fire')
{
  const r = await call({ message: 'How much is Charizard worth?', session_id: 'smk164-4-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' ms:', r.ms, ' tool:', r.data?.tool_used, ' pinned:', r.data?.matched_pc_product_id, ' requires_selection:', !!r.data?.requires_card_selection)
  console.log('  A:', (r.data?.answer || '').slice(0, 320))
  const ans = r.data?.answer || ''
  check('4', true, 'status 200', r.status === 200)
  const isClarification = /which|specify|clarif|narrow|specific|printing|version|set|are you (?:asking|after)/i.test(ans)
  const isSelectionUI   = r.data?.requires_card_selection === true
  const pinned          = !!r.data?.matched_pc_product_id
  // If the answer is a clarification-only response, auto-pin must NOT have fired.
  if (isClarification && !isSelectionUI) {
    check('4', true, 'clarification-only response has no auto-pin', !pinned, `pinned=${r.data?.matched_pc_product_id}`)
  } else if (isSelectionUI) {
    check('4', true, 'selection UI has no auto-pin', !pinned)
  } else {
    // Model gave a specific-card answer — pin OK.
    check('4', true, 'specific-card answer includes formatted price', /[£$]\s?\d/.test(ans))
  }
}

// --- 5. Explicit card switch on turn 2 ---
log('5', 'Explicit card switch: Charizard → Blastoise (turn 2)')
{
  const session = 'smk164-5-' + Date.now()
  const t1 = await call({ message: 'Charizard Base Set unlimited price?', session_id: session, history: [], context_source: 'text' })
  console.log('  T1 status:', t1.status, ' ms:', t1.ms, ' pinned:', t1.data?.matched_pc_product_id, ' matched_name:', t1.data?.matched_card_name)
  console.log('    A1:', (t1.data?.answer || '').slice(0, 220))
  const pin1 = t1.data?.matched_pc_product_id
  check('5', true, 'T1 pinned Charizard', !!pin1)

  // Simulate the client's detectExplicitCardSwitch — user names a new
  // Pokemon so card_context is dropped and context_source is
  // 'card_switch'.
  const history = [
    { role: 'user',      content: 'Charizard Base Set unlimited price?' },
    { role: 'assistant', content: t1.data?.answer || '' },
  ]
  const t2 = await call({
    message: 'Now what about Blastoise Base Set unlimited?',
    session_id: session,
    history,
    card_context: null,
    context_source: 'card_switch',
  })
  console.log('  T2 status:', t2.status, ' ms:', t2.ms, ' pinned:', t2.data?.matched_pc_product_id, ' matched_name:', t2.data?.matched_card_name)
  console.log('    A2:', (t2.data?.answer || '').slice(0, 260))
  check('5', true, 'T2 status 200', t2.status === 200)
  check('5', true, 'T2 pin is DIFFERENT from T1 (card switched)',
    t2.data?.matched_pc_product_id && t2.data?.matched_pc_product_id !== pin1,
    `T1=${pin1} T2=${t2.data?.matched_pc_product_id}`)
  check('5', true, 'T2 matched_card_name references Blastoise',
    /blastoise/i.test(t2.data?.matched_card_name || ''),
    `matched_name=${t2.data?.matched_card_name}`)
  check('5', true, 'T2 answer is about Blastoise',
    /blastoise/i.test(t2.data?.answer || ''))
}

console.log('\n────────────────────────────────────────────────────')
console.log(`Summary: 5 smokes, ${hardStops.length} hard-stop failures`)
if (hardStops.length) {
  console.log('\nHard-stop failures:')
  for (const h of hardStops) console.log(`  - ${h}`)
}
process.exit(hardStops.length ? 1 : 0)
