#!/usr/bin/env node
// v168 freshness-flow comparison — v167 live vs v168 canary.
// F1-F5 hard-stops per the 2026-09-24 real-user regression brief.
//
// Universal hard-stop (applied to every turn):
//   no future-tense language ("next", "upcoming", "releases on",
//   "coming soon", "coming up", "drops on", "hits shelves", "will
//   release") near a date earlier than TODAY.

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
  const a = process.argv[i]; if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i])
}
const endpoints = (args.get('endpoints') || 'smart-endpoint,smart-endpoint-canary').split(',')

const TODAY = new Date()
const TODAY_ISO = TODAY.toISOString().slice(0, 10)

// ── date-language guard ──────────────────────────────────────────
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']
function parseDatesFromText(s) {
  const dates = []
  const t = s || ''
  // "Month D, YYYY" or "Month D YYYY"
  const monthRegex = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s+|\s+)(\d{4})\b/gi
  for (const m of t.matchAll(monthRegex)) {
    const monIdx = MONTHS.indexOf(m[1].toLowerCase())
    const d = new Date(Date.UTC(Number(m[3]), monIdx, Number(m[2])))
    if (!isNaN(d.getTime())) dates.push({ text: m[0], date: d, index: m.index })
  }
  // "D Month YYYY"
  const dayFirstRegex = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:,\s+|\s+)(\d{4})\b/gi
  for (const m of t.matchAll(dayFirstRegex)) {
    const monIdx = MONTHS.indexOf(m[2].toLowerCase())
    const d = new Date(Date.UTC(Number(m[3]), monIdx, Number(m[1])))
    if (!isNaN(d.getTime())) dates.push({ text: m[0], date: d, index: m.index })
  }
  // "YYYY-MM-DD"
  const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g
  for (const m of t.matchAll(isoRegex)) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])))
    if (!isNaN(d.getTime())) dates.push({ text: m[0], date: d, index: m.index })
  }
  // "M/D/YYYY" or "MM/DD/YYYY"
  const slashRegex = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g
  for (const m of t.matchAll(slashRegex)) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[1])-1, Number(m[2])))
    if (!isNaN(d.getTime())) dates.push({ text: m[0], date: d, index: m.index })
  }
  return dates
}
const FUTURE_LANG = /\b(?:next|upcoming|coming\s+(?:soon|up|out)|releases?\s+on|will\s+release|drops?\s+on|hits\s+shelves|due\s+(?:on|to\s+release)|is\s+set\s+to\s+release|scheduled\s+for)\b/i
function pastDateWithFutureLanguage(answer, today) {
  const dates = parseDatesFromText(answer)
  for (const d of dates) {
    if (d.date >= today) continue
    // Look 100 chars before and 40 chars after for future-tense language
    const before = (answer || '').slice(Math.max(0, d.index - 100), d.index)
    const after  = (answer || '').slice(d.index + d.text.length, d.index + d.text.length + 40)
    if (FUTURE_LANG.test(before + ' ' + after)) {
      return { hit: true, date: d.text, context: (before + '[' + d.text + ']' + after).slice(0, 250) }
    }
  }
  return { hit: false }
}

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

// ── prompts ──────────────────────────────────────────────────────
const PROMPTS = [
  { id: 'F1-next-set-date',
    description: 'Must not return any date before today for a "next set" claim.',
    turns: [{ message: 'When is the next set coming out?', expect: [
      { kind: 'no_past_date_as_upcoming' },
      { kind: 'prefer_official_source_when_present' },
    ]}]},
  { id: 'F2-next-expansion',
    description: 'Must call lookup_current_tcg_info; get_latest_sets is not sufficient for future.',
    turns: [{ message: "What's the next English Pokemon TCG expansion?", expect: [
      { kind: 'tool_called', name: 'lookup_current_tcg_info' },
      { kind: 'no_past_date_as_upcoming' },
      { kind: 'prefer_official_source_when_present' },
    ]}]},
  { id: 'F3-latest-released',
    description: 'DB-backed answer is fine; must distinguish released from upcoming.',
    turns: [{ message: 'What is the latest released Pokemon TCG set on PokePrices?', expect: [
      // Acceptable: get_latest_sets OR lookup. Not required.
      { kind: 'no_past_date_as_upcoming' },
    ]}]},
  { id: 'F4-delta-reign',
    description: 'Named upcoming set — must use live lookup.',
    turns: [{ message: 'When does Delta Reign come out?', expect: [
      { kind: 'tool_called', name: 'lookup_current_tcg_info' },
      { kind: 'no_past_date_as_upcoming' },
      { kind: 'prefer_official_source_when_present' },
    ]}]},
  { id: 'F5-stale-db-hypothetical',
    description: 'Ask a bare "next set" question — hard-stop is no past-date-as-upcoming, regardless of DB state.',
    turns: [{ message: "What's the next Pokemon set?", expect: [
      { kind: 'no_past_date_as_upcoming' },
      { kind: 'prefer_official_source_when_present' },
    ]}]},
]

