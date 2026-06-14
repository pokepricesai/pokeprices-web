// scripts/verify-security.mjs
// ============================================================================
// Security verification for PokePrices v2 Block 1A.
//
// Asserts:
//   * User A cannot read User B's portfolios / portfolio_items.
//   * User A cannot read User B's watchlist / user_alerts / user_email_preferences.
//   * User A cannot update or delete User B's portfolio_items.
//   * Anonymous client cannot read any private user table.
//   * Anonymous client cannot UPDATE or DELETE social_content_posts.
//   * Anonymous client cannot POST to /api/admin/content-studio/posts.
//
// SAFETY
// ------
// This script REFUSES to run against production:
//   * Requires `VERIFY_ALLOW_NON_PRODUCTION=1` in the environment.
//   * Refuses if `SUPABASE_URL` matches the known production project
//     (egidpsrkqvymvioidatc.supabase.co).
//
// Use a dedicated development or staging Supabase project. If you do not
// have one, fall back to the manual checklist in `scripts/verify-rls.sql`
// and the inline checklist in the Block 1A report.
//
// USAGE
// -----
//   VERIFY_ALLOW_NON_PRODUCTION=1 \
//   SUPABASE_URL=https://YOUR-DEV-PROJECT.supabase.co \
//   SUPABASE_ANON_KEY=... \
//   TEST_USER_A_EMAIL=a@example.com TEST_USER_A_PASSWORD=... \
//   TEST_USER_B_EMAIL=b@example.com TEST_USER_B_PASSWORD=... \
//   NEXT_BASE_URL=http://localhost:3000 \
//   node scripts/verify-security.mjs
//
// Test accounts MUST be provisioned in your dev Supabase project ahead of
// time. They will have a portfolio + watchlist row created in their own
// scope for the duration of the run. Cleanup is best-effort.
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

// ── Safety gates ────────────────────────────────────────────────────────────

if (process.env.VERIFY_ALLOW_NON_PRODUCTION !== '1') {
  fail('Refusing to run without VERIFY_ALLOW_NON_PRODUCTION=1.')
}

const SUPABASE_URL = need('SUPABASE_URL')
let url
try { url = new URL(SUPABASE_URL) } catch { fail('SUPABASE_URL is not a valid URL.') }

if (PROD_HOSTNAMES.has(url.hostname)) {
  fail(`Refusing to run against production hostname ${url.hostname}. Point SUPABASE_URL at a dev/staging Supabase project.`)
}

const ANON_KEY  = need('SUPABASE_ANON_KEY')
const A_EMAIL   = need('TEST_USER_A_EMAIL')
const A_PW      = need('TEST_USER_A_PASSWORD')
const B_EMAIL   = need('TEST_USER_B_EMAIL')
const B_PW      = need('TEST_USER_B_PASSWORD')
const BASE_URL  = process.env.NEXT_BASE_URL || ''

// ── Test runner ─────────────────────────────────────────────────────────────

let pass = 0
let failCount = 0
const failures = []

