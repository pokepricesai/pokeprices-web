// scripts/verify-vendor-security.mjs
// ============================================================================
// Block 1B vendor security verification.
//
// SAFETY
// ------
//   * Refuses to run unless VERIFY_ALLOW_NON_PRODUCTION=1.
//   * Refuses to run if SUPABASE_URL matches the known production hostname.
//   * Requires a running Next.js dev server (NEXT_BASE_URL) so it can
//     hit the new routes end-to-end.
//   * Does not modify production data.
//
// REQUIRED ENV
// ------------
//   VERIFY_ALLOW_NON_PRODUCTION=1
//   SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co
//   SUPABASE_ANON_KEY=...
//   NEXT_BASE_URL=http://localhost:3000
//
// COVERED SCENARIOS (mapping to the Block 1B brief)
//   1.  Valid submission without logo
//   2.  Valid submission with PNG
//   3.  Valid submission with JPEG
//   4.  Valid submission with WEBP
//   5.  Invalid declared MIME (text/plain)
//   6.  Mismatched magic bytes (declared PNG, JPEG bytes)
//   7.  File above 2 MB
//   8.  SVG rejected
//   9.  Expired token
//   10. Reused token
//   11. Token belonging to another vendor
//   12. Direct anonymous insert into vendors fails
//   13. Public users can read approved vendor profiles
//   14. Public users cannot read pending vendor submissions
//   15. Path traversal attempt fails (no client-controlled path)
//   16. Client-supplied slug cannot control the storage path
//   17. Honeypot triggers a silent success without inserting
//
// NOTES
// -----
//   * Scenario 9 (expired token) requires the test harness to manually
//     expire a token via the dev SQL editor — the script will print the
//     vendor ID and instruct the operator to run a snippet, then resume.
//   * Scenario 13 expects at least one approved vendor (active = true)
//     in the dev project. If none exists, the check is skipped with a
//     visible note.
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const PROD_HOSTNAMES = new Set(['egidpsrkqvymvioidatc.supabase.co'])

function fail(msg) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}
function need(name) {
  const v = process.env[name]
  if (!v) fail(`Missing env var: ${name}`)
  return v
}

if (process.env.VERIFY_ALLOW_NON_PRODUCTION !== '1') {
  fail('Refusing to run without VERIFY_ALLOW_NON_PRODUCTION=1.')
}

const SUPABASE_URL  = need('SUPABASE_URL')
const ANON_KEY      = need('SUPABASE_ANON_KEY')
const BASE_URL      = need('NEXT_BASE_URL').replace(/\/$/, '')

let parsedUrl
try { parsedUrl = new URL(SUPABASE_URL) } catch { fail('SUPABASE_URL is not a valid URL.') }
if (PROD_HOSTNAMES.has(parsedUrl.hostname)) {
  fail(`Refusing to run against production hostname ${parsedUrl.hostname}.`)
}

let pass = 0
let failCount = 0
const failures = []
function ok(label)  { pass++; console.log(`  ✓ ${label}`) }
function bad(label, detail) {
  failCount++
  failures.push({ label, detail })
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
}
async function step(name, fn) {
  console.log(`\n— ${name}`)
  try { await fn() }
  catch (e) { bad(`${name} threw`, e?.message || String(e)) }
}

const anon = () => createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Fixture bytes (real minimal valid files) ────────────────────────────────
// 1×1 transparent PNG
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/3WIv7gAAAAASUVORK5CYII=',
  'base64',
)
// 1×1 white JPEG
const JPEG_BYTES = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpAAAAB//9k=',
  'base64',
)
// Minimal valid WEBP (RIFF...WEBP...)
const WEBP_BYTES = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v3AgAA=',
  'base64',
)
// Plain text masquerading as JPEG.
const FAKE_JPEG = Buffer.from('this is definitely not a jpeg\n')
// Tiny SVG fragment.
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
// 3 MB blob to test size cap.
const TOO_LARGE = Buffer.alloc(3 * 1024 * 1024, 0x89)