// ── assertion runner ─────────────────────────────────────────────
const OFFICIAL_DOMAIN_RE = /\b(pokemon\.com|pokemoncenter\.com|pokemon\.co\.jp|tcg\.pokemon\.com)\b/i
const SPECIALIST_DOMAIN_RE = /\b(pokebeach\.com|bulbagarden\.net|serebii\.net|cardprice\.com|ptcgo\.com|tcgplayer\.com)\b/i

function assertTurn(_ep, turnResult, assertion, rec) {
  const d = turnResult.data || {}
  const ans = d.answer || ''
  const tools = Array.isArray(d.tools_used) ? d.tools_used : (d.tool_used ? [d.tool_used] : [])
  const failures = []
  if (assertion.kind === 'tool_called') {
    if (!tools.includes(assertion.name)) failures.push({ hard: true, kind: 'tool_called', expected: assertion.name, tools })
  } else if (assertion.kind === 'no_past_date_as_upcoming') {
    const r = pastDateWithFutureLanguage(ans, TODAY)
    if (r.hit) failures.push({ hard: true, kind: 'no_past_date_as_upcoming', date: r.date, context: r.context })
  } else if (assertion.kind === 'prefer_official_source_when_present') {
    // v168 addition: when lookup_current_tcg_info returned an
    // OFFICIAL Pokemon domain in its sources, the user-facing
    // answer must not cite a lower-priority specialist source
    // WITHOUT also citing the official one. If no official source
    // was returned, this check is a no-op (soft — not a fail).
    const prov = d.freshness_provenance
    if (!prov || !prov.has_official_source) {
      // no official source available — assertion is a no-op
    } else {
      const ansMentionsOfficial   = OFFICIAL_DOMAIN_RE.test(ans)
      const ansMentionsSpecialist = SPECIALIST_DOMAIN_RE.test(ans)
      if (ansMentionsSpecialist && !ansMentionsOfficial) {
        failures.push({
          hard: true, kind: 'prefer_official_source_when_present',
          note: 'answer cited a specialist source when an official pokemon.com source was available in the tool result',
          tool_sources: prov.sources?.map(s => s.url).slice(0, 5),
          answer_snippet: ans.slice(0, 300),
        })
      }
    }
  }
  rec.failures.push(...failures)
}

async function evaluatePrompt(endpoint, prompt) {
  const record = { prompt: prompt.id, endpoint, turns: [] }
  for (const turn of prompt.turns) {
    const body = { message: turn.message, session_id: `v168-${prompt.id}-${endpoint}-${Date.now()}`, history: [], context_source: 'text' }
    const c = await call(endpoint, body)
    const rec = {
      userMessage: turn.message, status: c.status, ms: c.ms,
      answer: c.data?.answer || '', tools_used: c.data?.tools_used || [], failures: [],
    }
    for (const a of (turn.expect || [])) assertTurn(endpoint, c, a, rec)
    // Also apply the UNIVERSAL past-date guard to every turn.
    const universal = pastDateWithFutureLanguage(rec.answer, TODAY)
    if (universal.hit) {
      // If this turn's expect already includes no_past_date_as_upcoming, don't double-log.
      const already = rec.failures.some(f => f.kind === 'no_past_date_as_upcoming')
      if (!already) rec.failures.push({ hard: true, kind: 'universal_no_past_date_as_upcoming', date: universal.date, context: universal.context })
    }
    record.turns.push(rec)
  }
  return record
}

// ── run ───────────────────────────────────────────────────────────
console.log(`Today: ${TODAY_ISO}`)
console.log(`Endpoints: ${endpoints.join(', ')}\n`)

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

const out = `reports/v168-freshness-eval-${TODAY_ISO}.json`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify({ ts: new Date().toISOString(), today: TODAY_ISO, endpoints, runs: all }, null, 2))
console.log(`\nReport: ${out}`)

const primary = all[endpoints[endpoints.length-1]]
const primaryHard = primary.some(r => r.turns?.some(t => t.failures.some(f => f.hard)))
process.exit(primaryHard ? 1 : 0)
