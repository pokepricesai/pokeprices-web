// PP-TCG-PUBLIC-PILOT-03 — admin tooling for the controlled 13-card
// Group A expansion plus per-card rollback. Hard-locked to slugs that
// exist as rows in pokemon_tcg_pilot_cohort — that table is the
// allowlist, mutated only by DB migrations, so this page cannot be
// repurposed to activate anything outside the pilot cohort.
//
// What it DOES:
//   * Lists all 18 pilot cohort rows with current flag state.
//   * Preset-button activation for the 3 representatives + two
//     5-card Group A batches, one click per batch.
//   * Per-slug "Deactivate" and "Rollback round-trip" dropdowns for
//     any pilot slug the operator wants to verify independently.
//
// What it does NOT:
//   * Accept any slug outside the cohort table.
//   * Mutate images/history/currency flags — those stay OFF
//     everywhere.
//   * Create new revalidation endpoints — reuses the existing
//     authenticated POST /api/admin/pilot/revalidate with the
//     signed-in admin's own session JWT.
//   * Expose anything to the browser bundle — all logic is in
//     server components + Server Actions, service-role Supabase is
//     `import 'server-only'`.
//
// Flow for activation (per selected slug, sequential within one
// server action invocation):
//   1. Verify slug is in the pilot cohort table.
//   2. flipCohort(slug, true)                  — DB mutation only.
//   3. POST /api/admin/pilot/revalidate         — admin JWT.
//   4. Poll pilot URL up to N × 2s until provider-active.
//   5. Capture evidence (cache status, age, HTML signals).
//
// Deactivate + rollback mirror the shape above.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// PP-TCG-500-PREP correction §A — explicit function duration; defends
// against any plan-level default change. Batch size is 5 so a single
// Server Action can accommodate BOTH activation (up to 5 × 22 s ≈
// 110 s) AND worst-case batch-level restoration (another 5 × 22 s ≈
// 110 s) within the 300 s function limit, with ~80 s headroom.
export const maxDuration = 300
export const metadata = {
  title: 'Pilot batch control',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}

const ADMIN_PAGE_PATH    = '/admin/pilot/batch'
const REVALIDATE_ENDPOINT = 'https://www.pokeprices.io/api/admin/pilot/revalidate'
const POLL_MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS  = 2000

// Preset batches — matches PP-TCG-PUBLIC-PILOT-03 ticket.
const PRESET_REPS   = ['12368556', '889380', '3449535']
const PRESET_BATCH2 = ['12368493', '13025625', '11830160', '13025579', '11197498']
const PRESET_BATCH3 = ['5732710', '6770012', '849472', '7445267', '5952701']
// Explicitly excluded thin-data cards (Group B — not activated in this ticket).
const THIN_DATA = new Set(['2677929', '3468740', '6903541', '6903528'])

// PP-TCG-500-PREP correction §A — staged-marker scope.
// Rows inserted by scripts/_pp03/stage-348-insert.mjs carry this prefix
// in `notes`. Every PP-TCG-500-PREP action restricts itself to rows
// matching this prefix. The 14 live cards + 4 thin cards use a different
// notes string ('pilot cohort proposal · ...') and are invisible to
// expansion-only operations as a data-level invariant.
const EXPANSION_NOTES_PREFIX = 'PP-TCG-500-PREP · GSC-ranked'
// PP-TCG-500-PREP final correction — reduced from 10 to 5 so a single
// Server Action can hold BOTH worst-case activation (up to 5 × 22 s)
// AND worst-case restore-on-failure (another 5 × 22 s) inside the
// 300 s function limit. At 10 cards the activate+restore worst case
// would be ~440 s, risking a timeout mid-restore.
const EXPANSION_BATCH_SIZE = 5
// Hard block: these slugs can never flow through expansion operations
// even if a future row somehow carried the expansion marker.
const EXPANSION_HARD_BLOCK = THIN_DATA

type ProbeAttempt = {
  attempt: number
  elapsed_ms: number
  status: number
  cache: string | null
  age: string | null
  provider_active: boolean
  has_marketplace_panel: boolean
  grade_ladder_has_psa10: boolean
  faq_mentions_tcggraph: boolean
  faq_snip: string
}

type SlugResult = {
  slug: string
  url: string
  action: 'activate' | 'deactivate' | 'rollback'
  pre_cohort: unknown
  post_cohort: unknown
  revalidate_responses: Array<{ status: number; body: string }>
  polls: ProbeAttempt[]
  content_as_expected: boolean
  ok: boolean
  detail: string
}

type RollbackResult = {
  slug: string
  pre_prices_enabled: boolean | null
  target_prices_enabled: boolean | null
  cohort_restore_ok: boolean
  revalidate_responses: Array<{ status: number; body: string }>
  polls: ProbeAttempt[]
  verified: boolean
  detail: string
}

type BatchOutcome = {
  started_at: string
  action: 'activate' | 'deactivate' | 'rollback'
  slugs_requested: string[]
  per_slug: SlugResult[]
  // Non-null ONLY when a failure occurred. Contains one entry per
  // card the batch mutated (even the one that triggered the failure),
  // restored to its pre-batch prices_enabled value with public HTML
  // re-verified. verified=false here means a card did not come back
  // to its original rendering within the poll budget — flagged
  // explicitly so the operator can intervene.
  rollback_on_failure: RollbackResult[] | null
  verdict: 'PASS' | 'FAIL'
}

async function urlForSlug(sb: ReturnType<typeof getSupabaseServiceClient>, slug: string): Promise<string | null> {
  const { data } = await sb.from('cards').select('set_name,card_url_slug,card_slug').eq('card_slug', slug).maybeSingle()
  if (!data?.set_name) return null
  const urlSlug = data.card_url_slug ?? data.card_slug ?? slug
  return `https://www.pokeprices.io/set/${encodeURIComponent(String(data.set_name))}/card/${encodeURIComponent(String(urlSlug))}`
}

