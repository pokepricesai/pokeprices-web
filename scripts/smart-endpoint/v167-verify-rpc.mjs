#!/usr/bin/env node
// Verify the find_graded_cards_for_ai RPC against real DB queries
// and show the actual returned candidates for the user's asked
// ground-truth cases: Charizard PSA 9 <$100 and PSA 8 <$100.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run(label, params) {
  console.log('\n══', label, '══')
  console.log('  params:', JSON.stringify(params))
  const t0 = Date.now()
  const { data, error } = await sb.rpc('find_graded_cards_for_ai', params)
  const ms = Date.now() - t0
  if (error) { console.log('  ERR:', error.message); return }
  console.log(`  latency: ${ms}ms  rows: ${data.length}`)
  for (const r of data) {
    const usd  = r.price_usd_cents != null ? '$'+(r.price_usd_cents/100).toFixed(2) : '-'
    const raw  = r.raw_usd_cents   != null ? '$'+(r.raw_usd_cents/100).toFixed(2)   : '-'
    const psa10= r.psa10_usd_cents != null ? '$'+(r.psa10_usd_cents/100).toFixed(2) : '-'
    console.log(`    ${usd.padStart(9)}  (raw ${raw.padStart(8)} · psa10 ${psa10.padStart(10)})  ${r.card_name} — ${r.set_name}  [${r.language}]`)
  }
}

// Ground-truth from the user's brief
await run('Charizard PSA 9 <= $100 (EN)', {
  name_filter: 'Charizard', grader: 'PSA', grade: '9',
  max_price_cents: 10000, set_filter: null, language: 'en', limit_count: 10,
})
await run('Charizard PSA 8 <= $100 (EN)', {
  name_filter: 'Charizard', grader: 'PSA', grade: '8',
  max_price_cents: 10000, set_filter: null, language: 'en', limit_count: 10,
})
await run('Charizard PSA 9 <= $150 (EN)', {
  name_filter: 'Charizard', grader: 'PSA', grade: '9',
  max_price_cents: 15000, set_filter: null, language: 'en', limit_count: 8,
})
await run('Blastoise PSA 9 <= $100 (EN)', {
  name_filter: 'Blastoise', grader: 'PSA', grade: '9',
  max_price_cents: 10000, set_filter: null, language: 'en', limit_count: 8,
})
await run('Charizard PSA 9 no budget (EN)', {
  name_filter: 'Charizard', grader: 'PSA', grade: '9',
  max_price_cents: null, set_filter: null, language: 'en', limit_count: 5,
})
await run('Charizard PSA 9 in Brilliant Stars only', {
  name_filter: 'Charizard', grader: 'PSA', grade: '9',
  max_price_cents: null, set_filter: 'Brilliant Stars', language: 'en', limit_count: 5,
})
await run('nonexistent Pokemon (zero-match)', {
  name_filter: 'Pikaflarge', grader: 'PSA', grade: '9',
  max_price_cents: 10000, set_filter: null, language: 'en', limit_count: 5,
})
