#!/usr/bin/env node
// v167 recommendation flow comparison — v166 live vs v167 canary.
// Z4-Z8 hard-stops per the 2026-09-23 accuracy brief.
//
// Usage:
//   node scripts/smart-endpoint/v167-recommendation-eval.mjs
//     [--endpoints smart-endpoint,smart-endpoint-canary]
//
// Every prompt runs against every endpoint. For multi-turn prompts,
// the eval carries forward BOTH card_context (via matched_*) AND
// recommendation_context (new in v167) between turns so we can
// verify the constraint-carryover contract holds.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i])
}
const endpoints = (args.get('endpoints') || 'smart-endpoint,smart-endpoint-canary').split(',')

async function call(endpoint, body) {
  const url = `${SUPA_URL}/functions/v1/${endpoint}`
  const t0 = Date.now()
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
    body: JSON.stringify(body),
  })
  const ms = Date.now() - t0
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { ms, status: r.status, data }
}

// Detect if an answer LOOKS like it claims availability without
// having called the tool. "There are no matching cards…" is a
// specific factual claim that MUST come from find_graded_cards
// zero_match=true.
function claimsNoMatch(s) {
  const t = s || ''
  return /(?:there(?:'| i)?s?\s+(?:no|are\s+no)|i\s+don'?t\s+see|couldn'?t\s+find|no\s+match(?:ing|es)?|none\s+(?:in|under)|not?\s+any(?:thing)?|no\s+charizard\s+at)\s*.{0,100}?(?:under|below|less\s+than|for)\s*\$?\d/i.test(t)
    || /\b(?:i\s+don'?t\s+see|there\s+aren'?t)\b.*(?:under|below|less than|for)\s*\$?\d/i.test(t)
}
function claimsCandidate(s) {
  // Any dollar-figure quoted for a specific card (e.g. "$92.49" alongside a Pokemon name)
  return /[$£]\s?\d/.test(s || '')
}
function containsPokemonName(s, names) {
  return names.some(n => new RegExp(`\\b${n}\\b`, 'i').test(s || ''))
}

const PROMPTS = [
  {
    id: 'Z4-recommendation-baseline',
    description: 'buy-me-a-Charizard-PSA-9-under-$100 must call find_graded_cards',
    turns: [
      { message: 'I want to buy a Charizard for under $100 PSA 9', expect: [
        { kind: 'tool_called', name: 'find_graded_cards' },
        { kind: 'if_no_match_claim_then_tool_must_have_zero_match' },
        { kind: 'no_charizard_price_claim_from_thin_air' },
        { kind: 'recommendation_context_has',
          subject: 'Charizard', grader: 'PSA', grade: '9', max_price_usd: 100 },
        { kind: 'no_unqualified_superlative' },
        { kind: 'no_bare_total_claim' },
      ]},
    ],
  },
  {
    id: 'Z5-grade-update',
    description: 'multi-turn: T1 same, T2 "PSA 8 then" must preserve Charizard + $100',
    turns: [
      { message: 'I want to buy a Charizard for under $100 PSA 9', expect: [] },
      { message: 'PSA 8 then', expect: [
        { kind: 'tool_called', name: 'find_graded_cards' },
        { kind: 'tool_input_matches',
          name_filter: 'Charizard', grader: 'PSA', grade: '8', max_price_usd: 100 },
        { kind: 'recommendation_context_has',
          subject: 'Charizard', grader: 'PSA', grade: '8', max_price_usd: 100 },
        { kind: 'answer_does_not_price_wrong_grade' }, // no PSA 9 price claim
        { kind: 'no_unqualified_superlative' },
        { kind: 'no_bare_total_claim' },
      ]},
    ],
  },
  {
    id: 'Z6-budget-update',
    description: 'multi-turn: T2 "make it $150" preserves Charizard + PSA 9, updates budget',
    turns: [
      { message: 'I want to buy a Charizard for under $100 PSA 9', expect: [] },
      { message: 'make it $150', expect: [
        { kind: 'tool_called', name: 'find_graded_cards' },
        { kind: 'tool_input_matches',
          name_filter: 'Charizard', grader: 'PSA', grade: '9', max_price_usd: 150 },
        { kind: 'recommendation_context_has',
          subject: 'Charizard', grader: 'PSA', grade: '9', max_price_usd: 150 },
      ]},
    ],
  },
  {
    id: 'Z7-subject-swap',
    description: 'multi-turn: T2 "Blastoise instead" preserves PSA 9 + $100, swaps subject',
    turns: [
      { message: 'I want to buy a Charizard for under $100 PSA 9', expect: [] },
      { message: 'Blastoise instead', expect: [
        { kind: 'tool_called', name: 'find_graded_cards' },
        { kind: 'tool_input_matches',
          name_filter: 'Blastoise', grader: 'PSA', grade: '9', max_price_usd: 100 },
        { kind: 'recommendation_context_has',
          subject: 'Blastoise', grader: 'PSA', grade: '9', max_price_usd: 100 },
        { kind: 'answer_does_not_reference_pokemon', names: ['Charizard'] },
      ]},
    ],
  },
  {
    id: 'Z8-zero-result-honesty',
    description: 'nonexistent Pokemon must return zero-match hedge, no invented card',
    turns: [
      { message: 'I want to buy a Pikaflarge for under $50 PSA 9', expect: [
        // The tool call is preferred but not required: the model
        // asking "did you mean Pikachu?" without inventing a
        // candidate is also acceptable per the user's brief
        // ("must not invent a candidate or claim live market
        // availability").
        { kind: 'no_price_claim_when_zero_match' },
        { kind: 'no_invented_pokemon', notInList: [
          'Charizard','Blastoise','Venusaur','Umbreon','Pikachu','Mew','Mewtwo','Lugia'
        ]},
      ]},
    ],
  },
]

function assertTurn(endpointName, turnResult, assertion, turnRecord) {
  const d = turnResult.data || {}
  const ans = d.answer || ''
  const tools = Array.isArray(d.tools_used) ? d.tools_used : (d.tool_used ? [d.tool_used] : [])
  const failures = []
  if (assertion.kind === 'tool_called') {
    if (!tools.includes(assertion.name)) failures.push({ hard: true, kind: 'tool_called', expected: assertion.name, tools })
  } else if (assertion.kind === 'if_no_match_claim_then_tool_must_have_zero_match') {
    if (claimsNoMatch(ans)) {
      const usedTool = tools.includes('find_graded_cards')
      if (!usedTool) failures.push({ hard: true, kind: 'if_no_match_claim_then_tool_must_have_zero_match', note: 'no-match claim without find_graded_cards' })
    }
  } else if (assertion.kind === 'no_charizard_price_claim_from_thin_air') {
    if (claimsCandidate(ans) && !tools.includes('find_graded_cards') && !tools.includes('search_cards')) {
      failures.push({ hard: true, kind: 'no_charizard_price_claim_from_thin_air', note: 'quotes a price but did not call any card search tool' })
    }
  } else if (assertion.kind === 'recommendation_context_has') {
    const rc = d.recommendation_context || {}
    for (const k of ['subject','grader','grade','max_price_usd']) {
      if (assertion[k] !== undefined && String(rc[k]) !== String(assertion[k])) {
        failures.push({ hard: true, kind: 'recommendation_context_has', field: k, expected: assertion[k], got: rc[k] })
      }
    }
  } else if (assertion.kind === 'tool_input_matches') {
    // The response body doesn't include tool_input. We rely on
    // recommendation_context echoing the merged constraints AND
    // tools_used including find_graded_cards. If both hold, the
    // tool was called with those constraints (the injection is
    // deterministic).
    const rc = d.recommendation_context || {}
    for (const k of ['name_filter','grader','grade','max_price_usd']) {
      // name_filter maps to subject in recommendation_context.
      const rcKey = k === 'name_filter' ? 'subject' : k
      if (assertion[k] !== undefined && String(rc[rcKey]) !== String(assertion[k])) {
        failures.push({ hard: true, kind: 'tool_input_matches', field: k, expected: assertion[k], got: rc[rcKey] })
      }
    }
    if (!tools.includes('find_graded_cards')) failures.push({ hard: true, kind: 'tool_input_matches', note: 'find_graded_cards not called' })
  } else if (assertion.kind === 'answer_does_not_price_wrong_grade') {
    // For Z5: T2 is about PSA 8. If model quotes PSA 9 as a price
    // (e.g. "PSA 9 is $28,187") that's a drift back to the old grade.
    if (/\bpsa\s*9\b[^.]{0,40}[$£]\d/i.test(ans)) {
      failures.push({ hard: true, kind: 'answer_does_not_price_wrong_grade', note: 'quotes a PSA 9 price on a PSA 8 follow-up' })
    }
  } else if (assertion.kind === 'answer_does_not_reference_pokemon') {
    // Only fail if the forbidden name appears with a price attached
    // in the same sentence (a candidate claim). Comparative mentions
    // ("closest match to the Charizard price you looked at") are fine.
    const sentences = ans.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      if (containsPokemonName(s, assertion.names) && /[$£]\s?\d/.test(s)) {
        failures.push({ hard: true, kind: 'answer_does_not_reference_pokemon',
          names: assertion.names, snippet: s.slice(0, 200) })
        break
      }
    }
  } else if (assertion.kind === 'no_price_claim_when_zero_match') {
    // For Z8: if find_graded_cards zero_matched, no $ price should
    // appear attributed to a specific card. Currency in generic
    // hedges is fine, but "$X.YY" style is not.
    if (/[$£]\s?\d{1,3}(?:[.,]\d{2})?\b/.test(ans)) {
      // Allow "$50" (the budget echoed back) — only fail on non-budget cents-style prices.
      const nonBudget = ans.replace(/\$50\b/g, '')
      if (/[$£]\s?\d+[.,]\d{2}/.test(nonBudget)) {
        failures.push({ hard: true, kind: 'no_price_claim_when_zero_match', note: 'quoted a specific price after zero match' })
      }
    }
  } else if (assertion.kind === 'no_unqualified_superlative') {
    // v167b: forbid superlative claims about a set unless the
    // model has ANYWHERE in the answer established either:
    //   * an N-of-M window scope ("8 of 156 total") — all
    //     subsequent superlatives are implicitly window-scoped, OR
    //   * a nearby explicit qualifier ("of the N shown", "here",
    //     "in this window", "of these").
    const answerLower = ans.toLowerCase()
    // Window scope is established when the model explicitly conveys
    // that the returned rows are a subset of a larger universe. We
    // accept several phrasings the model actually uses in practice:
    // Accept spelled-out numbers up to twenty in addition to digits.
    const numToken = "(?:\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty)"
    const windowScopeEstablished =
         // "N of (the) M" — number, "of", optional "the/a", number.
         new RegExp(`\\b${numToken}\\s+of\\s+(?:the\\s+|a\\s+)?\\d{1,3}\\b`, "i").test(ans)
      // "total of 119"
      || /\btotal\s+of\s+\d{1,3}\b/i.test(ans)
      // "119 total ..." — number then the word "total" is enough
      // signal that the model has referenced the universe count.
      || /\b\d{1,3}\s+total\b/i.test(ans)
      // "of the 119"
      || /\bof\s+the\s+\d{1,3}\b/i.test(ans)
      // "there are 119 (total) matches / cards"
      || /\b(?:there\s+are|there(?:'| i)?s)\s+\d{1,3}\s+(?:total\s+)?(?:matches?|cards?)\b/i.test(ans)
      // "N cheapest / lowest-priced / most expensive" — plural
      // window-ordering claim, not a total-universe superlative.
      || new RegExp(`\\b(?:the\\s+)?${numToken}\\s+(?:cheapest|lowest[\\s-]?priced|most\\s+expensive|priciest)\\b`, "i").test(ans)
    if (!windowScopeEstablished) {
      const superlativeRe = /\b(?:the\s+)?(?:cheapest|lowest[\s-]?priced|most\s+affordable|most\s+expensive|highest[\s-]?priced|priciest|best\s+value|most\s+valuable)\b/gi
      const matches = [...ans.matchAll(superlativeRe)]
      for (const m of matches) {
        const idx = m.index || 0
        // Skip window-ordering plural claims like "the 8 cheapest",
        // "8 cheapest matches" — a count preceding the superlative
        // signals a window-scoped claim, not a total-universe one.
        const before = ans.slice(Math.max(0, idx - 30), idx)
        if (/\d{1,3}\s+$/.test(before)) continue
        const after  = ans.slice(idx, Math.min(ans.length, idx + 160)).toLowerCase()
        const qualified =
             /\b(?:of|among)\s+(?:the\s+)?\d/.test(after)
          || /\b(?:of|among)\s+(?:those|these)\b/.test(after)
          || /\bin\s+(?:this|the)\s+(?:window|list|results|batch)\b/.test(after)
          || /\b(?:here|shown|listed)\b/.test(after.slice(0, 80))
        if (!qualified) {
          failures.push({ hard: true, kind: 'no_unqualified_superlative',
            match: m[0], snippet: ans.slice(Math.max(0, idx-30), Math.min(ans.length, idx+120)) })
          break
        }
      }
    }
  } else if (assertion.kind === 'no_bare_total_claim') {
    // v167b: forbid "there are N cards / matches" style claims
    // when the model hasn't quoted the tool's total_match_count.
    // Safe: "here are 8 matches from the price data", "8 of 20".
    // Unsafe: "there are 8 Charizards", "I've got 8 matches", "I found 8".
    const bareCountRe = /\b(?:there\s+are|there(?:'| i)?s|i(?:'|)ve\s+got|i\s+found|i\s+have)\s+(\d{1,3})\s+(?:matches?|cards?|charizards?|options?|copies|blastoises?)\b/i
    const m = ans.match(bareCountRe)
    if (m) {
      const claimedN = Number(m[1])
      // A bare N-count claim is only OK if the answer ALSO cites
      // a total ("out of M", "of M total", "N of M").
      const hasTotal = /\b(?:out\s+of|of)\s+\d{1,3}\s+(?:total|matches?|shown)\b/i.test(ans)
        || /\b\d{1,3}\s+of\s+\d{1,3}\b/.test(ans)
      if (!hasTotal) {
        failures.push({ hard: true, kind: 'no_bare_total_claim', claimed: claimedN,
          snippet: m[0] })
      }
    }
  } else if (assertion.kind === 'no_invented_pokemon') {
    // For Z8: model must not pivot to a random Pokemon it invented.
    // (Suggesting "try Charizard" or "try Blastoise" IS allowed as
    // an alternative, so we don't fail on those.)
    const namesRegex = new RegExp(`\\b(?:${assertion.notInList.map(n => n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})\\b`, 'i')
    // Only fail if the model is CLAIMING one of these as an existing match, e.g.
    // "I found a Charizard PSA 9 under $50 for $..." — a suggestion to try Charizard
    // is fine.
    if (/[$£]\s?\d/.test(ans) && namesRegex.test(ans) && /\bfound|is\s+(?:a|the)|available/i.test(ans)) {
      failures.push({ hard: true, kind: 'no_invented_pokemon', note: 'model presented a different Pokemon as a match' })
    }
  }
  turnRecord.failures.push(...failures)
}

async function evaluatePrompt(endpoint, prompt) {
  const record = { prompt: prompt.id, endpoint, turns: [] }
  let recContext = null
  for (const turn of prompt.turns) {
    const body = {
      message: turn.message,
      session_id: `v167-${prompt.id}-${endpoint}-${Date.now()}`,
      history: record.turns.flatMap(t => [
        { role: 'user',      content: t.userMessage },
        { role: 'assistant', content: t.answer || '' },
      ]),
      recommendation_context: recContext,
      context_source: 'text',
    }
    const call_ = await call(endpoint, body)
    const rec = {
      userMessage: turn.message,
      status: call_.status,
      ms: call_.ms,
      answer: call_.data?.answer || '',
      tools_used: call_.data?.tools_used || [],
      recommendation_context: call_.data?.recommendation_context || null,
      failures: [],
    }
    for (const a of (turn.expect || [])) assertTurn(endpoint, call_, a, rec)
    record.turns.push(rec)
    // Carry forward recommendation_context for the next turn.
    if (call_.data?.recommendation_context) recContext = call_.data.recommendation_context
  }
  return record
}

// ── run ────────────────────────────────────────────────────────────
const all = {}
for (const ep of endpoints) {
  console.log(`\n══ ENDPOINT: ${ep} ══`)
  all[ep] = []
  for (const p of PROMPTS) {
    process.stdout.write(`  ${p.id.padEnd(30)} `)
    try {
      const r = await evaluatePrompt(ep, p)
      const totalMs = r.turns.reduce((s, t) => s + t.ms, 0)
      const anyHard = r.turns.some(t => t.failures.some(f => f.hard))
      process.stdout.write(anyHard ? `\x1b[41m HARD-STOP \x1b[0m  ${totalMs}ms\n` : `\x1b[32m OK        \x1b[0m  ${totalMs}ms\n`)
      all[ep].push(r)
    } catch (e) {
      process.stdout.write(`\x1b[41m THREW \x1b[0m ${e.message}\n`)
      all[ep].push({ prompt: p.id, error: e.message })
    }
  }
}

console.log('\n══ SUMMARY ══')
for (const ep of endpoints) {
  const runs = all[ep]
  const hard = runs.filter(r => r.turns?.some(t => t.failures.some(f => f.hard))).map(r => r.prompt)
  console.log(`[${ep}]  ${runs.length - hard.length}/${runs.length} OK   HARD: ${hard.length ? hard.join(', ') : 'none'}`)
}

const out = `reports/v167-recommendation-eval-${new Date().toISOString().slice(0,10)}.json`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ ts: new Date().toISOString(), endpoints, runs: all }, null, 2))
console.log(`\nReport: ${out}`)

const primaryHard = all[endpoints[endpoints.length-1]].some(r => r.turns?.some(t => t.failures.some(f => f.hard)))
process.exit(primaryHard ? 1 : 0)