async function probe(url: string, attempt: number, started_at: number): Promise<ProbeAttempt> {
  const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  const body = await res.text()
  const faq = body.match(/currently reads([^"]{0,200})/)?.[1] ?? ''
  const psa9InFaq = /PSA\s*9:/i.test(faq)
  const psa7MutedDash = /PSA\s*7<\/div><div[^>]*color:var\(--border\)[^>]*>—<\/div>/i.test(body)
  const hasMarketplacePanel = /Marketplace Snapshots/.test(body)
  const faqMentionsTcggraph = /TCGGraph.{0,10}realised-sale aggregation/i.test(body)
  // Grade ladder psa10 value present + not em-dash.
  // We can't fully parse without a DOM, but the admin page's provider
  // mode populates `psa10_usd` which the ladder renders as $X.YY on
  // the PSA 10 row.
  const gradeLadderHasPsa10 = /PSA\s*10<\/div>[\s\S]{0,400}>\$\d/.test(body)
  const provider_active = (faq.length > 0 && !psa9InFaq) || psa7MutedDash || hasMarketplacePanel
  return {
    attempt,
    elapsed_ms: Date.now() - started_at,
    status: res.status,
    cache: res.headers.get('x-vercel-cache'),
    age:   res.headers.get('age'),
    provider_active,
    has_marketplace_panel: hasMarketplacePanel,
    grade_ladder_has_psa10: gradeLadderHasPsa10,
    faq_mentions_tcggraph: faqMentionsTcggraph,
    faq_snip: faq.slice(0, 120).trim(),
  }
}

async function pollUntil(url: string, expected: boolean): Promise<ProbeAttempt[]> {
  const polls: ProbeAttempt[] = []
  const started = Date.now()
  for (let i = 1; i <= POLL_MAX_ATTEMPTS; i++) {
    const p = await probe(url, i, started)
    polls.push(p)
    if (p.provider_active === expected) return polls
    if (i < POLL_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return polls
}

async function callRevalidate(adminJwt: string, slug: string) {
  const res = await fetch(REVALIDATE_ENDPOINT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pp_card_slugs: [slug] }),
  })
  return { status: res.status, body: (await res.text()).slice(0, 300) }
}

async function flipCohort(sb: ReturnType<typeof getSupabaseServiceClient>, slug: string, prices_enabled: boolean): Promise<unknown> {
  const now = new Date().toISOString()
  const patch = prices_enabled
    ? { prices_enabled: true, deactivated_at: null, activated_at: now, updated_at: now }
    : { prices_enabled: false, deactivated_at: now, updated_at: now }
  const { data, error } = await sb.from('pokemon_tcg_pilot_cohort')
    .update(patch).eq('pp_card_slug', slug).select().maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

async function runBatch(action: 'activate' | 'deactivate' | 'rollback', slugs: string[]): Promise<BatchOutcome> {
  'use server'
  await requireAdminPage(ADMIN_PAGE_PATH)
  const sb = getSupabaseServiceClient()

  // Allowlist: must be a current pilot cohort row.
  const { data: cohortRows } = await sb.from('pokemon_tcg_pilot_cohort').select('pp_card_slug')
  const allowed = new Set((cohortRows ?? []).map(r => r.pp_card_slug))
  const rejected = slugs.filter(s => !allowed.has(s))
  if (rejected.length > 0) {
    return {
      started_at: new Date().toISOString(),
      action,
      slugs_requested: slugs,
      per_slug: rejected.map(s => ({
        slug: s, url: '', action,
        pre_cohort: null, post_cohort: null, revalidate_responses: [], polls: [],
        content_as_expected: false, ok: false, detail: 'slug not in pilot cohort allowlist',
      })),
      rollback_on_failure: null,
      verdict: 'FAIL',
    }
  }

  const supa = await getSupabaseServerClient()
  const { data: sessData } = await supa.auth.getSession()
  const adminJwt = sessData?.session?.access_token
  if (!adminJwt) {
    return {
      started_at: new Date().toISOString(),
      action, slugs_requested: slugs, per_slug: [],
      rollback_on_failure: null, verdict: 'FAIL',
    }
  }

  // Track every slug whose cohort row this batch has mutated so a
  // failure anywhere can restore ALL of them to pre-batch state —
  // including the one that triggered the failure. We only push to
  // `mutated` AFTER a flip has actually been attempted.
  const mutated: Array<{ slug: string; pre_prices_enabled: boolean | null; url: string }> = []
  const per_slug: SlugResult[] = []
  let anyFailure = false

  for (const slug of slugs) {
    const url = await urlForSlug(sb, slug)
    if (!url) {
      per_slug.push({
        slug, url: '', action, pre_cohort: null, post_cohort: null,
        revalidate_responses: [], polls: [],
        content_as_expected: false, ok: false,
        detail: 'url resolution failed (cards table lookup) — no cohort mutation attempted',
      })
      anyFailure = true
      break
    }

    const { data: pre } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled,images_enabled,history_enabled,activated_at,deactivated_at')
      .eq('pp_card_slug', slug).maybeSingle()
    const prePrices: boolean | null = (pre as { prices_enabled?: boolean | null } | null)?.prices_enabled ?? null

    const rvResponses: Array<{ status: number; body: string }> = []
    const polls: ProbeAttempt[] = []
    let flipAttempted = false

    try {
      if (action === 'activate') {
        await flipCohort(sb, slug, true); flipAttempted = true
        mutated.push({ slug, pre_prices_enabled: prePrices, url })
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, true)))
      } else if (action === 'deactivate') {
        await flipCohort(sb, slug, false); flipAttempted = true
        mutated.push({ slug, pre_prices_enabled: prePrices, url })
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, false)))
      } else {
        // rollback cycle (OFF → verify legacy → ON → verify active)
        await flipCohort(sb, slug, false); flipAttempted = true
        mutated.push({ slug, pre_prices_enabled: prePrices, url })
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, false)))
        await flipCohort(sb, slug, true)
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, true)))
      }
    } catch (e) {
      // No post-hoc force-flip here — the batch-level restore pass
      // below handles reverting any touched cohort rows to their
      // ORIGINAL prices_enabled values.
      per_slug.push({
        slug, url, action, pre_cohort: pre, post_cohort: null,
        revalidate_responses: rvResponses, polls,
        content_as_expected: false, ok: false,
        detail: `error after flipAttempted=${flipAttempted}: ${(e as Error).message}`,
      })
      anyFailure = true
      break
    }

    const { data: post } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled,images_enabled,history_enabled,activated_at,deactivated_at')
      .eq('pp_card_slug', slug).maybeSingle()

    const expected = action === 'deactivate' ? false : true
    const lastProbe = polls[polls.length - 1]
    const content_as_expected = !!lastProbe && lastProbe.provider_active === expected
    per_slug.push({
      slug, url, action, pre_cohort: pre, post_cohort: post,
      revalidate_responses: rvResponses, polls,
      content_as_expected, ok: content_as_expected,
      detail: content_as_expected ? 'public HTML matches expected post-action state' : 'public HTML did not transition within poll budget',
    })
    if (!content_as_expected) {
      anyFailure = true
      break
    }
  }

  // Batch-level restore pass — ONLY runs if a failure occurred. For
  // every card this batch mutated (including the one that failed),
  // flip prices_enabled back to its pre-batch value, revalidate, and
  // poll the public URL until it matches the pre-batch rendering.
  // Each card's restore is reported individually; verified=false
  // means the public HTML did not come back within the poll budget
  // and the operator needs to intervene.
  let rollback_on_failure: RollbackResult[] | null = null
  if (anyFailure && mutated.length > 0) {
    rollback_on_failure = []
    for (const m of mutated) {
      const target = m.pre_prices_enabled
      const rvs: Array<{ status: number; body: string }> = []
      const rps: ProbeAttempt[] = []
      let cohort_restore_ok = false
      let detail = ''
      try {
        if (target === true || target === false) {
          await flipCohort(sb, m.slug, target)
          cohort_restore_ok = true
        } else {
          detail = 'pre-batch prices_enabled was null (no cohort row read) — cohort row NOT re-written'
        }
        rvs.push(await callRevalidate(adminJwt, m.slug))
        rps.push(...(await pollUntil(m.url, target === true)))
      } catch (e) {
        detail = `restore error: ${(e as Error).message}`
      }
      const last = rps[rps.length - 1]
      const verified = cohort_restore_ok && !!last && last.provider_active === (target === true)
      if (!detail) {
        detail = verified
          ? 'original public rendering restored'
          : 'cohort row flipped back but public HTML did NOT restore within poll budget — operator intervention needed'
      }
      rollback_on_failure.push({
        slug: m.slug,
        pre_prices_enabled: target,
        target_prices_enabled: target,
        cohort_restore_ok,
        revalidate_responses: rvs,
        polls: rps,
        verified,
        detail,
      })
    }
  }

  return {
    started_at: new Date().toISOString(),
    action,
    slugs_requested: slugs,
    per_slug,
    rollback_on_failure,
    verdict: anyFailure ? 'FAIL' : 'PASS',
  }
}

