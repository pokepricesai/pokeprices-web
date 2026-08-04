#!/usr/bin/env node
// scripts/scanner/inspect-recent-scan-logs.mjs
//
// Block 5A-W-51B — one-shot inspector for the last N scan_logs rows,
// with the confidence-bearing columns and top-candidate breakdown
// printed inline. Read-only.
//
// Excludes image bytes and unnecessary user PII (device_id is
// hashed for display).

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const limit = parseInt(process.argv[2] || '20', 10)

const { data, error } = await supabase
  .from('scan_logs')
  .select('id, created_at, feature_used, parsed_signals, candidates, top_card_slug, top_confidence, confirmed_card_slug, confirmed_at')
  .order('created_at', { ascending: false })
  .limit(limit)

if (error) { console.error(error.message); process.exit(1) }

console.log(`Recent ${data.length} scan_logs rows (newest first):\n`)
for (const r of data) {
  const p = r.parsed_signals || {}
  const cands = Array.isArray(r.candidates) ? r.candidates : []
  console.log('══════════════════════════════════════════════════════════════════')
  console.log(`id=${r.id}  ${r.created_at}  feature=${r.feature_used}`)
  console.log(`  engine=${p.engine}  language=${p.language ?? '(null)'}  is_promo=${p.is_promo}`)
  console.log(`  collector_number=${JSON.stringify(p.collector_number)} (pattern=${p.collector_number_pattern})`)
  console.log(`  name=${JSON.stringify(p.name)}  set_hint=${JSON.stringify(p.set_hint)}  set_abbr=${JSON.stringify(p.set_abbreviation)}`)
  console.log(`  copyright_year=${p.copyright_year}  ai_variant=${p.ai_variant} (${p.ai_variant_confidence})`)
  console.log(`  candidates=${cands.length}  top_card=${r.top_card_slug}  top_conf=${r.top_confidence?.toFixed?.(3) ?? 'null'}`)
  console.log(`  confirmed=${r.confirmed_card_slug ?? '(none)'}`)
  if (cands.length > 0) {
    console.log(`  ── top ${Math.min(cands.length, 5)} candidates ──`)
    for (let i = 0; i < Math.min(cands.length, 5); i++) {
      const c = cands[i]
      const mq = c.match_quality?.padEnd(15) ?? '?'.padEnd(15)
      const conf = c.confidence?.toFixed?.(3) ?? '?'
      const nm = c.card_name?.slice(0, 40) ?? '(no name)'
      const sn = c.set_name?.slice(0, 30) ?? '(no set)'
      const cd = c.card_number_display ?? c.card_number ?? '?'
      const lang = c.language ?? '?'
      const lm = c.language_match === true ? 'LM' : '  '
      console.log(`    ${i+1}. [${mq}] conf=${conf} lang=${lang} ${lm}  #${cd.padEnd(8)}  ${sn.padEnd(30)}  ${nm}`)
    }
  }
}
