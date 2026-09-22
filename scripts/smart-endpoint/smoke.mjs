#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}
const name = process.argv[2] || 'smart-endpoint-canary'
const url  = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${name}`
const KEY  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const t0 = Date.now()
const r = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
  },
  body: JSON.stringify({
    message: process.argv[3] || 'What are the newest Pokemon sets?',
    session_id: 'smoke-' + Date.now(),
    history: [],
    context_source: 'text',
  }),
})
const body = await r.text()
console.log('endpoint:', name, ' status:', r.status, ' ms:', Date.now() - t0)
console.log(body.slice(0, 1500))
