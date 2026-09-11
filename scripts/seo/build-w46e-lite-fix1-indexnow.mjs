#!/usr/bin/env node
/*
 * HISTORICAL / DEPRECATED
 * ------------------------
 * This is a one-shot cohort builder from Block 5A-W-46x (Jul 2026).
 * Do NOT re-run against production IndexNow. Preserved for audit trail only.
 * For future IndexNow updates use: npm run indexnow:changed
 * See Block 5A-W-58C.
 */
// scripts/seo/build-w46e-lite-fix1-indexnow.mjs
// Block 5A-W-46E-Lite-FIX1 — build the IndexNow candidate list for the
// authoritative Pokémon-name deployment.
//
// Contents:
//   * every ranking /pokemon/{slug} URL from the current GSC 90d
//     pages export (these are the pages whose metadata just changed
//     from slug-capitalize to the authoritative PokeAPI name)
//   * /insights (W46E-Lite index metadata change)
//
// Guards enforced:
//   * canonical https://www.pokeprices.io only
//   * no query strings, no fragments, no trailing slash issues
//   * no card pages, no article pages, no private routes
//   * duplicates deduped via Set
//
// Modes:
//   default        — dry run: parse, validate, emit the candidate file.
//                    Reports counts. Zero network calls.
//   --submit KEY   — POST the candidate file to IndexNow with the
//                    supplied host-verification key.
//   --also-bing    — additionally POST to https://www.bing.com/indexnow
//                    (default OFF; api.indexnow.org already fans out to
//                    all participating engines including Bing).
//   --i-know-this-is-historical
//                  — required override to actually --submit; see
//                    Block 5A-W-58C. Without it, --submit throws.
//
// Retry policy (Block 5A-W-58C):
//   Retry ONLY on network-error / 429 / 5xx.
//   Do NOT retry on 200, 202, 400, 403, 422.
//   Cap at 3 attempts. Exit on first success.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DATE = new Date().toISOString().slice(0, 10)

function parseArgs(argv) {
  const opts = { submit: false, key: null, alsoBing: false, historicalOverride: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--submit') { opts.submit = true; opts.key = argv[++i] }
    else if (argv[i] === '--also-bing') { opts.alsoBing = true }
    else if (argv[i] === '--i-know-this-is-historical') { opts.historicalOverride = true }
  }
  return opts
}

function readCsv(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 5) continue
    rows.push({ url: cols[0] })
  }
  return rows
}

function classify(url) {
  try {
    const p = new URL(url).pathname
    if (p === '/insights')                     return 'insights-hub'
    if (/^\/insights\/[^/]+$/.test(p))         return 'insights-article'
    if (/^\/pokemon\/[^/]+$/.test(p))          return 'pokemon'
    if (/^\/set\/[^/]+\/card\/[^/]+$/.test(p)) return 'card'
    return 'other'
  } catch { return 'other' }
}

