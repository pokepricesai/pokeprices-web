/**
 * Dumps the population_scarcity shortlist for the exact production
 * project title used in the reliability sweep. Read-only.
 *
 *   Run: npx tsx --require ./scripts/smoke/server-only-shim.cjs \
 *        scripts/smoke/population-scarcity-shortlist.ts
 */

import { readFileSync } from 'node:fs'
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}

import { runResearchRecipe } from '../../src/lib/editorial/research/dispatch'

async function main() {
  const pack = await runResearchRecipe({
    id: 999901,
    title: 'High-value Pokémon cards with surprisingly low PSA 10 populations',
    angle: null,
    articleType: 'data_study',
    targetPublishAt: null,
  }, { recipe: 'population_scarcity', today: '2026-09-08' })

  const shortlist = (pack.dataTables ?? []).find(t => /population-scarcity-top/.test(t.id))
  console.log(`Pack quality: ${pack.quality?.status} — publishable=${pack.quality?.publishable}, sample=${pack.quality?.sampleSize}`)
  console.log(`Warnings: ${pack.warnings.length} (${pack.warnings.filter(w => w.severity === 'critical').length} critical, ${pack.warnings.filter(w => w.severity === 'major').length} major)`)
  console.log(`Quarantined: ${pack.quarantinedRows.length}`)
  console.log(`Data as of: ${pack.dataAsOf}`)
  console.log('')
  if (!shortlist) { console.log('NO SHORTLIST'); return }
  console.log(`Shortlist rows: ${shortlist.rows.length}`)
  console.log('')
  console.log('# | card | set | raw | PSA10 pop | total pop | gem% | PSA10 price')
  console.log('--+------+-----+-----+-----------+-----------+------+------------')
  shortlist.rows.slice(0, 20).forEach((r: any, i: number) => {
    const rawStr   = r.rawUsd   != null ? `$${Number(r.rawUsd  ).toFixed(0).padStart(4)}` : '  -  '
    const psa10Str = r.psa10Usd != null ? `$${Number(r.psa10Usd).toFixed(0).padStart(5)}` : '   -   '
    console.log(
      `${String(i + 1).padStart(2)} | ${String(r.cardName).slice(0, 32).padEnd(32)} | ${String(r.setName).slice(0, 28).padEnd(28)} | ${rawStr} | ${String(r.psa10).padStart(4)} | ${String(r.totalGraded).padStart(4)} | ${String(r.gemRate).padStart(4)} | ${psa10Str}`
    )
  })
  console.log('')
  console.log('Required caveats:')
  for (const r of pack.quality?.reasons ?? []) if (/Required caveat/.test(r)) console.log(`  - ${r}`)
  console.log('')
  console.log('Rejected claims:')
  for (const r of pack.rejectedClaims) console.log(`  - ${r.claim}`)
}
main().catch(e => { console.error(e); process.exit(1) })
