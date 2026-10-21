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

type BatchOutcome = {
  started_at: string
  action: 'activate' | 'deactivate' | 'rollback'
  slugs_requested: string[]
  per_slug: SlugResult[]
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
      verdict: 'FAIL',
    }
  }

  const per_slug: SlugResult[] = []
  for (const slug of slugs) {
    const url = await urlForSlug(sb, slug)
    if (!url) {
      per_slug.push({
        slug, url: '', action, pre_cohort: null, post_cohort: null,
        revalidate_responses: [], polls: [],
        content_as_expected: false, ok: false,
        detail: 'url resolution failed (cards table lookup)',
      })
      continue
    }

    const { data: pre } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled,images_enabled,history_enabled,activated_at,deactivated_at')
      .eq('pp_card_slug', slug).maybeSingle()

    const rvResponses: Array<{ status: number; body: string }> = []
    const polls: ProbeAttempt[] = []

    try {
      if (action === 'activate') {
        await flipCohort(sb, slug, true)
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, true)))
      } else if (action === 'deactivate') {
        await flipCohort(sb, slug, false)
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, false)))
      } else {
        // rollback cycle
        await flipCohort(sb, slug, false)
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, false)))
        await flipCohort(sb, slug, true)
        rvResponses.push(await callRevalidate(adminJwt, slug))
        polls.push(...(await pollUntil(url, true)))
      }
    } catch (e) {
      // Try to restore on error for activate/rollback (which end in "on")
      try {
        if (action !== 'deactivate') await flipCohort(sb, slug, true)
      } catch { /* best effort */ }
      per_slug.push({
        slug, url, action, pre_cohort: pre, post_cohort: null,
        revalidate_responses: rvResponses, polls,
        content_as_expected: false, ok: false,
        detail: `error: ${(e as Error).message}`,
      })
      continue
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
  }

  return {
    started_at: new Date().toISOString(),
    action,
    slugs_requested: slugs,
    per_slug,
    verdict: per_slug.every(r => r.ok) ? 'PASS' : 'FAIL',
  }
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

      <ResultBlock />

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
    </div>
  )
}
