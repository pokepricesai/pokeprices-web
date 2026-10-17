// src/__tests__/emDashRegression.test.ts
//
// PP-URGENT-02 Job 4 regression gate.
//
// Original PokePrices user-facing copy must not contain an em dash
// (U+2014) or its HTML-entity equivalents. This test scans the
// production source tree and fails if a new em dash lands in a
// user-visible string literal.
//
// What this gate IS NOT trying to catch:
//   * Em dashes in comments (lines starting with // or inside /* */
//     or JSX {/* */}).
//   * The single-character "no data" placeholder `'—'` or `"—"`,
//     which is a widely-used UI symbol and renders as a dash in a
//     table cell, not editorial copy.
//   * Em dashes in third-party / external source content, test
//     fixtures, admin surfaces, snapshots or legal quotations.
//   * Em dashes inside technical identifiers or URL strings.
//
// What it DOES catch:
//   * `description: '... — ...'` or `title: '... — ...'`
//   * JSX text literals containing an em dash inside a longer phrase
//   * Template-literal copy that renders to end-users
//
// This is a lightweight guard — not a formal grammar — so a very
// contrived false positive is possible, and when that happens the
// right response is to add the specific offending file to the
// exclusion list below and leave the broader scan intact.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, sep } from 'node:path'
import { describe, it, expect } from 'vitest'

const EM = '—'                       // literal em dash
const ENTITY_RE = /&mdash;|&#8212;|&#x2014;/

// Everything under src/ is scanned EXCEPT the paths below. These paths
// are intentionally allowed to contain em dashes:
//   * src/app/admin/**           operator-only interfaces behind auth
//   * src/app/api/admin/**       admin-only API routes
//   * src/lib/editorial/**       admin editorial pipeline (LLM prompts
//                                feed in and are not shown to end users)
//   * **/__tests__/**            test files
//   * *.test.*, *.spec.*         co-located tests
//
// If a legitimate em dash needs to live in a user-visible string
// (e.g. a legal quotation that must be rendered verbatim), add that
// file to FILE_CARVE_OUTS below with a one-line justification.
const PATH_EXCLUSIONS = [
  `src${sep}app${sep}admin${sep}`,
  `src${sep}app${sep}api${sep}admin${sep}`,
  `src${sep}lib${sep}editorial${sep}`,
  `${sep}__tests__${sep}`,
  '.test.',
  '.spec.',
]

// Per-file carve-outs (full file paths relative to repo root). Keep
// this list short and justified. Use forward slashes (Posix) — the
// matcher normalises platform separators.
const FILE_CARVE_OUTS = new Set<string>([
  // Dev-only strings: AI system prompts fed to Claude / OpenAI,
  // never rendered to end-users.
  'src/app/api/deep-search/parse/route.ts',

  // Visual symbol: "— Stable" is a flat-trend indicator shown next
  // to ▲/▼ arrows on exported Studio graphics (treated like the
  // single-char "no data" placeholder).
  'src/app/api/studio/render/route.tsx',

  // Developer-only env-var `description` fields documenting the
  // eBay Partner Network campaign IDs. These are not surfaced in
  // any UI or API response.
  'src/lib/env.ts',

  // BigQuery DDL `description = "..."` metadata. Not user-visible;
  // only appears in BQ console for data engineers.
  'src/lib/seo/bing/bqSchema.ts',

  // Grading cost config: `description` fields consumed only by the
  // admin tuner, not the public grading calculator UI.
  'src/lib/grading/gradingCostConfig.ts',

  // Grading service / selling profile `sourceNote` fields are
  // referenced only by tests, never rendered to users.
  'src/lib/grading/gradingServiceProfiles.ts',
  'src/lib/grading/sellingProfiles.ts',

  // Developer error messages thrown from server-only code paths.
  'src/lib/seo/pipeline/rollupsAndKpi.ts',
  'src/lib/studio/dataBlocks/factories.ts',

  // Internal `console.warn` + comments only.
  'src/components/InlineChat.tsx',

  // Alerts email digest `return ${plural}` fallback line is a
  // single-token placeholder analogue, not reader-facing prose.
  'src/lib/alerts/emailDigest.ts',

  // Admin-only queries + onboarding tester tooling.
  'src/lib/recentSales/adminQueries.ts',
])

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function isExcluded(path: string): boolean {
  if (FILE_CARVE_OUTS.has(normalizePath(path))) return true
  return PATH_EXCLUSIONS.some(frag => path.includes(frag))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next' || name === 'dist') continue
      walk(full, out)
    } else if (st.isFile()) {
      const ext = extname(full)
      if (ext === '.ts' || ext === '.tsx') out.push(full)
    }
  }
  return out
}