// ─────────────────────────────────────────────────────────────────────
// PP-TCG-500-PREP correction §A — expansion selector + emergency ops
// ─────────────────────────────────────────────────────────────────────

type ExpansionCandidate = {
  pp_card_slug: string
  gsc_rank: number | null
  outcome: string
  risk_class: string
  confidence: string
  review_status: string
  printing_active_status: string
  has_image: boolean
  has_market_prices: boolean
  has_graded_prices: boolean
  effective_eligibility: string
}

type ExpansionSelection = {
  slugs: string[]
  rejected: Array<{ slug: string; reason: string }>
  errors: string[]
  staged_total: number
  staged_still_available: number
}

/** PP-TCG-500-PREP §A: pick the next N expansion candidates.
 *
 * Rules:
 *   - Only rows with notes starting with EXPANSION_NOTES_PREFIX AND
 *     prices_enabled=false AND NOT in EXPANSION_HARD_BLOCK.
 *   - Re-check each candidate against the strict provider-safe filter
 *     at the moment of click (the live DB may have changed since
 *     staging).
 *   - After all re-checks, sort GLOBALLY by gsc_rank ascending, then
 *     take the first N. This is the fix for the earlier chunk-local
 *     sort bug.
 *   - DB errors are surfaced explicitly in `errors[]` so the operator
 *     sees them rather than silently fewer candidates.
 */
