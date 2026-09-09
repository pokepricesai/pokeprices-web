// Preloaded via --require so `server-only` returns an empty module
// when smoke scripts run in a standalone Node context. Placed
// directly into require.cache under the real resolved path so any
// downstream `require('server-only')` hits this instead of the
// package that throws by design.
const Module = require('node:module')
const path   = require('node:path')

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'server-only') return path.join(__dirname, '_server-only-noop.cjs')
  return origResolve.call(this, request, parent, ...rest)
}

// Real file that just exports {} — created lazily so the shim path
// is a valid CJS module resolvable by require.
const fs   = require('node:fs')
const noopPath = path.join(__dirname, '_server-only-noop.cjs')
if (!fs.existsSync(noopPath)) fs.writeFileSync(noopPath, 'module.exports = {}\n')