// Strip comment chunks from a line so the remaining text only
// represents what could be user-visible. Supports:
//   /* ... */           block comment on one line
//   /* ...              block comment start (rest of line removed)
//   ... */              block comment end (start of line removed)
//   {/* ... */}         JSX block comment on one line
//   {/* ...             JSX block comment start
//   ... */}             JSX block comment end
//   // ...              line comment
// Returns the stripped line AND the new in-block state.
function stripComments(line: string, inBlock: boolean): { visible: string; stillInBlock: boolean } {
  let s = line
  let active = inBlock

  // If we start inside a block, drop everything up to (and including)
  // the first `*/`. If there isn't one, the whole line is a comment.
  if (active) {
    const end = s.indexOf('*/')
    if (end < 0) return { visible: '', stillInBlock: true }
    s = s.slice(end + 2)
    active = false
  }

  // Repeatedly strip paired block comments on this line (both /* ... */
  // and {/* ... */}).
  while (true) {
    const jsxOpen = s.indexOf('{/*')
    const cOpen   = s.indexOf('/*')
    const open = jsxOpen >= 0 && (cOpen < 0 || jsxOpen < cOpen) ? jsxOpen : cOpen
    if (open < 0) break
    const closeAhead = jsxOpen >= 0 && jsxOpen === open ? s.indexOf('*/}', open) : s.indexOf('*/', open)
    if (closeAhead < 0) {
      // Unterminated block comment opens here; rest of line is comment.
      s = s.slice(0, open)
      active = true
      break
    }
    const closeLen = jsxOpen >= 0 && jsxOpen === open ? 3 : 2
    s = s.slice(0, open) + s.slice(closeAhead + closeLen)
  }

  // Strip trailing line comment.
  const lineComment = s.indexOf('//')
  if (lineComment >= 0) s = s.slice(0, lineComment)

  return { visible: s, stillInBlock: active }
}

// Given the comment-stripped portion of a line, count em dashes that
// are user-visible after accounting for the single-character "no data"
// UI placeholder. Three accepted forms:
//   * `'—'` / `"—"` / `` `—` ``             — bare string literal
//   * `>—<`                                  — bare JSX text node
//   * `{'—'}` / `{"—"}` / {`—`}              — bare JSX expression wrapping the dash
function visibleEmDashCountIn(stripped: string): number {
  if (!stripped.includes(EM) && !ENTITY_RE.test(stripped)) return 0
  const cleaned = stripped
    .replace(/(['"`])—\1/g, '')          // '—' / "—" / `—`
    .replace(/>—</g, '><')               // <span>—</span>
    .replace(/\{\s*(['"`])—\1\s*\}/g, '') // {'—'} / {"—"} / {`—`}
  const literalMatches = cleaned.match(/—/g)
  const entityMatches  = cleaned.match(ENTITY_RE)
  return (literalMatches ? literalMatches.length : 0)
       + (entityMatches  ? entityMatches.length  : 0)
}

interface Offense {
  file: string
  line: number
  text: string
}

function scanFile(path: string): Offense[] {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const offenses: Offense[] = []
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const { visible, stillInBlock } = stripComments(lines[i], inBlock)
    inBlock = stillInBlock
    if (visibleEmDashCountIn(visible) > 0) {
      offenses.push({ file: path, line: i + 1, text: lines[i].trim() })
    }
  }
  return offenses
}

describe('PP-URGENT-02 em-dash regression gate', () => {
  it('no original user-visible string literal in src/ contains an em dash', () => {
    const files = walk('src').filter(f => !isExcluded(f))
    const offenses: Offense[] = []
    for (const f of files) {
      for (const o of scanFile(f)) offenses.push(o)
    }
    if (offenses.length > 0) {
      const report = offenses.slice(0, 25).map(o => `  ${o.file}:${o.line}  ${o.text.slice(0, 160)}`).join('\n')
      throw new Error(
        `${offenses.length} em-dash occurrence${offenses.length === 1 ? '' : 's'} found in user-visible strings.\n` +
        `First ${Math.min(offenses.length, 25)}:\n${report}\n\n` +
        `Rewrite the sentence(s) naturally (full stop, comma, colon or restructure). ` +
        `If this is a legitimate exception (quotation, external content, etc.), add the file to FILE_CARVE_OUTS in this test with a one-line justification.`
      )
    }
    expect(offenses).toEqual([])
  })
})
