#!/usr/bin/env node
// scripts/submit-indexnow.js
// Block 5A-W-46B — CLI wrapper for the pure IndexNow submitter logic
// in src/lib/indexnow/submitter.ts. The wrapper handles argv parsing,
// snapshot diffing on disk, network I/O, retry sleeps, and safe
// logging. All URL validation, batching, and status classification
// is delegated to the tested pure module so the CLI stays thin.
//
// USAGE
//   node scripts/submit-indexnow.js --dry-run [--file urls.txt]
//   node scripts/submit-indexnow.js --changed-only \
//        --snapshot .indexnow-snapshot.json --file urls-and-hashes.tsv
//   node scripts/submit-indexnow.js https://www.pokeprices.io/insights
//   npm run indexnow -- --dry-run https://www.pokeprices.io/insights
//
// The `--dry-run` flag validates + dedupes + batches the input WITHOUT
// hitting the network. Nothing is submitted; the report is printed
// so an operator can spot-check what would happen.
//
// The `--changed-only` mode compares the input URL+hash list against
// a snapshot file and only submits URLs whose hash changed (or that
// are entirely new). Deleted URLs are printed but not submitted by
// default — pass `--include-deletions` to submit them too.
//
// SAFETY
//   * The shared IndexNow key is loaded from INDEXNOW_KEY env var if
//     set; otherwise from the hardcoded fallback below. It is NEVER
//     printed and is redacted from response bodies before logging.
//   * The wrapper never submits URLs from dashboard / admin / api /
//     login / signup paths, even if a caller lists them explicitly —
//     the pure module rejects those before batching.
//   * On a batch failure, retries follow a bounded exponential
//     backoff. Client errors (400/403/422) are never retried.

'use strict'

const fs   = require('node:fs')
const path = require('node:path')
const url  = require('node:url')

// Dynamically import the .mjs pure-logic module — Node accepts this
// from a CommonJS entry via the `import()` expression. Doing this in
// an async bootstrap keeps the module hot path async but tests that
// import the .mjs directly bypass this shim entirely.
let submitter
async function loadSubmitter() {
  if (submitter) return submitter
  const mjsPath = path.join(__dirname, '..', 'src', 'lib', 'indexnow', 'submitter.mjs')
  const mjsUrl  = url.pathToFileURL(mjsPath).href
  submitter = await import(mjsUrl)
  return submitter
}

// CLI constants — canonical host + retry schedule are mirrored from
// the pure module below (see loadSubmitter). Keep this list minimal
// so the .mjs source stays authoritative.
const CANONICAL_HOST = 'www.pokeprices.io'
const MAX_ATTEMPTS   = 4
const RETRY_DELAY_SCHEDULE_MS = [1000, 4000, 15000]

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a8f92c1d7e4b49d2b7c5e913f4aa8179'
const KEY_LOCATION = `https://${CANONICAL_HOST}/${INDEXNOW_KEY}.txt`
const ENDPOINT     = 'https://api.indexnow.org/indexnow'

function log(msg) { process.stdout.write(msg + '\n') }
function warn(msg) { process.stderr.write(msg + '\n') }

function parseArgs(argv) {
  const opts = {
    dryRun:            false,
    changedOnly:       false,
    includeDeletions:  false,
    file:              null,
    snapshotPath:      null,
    urls:              [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run')            opts.dryRun = true
    else if (a === '--changed-only')  opts.changedOnly = true
    else if (a === '--include-deletions') opts.includeDeletions = true
    else if (a === '--file')          opts.file = argv[++i] || null
    else if (a === '--snapshot')      opts.snapshotPath = argv[++i] || null
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else if (a.startsWith('http'))    opts.urls.push(a)
    else if (a.startsWith('--'))      { warn(`Unknown flag: ${a}`); process.exit(2) }
    else                              warn(`Ignoring non-URL argument: ${a}`)
  }
  return opts
}

function printHelp() {
  log(`IndexNow submitter — usage:
  node scripts/submit-indexnow.js [flags] [url ...]

Flags:
  --dry-run             Validate + dedupe + batch WITHOUT sending.
  --file <path>         Read one URL per line (with optional \\t<hash>).
  --changed-only        Compare against --snapshot; only submit new or
                        content-changed URLs.
  --snapshot <path>     Snapshot JSON path (read + rewritten on success).
  --include-deletions   With --changed-only, also submit URLs missing
                        from the current input (were in snapshot).
  --help                This message.
`)
}

/** Read a URL list. Each line is either a URL, or "URL\\t<hash>" if
 *  the caller wants to enable change-detection. Comment lines start
 *  with '#'. Empty lines skipped. */
function readInputFile(p) {
  const raw = fs.readFileSync(p, 'utf8')
  const rows = []
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const tab = s.indexOf('\t')
    if (tab < 0) rows.push({ url: s, hash: null })
    else          rows.push({ url: s.slice(0, tab), hash: s.slice(tab + 1) })
  }
  return rows
}

function readSnapshot(p) {
  if (!p) return new Map()
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return new Map()
    const out = new Map()
    for (const [u, h] of Object.entries(parsed)) {
      if (typeof u === 'string' && typeof h === 'string') out.set(u, h)
    }
    return out
  } catch (e) {
    warn(`Snapshot not read (${e.message}); treating as empty.`)
    return new Map()
  }
}

