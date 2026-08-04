#!/usr/bin/env node
// scripts/scanner/audit-normalization-impact.mjs
//
// Block 5A-W-51B.1 — read-only diagnostic that quantifies how many
// cards.card_number and cards.card_number_display values normalise
// differently under the OLD (buggy) `_normalize_card_number` regex
// versus the NEW (fixed) regex from
// migrations/2026-08-05-fix-card-number-normalisation.sql.
//
// No writes. No DB mutation. Pure count + representative sample.

import { readFileSync, existsSync } from 'node:fs'
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

// Mirror both regex behaviours precisely. JS regex semantics match
// Postgres for these patterns.
const strip = (s) => s ? s.toLowerCase().replace(/\s+/g, '') : null
const OLD = (s) => s == null ? null : strip(s).replace(/0+([0-9])/g, '$1')
const NEW = (s) => s == null ? null : strip(s).replace(/(^|[^0-9])0+([0-9])/g, '$1$2')

const stats = {
  total: 0,
  affected_by_old_bug: 0,
  affected_after_fix: 0,
  en: { total: 0, affected: 0, sample: [] },
  jp: { total: 0, affected: 0, sample: [] },
}

for (let start = 0; ; start += 1000) {
  const { data: page, error } = await supabase
    .from('cards')
    .select('card_number, card_number_display, set_name, card_name, language')
    .range(start, start + 999)
  if (error) { console.error(error.message); process.exit(1) }
  if (!page || page.length === 0) break

  for (const r of page) {
    stats.total += 1
    const lang = r.language === 'jp' ? 'jp' : 'en'
    stats[lang].total += 1

    const numOld = OLD(r.card_number),  numNew = NEW(r.card_number)
    const disOld = OLD(r.card_number_display), disNew = NEW(r.card_number_display)
    const wouldChange = (numOld !== numNew) || (disOld !== disNew)

    if (wouldChange) {
      stats.affected_by_old_bug += 1
      stats[lang].affected += 1
      if (stats[lang].sample.length < 5) {
        stats[lang].sample.push({
          set_name: r.set_name,
          card_name: r.card_name,
          card_number: r.card_number,
          card_number_display: r.card_number_display,
          old_num_normalised: numOld,
          new_num_normalised: numNew,
          old_disp_normalised: disOld,
          new_disp_normalised: disNew,
        })
      }
    }
    // "affected after fix" = rows the NEW normaliser still changes vs
    // raw input (leading-zero strips). Always ≤ affected_by_old_bug
    // because the new function is a strict subset of what the old one
    // did. This is a sanity number, not a suspicion signal.
    if (strip(r.card_number) !== numNew || strip(r.card_number_display) !== disNew) {
      stats.affected_after_fix += 1
    }
  }
  if (page.length < 1000) break
}

console.log('=== Normalisation impact audit ===')
console.log('  total card rows:                     ', stats.total)
console.log('  rows normalised DIFFERENTLY by fix:  ', stats.affected_by_old_bug, `(${((stats.affected_by_old_bug/stats.total)*100).toFixed(1)}%)`)
console.log('  rows the FIX still touches (leading-zero strips):', stats.affected_after_fix, `(${((stats.affected_after_fix/stats.total)*100).toFixed(1)}%)`)
console.log('')
console.log('  by language:')
console.log('    en:', stats.en.affected, '/', stats.en.total, `(${((stats.en.affected/stats.en.total)*100).toFixed(1)}%)`)
console.log('    jp:', stats.jp.affected, '/', stats.jp.total, `(${((stats.jp.affected/stats.jp.total)*100).toFixed(1)}%)`)
console.log('')
console.log('=== English samples of previously-broken normalisation ===')
for (const s of stats.en.sample) {
  console.log(`  ${s.set_name.padEnd(35)} ${(s.card_name||'').padEnd(35)}`)
  console.log(`    card_number=${s.card_number} card_number_display=${s.card_number_display}`)
  console.log(`    OLD norm: num=${s.old_num_normalised} disp=${s.old_disp_normalised}`)
  console.log(`    NEW norm: num=${s.new_num_normalised} disp=${s.new_disp_normalised}`)
}
console.log('')
console.log('=== Japanese samples of previously-broken normalisation ===')
for (const s of stats.jp.sample) {
  console.log(`  ${s.set_name.padEnd(35)} ${(s.card_name||'').padEnd(35)}`)
  console.log(`    card_number=${s.card_number} card_number_display=${s.card_number_display}`)
  console.log(`    OLD norm: num=${s.old_num_normalised} disp=${s.old_disp_normalised}`)
  console.log(`    NEW norm: num=${s.new_num_normalised} disp=${s.new_disp_normalised}`)
}
