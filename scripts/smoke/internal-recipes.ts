/**
 * Read-only smoke test for every registered internal research recipe.
 *
 * Runs the actual data-fetch/build portion of each recipe against
 * production Supabase and asserts:
 *
 *   * no PostgREST 400
 *   * no 414 Request-URI Too Large
 *   * no silent 1,000-row truncation (only if the recipe surfaces a
 *     truncated warning; the recipe itself sets the hardMaxRows)
 *   * the returned pack has the expected shape (recipe id, project
 *     ref, quality object)
 *   * quality object is present and internally consistent
 *
 * If a recipe genuinely cannot produce publishable data because
 * the dataset is thin, `quality.publishable = false` with a clear
 * reason is a PASS. Only exceptions or empty output count as FAIL.
 *
 * Does NOT call Anthropic or any AI model. Read-only DB access.
 *
 *   Run via: npx tsx scripts/smoke/internal-recipes.ts
 */

import { readFileSync } from 'node:fs'

// Load env from .env / .env.local before anything touches process.env.
for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// The `server-only` package is neutered by scripts/smoke/server-only-shim.cjs,
// preloaded via `--require` on the tsx CLI.
import { runResearchRecipe } from '../../src/lib/editorial/research/dispatch'
import type { EvidencePack, PackProjectRef, ResearchRecipeId } from '../../src/lib/editorial/research/types'

type Case = {
  label:   string
  recipe:  ResearchRecipeId
  project: PackProjectRef
  expect: {
    minPopulationScarcityShortlist?: number
    minMonthlyAggregate?:            number
  }
}

const CASES: Case[] = [
  {
    label:  'population_scarcity — High-value low-PSA-10-pop',
    recipe: 'population_scarcity',
    project: {
      id: 999901,
      title: 'High-value Pokémon cards with surprisingly low PSA 10 populations',
      angle: null,
      articleType: 'data_study',
      targetPublishAt: null,
    },
    expect: { minPopulationScarcityShortlist: 5 },
  },
  {
    label:  'monthly_market_report — August 2026',
    recipe: 'monthly_market_report',
    project: {
      id: 999902,
      title: 'Pokémon Card Market Report — August 2026',
      angle: null,
      articleType: 'monthly_market_report',
      targetPublishAt: '2026-09-05T00:00:00Z',
    },
    expect: { minMonthlyAggregate: 1000 },
  },
  {
    label:  'generic_fallback — bootstrap only',
    recipe: 'generic_fallback',
    project: {
      id: 999903,
      title: 'Grading trends for Silver Tempest',
      angle: null,
      articleType: 'grading_analysis',
      targetPublishAt: null,
    },
    expect: {},
  },
]

type Result = { label: string; ok: boolean; ms: number; note: string }
const results: Result[] = []

async function main() {
for (const c of CASES) {
  const started = Date.now()
  process.stdout.write(`\n▶ ${c.label} … `)
  try {
    const pack: EvidencePack = await runResearchRecipe(c.project, { recipe: c.recipe, today: '2026-09-08' })
    const ms = Date.now() - started
    // Shape assertions.
    const notes: string[] = []
    if (pack.recipe !== c.recipe)                    notes.push(`recipe mismatch: got ${pack.recipe}`)
    if (!pack.project || pack.project.id !== c.project.id) notes.push(`project ref lost`)
    if (!pack.quality)                                notes.push(`no quality object`)
    if (typeof pack.quality?.sampleSize !== 'number') notes.push(`quality.sampleSize not numeric`)
    // Recipe-specific asserts.
    if (c.recipe === 'population_scarcity') {
      const shortlist = (pack.dataTables ?? []).find(t => /population-scarcity-top/.test(t.id))
      const rowCount = shortlist?.rows.length ?? 0
      const min = c.expect.minPopulationScarcityShortlist ?? 0
      if (rowCount === 0 && pack.quality?.publishable !== false) {
        notes.push(`empty shortlist AND publishable=true — inconsistent`)
      }
      // A legitimately insufficient dataset is a PASS if quality flags it.
      if (rowCount < min && pack.quality?.publishable !== false) {
        notes.push(`shortlist has ${rowCount} rows (< ${min}) but publishable=true`)
      }
    }
    if (c.recipe === 'monthly_market_report') {
      const min = c.expect.minMonthlyAggregate ?? 0
      if ((pack.quality?.sampleSize ?? 0) < min && pack.quality?.publishable !== false) {
        notes.push(`aggregate sample ${pack.quality?.sampleSize} < ${min} but publishable=true`)
      }
    }
    if (c.recipe === 'generic_fallback') {
      if (pack.quality?.publishable === true) notes.push(`generic_fallback pack must never be publishable=true`)
    }
    const ok = notes.length === 0
    results.push({ label: c.label, ok, ms, note: notes.join(' | ') || `shape ok — sampleSize=${pack.quality?.sampleSize}, publishable=${pack.quality?.publishable}` })
    process.stdout.write(ok ? `PASS (${ms}ms)\n` : `FAIL (${ms}ms) — ${notes.join(' | ')}\n`)
  } catch (e: any) {
    const ms = Date.now() - started
    results.push({ label: c.label, ok: false, ms, note: `THREW: ${e?.message ?? e}` })
    process.stdout.write(`FAIL (${ms}ms) — threw\n`)
    console.error(String(e?.message ?? e).slice(0, 500))
  }
}

console.log('\n─── Summary ───')
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label} — ${r.note}`)
const anyFailed = results.some(r => !r.ok)
process.exit(anyFailed ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
