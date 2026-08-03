#!/usr/bin/env node
// scripts/set-assets/jp-manual-audit.mjs
//
// Block 5A-W-50H — local read-only audit of the manual JP set-asset
// intake tree. Zero I/O against Supabase, zero uploads, zero DB
// writes. Every discovered asset stays approved:false. Produces
// reports/jp-manual-set-assets-audit.json + a browsable HTML review.
//
// Usage:
//   npm run audit:jp-manual-assets
//   node scripts/set-assets/jp-manual-audit.mjs
//   node scripts/set-assets/jp-manual-audit.mjs --root manual-assets/jp

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname, basename, extname } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, def) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : def }
const ROOT       = arg('--root',     'manual-assets/jp')
const REPORT_JSON = arg('--json',    'reports/jp-manual-set-assets-audit.json')
const REPORT_HTML = arg('--out',     'reports/jp-manual-set-assets-review.html')

const INDEX_JSON = join(ROOT, 'asset-index.json')
const INBOX      = join(ROOT, 'inbox')

// ── Allowed shapes ─────────────────────────────────────
const ALLOWED_EXT = ['.png', '.webp', '.svg', '.jpg', '.jpeg']
const BASE_LOGO   = 'logo'
const BASE_SYMBOL = 'symbol'

// ── MIME sniffing by magic bytes ───────────────────────
function sniffMime(buf) {
  if (buf.length >= 8 && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47
      && buf[4]===0x0D && buf[5]===0x0A && buf[6]===0x1A && buf[7]===0x0A) return 'image/png'
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF'
      && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buf.length >= 3 && buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return 'image/jpeg'
  const head = buf.subarray(0, Math.min(512, buf.length)).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function mimeForExt(ext) {
  switch (ext) {
    case '.png':  return 'image/png'
    case '.webp': return 'image/webp'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.svg':  return 'image/svg+xml'
    default:      return null
  }
}

// ── Dimension parsing (best-effort, only PNG + WebP + SVG) ──
function parseDimensions(mime, buf) {
  try {
    if (mime === 'image/png' && buf.length >= 24) {
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
      return { width: w, height: h }
    }
    if (mime === 'image/webp' && buf.length >= 30) {
      const chunk = buf.subarray(12, 16).toString('ascii')
      if (chunk === 'VP8 ' && buf.length >= 30) {
        // Lossy VP8 bitstream — width/height at bytes 26-30 (14 bits each).
        const w = ((buf[27] | (buf[28] << 8)) & 0x3FFF) + 1
        const h = ((buf[29] | (buf[30] << 8)) & 0x3FFF) + 1
        return { width: w, height: h }
      }
      if (chunk === 'VP8L' && buf.length >= 25) {
        // Lossless VP8L — 14-bit width/height, 1-based, stored at 21..25.
        const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]
        const w = ((b1 & 0x3F) << 8 | b0) + 1
        const h = ((b3 & 0x0F) << 10 | b2 << 2 | (b1 >> 6)) + 1
        return { width: w, height: h }
      }
      if (chunk === 'VP8X' && buf.length >= 30) {
        const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1
        const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1
        return { width: w, height: h }
      }
    }
    if (mime === 'image/svg+xml') {
      const head = buf.subarray(0, Math.min(4096, buf.length)).toString('utf8')
      const wMatch = head.match(/\bwidth\s*=\s*["']?([0-9.]+)/i)
      const hMatch = head.match(/\bheight\s*=\s*["']?([0-9.]+)/i)
      if (wMatch && hMatch) return { width: Math.round(Number(wMatch[1])), height: Math.round(Number(hMatch[1])) }
    }
  } catch { /* ignore */ }
  return { width: null, height: null }
}

// ── SVG safety parse (no execution, string-level rejection) ──
function inspectSvgSafety(buf) {
  const head = buf.toString('utf8')
  const warnings = []
  if (/<\s*script\b/i.test(head)) warnings.push('svg-contains-script-element')
  if (/on[a-z]+\s*=\s*(["']|[^\s>])/i.test(head)) warnings.push('svg-contains-inline-event-handler')
  if (/<\s*foreignObject/i.test(head)) warnings.push('svg-contains-foreignObject')
  if (/xlink:href\s*=\s*["']?(https?:|file:|ftp:)/i.test(head)) warnings.push('svg-external-reference')
  if (/<!ENTITY/i.test(head)) warnings.push('svg-contains-doctype-entity')
  return warnings
}

// ── Load index ─────────────────────────────────────────
if (!existsSync(INDEX_JSON)) {
  console.error(`missing ${INDEX_JSON} — run npm run scaffold:jp-manual-assets first`)
  process.exit(1)
}
const index = JSON.parse(readFileSync(INDEX_JSON, 'utf8'))
const entries = index.entries ?? []

// ── Known paired-expansion warning list (heuristic) ────
function isPairedExpansion(setName) {
  const stripped = setName.replace(/^Japanese\s+/, '')
  return / & | and /i.test(stripped)
}

// ── Scan each set's inbox folder ───────────────────────
const perSet = []
const hashToSets = new Map()   // sha256 → [{ set_name, kind, file }]
let totalErrors = 0
let totalWarnings = 0

for (const e of entries) {
  const dir = join(INBOX, e.asset_key)
  const setReport = {
    set_name:   e.set_name,
    visible_name: e.visible_name,
    asset_key:  e.asset_key,
    folder:     dir,
    exists:     existsSync(dir),
    logo:       null,
    symbol:     null,
    unexpected: [],
    errors:     [],
    warnings:   [],
  }

  if (!setReport.exists) { perSet.push(setReport); continue }

  const found = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name)

  const logoCandidates = []
  const symbolCandidates = []
  const unexpected = []
  for (const name of found) {
    if (name === '.gitkeep' || name.startsWith('.')) continue
    const ext = extname(name).toLowerCase()
    const base = basename(name, ext).toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) { unexpected.push({ name, reason: `disallowed extension ${ext}` }); continue }
    if (base === BASE_LOGO)   { logoCandidates.push(name);   continue }
    if (base === BASE_SYMBOL) { symbolCandidates.push(name); continue }
    unexpected.push({ name, reason: 'basename must be exactly "logo" or "symbol" (case sensitive)' })
  }

  setReport.unexpected = unexpected
  if (logoCandidates.length > 1) {
    setReport.errors.push(`multiple logo candidates: ${logoCandidates.join(', ')}`)
  }
  if (symbolCandidates.length > 1) {
    setReport.errors.push(`multiple symbol candidates: ${symbolCandidates.join(', ')}`)
  }

  if (logoCandidates.length === 1)   setReport.logo   = inspectFile(setReport, dir, logoCandidates[0],   'logo')
  if (symbolCandidates.length === 1) setReport.symbol = inspectFile(setReport, dir, symbolCandidates[0], 'symbol')

  perSet.push(setReport)
  totalErrors   += setReport.errors.length
  totalWarnings += setReport.warnings.length
}

function inspectFile(setReport, dir, name, kind) {
  const path = join(dir, name)
  const stat = statSync(path)
  if (stat.size === 0) {
    setReport.errors.push(`${kind} "${name}" is empty`)
    return { name, size: 0, mime: null, ext: extname(name).toLowerCase(), width: null, height: null, sha256: null, path }
  }
  const buf = readFileSync(path)
  const ext = extname(name).toLowerCase()
  const sniffed = sniffMime(buf)
  const expected = mimeForExt(ext)
  if (expected && sniffed !== expected && !(expected === 'image/jpeg' && sniffed === 'image/jpeg')) {
    setReport.errors.push(`${kind} "${name}": extension ${ext} does not match detected MIME ${sniffed}`)
  }
  if (sniffed === 'image/jpeg') {
    setReport.warnings.push(`${kind} "${name}": JPEG has no transparency; logos + symbols normally need transparent PNG/WebP/SVG`)
  }
  if (sniffed === 'image/svg+xml') {
    for (const w of inspectSvgSafety(buf)) setReport.warnings.push(`${kind} "${name}": ${w}`)
  }
  const { width, height } = parseDimensions(sniffed, buf)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const info = { name, size: stat.size, mime: sniffed, ext, width, height, sha256, path }
  // Track for cross-set duplicate detection.
  const arr = hashToSets.get(sha256) ?? []
  arr.push({ set_name: setReport.set_name, kind, file: name })
  hashToSets.set(sha256, arr)
  return info
}

// ── Cross-set duplicate hash detection ─────────────────
const duplicateGroups = []
for (const [hash, uses] of hashToSets.entries()) {
  if (uses.length < 2) continue
  // Group same-set logo/symbol pairs are expected — only flag when
  // the hash spans DIFFERENT set_names.
  const sets = new Set(uses.map(u => u.set_name))
  if (sets.size < 2) continue
  const anyPaired = uses.every(u => isPairedExpansion(u.set_name))
  duplicateGroups.push({ sha256: hash, uses, paired_expansion_only: anyPaired })
}

// ── Counters ───────────────────────────────────────────
const counts = {
  total:                  entries.length,
  with_neither:           perSet.filter(s => !s.logo && !s.symbol).length,
  with_logo_only:         perSet.filter(s =>  s.logo && !s.symbol).length,
  with_symbol_only:       perSet.filter(s => !s.logo &&  s.symbol).length,
  with_both:              perSet.filter(s =>  s.logo &&  s.symbol).length,
  errors:                 totalErrors,
  warnings:               totalWarnings,
  duplicate_hash_groups:  duplicateGroups.length,
  jpeg_files:             perSet.reduce((n, s) => n + (s.logo?.mime === 'image/jpeg' ? 1 : 0) + (s.symbol?.mime === 'image/jpeg' ? 1 : 0), 0),
}

console.log('[jp-manual-audit]', JSON.stringify(counts))

// ── Write audit JSON ───────────────────────────────────
await mkdir(dirname(REPORT_JSON), { recursive: true })
await writeFile(REPORT_JSON, JSON.stringify({
  generated_at:    new Date().toISOString(),
  root:            ROOT,
  entry_count:     entries.length,
  counts,
  duplicate_groups: duplicateGroups,
  per_set:         perSet,
}, null, 2), 'utf8')

// ── HTML report ────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
function fileToDataUrlSrc(f) {
  if (!f) return ''
  // Reference via file:// so the browser reads it locally without
  // embedding binaries into the report itself.
  return `file://${f.path.replace(/\\/g, '/')}`
}

function bucket(setReport) {
  if (setReport.errors.length > 0) return 'errors'
  if (setReport.logo && setReport.symbol) return 'both'
  if (setReport.logo)   return 'logo_only'
  if (setReport.symbol) return 'symbol_only'
  return 'none'
}
const buckets = { errors: [], both: [], logo_only: [], symbol_only: [], none: [] }
for (const s of perSet) buckets[bucket(s)].push(s)

function renderRow(s) {
  const paired = isPairedExpansion(s.set_name)
  const flag = paired ? '<span class="flag">paired-expansion</span>' : ''
  const dupWarn = duplicateGroups
    .filter(g => g.uses.some(u => u.set_name === s.set_name))
    .map(g => `<div class="warn">duplicate hash shared with: ${g.uses.filter(u => u.set_name !== s.set_name).map(u => esc(u.set_name)).join(', ')}${g.paired_expansion_only ? ' (paired-expansion review)' : ''}</div>`)
    .join('')
  const errList = s.errors.map(e => `<div class="err">${esc(e)}</div>`).join('')
  const warnList = s.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')
  const unex = s.unexpected.map(u => `<div class="warn">unexpected file ${esc(u.name)}: ${esc(u.reason)}</div>`).join('')
  function cell(f, kind) {
    if (!f) return `<span class="muted">no ${kind}</span>`
    return `
      <div class="asset">
        <img src="${esc(fileToDataUrlSrc(f))}" alt="" loading="lazy">
        <div class="meta">
          <div><code>${esc(f.name)}</code></div>
          <div>${esc(f.mime ?? '—')} · ${f.width ?? '?'}×${f.height ?? '?'} · ${f.size} B</div>
          <div class="hash" title="${esc(f.sha256 ?? '')}">${esc((f.sha256 ?? '').slice(0, 12))}…</div>
        </div>
      </div>`
  }
  return `<tr>
    <td>
      <div class="internal">${esc(s.set_name)}</div>
      <div class="visible">${esc(s.visible_name)}</div>
      <div class="meta"><code>${esc(s.asset_key)}</code></div>
      ${flag}
    </td>
    <td>${cell(s.logo, 'logo')}</td>
    <td>${cell(s.symbol, 'symbol')}</td>
    <td class="issues">${errList}${warnList}${unex}${dupWarn}</td>
  </tr>`
}

function renderSection(label, rows) {
  if (rows.length === 0) return ''
  return `<section><h2>${esc(label)} <span class="count">${rows.length}</span></h2>
    <table><thead><tr><th>Set</th><th>Logo</th><th>Symbol</th><th>Issues</th></tr></thead>
    <tbody>${rows.map(renderRow).join('')}</tbody></table></section>`
}

const html = `<!doctype html><html><head><meta charset=utf-8><title>JP manual set-assets audit</title>
<style>
 body { font: 13px/1.45 -apple-system, sans-serif; margin: 20px; color: #111 }
 h1 { margin: 0 0 4px } h2 { border-bottom: 2px solid #ddd; padding-bottom: 4px }
 .lead { color: #555 }
 .counters { display:flex; gap:10px; flex-wrap:wrap; margin:16px 0; padding:12px; background:#f7f8fb; border-radius:8px }
 .counter { padding:6px 12px; background:#fff; border:1px solid #e2e5eb; border-radius:6px }
 .counter b { display:block; font-size:18px }
 .count { background:#eee; border-radius:10px; padding:2px 8px; font-size:12px; margin-left:8px }
 table { border-collapse: collapse; width:100% }
 th, td { border-bottom:1px solid #eee; padding:8px; text-align:left; vertical-align: top }
 th { background:#fafafa; position:sticky; top:0; z-index:1 }
 .internal { font-weight: 600 } .visible { color:#555; font-size:12px } .meta { color:#888; font-size:11px }
 .flag { display:inline-block; margin:4px 0 0; padding:1px 6px; border-radius:8px; background:#fef3c7; color:#92400e; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px }
 img { max-width:120px; max-height:80px; object-fit: contain; background: repeating-conic-gradient(#f5f5f5 0 25%, #fff 0 50%) 0/12px 12px; border-radius:3px }
 .asset { display:flex; gap:10px; align-items:flex-start }
 .asset .meta { max-width:180px; font-size:11px }
 code { background:#f4f4f4; padding:1px 4px; border-radius:3px; font-size:11px }
 .hash { color:#888; font-family:monospace; font-size:10px }
 .muted { color:#999 }
 .err  { color:#b91c1c; font-size:11px; margin:2px 0 }
 .warn { color:#a16207; font-size:11px; margin:2px 0 }
</style></head><body>
<h1>JP manual set-assets audit</h1>
<p class="lead">Generated ${esc(new Date().toISOString())} · root: <code>${esc(ROOT)}</code></p>
<div class="counters">
  <div class="counter"><b>${counts.total}</b>total sets</div>
  <div class="counter"><b>${counts.with_both}</b>both</div>
  <div class="counter"><b>${counts.with_logo_only}</b>logo only</div>
  <div class="counter"><b>${counts.with_symbol_only}</b>symbol only</div>
  <div class="counter"><b>${counts.with_neither}</b>neither</div>
  <div class="counter"><b>${counts.errors}</b>errors</div>
  <div class="counter"><b>${counts.warnings}</b>warnings</div>
  <div class="counter"><b>${counts.duplicate_hash_groups}</b>duplicate-hash groups</div>
  <div class="counter"><b>${counts.jpeg_files}</b>JPEG files (no transparency)</div>
</div>
${renderSection('With validation errors', buckets.errors)}
${renderSection('Logo + symbol supplied', buckets.both)}
${renderSection('Logo only',              buckets.logo_only)}
${renderSection('Symbol only',            buckets.symbol_only)}
${renderSection('Neither supplied yet',   buckets.none)}
</body></html>`

await mkdir(dirname(REPORT_HTML), { recursive: true })
await writeFile(REPORT_HTML, html, 'utf8')
console.log(`[jp-manual-audit] wrote  ${REPORT_JSON}`)
console.log(`[jp-manual-audit] wrote  ${REPORT_HTML}`)
console.log(`[jp-manual-audit] every discovered asset remains approved:false`)