async function selectNextExpansionBatch(
  sb: ReturnType<typeof getSupabaseServiceClient>,
  size: number,
): Promise<ExpansionSelection> {
  const errors: string[] = []
  // (1) Pull every staged row for this expansion ticket.
  const { data: stagedRaw, error: stagedErr } = await sb
    .from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,notes,prices_enabled')
    .eq('prices_enabled', false)
    .like('notes', `${EXPANSION_NOTES_PREFIX}%`)
  if (stagedErr) {
    errors.push(`staged read: ${stagedErr.message}`)
    return { slugs: [], rejected: [], errors, staged_total: 0, staged_still_available: 0 }
  }
  const stagedSlugs = (stagedRaw ?? [])
    .map(r => r.pp_card_slug as string)
    .filter(s => !EXPANSION_HARD_BLOCK.has(s))
  const staged_total = stagedSlugs.length
  if (staged_total === 0) return { slugs: [], rejected: [], errors, staged_total, staged_still_available: 0 }

  // (2) Re-check against strict filter — fetch in chunks because of
  //     PostgREST's URL-length cap on IN clauses.
  const rechecked: ExpansionCandidate[] = []
  for (let i = 0; i < stagedSlugs.length; i += 100) {
    const chunk = stagedSlugs.slice(i, i + 100)
    const { data, error } = await sb
      .from('v_pp_tcg_card_reconciliation')
      .select('pp_card_slug,outcome,risk_class,confidence,review_status,printing_active_status,has_image,has_market_prices,has_graded_prices,effective_eligibility,gsc_rank')
      .in('pp_card_slug', chunk)
    if (error) {
      errors.push(`reconciliation chunk ${i}: ${error.message}`)
      // Don't silently drop candidates — surface the error and skip this chunk.
      continue
    }
    if (data) rechecked.push(...(data as ExpansionCandidate[]))
  }

  // (3) GLOBAL sort by gsc_rank ASC. Rows missing gsc_rank sink to the
  //     end (shouldn't happen since staging requires gsc_rank, but
  //     defensive). This is the correction over the earlier draft that
  //     sorted within each chunk.
  rechecked.sort((a, b) => (a.gsc_rank ?? Number.MAX_SAFE_INTEGER) - (b.gsc_rank ?? Number.MAX_SAFE_INTEGER))

  // (4) Apply strict filter, in global rank order, until we have N.
  const slugs: string[] = []
  const rejected: Array<{ slug: string; reason: string }> = []
  for (const r of rechecked) {
    if (slugs.length >= size) break
    if (r.outcome !== 'approved_active')             { rejected.push({ slug: r.pp_card_slug, reason: `outcome=${r.outcome}` });              continue }
    if (r.risk_class !== 'catalogue_corroborated')   { rejected.push({ slug: r.pp_card_slug, reason: `risk=${r.risk_class}` });                continue }
    if (r.confidence !== 'verified')                 { rejected.push({ slug: r.pp_card_slug, reason: `conf=${r.confidence}` });                continue }
    if (r.review_status !== 'approved')              { rejected.push({ slug: r.pp_card_slug, reason: `review=${r.review_status}` });           continue }
    if (r.printing_active_status !== 'active')       { rejected.push({ slug: r.pp_card_slug, reason: `printing=${r.printing_active_status}` }); continue }
    if (!r.has_image || !r.has_market_prices || !r.has_graded_prices) { rejected.push({ slug: r.pp_card_slug, reason: 'missing_asset' });     continue }
    if (!['bulk_safe','market_only'].includes(r.effective_eligibility)) { rejected.push({ slug: r.pp_card_slug, reason: `elig=${r.effective_eligibility}` }); continue }
    slugs.push(r.pp_card_slug)
  }
  const staged_still_available = rechecked.length - rejected.length
  return { slugs, rejected, errors, staged_total, staged_still_available }
}

// ─────────────────────────────────────────────────────────────────────
// Emergency rollback — DEDICATED. Does NOT share runBatch's restore-on-
// failure semantics (which would be inappropriate for a kill switch).
//
// Split into two separate server actions so operator can run each
// independently and resume:
//   1. emergencyDisableExpansion — one bulk UPDATE on cohort rows
//      matching the expansion marker AND prices_enabled=true. Atomic.
//      Never re-enables anything. 14 live cards are protected by data
//      because their notes don't start with EXPANSION_NOTES_PREFIX.
//   2. revalidateExpansionPending — iterates up to N slugs whose
//      updated_at == deactivated_at (never revalidated after disable)
//      and submits each to the admin revalidate endpoint. On success
//      bumps updated_at above deactivated_at. On failure LEAVES the
//      row in the pending state so a re-click retries it. Does NOT
//      auto-re-enable prices.
// ─────────────────────────────────────────────────────────────────────

type EmergencyDisableReport = {
  started_at: string
  rows_matched: number
  rows_affected: number
  slugs: string[]
  error: string | null
}

type RevalidatePendingReport = {
  started_at: string
  pending_before: number
  attempted: number
  succeeded: Array<{ slug: string; revalidated_at: string }>
  failed: Array<{ slug: string; reason: string }>
  pending_after: number
}

const REVAL_BATCH_SIZE = 10

async function emergencyDisableExpansion(): Promise<EmergencyDisableReport> {
  'use server'
  await requireAdminPage(ADMIN_PAGE_PATH)
  const sb = getSupabaseServiceClient()
  const started_at = new Date().toISOString()
  // Pre-select to count + report the affected slug set
  const { data: before, error: beforeErr } = await sb
    .from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug')
    .eq('prices_enabled', true)
    .like('notes', `${EXPANSION_NOTES_PREFIX}%`)
  if (beforeErr) {
    return { started_at, rows_matched: 0, rows_affected: 0, slugs: [], error: `select: ${beforeErr.message}` }
  }
  const matchedSlugs = (before ?? []).map(r => r.pp_card_slug as string).filter(s => !EXPANSION_HARD_BLOCK.has(s))
  const rows_matched = matchedSlugs.length
  if (rows_matched === 0) {
    return { started_at, rows_matched: 0, rows_affected: 0, slugs: [], error: null }
  }
  // Bulk UPDATE: set prices_enabled=false, deactivated_at=now(),
  // updated_at=now(). The equality of deactivated_at and updated_at
  // after this is the "pending revalidation" marker used by step 2.
  // Scope: expansion-marker rows ONLY. The 14 live cards have
  // different notes and are not matched.
  const now = new Date().toISOString()
  const { data: affected, error: upErr } = await sb
    .from('pokemon_tcg_pilot_cohort')
    .update({ prices_enabled: false, deactivated_at: now, updated_at: now })
    .eq('prices_enabled', true)
    .like('notes', `${EXPANSION_NOTES_PREFIX}%`)
    .select('pp_card_slug')
  if (upErr) {
    return { started_at, rows_matched, rows_affected: 0, slugs: [], error: `update: ${upErr.message}` }
  }
  const affectedSlugs = (affected ?? []).map(r => r.pp_card_slug as string)
  return { started_at, rows_matched, rows_affected: affectedSlugs.length, slugs: affectedSlugs, error: null }
}

