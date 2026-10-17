// Standalone report: lists every file with user-visible em dashes.
// Uses the same comment-stripping logic as src/__tests__/emDashRegression.test.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, sep } from 'node:path'

const EM = '—'
const ENTITY_RE = /&mdash;|&#8212;|&#x2014;/

const PATH_EXCLUSIONS = [
  `src${sep}app${sep}admin${sep}`,
  `src${sep}app${sep}api${sep}admin${sep}`,
  `src${sep}lib${sep}editorial${sep}`,
  `${sep}__tests__${sep}`,
  '.test.',
  '.spec.',
]

function isExcluded(path) {
  return PATH_EXCLUSIONS.some(frag => path.includes(frag))
}

function stripComments(line, inBlock) {
  let s = line
  let active = inBlock
  if (active) {
    const end = s.indexOf('*/')
    if (end < 0) return { visible: '', stillInBlock: true }
    s = s.slice(end + 2)
    active = false
  }
  while (true) {
    const jsxOpen = s.indexOf('{/*')
    const cOpen = s.indexOf('/*')
    const open = jsxOpen >= 0 && (cOpen < 0 || jsxOpen < cOpen) ? jsxOpen : cOpen
    if (open < 0) break
    const closeAhead = jsxOpen >= 0 && jsxOpen === open ? s.indexOf('*/}', open) : s.indexOf('*/', open)
    if (closeAhead < 0) {
      s = s.slice(0, open)
      active = true
      break
    }
    const closeLen = jsxOpen >= 0 && jsxOpen === open ? 3 : 2
    s = s.slice(0, open) + s.slice(closeAhead + closeLen)
  }
  const lineComment = s.indexOf('//')
  if (lineComment >= 0) s = s.slice(0, lineComment)
  return { visible: s, stillInBlock: active }
}

function visibleEmDashCountIn(stripped) {
  if (!stripped.includes(EM) && !ENTITY_RE.test(stripped)) return 0
  const cleaned = stripped
    .replace(/(['"`])—\1/g, '')
    .replace(/>—</g, '><')
    .replace(/\{\s*(['"`])—\1\s*\}/g, '')
  const literal = (cleaned.match(/—/g) || []).length
  const entity = (cleaned.match(ENTITY_RE) || []).length
  return literal + entity
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (['node_modules', '.next', 'dist'].includes(name)) continue
      walk(full, out)
    } else if (st.isFile()) {
      const ext = extname(full)
      if (ext === '.ts' || ext === '.tsx') out.push(full)
    }
  }
  return out
}

function scan(path) {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const offenses = []
  let inBlock = false
  for (let i = 0; i < lines.length; i++) {
    const { visible, stillInBlock } = stripComments(lines[i], inBlock)
    inBlock = stillInBlock
    if (visibleEmDashCountIn(visible) > 0) {
      offenses.push({ path, line: i + 1, text: lines[i].trim() })
    }
  }
  return offenses
}

const files = walk('src').filter(f => !isExcluded(f))
const perFile = new Map()
for (const f of files) {
  const o = scan(f)
  if (o.length > 0) perFile.set(f, o)
}

const total = Array.from(perFile.values()).reduce((a, b) => a + b.length, 0)
console.log(`total user-visible em-dash occurrences: ${total}`)
console.log(`files affected: ${perFile.size}`)
console.log()
const sorted = Array.from(perFile.entries()).sort((a, b) => b[1].length - a[1].length)
for (const [path, offs] of sorted) {
  console.log(`${offs.length.toString().padStart(3)}  ${path}`)
}
