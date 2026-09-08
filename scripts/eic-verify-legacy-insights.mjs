#!/usr/bin/env node
// scripts/eic-verify-legacy-insights.mjs
//
// EIC Block 1 — Part 5 (on-demand). Compare the current public.insights
// rows against the latest committed backup and report any diff on the
// invariants that MUST remain stable across the EIC evolution:
//   id, slug, headline, status, published_at, body_json
//
// Exits 0 with a green summary if all invariants hold; non-zero if any
// row has changed in a protected field, has vanished, or is new.
//
// Not run by CI. Run manually before / after any block that touches
// insights, e.g.:
//   node scripts/eic-verify-legacy-insights.mjs
//
// Env: SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL and
//      SUPABASE_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const BACKUP_DIR = join(process.cwd(), 'reports', 'eic-backups')

if (!existsSync(BACKUP_DIR)) { console.error('No backup directory yet — run scripts/eic-backup-insights.mjs first.'); process.exit(2) }
const files = readdirSync(BACKUP_DIR).filter(f => f.endsWith('.json') && !f.endsWith('.summary.json')).sort()
if (files.length === 0) { console.error('No backup file found. Run scripts/eic-backup-insights.mjs first.'); process.exit(2) }
const latestFile = join(BACKUP_DIR, files[files.length - 1])

const backup = JSON.parse(readFileSync(latestFile, 'utf8'))
if (!Array.isArray(backup.rows)) { console.error('Backup missing .rows'); process.exit(2) }

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env.'); process.exit(2) }

const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: live, error } = await supa
  .from('insights')
  .select('id, slug, headline, status, published_at, body_json')
if (error) { console.error('Live fetch failed:', error.message); process.exit(2) }

const liveById = new Map(live.map(r => [r.id, r]))
const backupById = new Map(backup.rows.map(r => [r.id, r]))

const diffs = []

// 1. Rows in backup missing from live — likely a deletion.
for (const [id, b] of backupById) {
  if (!liveById.has(id)) {
    diffs.push({ kind: 'missing_from_live', id, slug: b.slug })
  }
}

// 2. Rows in live that were not in backup — a new article since the
// snapshot. Report but do not fail; the invariant is only about
// existing articles remaining intact.
const additions = []
for (const [id, l] of liveById) {
  if (!backupById.has(id)) additions.push({ id, slug: l.slug, headline: l.headline, status: l.status })
}

// 3. For rows present in both, invariants must match.
for (const [id, b] of backupById) {
  const l = liveById.get(id)
  if (!l) continue
  const fields = ['slug', 'headline', 'status', 'published_at']
  for (const f of fields) {
    if (String(l[f] ?? '') !== String(b[f] ?? '')) {
      diffs.push({ kind: 'field_diverged', id, field: f, backup: b[f], live: l[f] })
    }
  }
  // body_json compare via stable JSON.
  if (JSON.stringify(l.body_json) !== JSON.stringify(b.body_json)) {
    diffs.push({ kind: 'field_diverged', id, field: 'body_json', backup: '(large)', live: '(large)' })
  }
}

console.log(`Backup: ${latestFile}`)
console.log(`Backup rows: ${backup.rows.length}   Live rows: ${live.length}`)
if (additions.length) {
  console.log(`New articles in live (not fatal — invariant only covers rows in the backup):`)
  for (const a of additions) console.log(`  + ${a.status.padEnd(9)} ${a.slug}  — ${a.headline}`)
}
if (diffs.length === 0) {
  console.log('OK — every backed-up article still has matching id/slug/headline/status/published_at/body_json.')
  process.exit(0)
}
console.log('DIFFS:')
for (const d of diffs) console.log(' -', d)
process.exit(1)