async function revalidateExpansionPending(): Promise<RevalidatePendingReport> {
  'use server'
  await requireAdminPage(ADMIN_PAGE_PATH)
  const sb = getSupabaseServiceClient()
  const supa = await getSupabaseServerClient()
  const { data: sessData } = await supa.auth.getSession()
  const adminJwt = sessData?.session?.access_token
  const started_at = new Date().toISOString()
  // Pending list: deactivated_at IS NOT NULL AND updated_at <= deactivated_at
  // (the bulk disable set them equal; successful revalidation bumps
  // updated_at above deactivated_at so the row drops out of pending).
  //
  // PostgREST filter: `.eq('updated_at', 'deactivated_at')` isn't supported
  // directly; we fetch pending candidates (prices_enabled=false, marker,
  // deactivated_at not null) and filter client-side on the timestamps.
  const { data: candidates, error: candErr } = await sb
    .from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,deactivated_at,updated_at,notes')
    .eq('prices_enabled', false)
    .not('deactivated_at', 'is', null)
    .like('notes', `${EXPANSION_NOTES_PREFIX}%`)
  if (candErr) {
    return { started_at, pending_before: 0, attempted: 0, succeeded: [], failed: [{ slug: '*', reason: `select: ${candErr.message}` }], pending_after: 0 }
  }
  const pending = (candidates ?? [])
    .filter(r => r.deactivated_at && r.updated_at && new Date(r.updated_at as string).getTime() <= new Date(r.deactivated_at as string).getTime())
    .filter(r => !EXPANSION_HARD_BLOCK.has(r.pp_card_slug as string))
  const pending_before = pending.length
  if (pending_before === 0) {
    return { started_at, pending_before: 0, attempted: 0, succeeded: [], failed: [], pending_after: 0 }
  }
  if (!adminJwt) {
    return { started_at, pending_before, attempted: 0, succeeded: [], failed: [{ slug: '*', reason: 'no admin session JWT' }], pending_after: pending_before }
  }

  const batch = pending.slice(0, REVAL_BATCH_SIZE)
  const succeeded: Array<{ slug: string; revalidated_at: string }> = []
  const failed: Array<{ slug: string; reason: string }> = []
  for (const row of batch) {
    const slug = row.pp_card_slug as string
    let rvOk = false
    try {
      const res = await fetch(REVALIDATE_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pp_card_slugs: [slug] }),
      })
      rvOk = res.ok
      if (!rvOk) failed.push({ slug, reason: `revalidate status=${res.status}` })
    } catch (e) {
      failed.push({ slug, reason: `revalidate threw: ${(e as Error).message}` })
    }
    if (rvOk) {
      // Mark revalidated by bumping updated_at above deactivated_at.
      const now = new Date().toISOString()
      const { error: markErr } = await sb
        .from('pokemon_tcg_pilot_cohort')
        .update({ updated_at: now })
        .eq('pp_card_slug', slug)
      if (markErr) {
        failed.push({ slug, reason: `mark error: ${markErr.message}` })
      } else {
        succeeded.push({ slug, revalidated_at: now })
      }
    }
  }
  // Count remaining pending for the operator-visible status.
  const { data: afterCandidates } = await sb
    .from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,deactivated_at,updated_at')
    .eq('prices_enabled', false)
    .not('deactivated_at', 'is', null)
    .like('notes', `${EXPANSION_NOTES_PREFIX}%`)
  const pending_after = (afterCandidates ?? [])
    .filter(r => r.deactivated_at && r.updated_at && new Date(r.updated_at as string).getTime() <= new Date(r.deactivated_at as string).getTime())
    .filter(r => !EXPANSION_HARD_BLOCK.has(r.pp_card_slug as string))
    .length
  return { started_at, pending_before, attempted: batch.length, succeeded, failed, pending_after }
}

