#!/usr/bin/env node
// scripts/eic-backup-insights.mjs
//
// EIC Block 1 — Part 1. Simple backup of every row in public.insights
// to a timestamped JSON file. Not a versioning framework — a plain,
// trustworthy safety reference we can diff against if something goes
// wrong during the EIC evolution.
//
// Writes to:
//   reports/eic-backups/insights-YYYY-MM-DD-HHmmssZ.json         (full rows)
//   reports/eic-backups/insights-YYYY-MM-DD-HHmmssZ.summary.json (counts + slugs)
//
// Env required (any one of the two names for each):
//   SUPABASE_URL           or NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_KEY   or SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   set SUPABASE_URL=https://…
//   set SUPABASE_SERVICE_KEY=eyJ…
//   node scripts/eic-backup-insights.mjs

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const url =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
const key =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''

if (!url) { console.error('Missing env SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).'); process.exit(1) }
if (!key) { console.error('Missing env SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY).'); process.exit(1) }

// The audit-of-record list of columns we CARE about. If the live table
// omits one, we record it rather than treat it as a fatal error — the
// point is a trustworthy snapshot, not a schema-validation gate.
const EXPECTED_COLUMNS = [
  'id',
  'slug',
  'headline',
  'title',            // legacy — may not exist in the live schema
  'intro',
  'excerpt',          // legacy — may not exist in the live schema
  'body_json',
  'body_text',        // legacy — may not exist in the live schema
  'theme',
  'theme_label',
  'status',
  'published_at',
  'created_at',
  'updated_at',       // may not exist in the live schema
  'image_url',
  'author',
  'read_time_mins',
  'seo_title',
  'seo_description',
  'meta_title',
  'meta_description',
]

const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

console.error('EIC backup — fetching insights…')
const { data: rows, error } = await supa
  .from('insights')
  .select('*')
  .order('created_at', { ascending: false })

if (error) {
  console.error('Fetch failed:', error.message)
  process.exit(1)
}
if (!Array.isArray(rows)) {
  console.error('Unexpected response shape.')
  process.exit(1)
}

// Column presence audit — infer from the first row (Postgres/PostgREST
// always returns the same key set across rows in a homogeneous table).
const presentKeys = rows[0] ? Object.keys(rows[0]) : []
const columnsPresent = EXPECTED_COLUMNS.filter(c => presentKeys.includes(c))
const columnsMissing = EXPECTED_COLUMNS.filter(c => !presentKeys.includes(c))
const extraColumns   = presentKeys.filter(k => !EXPECTED_COLUMNS.includes(k))

// Timestamp: filesystem-safe, sortable, second-precision, UTC.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
const outDir = join(process.cwd(), 'reports', 'eic-backups')
mkdirSync(outDir, { recursive: true })

const fullPath    = join(outDir, `insights-${stamp}.json`)
const summaryPath = join(outDir, `insights-${stamp}.summary.json`)

const payload = {
  backup_kind:      'eic-block-1-insights',
  captured_at:      new Date().toISOString(),
  source:           'public.insights via service-role select *',
  columns_present:  columnsPresent,
  columns_missing:  columnsMissing,
  extra_columns:    extraColumns,
  row_count:        rows.length,
  rows,
}
writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8')

const published = rows.filter(r => r.status === 'published')
const drafts    = rows.filter(r => r.status !== 'published')

const summary = {
  captured_at:      payload.captured_at,
  full_backup_file: fullPath.replace(/\\/g, '/'),
  total_articles:   rows.length,
  published_count:  published.length,
  draft_count:      drafts.length,
  published_slugs:     published.map(r => r.slug).sort(),
  published_headlines: published.map(r => ({ slug: r.slug, headline: r.headline })),
  columns_present:  columnsPresent,
  columns_missing:  columnsMissing,
  extra_columns:    extraColumns,
}
writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

console.error(`Backup written: ${fullPath}`)
console.error(`Summary written: ${summaryPath}`)
console.error(`  total=${rows.length}  published=${published.length}  drafts=${drafts.length}`)
if (columnsMissing.length) {
  console.error(`  columns missing from live schema: ${columnsMissing.join(', ')}`)
}
if (extraColumns.length) {
  console.error(`  extra columns present in live schema: ${extraColumns.join(', ')}`)
}
