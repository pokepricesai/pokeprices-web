// scripts/54a-audit-counts.mjs — one-shot count utility used for the
// Block 5A-W-54A completion report. Prints per-country totals and
// per-country future-event counts against today.

import { readFileSync } from 'node:fs'

const src = readFileSync('src/data/cardShows.ts', 'utf8')

// Parse each { ... } object literal in the cardShows array.
const arrStart = src.indexOf('export const cardShows: CardShow[] = [')
if (arrStart < 0) { console.error('cardShows array not found'); process.exit(1) }
const arrEnd = src.indexOf('\n]\n', arrStart)
const body = src.slice(arrStart, arrEnd)

// Match each entry's key fields with regex — no full parse needed.
const entries = []
const re = /\{\s*id: '([^']+)',[\s\S]*?country: '([a-z]{2})',[\s\S]*?startDate: '(\d{4}-\d{2}-\d{2})',[\s\S]*?(?:endDate: '(\d{4}-\d{2}-\d{2})',)?[\s\S]*?lastChecked: '(\d{4}-\d{2}-\d{2})',/g
let m
while ((m = re.exec(body)) !== null) {
  entries.push({
    id:       m[1],
    country:  m[2],
    startDate: m[3],
    endDate:  m[4] || null,
    lastChecked: m[5],
  })
}

const today = '2026-08-09'
const countries = ['uk', 'us', 'ca', 'au', 'nz']

console.log(`Total entries: ${entries.length}`)
console.log('')
console.log('Per-country totals:')
for (const c of countries) {
  const all = entries.filter(e => e.country === c)
  const future = all.filter(e => (e.endDate || e.startDate) >= today)
  const added54A = all.filter(e => e.lastChecked === '2026-08-09')
  console.log(`  ${c.toUpperCase()}: total=${all.length}  upcoming(as-of ${today})=${future.length}  added-54A=${added54A.length}`)
}
console.log('')
console.log(`Total upcoming (as-of ${today}): ${entries.filter(e => (e.endDate || e.startDate) >= today).length}`)
console.log(`Total added by 54A: ${entries.filter(e => e.lastChecked === '2026-08-09').length}`)