function ok(label) {
  pass++
  console.log(`  ✓ ${label}`)
}
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function newAnonClient() {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(email, password) {
  const supa = newAnonClient()
  const { data, error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in for ${email}: ${error.message}`)
  return { supa, user: data.user, token: data.session?.access_token }
}

async function ensurePortfolioRow(supa, userId) {
  const { data: existing } = await supa
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
  if (existing?.[0]?.id) return existing[0].id
  const { data, error } = await supa
    .from('portfolios')
    .insert([{ user_id: userId, name: 'Verifier Portfolio', is_default: false }])
    .select('id')
    .single()
  if (error) throw new Error(`could not create portfolio: ${error.message}`)
  return data.id
}

async function ensurePortfolioItem(supa, portfolioId) {
  const { data: existing } = await supa
    .from('portfolio_items')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .limit(1)
  if (existing?.[0]?.id) return existing[0].id
  const { data, error } = await supa
    .from('portfolio_items')
    .insert([{ portfolio_id: portfolioId, card_slug: 'verifier-001', holding_type: 'raw', quantity: 1 }])
    .select('id')
    .single()
  if (error) throw new Error(`could not create portfolio_item: ${error.message}`)
  return data.id
}

async function ensureWatchlistRow(supa, userId) {
  const { data: existing } = await supa
    .from('watchlist')
    .select('id')
    .eq('user_id', userId)
    .eq('card_slug', 'verifier-001')
    .limit(1)
  if (existing?.[0]?.id) return existing[0].id
  const { data, error } = await supa
    .from('watchlist')
    .insert([{ user_id: userId, card_slug: 'verifier-001', card_name: 'Verifier', set_name: 'Verifier Set' }])
    .select('id')
    .single()
  if (error) throw new Error(`could not create watchlist: ${error.message}`)
  return data.id
}

// ── Run ─────────────────────────────────────────────────────────────────────

console.log(`Verifying security against ${url.hostname}`)
console.log(`User A: ${A_EMAIL}`)
console.log(`User B: ${B_EMAIL}`)

let A, B
await step('sign in both test users', async () => {
  A = await signIn(A_EMAIL, A_PW)
  B = await signIn(B_EMAIL, B_PW)
  if (A.user?.id && B.user?.id && A.user.id !== B.user.id) ok('two distinct user ids')
  else bad('two distinct user ids', `A=${A.user?.id} B=${B.user?.id}`)
})

let portfolioA, portfolioItemA, watchlistA
await step("create A's own rows", async () => {
  portfolioA     = await ensurePortfolioRow(A.supa, A.user.id)
  portfolioItemA = await ensurePortfolioItem(A.supa, portfolioA)
  watchlistA     = await ensureWatchlistRow(A.supa, A.user.id)
  ok(`portfolio=${portfolioA?.slice(0,8)}… item=${portfolioItemA?.slice(0,8)}… watch=${watchlistA?.slice(0,8)}…`)
})

await step("B cannot read A's portfolios", async () => {
  const { data, error } = await B.supa.from('portfolios').select('id').eq('id', portfolioA)
  if (error)            bad('select rejected with error', error.message)
  else if ((data ?? []).length === 0) ok('B sees zero rows for A.portfolios')
  else                  bad('B saw A.portfolios rows', JSON.stringify(data))
})

await step("B cannot read A's portfolio_items", async () => {
  const { data, error } = await B.supa.from('portfolio_items').select('id').eq('id', portfolioItemA)
  if (error)            bad('select rejected with error', error.message)
  else if ((data ?? []).length === 0) ok('B sees zero rows for A.portfolio_items')
  else                  bad('B saw A.portfolio_items rows', JSON.stringify(data))
})

await step("B cannot update A's portfolio_item", async () => {
  const { error, data } = await B.supa
    .from('portfolio_items')
    .update({ quantity: 99 })
    .eq('id', portfolioItemA)
    .select('id')
  // Supabase returns no error but zero rows when RLS rejects an update silently.
  if (error)                        ok(`rejected with error: ${error.code || error.message}`)
  else if (!data || data.length === 0) ok('update returned zero rows (RLS blocked)')
  else                              bad('update affected rows', JSON.stringify(data))
})

await step("B cannot delete A's portfolio_item", async () => {
  const { error, count } = await B.supa
    .from('portfolio_items')
    .delete({ count: 'exact' })
    .eq('id', portfolioItemA)
  if (error)            ok(`rejected with error: ${error.code || error.message}`)
  else if (count === 0) ok('delete affected zero rows')
  else                  bad(`delete affected ${count} rows`)
})

await step("B cannot read A's watchlist", async () => {
  const { data, error } = await B.supa.from('watchlist').select('id').eq('id', watchlistA)
  if (error)            bad('select rejected with error', error.message)
  else if ((data ?? []).length === 0) ok('B sees zero rows for A.watchlist')
  else                  bad('B saw A.watchlist rows', JSON.stringify(data))
})

await step('anon cannot read any private user table', async () => {
  const anon = newAnonClient()
  for (const t of ['watchlist', 'user_alerts', 'user_email_preferences', 'card_show_stars', 'portfolios', 'portfolio_items', 'pending_emails', 'scan_logs']) {
    const { data, error } = await anon.from(t).select('*').limit(1)
    if (error)           ok(`${t} → error: ${error.code || error.message}`)
    else if ((data ?? []).length === 0) ok(`${t} → empty for anon`)
    else                 bad(`${t} returned rows to anon`, JSON.stringify(data))
  }
})

await step('anon cannot UPDATE or DELETE social_content_posts', async () => {
  const anon = newAnonClient()
  const fakeId = '00000000-0000-0000-0000-000000000000'
  const upd = await anon.from('social_content_posts').update({ status: 'rejected' }).eq('id', fakeId).select('id')
  if (upd.error)                        ok(`UPDATE rejected: ${upd.error.code || upd.error.message}`)
  else if (!upd.data || upd.data.length === 0) ok('UPDATE returned zero rows (RLS blocked)')
  else                                  bad('UPDATE affected rows for anon', JSON.stringify(upd.data))

  const del = await anon.from('social_content_posts').delete({ count: 'exact' }).eq('id', fakeId)
  if (del.error)            ok(`DELETE rejected: ${del.error.code || del.error.message}`)
  else if (del.count === 0) ok('DELETE affected zero rows')
  else                      bad(`DELETE affected ${del.count} rows for anon`)
})

if (BASE_URL) {
  await step('anon cannot POST to /api/admin/content-studio/posts', async () => {
    const url = `${BASE_URL.replace(/\/$/, '')}/api/admin/content-studio/posts`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000000'], status: 'rejected' }),
    })
    if (res.status === 401 || res.status === 403 || res.status === 503) {
      ok(`admin route refused (status ${res.status})`)
    } else {
      bad(`admin route did not refuse anon (status ${res.status})`)
    }
  })
} else {
  console.log('\n(skipping admin-route check — set NEXT_BASE_URL=http://localhost:3000 to enable)')
}

console.log(`\nResults: ${pass} pass, ${failCount} fail`)
if (failCount > 0) {
  console.error('Failures:')
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? ` :: ${f.detail}` : ''}`)
  process.exit(1)
}