export default async function PilotBatchPage() {
  await requireAdminPage(ADMIN_PAGE_PATH)
  const sb = getSupabaseServiceClient()

  // Current state table (18 rows)
  type CohortRow = { pp_card_slug: string; prices_enabled: boolean; images_enabled: boolean; history_enabled: boolean; activated_at: string | null; deactivated_at: string | null; updated_at: string | null }
  type CardMetaRow = { card_slug: string; card_name: string | null; set_name: string | null; card_url_slug: string | null }
  const { data: cohortRaw } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,prices_enabled,images_enabled,history_enabled,activated_at,deactivated_at,updated_at')
    .order('pp_card_slug')
  const cohort: CohortRow[] = (cohortRaw ?? []) as unknown as CohortRow[]
  const slugs: string[] = cohort.map(r => r.pp_card_slug)
  const cardsRaw = slugs.length > 0
    ? (await sb.from('cards').select('card_slug,card_name,set_name,card_url_slug').in('card_slug', slugs)).data ?? []
    : []
  const cards: CardMetaRow[] = cardsRaw as unknown as CardMetaRow[]
  const byslug = new Map<string, CardMetaRow>(cards.map(c => [c.card_slug, c]))

  return (
    <main style={{ maxWidth: 1100, margin: '32px auto', padding: '0 20px', fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Pilot batch control</h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Admin-only control surface for the 18-card pilot cohort. All operations use your signed-in admin session JWT and the existing
        <code> /api/admin/pilot/revalidate </code> endpoint. Allowlist = <code>pokemon_tcg_pilot_cohort</code> rows only.
        Images, history and currency-selector flags are not touched by this page.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Current cohort state</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
        <thead>
          <tr style={{ background: 'var(--bg-light)' }}>
            <th style={{ textAlign: 'left', padding: 6 }}>slug</th>
            <th style={{ textAlign: 'left', padding: 6 }}>card</th>
            <th style={{ textAlign: 'left', padding: 6 }}>set</th>
            <th style={{ textAlign: 'left', padding: 6 }}>prices</th>
            <th style={{ textAlign: 'left', padding: 6 }}>img</th>
            <th style={{ textAlign: 'left', padding: 6 }}>hist</th>
            <th style={{ textAlign: 'left', padding: 6 }}>group</th>
          </tr>
        </thead>
        <tbody>
          {cohort.map(r => {
            const c = byslug.get(r.pp_card_slug)
            const group = THIN_DATA.has(r.pp_card_slug) ? 'thin (B)'
              : PRESET_REPS.includes(r.pp_card_slug) ? 'rep'
              : PRESET_BATCH2.includes(r.pp_card_slug) ? 'B2'
              : PRESET_BATCH3.includes(r.pp_card_slug) ? 'B3'
              : r.pp_card_slug === '5732721' ? 'Sinistea-pilot' : ''
            return (
              <tr key={r.pp_card_slug} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 6, fontFamily: 'monospace' }}>{r.pp_card_slug}</td>
                <td style={{ padding: 6 }}>{c?.card_name ?? '?'}</td>
                <td style={{ padding: 6 }}>{c?.set_name ?? '?'}</td>
                <td style={{ padding: 6, fontWeight: 700, color: r.prices_enabled ? '#15803d' : 'var(--text-muted)' }}>{String(r.prices_enabled)}</td>
                <td style={{ padding: 6, color: 'var(--text-muted)' }}>{String(r.images_enabled)}</td>
                <td style={{ padding: 6, color: 'var(--text-muted)' }}>{String(r.history_enabled)}</td>
                <td style={{ padding: 6 }}>{group}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Batched activation</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <SlugFormButton action="activate" slugs={PRESET_REPS} label="Activate 3 representatives (Jacinthe · Groudon EX · Falinks V)" />
        <SlugFormButton action="activate" slugs={PRESET_BATCH2} label="Activate Group A batch 2 (5 cards)" />
        <SlugFormButton action="activate" slugs={PRESET_BATCH3} label="Activate Group A batch 3 (5 cards)" />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Per-slug deactivate</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Flips prices_enabled=false on the selected slug, revalidates, and verifies legacy HTML returned.</p>
      <PerSlugForm action="deactivate" slugs={slugs} labels={byslug} />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Per-slug rollback round-trip</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Flips off → revalidate → verify legacy → flips on → revalidate → verify active. Ends with prices_enabled=true.</p>
      <PerSlugForm action="rollback" slugs={slugs} labels={byslug} />

      {/* ─── PP-TCG-500-PREP correction §A — expansion controls (348 staged, zero activated) ─── */}
      <h2 style={{ fontSize: 16, marginTop: 40 }}>Expansion — next {EXPANSION_BATCH_SIZE} by GSC rank</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Picks the globally top-{EXPANSION_BATCH_SIZE} staged candidates (<code>notes</code> starts with <code>{EXPANSION_NOTES_PREFIX}</code>, <code>prices_enabled=false</code>, strict provider-safe at click time, excluding thin-data slugs). The 14 live cards and 4 thin cards use different <code>notes</code> and are invisible to this selector by data-level invariant. Server-side re-check runs immediately before each activation.
      </p>
      <form action={async () => {
        'use server'
        await requireAdminPage(ADMIN_PAGE_PATH)
        const sb = getSupabaseServiceClient()
        const sel = await selectNextExpansionBatch(sb, EXPANSION_BATCH_SIZE)
        const outcome = sel.slugs.length > 0
          ? await runBatch('activate', sel.slugs)
          : { started_at: new Date().toISOString(), action: 'activate' as const, slugs_requested: [], per_slug: [], rollback_on_failure: null, verdict: 'FAIL' as const }
        const augmented = { ...outcome, _expansion: sel }
        const jar = await cookies()
        jar.set('pilot_batch_result', JSON.stringify(augmented), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
        redirect(ADMIN_PAGE_PATH)
      }}>
        <button type="submit" style={{ background: '#166534', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Activate next {EXPANSION_BATCH_SIZE} by GSC rank (global sort, strict re-check)
        </button>
      </form>

      <h2 style={{ fontSize: 16, marginTop: 32, color: '#991b1b' }}>Emergency — disable ALL expansion-cohort pricing</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        Dedicated kill switch for expansion rows only. One bulk <code>UPDATE</code> sets <code>prices_enabled=false</code> on every row matching the <code>{EXPANSION_NOTES_PREFIX}</code> marker that is currently enabled. Does NOT auto re-enable on failure. 14 live cards + 4 thin cards are protected by data (different <code>notes</code> values). Public HTML continues serving cached content until <strong>Revalidate pending expansion URLs</strong> below is run.
        Requires typing <code>disable expansion</code> to confirm.
      </p>
      <form action={async (fd: FormData) => {
        'use server'
        await requireAdminPage(ADMIN_PAGE_PATH)
        if ((fd.get('confirm') ?? '').toString().trim() !== 'disable expansion') {
          const jar = await cookies()
          jar.set('pilot_emergency_result', JSON.stringify({ started_at: new Date().toISOString(), error: 'confirmation phrase did not match', rows_matched: 0, rows_affected: 0, slugs: [] } satisfies EmergencyDisableReport), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
          redirect(ADMIN_PAGE_PATH)
        }
        const report = await emergencyDisableExpansion()
        const jar = await cookies()
        jar.set('pilot_emergency_result', JSON.stringify(report), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
        redirect(ADMIN_PAGE_PATH)
      }}>
        <input name="confirm" placeholder='type "disable expansion"' style={{ padding: 8, fontSize: 13, marginRight: 8, border: '1px solid #991b1b', borderRadius: 6 }} />
        <button type="submit" style={{ background: '#991b1b', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          EMERGENCY: Bulk-disable expansion cohort
        </button>
      </form>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Revalidate pending expansion URLs</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.55 }}>
        Resumable, bounded ({REVAL_BATCH_SIZE} slugs per invocation). Processes rows where <code>updated_at ≤ deactivated_at</code> (the pending marker set by emergency disable). On success bumps <code>updated_at</code> above <code>deactivated_at</code> so the row drops out of pending. On failure LEAVES the row pending for a safe retry. Does NOT re-enable pricing under any outcome.
      </p>
      <form action={async () => {
        'use server'
        await requireAdminPage(ADMIN_PAGE_PATH)
        const report = await revalidateExpansionPending()
        const jar = await cookies()
        jar.set('pilot_reval_result', JSON.stringify(report), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
        redirect(ADMIN_PAGE_PATH)
      }}>
        <button type="submit" style={{ background: '#a16207', color: 'white', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          Revalidate next {REVAL_BATCH_SIZE} pending expansion URLs
        </button>
      </form>

      <ResultBlock />
      <EmergencyResultBlock />
      <RevalResultBlock />

      <div style={{ marginTop: 32, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>Scope &amp; safety</strong>
        <ul>
          <li>Allowlist is the <code>pokemon_tcg_pilot_cohort</code> table — DB-mutable only.</li>
          <li>Uses your signed-in admin JWT (same cookie session as <code>/admin/*</code>); no new secrets.</li>
          <li>Content-based polling (up to {POLL_MAX_ATTEMPTS} × {POLL_INTERVAL_MS / 1000}s) per slug — passes only when the public HTML actually flips.</li>
          <li>Thin-data slugs ({Array.from(THIN_DATA).join(', ')}) are visible in the state table but excluded from the preset activation batches.</li>
          <li>No sitewide purge; each slug revalidates one specific card URL via <code>/api/admin/pilot/revalidate</code>.</li>
        </ul>
      </div>
    </main>
  )
}

function SlugFormButton({ action, slugs, label }: { action: 'activate' | 'deactivate' | 'rollback'; slugs: string[]; label: string }) {
  return (
    <form action={async (fd: FormData) => {
      'use server'
      const slugListStr = fd.get('slugs')
      const slugList = typeof slugListStr === 'string' ? slugListStr.split(',').filter(Boolean) : []
      const act = (fd.get('action') ?? 'activate') as 'activate' | 'deactivate' | 'rollback'
      const outcome = await runBatch(act, slugList)
      const jar = await cookies()
      jar.set('pilot_batch_result', JSON.stringify(outcome), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
      redirect(ADMIN_PAGE_PATH)
    }}>
      <input type="hidden" name="slugs" value={slugs.join(',')} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" style={{
        background: '#1a5fad', color: 'white', border: 'none', borderRadius: 8,
        padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
      }}>{label} — slugs: {slugs.join(', ')}</button>
    </form>
  )
}

function PerSlugForm({ action, slugs, labels }: {
  action: 'activate' | 'deactivate' | 'rollback'
  slugs: string[]
  labels: Map<string, { card_name: string | null; set_name: string | null; card_slug: string; card_url_slug: string | null }>
}) {
  return (
    <form action={async (fd: FormData) => {
      'use server'
      const slug = (fd.get('slug') ?? '').toString()
      if (!slug) { redirect(ADMIN_PAGE_PATH); return }
      const outcome = await runBatch(action, [slug])
      const jar = await cookies()
      jar.set('pilot_batch_result', JSON.stringify(outcome), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 600 })
      redirect(ADMIN_PAGE_PATH)
    }}>
      <select name="slug" required style={{ padding: 8, fontSize: 13, marginRight: 8 }}>
        <option value="">— select pilot slug —</option>
        {slugs.map(s => {
          const c = labels.get(s)
          return <option key={s} value={s}>{s} — {c?.card_name ?? '?'} ({c?.set_name ?? '?'})</option>
        })}
      </select>
      <button type="submit" style={{
        background: action === 'rollback' ? '#a16207' : '#991b1b', color: 'white', border: 'none', borderRadius: 8,
        padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
      }}>Run {action}</button>
    </form>
  )
}

async function ResultBlock() {
  const jar = await cookies()
  const raw = jar.get('pilot_batch_result')?.value
  if (!raw) return null
  let parsed: BatchOutcome
  try { parsed = JSON.parse(raw) as BatchOutcome } catch { return null }
  const colour = parsed.verdict === 'PASS' ? '#15803d' : '#b91c1c'
  return (
    <div style={{ marginTop: 32, background: 'var(--card)', border: `2px solid ${colour}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: colour }}>{parsed.verdict} — {parsed.action}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Started: {parsed.started_at} · slugs: {parsed.slugs_requested.join(', ')}
      </div>
      {parsed.per_slug.map((r, i) => {
        const lastPoll = r.polls[r.polls.length - 1]
        return (
          <div key={i} style={{ marginTop: 10, padding: 10, background: 'var(--bg-light)', borderRadius: 6, border: `1px solid ${r.ok ? '#15803d44' : '#b91c1c44'}` }}>
            <div style={{ fontWeight: 700, color: r.ok ? '#15803d' : '#b91c1c' }}>{r.slug} — {r.ok ? '✓' : '✗'} {r.detail}</div>
            <div style={{ fontSize: 11, marginTop: 4 }}><a href={r.url} target="_blank" rel="noreferrer">{r.url}</a></div>
            {lastPoll && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                last probe: cache={lastPoll.cache} age={lastPoll.age} status={lastPoll.status}{' '}
                provider_active={String(lastPoll.provider_active)}{' '}
                marketplace={String(lastPoll.has_marketplace_panel)}{' '}
                psa10_in_ladder={String(lastPoll.grade_ladder_has_psa10)}{' '}
                faq_tcggraph={String(lastPoll.faq_mentions_tcggraph)}{' '}
                attempts={r.polls.length}
              </div>
            )}
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)' }}>Evidence (polls + revalidate responses)</summary>
              <pre style={{ fontSize: 10, overflowX: 'auto', background: 'var(--card)', padding: 6, marginTop: 4, borderRadius: 4 }}>
                {JSON.stringify({ pre: r.pre_cohort, post: r.post_cohort, revalidate: r.revalidate_responses, polls: r.polls }, null, 2)}
              </pre>
            </details>
          </div>
        )
      })}

      {parsed.rollback_on_failure && (
        <div style={{ marginTop: 20, padding: 12, background: '#fef3c7', borderRadius: 8, border: '2px solid #a16207' }}>
          <div style={{ fontWeight: 800, color: '#a16207', fontSize: 14 }}>Batch-level restore pass (triggered by failure above)</div>
          <div style={{ fontSize: 11, color: '#7c5f0a', marginTop: 4 }}>
            Each mutated card was flipped back to its pre-batch prices_enabled value, revalidated via the admin endpoint, and polled until the public HTML matched the original rendering.
            Subsequent batches should NOT be run until every entry below reports <code>verified=true</code>.
          </div>
          {parsed.rollback_on_failure.map((rb, i) => {
            const last = rb.polls[rb.polls.length - 1]
            return (
              <div key={i} style={{ marginTop: 10, padding: 10, background: 'var(--card)', borderRadius: 6, border: `1px solid ${rb.verified ? '#15803d44' : '#b91c1c88'}` }}>
                <div style={{ fontWeight: 700, color: rb.verified ? '#15803d' : '#b91c1c' }}>
                  {rb.slug} — restore {rb.verified ? '✓ verified' : '✗ NOT VERIFIED'} · target prices_enabled={String(rb.target_prices_enabled)} · cohort_restore_ok={String(rb.cohort_restore_ok)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{rb.detail}</div>
                {last && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    last probe: cache={last.cache} age={last.age} status={last.status}{' '}
                    provider_active={String(last.provider_active)} attempts={rb.polls.length}
                  </div>
                )}
                <details style={{ marginTop: 4 }}>
                  <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)' }}>Restore evidence</summary>
                  <pre style={{ fontSize: 10, overflowX: 'auto', background: 'var(--bg-light)', padding: 6, marginTop: 4, borderRadius: 4 }}>
                    {JSON.stringify({ revalidate: rb.revalidate_responses, polls: rb.polls }, null, 2)}
                  </pre>
                </details>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

async function EmergencyResultBlock() {
  const jar = await cookies()
  const raw = jar.get('pilot_emergency_result')?.value
  if (!raw) return null
  let parsed: EmergencyDisableReport
  try { parsed = JSON.parse(raw) as EmergencyDisableReport } catch { return null }
  const ok = !parsed.error
  return (
    <div style={{ marginTop: 20, padding: 12, background: ok ? '#fef3c7' : '#fee2e2', borderRadius: 8, border: `2px solid ${ok ? '#a16207' : '#991b1b'}` }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: ok ? '#a16207' : '#991b1b' }}>
        Emergency bulk-disable report
      </div>
      <div style={{ fontSize: 11, color: '#5c3b00', marginTop: 4 }}>Started: {parsed.started_at}</div>
      {parsed.error && <div style={{ fontSize: 12, color: '#991b1b', marginTop: 6, fontWeight: 700 }}>Error: {parsed.error}</div>}
      <div style={{ fontSize: 12, marginTop: 6 }}>Rows matching marker: <strong>{parsed.rows_matched}</strong></div>
      <div style={{ fontSize: 12, marginTop: 2 }}>Rows affected: <strong>{parsed.rows_affected}</strong></div>
      {parsed.slugs.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, cursor: 'pointer' }}>Affected slugs ({parsed.slugs.length})</summary>
          <pre style={{ fontSize: 10, overflowX: 'auto', background: 'var(--card)', padding: 6, marginTop: 4, borderRadius: 4 }}>{parsed.slugs.join('\n')}</pre>
        </details>
      )}
      {parsed.rows_affected > 0 && (
        <div style={{ fontSize: 11, color: '#5c3b00', marginTop: 8 }}>
          Public pages continue serving cached TCGGraph content until <strong>Revalidate pending expansion URLs</strong> is run (resumable, {REVAL_BATCH_SIZE} per click).
        </div>
      )}
    </div>
  )
}

async function RevalResultBlock() {
  const jar = await cookies()
  const raw = jar.get('pilot_reval_result')?.value
  if (!raw) return null
  let parsed: RevalidatePendingReport
  try { parsed = JSON.parse(raw) as RevalidatePendingReport } catch { return null }
  const done = parsed.pending_after === 0
  return (
    <div style={{ marginTop: 20, padding: 12, background: done ? '#dcfce7' : '#fef3c7', borderRadius: 8, border: `2px solid ${done ? '#15803d' : '#a16207'}` }}>
      <div style={{ fontWeight: 800, fontSize: 14, color: done ? '#15803d' : '#a16207' }}>
        Revalidate pending — {done ? 'ALL CLEAR' : `${parsed.pending_after} still pending`}
      </div>
      <div style={{ fontSize: 11, marginTop: 4 }}>Started: {parsed.started_at}</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>Pending before this run: <strong>{parsed.pending_before}</strong> · attempted: <strong>{parsed.attempted}</strong> · succeeded: <strong>{parsed.succeeded.length}</strong> · failed: <strong>{parsed.failed.length}</strong> · pending after: <strong>{parsed.pending_after}</strong></div>
      {parsed.failed.length > 0 && (
        <details open style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, cursor: 'pointer', color: '#991b1b' }}>Failures ({parsed.failed.length}) — these rows remain pending; re-click to retry</summary>
          <pre style={{ fontSize: 10, overflowX: 'auto', background: 'var(--card)', padding: 6, marginTop: 4, borderRadius: 4 }}>{parsed.failed.map(f => `${f.slug}: ${f.reason}`).join('\n')}</pre>
        </details>
      )}
      {parsed.succeeded.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 11, cursor: 'pointer' }}>Succeeded ({parsed.succeeded.length})</summary>
          <pre style={{ fontSize: 10, overflowX: 'auto', background: 'var(--card)', padding: 6, marginTop: 4, borderRadius: 4 }}>{parsed.succeeded.map(s => `${s.slug} @ ${s.revalidated_at}`).join('\n')}</pre>
        </details>
      )}
      {!done && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Click <strong>Revalidate next {REVAL_BATCH_SIZE} pending expansion URLs</strong> again to continue. Safe to re-click — only still-pending rows are processed.
        </div>
      )}
    </div>
  )
}