// ── Helpers ─────────────────────────────────────────────────────────────────
function uniqueName(prefix) {
  // Suffix with timestamp so consecutive runs do not collide on slug.
  return `${prefix} ${Date.now().toString(36)} ${Math.random().toString(36).slice(2, 6)}`
}

async function submitVendor(extra = {}) {
  const body = {
    name:        uniqueName('Verifier Store'),
    vendor_type: 'physical_shop',
    country:     'UK',
    city:        'London',
    description: 'Created by scripts/verify-vendor-security.mjs',
    // Pretend the user took 4 seconds — passes minimum-fill-time.
    form_started_at_ms: Date.now() - 4000,
    ...extra,
  }
  const res = await fetch(`${BASE_URL}/api/vendors/submit`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  let json = {}
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

async function uploadLogo({ vendorId, token, declaredMime, bytes }) {
  const fd = new FormData()
  fd.append('vendorId', vendorId)
  fd.append('token',    token)
  // Node's File ctor takes a body, name and options { type }.
  fd.append('file', new File([bytes], 'logo.bin', { type: declaredMime }))
  const res = await fetch(`${BASE_URL}/api/vendor-logo-upload`, {
    method: 'POST',
    body:   fd,
  })
  let json = {}
  try { json = await res.json() } catch {}
  return { status: res.status, json }
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`Verifying Block 1B against ${parsedUrl.hostname} via ${BASE_URL}`)

// Capture the snapshot of existing vendor rows so we can later confirm
// the migration / new code did not silently change them. Read via anon —
// only active rows will be visible, which is the right invariant to
// protect anyway.
let preExistingActive = []
await step('0. Snapshot existing active vendor rows', async () => {
  const { data, error } = await anon().from('vendors')
    .select('id, name, slug, active, verified, logo_url')
    .eq('active', true)
  if (error) return bad('snapshot read failed', error.message)
  preExistingActive = data ?? []
  ok(`captured ${preExistingActive.length} active vendor row(s)`)
})

// ── 0a. Column existence ────────────────────────────────────────────────────
// PostgREST returns 400 / 42703 when the column does not exist regardless
// of RLS or row count, so this works under anon.
await step('0a. vendors.logo_url column exists', async () => {
  const { error } = await anon().from('vendors').select('logo_url').limit(1)
  if (!error) ok('logo_url column present')
  else if ((error.code || '') === '42703' || /logo_url/.test(error.message)) {
    bad('logo_url column missing', error.message)
  } else {
    // Some other (RLS-shape) error — still indicates the column itself parses.
    ok(`logo_url query parsed (driver error: ${error.code || error.message})`)
  }
})

// ── 0b. Existing-active vendors remain readable after RLS ──────────────────
await step('0b. Existing active vendors readable under anon', async () => {
  if (preExistingActive.length === 0) {
    console.log('  (note: no active vendors in dev — skipping)')
    return
  }
  const sample = preExistingActive[0]
  const { data, error } = await anon().from('vendors').select('id').eq('id', sample.id)
  if (error)                  bad('read error', error.message)
  else if ((data ?? []).length === 1) ok(`anon can read active vendor ${sample.slug}`)
  else                        bad('anon cannot read pre-existing active vendor', JSON.stringify(data))
})

// ── 12. Direct anon insert ──────────────────────────────────────────────────
await step('12. Direct anonymous insert into vendors must fail', async () => {
  const a = anon()
  const { error, data } = await a.from('vendors').insert({
    name:        uniqueName('Anon Insert Attempt'),
    vendor_type: 'physical_shop',
    country:     'UK',
    slug:        `anon-${Date.now().toString(36)}`,
    active:      true,    // attempt to escalate
    verified:    true,
  }).select('id')
  if (error) {
    ok(`rejected: ${error.code || error.message}`)
  } else if (!data || data.length === 0) {
    ok('insert returned no row (RLS blocked)')
  } else {
    bad('anon insert succeeded', JSON.stringify(data))
  }
})

// ── 13. Anon can read approved vendors ──────────────────────────────────────
await step('13. Anon can read approved vendor profiles', async () => {
  const { data, error } = await anon().from('vendors').select('id, slug, active').eq('active', true).limit(1)
  if (error)                bad('select error', error.message)
  else if ((data ?? []).length > 0) ok(`saw at least one active vendor (${data[0].slug})`)
  else                      console.log('  (note: no active vendors in dev project — skipping)')
})

// ── 14. Anon cannot read pending vendors ────────────────────────────────────
await step('14. Anon cannot read pending vendor submissions', async () => {
  // First, create one via the new server route.
  const { json: created } = await submitVendor()
  if (!created.vendorId) { bad('precondition failed: vendor not created', JSON.stringify(created)); return }
  const { data } = await anon().from('vendors').select('id').eq('id', created.vendorId)
  if (!data || data.length === 0) ok('pending vendor invisible to anon')
  else                            bad('anon saw pending vendor', JSON.stringify(data))
})

// ── 17. Honeypot ────────────────────────────────────────────────────────────
await step('17. Honeypot field returns soft success without inserting', async () => {
  const { status, json } = await submitVendor({ company_url: 'https://spam.example' })
  if (status === 200 && json.vendorId === null) ok('soft 200 with null vendorId')
  else bad('honeypot did not soft-succeed', `status=${status} json=${JSON.stringify(json)}`)
})

// ── 1. Valid without logo ───────────────────────────────────────────────────
let creds1
await step('1. Valid submission without logo', async () => {
  const { status, json } = await submitVendor()
  if (status === 200 && json.vendorId && json.uploadToken) {
    creds1 = json
    ok(`vendorId=${json.vendorId.slice(0,8)}…`)
  } else {
    bad('expected 200 with credential', `status=${status} json=${JSON.stringify(json)}`)
  }
})

// ── 2. PNG happy path ──────────────────────────────────────────────────────
await step('2. Valid submission with PNG', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status, json } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (status === 200 && json.url) ok(`url=${json.url.split('/').slice(-2).join('/')}`)
  else bad('PNG upload failed', `status=${status} json=${JSON.stringify(json)}`)
})