function isAcceptable(url) {
  if (typeof url !== 'string' || !url) return { ok: false, reason: 'empty' }
  let u
  try { u = new URL(url) } catch { return { ok: false, reason: 'unparseable' } }
  if (u.protocol !== 'https:')            return { ok: false, reason: 'non-https' }
  if (u.hostname !== 'www.pokeprices.io') return { ok: false, reason: 'non-www-host' }
  if (u.search)                            return { ok: false, reason: 'has-query-string' }
  if (u.hash)                              return { ok: false, reason: 'has-fragment' }
  if (/\/(dashboard|admin|api|intel|scan-test|_next|login|signup|logout)/.test(u.pathname))
                                            return { ok: false, reason: 'private-route' }
  const t = classify(url)
  if (t === 'card')                        return { ok: false, reason: 'card-page-out-of-scope' }
  if (t === 'insights-article')            return { ok: false, reason: 'article-page-out-of-scope' }
  return { ok: true }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.submit && !opts.historicalOverride) {
    throw new Error(
      'This script is HISTORICAL / DEPRECATED (Block 5A-W-46E-Lite-FIX1, Jul 2026).\n' +
      'Live submission is blocked by default. If you truly need to re-run it,\n' +
      'pass --i-know-this-is-historical explicitly. For future IndexNow updates,\n' +
      'use: npm run indexnow:changed (see Block 5A-W-58C).'
    )
  }

  const pagesCsv = resolve(ROOT, 'seo', 'exports', 'gsc-pages-90d.csv')
  if (!existsSync(pagesCsv)) throw new Error(`Pages CSV not found: ${pagesCsv}`)
  const rows = readCsv(pagesCsv)

  const pokemonRankingUrls = rows
    .map(r => r.url)
    .filter(u => classify(u) === 'pokemon')

  const insightsHubUrl = 'https://www.pokeprices.io/insights'

  const candidateSet = new Set()
  const rejections = []
  for (const raw of [...pokemonRankingUrls, insightsHubUrl]) {
    const verdict = isAcceptable(raw)
    if (!verdict.ok) { rejections.push({ url: raw, reason: verdict.reason }); continue }
    candidateSet.add(raw)
  }

  const accepted = Array.from(candidateSet).sort()

  const outDir = resolve(ROOT, 'seo', 'experiments')
  mkdirSync(outDir, { recursive: true })
  const lines = [
    '# W46E-Lite-FIX1 IndexNow candidate list',
    `# Generated ${DATE}.`,
    '# Contains all ranking /pokemon/{slug} URLs receiving the new',
    '# authoritative-display-name metadata + /insights.',
    '',
    ...accepted,
  ]
  const filePath = resolve(outDir, `${DATE}-w46e-lite-fix1-indexnow.txt`)
  writeFileSync(filePath, lines.join('\n') + '\n', 'utf8')

  // Counts breakdown
  const pokemonCount = accepted.filter(u => classify(u) === 'pokemon').length
  const insightsCount = accepted.filter(u => classify(u) === 'insights-hub').length

  console.log('W46E-Lite-FIX1 IndexNow dry-run:')
  console.log(`  Pokémon ranking URLs:  ${pokemonCount}`)
  console.log(`  Insights hub URL:      ${insightsCount}`)
  console.log(`  ────────────────────────────`)
  console.log(`  Total candidates:      ${accepted.length}`)
  console.log(`  Accepted:              ${accepted.length}`)
  console.log(`  Rejected:              ${rejections.length}`)
  if (rejections.length) {
    console.log(`  Rejection reasons:`)
    const grouped = {}
    for (const r of rejections) grouped[r.reason] = (grouped[r.reason] || 0) + 1
    for (const [reason, n] of Object.entries(grouped)) console.log(`    ${reason}: ${n}`)
  }
  console.log(`  Network calls (dry run): 0`)
  console.log('')
  console.log(`Wrote ${filePath} (${accepted.length} URLs).`)

  if (!opts.submit) {
    console.log('')
    console.log('Dry run complete. Re-run with --submit <INDEXNOW_KEY> to POST to IndexNow.')
    return
  }
  if (!opts.key || opts.key.length < 8) {
    console.error('ERROR: --submit requires a valid IndexNow key argument.')
    process.exit(1)
  }

  // ── Live submission ─────────────────────────────────────────
  // https://www.indexnow.org/documentation
  // Single POST body: { host, key, keyLocation, urlList: [...] }
  const body = {
    host:        'www.pokeprices.io',
    key:         opts.key,
    keyLocation: `https://www.pokeprices.io/${opts.key}.txt`,
    urlList:     accepted,
  }

  // Block 5A-W-58C — Endpoint policy:
  //   Default: POST to api.indexnow.org ONLY. That endpoint fans out to
  //   every participating IndexNow engine (including Bing), so posting
  //   to www.bing.com/indexnow in addition just doubles per-run traffic.
  //   The Aug 2026 21k spike was traced to this exact dual-endpoint
  //   loop × 3-retry cap = up to 6× amplification per operator run.
  //   Pass --also-bing to add the Bing-specific endpoint when explicitly
  //   testing that surface.
  const endpoints = ['https://api.indexnow.org/indexnow']
  if (opts.alsoBing) endpoints.push('https://www.bing.com/indexnow')

  console.log('')
  console.log('Endpoints selected:')
  for (const e of endpoints) console.log(`  ${e}`)
  console.log(opts.alsoBing
    ? '  (--also-bing set: posting to Bing endpoint in addition to api.indexnow.org)'
    : '  (default: api.indexnow.org only — it fans out to Bing and other engines.'
      + ' Use --also-bing to post to www.bing.com/indexnow as well.)')

  // Retry policy per Block 5A-W-58C:
  //   Retry ONLY on network-error / 429 / 5xx.
  //   Do NOT retry on 200, 202, 400, 403, 422.
  //   Cap at 3 attempts. Exit on first success.
  const MAX_ATTEMPTS = 3
  const RETRY_DELAYS_MS = [1000, 4000, 15000]
  const shouldRetryStatus = (status) => {
    if (status === 0) return true                // network-error
    if (status === 429) return true              // rate-limited
    if (status >= 500 && status < 600) return true // 5xx server error
    return false
  }

  let overallOk = false
  const results = []
  for (const endpoint of endpoints) {
    let lastStatus = 0
    let lastText = ''
    let attempt = 0
    let succeeded = false
    while (attempt < MAX_ATTEMPTS) {
      attempt++
      console.log(`POST ${endpoint} — ${accepted.length} URL(s) attempt ${attempt}/${MAX_ATTEMPTS}`)
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
        })
        lastStatus = r.status
        lastText = await r.text().catch(() => '')
        // Redact key from log line just in case the server echoes it.
        const redacted = lastText.split(opts.key).join('[REDACTED_KEY]').slice(0, 200)
        console.log(`  → HTTP ${r.status} ${r.statusText}. body: ${redacted}`)
        if (r.status === 200 || r.status === 202) {
          console.log(`  → success (${r.status}); exiting retry loop.`)
          succeeded = true
          break
        }
        if (!shouldRetryStatus(r.status)) {
          console.error(`  → non-retryable status ${r.status}; not retrying.`)
          break
        }
      } catch (e) {
        lastStatus = 0
        lastText = e.message || 'network error'
        console.warn(`  → fetch error: ${lastText}`)
        if (!shouldRetryStatus(0)) break
      }
      if (attempt >= MAX_ATTEMPTS) break
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
      console.log(`  → sleeping ${delay}ms before retry`)
      await new Promise(r => setTimeout(r, delay))
    }
    results.push({ endpoint, attempts: attempt, lastStatus, succeeded })
    if (succeeded) overallOk = true
  }

  console.log('')
  console.log('Submission summary:')
  for (const r of results) {
    console.log(`  ${r.endpoint} → attempts=${r.attempts}, lastStatus=${r.lastStatus}, ok=${r.succeeded}`)
  }
  if (!overallOk) {
    console.error('FAILED: no endpoint returned 200/202.')
    process.exit(2)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