function writeSnapshot(p, map) {
  if (!p) return
  const obj = {}
  for (const [u, h] of map.entries()) obj[u] = h
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(obj, null, 2))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function submitBatch(urls, batchIdx, batchTotal) {
  const s = await loadSubmitter()
  const { buildPayload, classifyStatus, shouldRetry, safeLogBody } = s
  const payload = buildPayload(urls, { key: INDEXNOW_KEY, keyLocation: KEY_LOCATION })
  const label = batchTotal > 1 ? `[batch ${batchIdx + 1}/${batchTotal}]` : ''
  let attempt = 0
  let last = { status: 0, text: '' }
  while (attempt < MAX_ATTEMPTS) {
    attempt++
    log(`${label} POST ${ENDPOINT} — ${urls.length} URL(s) attempt ${attempt}/${MAX_ATTEMPTS}`)
    try {
      const res = await fetch(ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body:    JSON.stringify(payload),
      })
      const text = await res.text()
      last = { status: res.status, text }
    } catch (err) {
      last = { status: 0, text: err.message }
    }
    const cls = classifyStatus(last.status)
    const bodyLog = safeLogBody(last.text, INDEXNOW_KEY)
    log(`${label} status: ${last.status} (${cls})${bodyLog ? ' body: ' + bodyLog : ''}`)
    if (!shouldRetry(cls) || attempt >= MAX_ATTEMPTS) return { ok: cls === 'ok' || cls === 'accepted', last, cls }
    const delay = RETRY_DELAY_SCHEDULE_MS[attempt - 1] ?? RETRY_DELAY_SCHEDULE_MS[RETRY_DELAY_SCHEDULE_MS.length - 1]
    log(`${label} retrying after ${delay}ms`)
    await sleep(delay)
  }
  return { ok: false, last, cls: classifyStatus(last.status) }
}

async function main() {
  const s = await loadSubmitter()
  const { collectValidUrls, batchUrls, diffSnapshots } = s
  const opts = parseArgs(process.argv.slice(2))

  // 1. Gather input rows.
  let inputRows = []
  if (opts.file) inputRows = readInputFile(opts.file)
  for (const u of opts.urls) inputRows.push({ url: u, hash: null })
  if (inputRows.length === 0) {
    log('IndexNow submitter — no URLs supplied. Pass --file, --help, or URLs as arguments.')
    return
  }

  // 2. Change detection.
  let toSubmit = inputRows.map(r => r.url)
  let deletions = []
  if (opts.changedOnly) {
    const prevMap = readSnapshot(opts.snapshotPath)
    const curMap  = new Map()
    for (const r of inputRows) {
      if (r.hash == null) {
        warn(`--changed-only requires every input row to carry a hash; missing on ${r.url} — skipping.`)
        continue
      }
      curMap.set(r.url, r.hash)
    }
    const diff = diffSnapshots(prevMap, curMap)
    toSubmit  = diff.changed
    deletions = diff.deleted
    log(`Change detection: ${toSubmit.length} changed, ${deletions.length} deleted.`)
    if (opts.includeDeletions) toSubmit = toSubmit.concat(deletions)
    // Snapshot rewrite on the current input, regardless of send outcome —
    // if a URL genuinely never changes, we don't want to keep resubmitting
    // it on every run just because a network hiccup broke the previous
    // attempt. If the current run fails, the operator re-runs; the diff
    // will still be empty because content hasn't moved.
    writeSnapshot(opts.snapshotPath, curMap)
  }

  // 3. Validate + dedupe.
  const val = collectValidUrls(toSubmit, { allowDeletions: opts.includeDeletions })
  log(`Accepted: ${val.accepted.length}. Rejected: ${val.rejected.length}.`)
  if (val.rejected.length > 0) {
    const byReason = new Map()
    for (const r of val.rejected) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + 1)
    for (const [reason, count] of byReason.entries()) log(`  ${reason}: ${count}`)
  }

  // 4. Dry run — stop before network.
  if (opts.dryRun) {
    log('')
    log('DRY RUN — no network call made.')
    log(`Would submit ${val.accepted.length} URL(s) in ${Math.max(1, Math.ceil(val.accepted.length / 1000))} batch(es).`)
    for (const u of val.accepted.slice(0, 10)) log(`  ${u}`)
    if (val.accepted.length > 10) log(`  ... (+${val.accepted.length - 10} more)`)
    return
  }

  if (val.accepted.length === 0) {
    log('Nothing to submit after validation. Exiting.')
    return
  }

  // 5. Batch + POST.
  const batches = batchUrls(val.accepted)
  const failures = []
  for (let i = 0; i < batches.length; i++) {
    const result = await submitBatch(batches[i], i, batches.length)
    if (!result.ok) failures.push({ batch: i + 1, cls: result.cls, status: result.last.status })
  }

  log('')
  log(`Done. Submitted ${val.accepted.length} URL(s) in ${batches.length} batch(es).`)
  if (failures.length > 0) {
    warn(`Failed batches: ${failures.length}`)
    for (const f of failures) warn(`  batch ${f.batch}: ${f.cls} (${f.status})`)
    process.exit(1)
  }
}

main().catch(err => {
  warn(`FATAL: ${err && err.message ? err.message : err}`)
  process.exit(1)
})