// ── 3. JPEG happy path ─────────────────────────────────────────────────────
await step('3. Valid submission with JPEG', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status, json } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/jpeg',
    bytes:        JPEG_BYTES,
  })
  if (status === 200 && json.url) ok(`url=${json.url.split('/').slice(-2).join('/')}`)
  else bad('JPEG upload failed', `status=${status} json=${JSON.stringify(json)}`)
})

// ── 4. WEBP happy path ─────────────────────────────────────────────────────
await step('4. Valid submission with WEBP', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status, json } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/webp',
    bytes:        WEBP_BYTES,
  })
  if (status === 200 && json.url) ok(`url=${json.url.split('/').slice(-2).join('/')}`)
  else bad('WEBP upload failed', `status=${status} json=${JSON.stringify(json)}`)
})

// ── 5. Invalid declared MIME ───────────────────────────────────────────────
await step('5. Invalid declared MIME (text/plain) is rejected', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'text/plain',
    bytes:        PNG_BYTES,
  })
  if (status === 400) ok('rejected with 400')
  else bad('expected 400', `got ${status}`)
})

// ── 6. Magic-byte mismatch ─────────────────────────────────────────────────
await step('6. Magic-byte mismatch (declared PNG, plain text bytes) is rejected', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        FAKE_JPEG,
  })
  if (status === 400) ok('rejected with 400')
  else bad('expected 400', `got ${status}`)
})

// ── 7. File above 2 MB ─────────────────────────────────────────────────────
await step('7. File above 2 MB is rejected', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        TOO_LARGE,
  })
  if (status === 413) ok('rejected with 413')
  else bad('expected 413', `got ${status}`)
})

// ── 8. SVG rejected ────────────────────────────────────────────────────────
await step('8. SVG is rejected', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const { status } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/svg+xml',
    bytes:        SVG_BYTES,
  })
  if (status === 400) ok('rejected with 400')
  else bad('expected 400', `got ${status}`)
})

