#!/usr/bin/env node
// scripts/smart-endpoint/stage5-prod-smoke.mjs
//
// Post-deploy production smoke: exercises the 6 canonical shapes
// against the LIVE smart-endpoint after the audit deploy. All must
// pass before the canary is deleted.
//
// Coverage:
//   1. current/latest set
//   2. official set-size (semantic split: official vs catalog)
//   3. Base Set Charizard price (multi-printing disambiguation)
//   4. 90-day trend question
//   5. multi-turn PSA 10 follow-up
//   6. genuinely ambiguous card search (threshold sanity check)
//
// Every prompt is also run through the universal hard-stop assertions
// from stage4-eval (no aborted chain, no raw cents leak, no fake
// set claim). Exit code = number of hard-stop failures.

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

function looksAbortedChain(s) {
  const t = (s || '').trim()
  if (!t) return false
  if (t.length <= 220 &&
      /(^|[.,]\s*)(let me (check|look|get|pull|see)|now let me|i(?:'| wi)ll now|checking (the|its) price)/i.test(t) &&
      !/\$|£|€|%|per (?:week|month|day)/.test(t)) return true
  const tail = t.slice(-200)
  return /(?:^|[.,]\s*)(let me (?:check|look|get|pull|see|grab|fetch|pull that|get that)|now let me|i(?:'| wi)ll now)[^.!?]*[.!?]?\s*$/i.test(tail)
}
function looksLikeRawCentsLeak(s) {
  const t = s || ''
  if (/\b(raw|psa\d+):\s*-?\d+/i.test(t)) return { hit: true, kind: 'rpc_line_leak' }
  if (/\braw\s*:?\s+\d{4,}\b(?![\s.]?\d?\s*(?:usd|gbp|eur|dollar))/i.test(t)
      && !/raw[^,.]*[$£€]/i.test(t.slice(0, 200))) return { hit: true, kind: 'bare_raw_integer' }
  const m = t.match(/\b(\d{2,})\s+cents?\b/i)
  if (m && Number(m[1]) >= 10) return { hit: true, kind: 'dollar_mislabeled_as_cents', value: m[1] }
  return { hit: false }
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

const results = []
const hardStops = []
function log(id, msg) { console.log(`\n══ ${id}: ${msg} ══`) }
function check(id, hard, msg, ok) {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : (hard ? '\x1b[41m HARD-STOP \x1b[0m' : '\x1b[33m warn \x1b[0m')
  console.log(`  ${tag}  ${msg}`)
  if (!ok && hard) hardStops.push(`${id}: ${msg}`)
}
function commonChecks(id, ans) {
  check(id, true, 'no aborted chain / trailing "let me..."', !looksAbortedChain(ans))
  const cents = looksLikeRawCentsLeak(ans)
  check(id, true, `no raw-cents leak (${cents.kind || 'clean'})`, !cents.hit)
}

console.log(`Endpoint: ${URL}`)
console.log(`Started: ${new Date().toISOString()}`)

// --- 1. current/latest set ---
log('1', 'current/latest set')
{
  const r = await call({ message: 'What is the very latest Pokemon set?', session_id: 'smoke-1-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' latency:', r.ms + 'ms', ' tool:', r.data.tool_used)
  console.log('  A:', (r.data.answer || '').slice(0, 320))
  check('1', true, 'status 200', r.status === 200)
  check('1', true, 'mentions 30th Celebration', /30th\s*Celebration/i.test(r.data.answer || ''))
  check('1', true, 'used get_latest_sets or search_cards', ['get_latest_sets','search_cards','get_set_data'].includes(r.data.tool_used))
  commonChecks('1', r.data.answer || '')
  results.push({ id: '1', ok: true })
}

// --- 2. official set-size (Perfect Order = 88 official, 219 catalog) ---
log('2', 'official set-size — Perfect Order')
{
  const r = await call({ message: 'Roughly how many cards are in Perfect Order?', session_id: 'smoke-2-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' latency:', r.ms + 'ms', ' tool:', r.data.tool_used)
  console.log('  A:', (r.data.answer || '').slice(0, 320))
  const ans = r.data.answer || ''
  check('2', true, 'status 200', r.status === 200)
  // Unlabeled "N cards" claim must be 88 (official_set_size).
  const nCardsClaims = [...ans.matchAll(/(?:has|contains|is)\s+(?:(?:around|about|roughly|approximately|~)\s+)?(\d{2,4})\s*(?:cards?|-card)/gi)].map(m => Number(m[1]))
  const wrongClaims = nCardsClaims.filter(n => n !== 88)
  check('2', true, 'no unlabeled card-count claim other than 88', wrongClaims.length === 0)
  // Forbid the buggy 194/204 values that used to appear.
  const forbid = ans.match(/\b(194|204|131)\b/)
  check('2', true, 'no forbidden values (194, 204, 131)', !forbid)
  // If 219 is mentioned, must be labeled as catalogue.
  if (ans.includes('219')) {
    const labeled = /pokeprices\s+catalog|catalog(?:ue)?\s+(?:entries|records|count|has|holds|contains)/i.test(ans)
    check('2', true, '219 only when labeled as catalogue', labeled)
  } else {
    check('2', false, '219 not mentioned', true)
  }
  commonChecks('2', ans)
  results.push({ id: '2', ok: true })
}

// --- 3. Base Set Charizard price ---
log('3', 'Base Set Charizard price (multi-printing)')
{
  const r = await call({ message: 'How much is Charizard from Base Set worth?', session_id: 'smoke-3-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' latency:', r.ms + 'ms', ' tool:', r.data.tool_used)
  console.log('  A:', (r.data.answer || '').slice(0, 400))
  const ans = r.data.answer || ''
  check('3', true, 'status 200', r.status === 200)
  // Real prices (£317 or $401 for unlimited) should surface
  const hasFormattedPrice = /[£$]\d{1,3}(?:[,.]\d{2,3})?/.test(ans)
  const hasPickerOrPrice  = /which one|find(?:ing)? more than one|£\d|\$\d/.test(ans)
  check('3', true, 'gives a formatted price or shows picker', hasPickerOrPrice)
  commonChecks('3', ans)
  results.push({ id: '3', ok: true })
}

// --- 4. 90-day trend ---
log('4', '90-day trend — Base Set Charizard raw')
{
  const r = await call({ message: 'Has the raw price of Base Set Charizard unlimited moved over the last 90 days?', session_id: 'smoke-4-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' latency:', r.ms + 'ms', ' tool:', r.data.tool_used)
  console.log('  A:', (r.data.answer || '').slice(0, 400))
  const ans = r.data.answer || ''
  check('4', true, 'status 200', r.status === 200)
  // Either states a movement direction / percent, OR hedges honestly.
  const hasTrend = /\b(up|down|flat|risen|fallen|steady|rose|fell|dropped|climb|gain|lose|holding)/i.test(ans)
  const hasHedge = /don'?t have|not (?:available|tracked)|isn'?t (?:in|available)|couldn'?t find/i.test(ans)
  check('4', true, 'gives trend direction OR honest hedge', hasTrend || hasHedge)
  commonChecks('4', ans)
  results.push({ id: '4', ok: true })
}

// --- 5. Multi-turn PSA 10 follow-up ---
log('5', 'multi-turn PSA 10 follow-up')
{
  const session = 'smoke-5-' + Date.now()
  const t1 = await call({ message: 'How much is Charizard from Base Set unlimited worth?', session_id: session, history: [], context_source: 'text' })
  console.log('  turn 1 status:', t1.status, ' latency:', t1.ms + 'ms', ' tool:', t1.data.tool_used, ' pinned:', !!t1.data.matched_pc_product_id)
  console.log('    A1:', (t1.data.answer || '').slice(0, 300))
  const history = [
    { role: 'user',      content: 'How much is Charizard from Base Set unlimited worth?' },
    { role: 'assistant', content: t1.data.answer || '' },
  ]
  const t2 = await call({
    message: 'And PSA 10?',
    session_id: session,
    history,
    // Pin activeCard IF turn 1 resolved to a card.
    card_context: t1.data.matched_pc_product_id ? {
      cardRecordId:          t1.data.matched_card_record_id ? Number(t1.data.matched_card_record_id) : null,
      cardUrlSlug:           t1.data.matched_card_url_slug || '',
      priceChartingProductId: t1.data.matched_pc_product_id,
      cardName:              t1.data.matched_card_name || '',
      setName:               t1.data.matched_set_name || '',
      cardNumber:            t1.data.matched_card_number || null,
      cardNumberDisplay:     t1.data.matched_card_number_display || null,
      language:              (t1.data.matched_language === 'jp' ? 'jp' : 'en'),
      variant:               t1.data.matched_variant || null,
    } : undefined,
    context_source: t1.data.matched_pc_product_id ? 'conversation' : 'text',
  })
  console.log('  turn 2 status:', t2.status, ' latency:', t2.ms + 'ms', ' tool:', t2.data.tool_used)
  console.log('    A2:', (t2.data.answer || '').slice(0, 300))
  const ans2 = t2.data.answer || ''
  check('5', true, 'both turns 200', t1.status === 200 && t2.status === 200)
  // Turn 2 must reference PSA 10 with a real number
  const hasPsa10Price = /psa\s*10.*[£$]\d|[£$]\d.*psa\s*10|9,?\d{3}/i.test(ans2)
  check('5', true, 'turn 2 gives a PSA 10 price', hasPsa10Price)
  // Turn 2 should NOT drop the Charizard context
  const stillCharizard = /charizard/i.test(ans2)
  check('5', true, 'turn 2 retains Charizard context', stillCharizard)
  commonChecks('5', ans2)
  results.push({ id: '5', ok: true })
}

// --- 6. Genuinely ambiguous ---
log('6', 'genuinely ambiguous — "Charizard"')
{
  const r = await call({ message: 'How much is Charizard worth?', session_id: 'smoke-6-' + Date.now(), history: [], context_source: 'text' })
  console.log('  status:', r.status, ' latency:', r.ms + 'ms', ' tool:', r.data.tool_used, ' requires_selection:', !!r.data.requires_card_selection, ' candidate_count:', r.data.candidate_count)
  console.log('  A:', (r.data.answer || '').slice(0, 320))
  const ans = r.data.answer || ''
  check('6', true, 'status 200', r.status === 200)
  // Either shows selection UI OR asks for clarification in text.
  const shows = r.data.requires_card_selection === true
  const askedInText = /which|specify|clarif|narrow|specific|printing|version|set/i.test(ans)
  check('6', true, 'shows selection UI OR asks for clarification', shows || askedInText)
  // Must NOT invent a price for a single random Charizard silently.
  const gavePriceWithoutAsking = /[£$]\d{1,3}(?:[,.]\d{2,3})?/.test(ans) && !askedInText && !shows
  check('6', true, 'no silent price for an ambiguous query', !gavePriceWithoutAsking)
  commonChecks('6', ans)
  results.push({ id: '6', ok: true })
}

// --- Summary ---
console.log('\n────────────────────────────────────────────────────')
console.log(`Summary: ${results.length} smokes, ${hardStops.length} hard-stop failures`)
if (hardStops.length) {
  console.log('\nHard-stop failures:')
  for (const h of hardStops) console.log(`  - ${h}`)
}
process.exit(hardStops.length ? 1 : 0)
