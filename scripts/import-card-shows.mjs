#!/usr/bin/env node
/**
 * import-card-shows.mjs
 * --------------------
 * Convert a CSV export from your spreadsheet into the CardShow[] array
 * shape used by src/data/cardShows.ts. Prints the array to stdout — paste
 * the output into the seed block in cardShows.ts, or redirect to a file.
 *
 * Expected columns (header row required, order doesn't matter):
 *   name, country, region, city, venue, address, postcode,
 *   startDate, endDate, recurring, eventType, description,
 *   organiserName, websiteUrl, ticketUrl, instagramUrl, facebookUrl,
 *   imageUrl, featured, lastChecked, status
 *
 * Usage:
 *   node scripts/import-card-shows.mjs path/to/events.csv
 *   node scripts/import-card-shows.mjs path/to/events.csv > output.ts
 *
 * Validation:
 *   - country must be uk or us (rows with anything else are skipped + logged)
 *   - startDate, name, city are required
 *   - status defaults to "upcoming"
 *   - lastChecked defaults to today
 *   - eventType defaults to "card-show" if blank or unrecognised
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// ── Tiny CSV parser. Handles quoted fields with embedded commas + ""-escaped
// quotes. Doesn't try to be a full RFC 4180 parser but covers Excel /
// Google Sheets exports.
function parseCsv(text) {
  // Strip BOM if Excel added one.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++
        row.push(field); rows.push(row); row = []; field = ''
      } else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function normSlugPart(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function makeSlug(name, city, startDate) {
  const year = startDate?.slice(0, 4) || new Date().getFullYear().toString()
  return [normSlugPart(name), normSlugPart(city), year].filter(Boolean).join('-')
}

function makeId(country, name, startDate) {
  const ym = (startDate || '').slice(0, 7).replace('-', '-') || 'tbd'
  return [country, normSlugPart(name), ym].filter(Boolean).join('-')
}

const VALID_TYPES = new Set(['pokemon', 'tcg', 'card-show', 'collectibles', 'mixed'])
const VALID_STATUS = new Set(['upcoming', 'cancelled', 'past', 'unknown'])

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function parseBool(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === 'yes' || s === '1' || s === 'y'
}

// ── Main ────────────────────────────────────────────────────────────────────

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage: node scripts/import-card-shows.mjs <path-to-csv>')
  process.exit(1)
}
const abs = path.resolve(csvPath)
if (!fs.existsSync(abs)) {
  console.error(`File not found: ${abs}`)
  process.exit(1)
}

const raw = fs.readFileSync(abs, 'utf8')
const rows = parseCsv(raw).filter(r => r.some(cell => cell && cell.trim().length))
if (rows.length < 2) {
  console.error('CSV needs a header row and at least one data row.')
  process.exit(1)
}

const headers = rows[0].map(h => h.trim())
const dataRows = rows.slice(1)
const out = []
const errors = []

for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i]
  const get = (col) => {
    const idx = headers.indexOf(col)
    return idx >= 0 ? (r[idx] ?? '').trim() : ''
  }

  const name = get('name')
  const city = get('city')
  const startDate = get('startDate')
  const country = get('country').toLowerCase()

  if (!name)      { errors.push(`Row ${i + 2}: missing name — skipped`); continue }
  if (!city)      { errors.push(`Row ${i + 2}: missing city — skipped`); continue }
  if (!startDate) { errors.push(`Row ${i + 2}: missing startDate — skipped`); continue }
  if (country !== 'uk' && country !== 'us') {
    errors.push(`Row ${i + 2}: country must be uk or us, got "${country}" — skipped`)
    continue
  }

  let eventType = get('eventType').toLowerCase()
  if (!VALID_TYPES.has(eventType)) eventType = 'card-show'

  let status = get('status').toLowerCase()
  if (!VALID_STATUS.has(status)) status = 'upcoming'

  const show = {
    id:             makeId(country, name, startDate),
    name,
    slug:           makeSlug(name, city, startDate),
    country,
    region:         get('region'),
    city,
    ...(get('venue')         && { venue:         get('venue') }),
    ...(get('address')       && { address:       get('address') }),
    ...(get('postcode')      && { postcode:      get('postcode') }),
    startDate,
    ...(get('endDate')       && { endDate:       get('endDate') }),
    ...(get('recurring')     && { recurring:     get('recurring') }),
    eventType,
    description:    get('description'),
    ...(get('organiserName') && { organiserName: get('organiserName') }),
    ...(get('websiteUrl')    && { websiteUrl:    get('websiteUrl') }),
    ...(get('ticketUrl')     && { ticketUrl:     get('ticketUrl') }),
    ...(get('instagramUrl')  && { instagramUrl:  get('instagramUrl') }),
    ...(get('facebookUrl')   && { facebookUrl:   get('facebookUrl') }),
    ...(get('imageUrl')      && { imageUrl:      get('imageUrl') }),
    ...(parseBool(get('featured')) && { featured: true }),
    lastChecked:    get('lastChecked') || todayIso(),
    status,
  }

  out.push(show)
}

// Sort by start date asc to match the file's existing convention.
out.sort((a, b) => a.startDate.localeCompare(b.startDate))

// Print as a TS-array literal that you can paste straight into cardShows.ts.
// JSON.stringify with 2-space indent is close enough — the reader just
// needs to swap "double-quoted keys" for unquoted (or leave them; the
// existing seed entries do unquoted, but TS accepts quoted keys too).
const body = out.map(o => {
  const lines = ['  {']
  for (const [k, v] of Object.entries(o)) {
    const val = typeof v === 'string'
      ? `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      : JSON.stringify(v)
    lines.push(`    ${k}: ${val},`)
  }
  lines.push('  },')
  return lines.join('\n')
}).join('\n')

console.log(`// Generated by scripts/import-card-shows.mjs from ${path.basename(csvPath)}`)
console.log(`// ${out.length} event(s) imported. Paste this into the cardShows array in src/data/cardShows.ts.`)
console.log('')
console.log('[')
console.log(body)
console.log(']')

if (errors.length) {
  console.error('')
  console.error(`── Skipped rows (${errors.length}) ──`)
  errors.forEach(e => console.error('  ' + e))
}