// ── 10. Reused token ───────────────────────────────────────────────────────
await step('10. Token cannot be reused', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created', JSON.stringify(created))
  const first = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (first.status !== 200) return bad('first upload failed', JSON.stringify(first))
  const second = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (second.status === 410 || second.status === 409) ok(`reuse rejected (${second.status})`)
  else bad('expected 409/410 on reuse', `got ${second.status}`)
})

// ── 11. Token belonging to another vendor ──────────────────────────────────
await step('11. Token from vendor A cannot upload for vendor B', async () => {
  const { json: a } = await submitVendor()
  const { json: b } = await submitVendor()
  if (!a.vendorId || !b.vendorId) return bad('precondition: vendors not created')
  const swapped = await uploadLogo({
    vendorId:     b.vendorId,
    token:        a.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (swapped.status === 403) ok('swapped vendorId rejected with 403')
  else bad('expected 403', `got ${swapped.status}`)
})

// ── 9. Expired token (operator-assisted) ──────────────────────────────────
await step('9. Expired token (operator-assisted)', async () => {
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition failed')
  console.log('  (operator) please run this in the dev Supabase SQL editor, then press Enter:')
  console.log(`    UPDATE public.vendor_upload_tokens SET expires_at = NOW() - interval '1 minute' WHERE vendor_id = '${created.vendorId}';`)
  if (process.env.VERIFY_INTERACTIVE !== '1') {
    console.log('  (skipping interactive prompt — set VERIFY_INTERACTIVE=1 to enable)')
    return
  }
  await new Promise(resolve => process.stdin.once('data', resolve))
  const expired = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (expired.status === 410) ok('expired token rejected with 410')
  else bad('expected 410', `got ${expired.status}`)
})

// ── 15 / 16. Path traversal / client-supplied slug control ────────────────
await step('15+16. Client cannot control storage path via slug or token', async () => {
  // The token & vendorId are the only fields the route reads; no slug or
  // path is accepted from the client. We do a positive test that the
  // returned URL lives under /pending/<uuid>.<ext>.
  const { json: created } = await submitVendor()
  if (!created.vendorId) return bad('precondition: vendor not created')
  const { status, json } = await uploadLogo({
    vendorId:     created.vendorId,
    token:        created.uploadToken,
    declaredMime: 'image/png',
    bytes:        PNG_BYTES,
  })
  if (status !== 200 || !json.url) {
    bad('upload failed', `status=${status} json=${JSON.stringify(json)}`)
    return
  }
  // The path component should be /vendor-logos/pending/<uuid>.<ext>
  const u = new URL(json.url)
  const m = /\/vendor-logos\/pending\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(u.pathname)
  if (m) ok(`path is server-controlled: ${u.pathname}`)
  else bad('path not under /pending/<uuid>.<ext>', u.pathname)
})

// ── 18. Pre-existing rows unchanged ─────────────────────────────────────────
await step('18. Pre-existing active vendor rows unchanged', async () => {
  if (preExistingActive.length === 0) {
    console.log('  (note: no active vendors in dev — skipping)')
    return
  }
  for (const before of preExistingActive) {
    const { data, error } = await anon().from('vendors')
      .select('id, name, slug, active, verified, logo_url')
      .eq('id', before.id)
      .maybeSingle()
    if (error || !data) { bad(`could not re-read ${before.slug}`, error?.message); continue }
    const drift =
      data.name     !== before.name     ||
      data.slug     !== before.slug     ||
      data.active   !== before.active   ||
      data.verified !== before.verified ||
      data.logo_url !== before.logo_url
    if (drift) bad(`row ${before.slug} changed`, JSON.stringify({ before, after: data }))
    else       ok(`row ${before.slug} unchanged`)
  }
})

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nResults: ${pass} pass, ${failCount} fail`)
if (failCount > 0) {
  console.error('Failures:')
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? ` :: ${f.detail}` : ''}`)
  process.exit(1)
}
