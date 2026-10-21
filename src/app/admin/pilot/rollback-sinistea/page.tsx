// PP-TCG-PUBLIC-PILOT-02 §2 (revision 2) — admin-authored rollback
// round-trip for the Sinistea #89 pilot. Hard-coded to pp_card_slug
// = 5732721.
//
// Access: cookie-based admin session via requireAdminPage, same gate
// as the rest of /admin/*. Non-admins get notFound(). Mutating action
// re-verifies admin on the server-action path.
//
// Why this route exists at all: the existing /api/admin/pilot/revalidate
// endpoint already encapsulates the correct revalidation primitive
// (`revalidatePath` on the one canonical card path, slug resolution
// against the `cards` table). We do NOT re-implement that here; we
// call the existing endpoint using the signed-in admin's own session
// JWT. That is the only identity used — no impersonation, no
// service-role bypass, no new secrets.
//
// Why the previous revision 1 was buggy: it called `revalidatePath`
// directly inside the Server Action, then immediately re-fetched the
// pilot URL twice at fixed 2s intervals. The Vercel edge cache was
// never actually invalidated in that path (the cache-age counter
// just kept ticking upward across A/D/G probes). This revision
// routes through the authenticated endpoint and polls the public
// URL with bounded retries until the HTML content actually flips.
//
// Flow when the operator clicks "Run rollback round-trip":
//   A  — probe public page: assert provider-active
//   B  — flip cohort.prices_enabled = false
//   C  — POST /api/admin/pilot/revalidate with admin JWT; expect {ok:true}
//   D  — poll public page up to 10× (2s backoff) until provider-inactive;
//        record every attempt's status/cache/age/signal
//   E  — flip cohort.prices_enabled = true
//   F  — POST /api/admin/pilot/revalidate again
//   G  — poll public page until provider-active; record every attempt
//   RESTORE_VERIFY — on any error path, flip back to true, call the
//        endpoint one more time, then poll; the "restore verified"
//        flag reflects whether the public HTML has actually come back
//
// Guarantees:
//   * Hard-coded to slug 5732721 and PILOT_REVALIDATE_PATH; no caller
//     input is accepted that could redirect this to another card.
//   * Images / history / currency flags are never read or mutated.
//   * revalidatePath is NEVER called with a layout or set path; only
//     the single pilot card path.
//   * On any thrown error, the restore flip runs anyway (in a finally
//     block) and the restored state is explicitly verified by a final
//     poll.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { getSupabaseServerClient } from '@/lib/supabaseServer'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = {
  title: 'Pilot rollback round-trip — Sinistea #89',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}

const PILOT_SLUG = '5732721'
const PILOT_SET_NAME = 'Trick or Trade 2023'
const PILOT_URL_SLUG = 'sinistea-89'
const PILOT_PUBLIC_URL = `https://www.pokeprices.io/set/${encodeURIComponent(PILOT_SET_NAME)}/card/${encodeURIComponent(PILOT_URL_SLUG)}`
const REVALIDATE_ENDPOINT = 'https://www.pokeprices.io/api/admin/pilot/revalidate'
const ADMIN_PAGE_PATH = '/admin/pilot/rollback-sinistea'

const POLL_MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS  = 2000

type ProbeAttempt = {
  attempt: number
  elapsed_ms: number
  status: number
  cache: string | null
  age: string | null
  provider_active: boolean
  has_marketplace_panel: boolean
  faq_snip: string
}

async function probePublicPage(attempt: number, started_at: number): Promise<ProbeAttempt> {
  const res = await fetch(PILOT_PUBLIC_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  const body = await res.text()
  const faq = body.match(/currently reads([^"]{0,200})/)?.[1] ?? ''
  const psa9InFaq = /PSA\s*9:/i.test(faq)
  const psa7MutedDash = /PSA\s*7<\/div><div[^>]*color:var\(--border\)[^>]*>—<\/div>/i.test(body)
  const hasMarketplacePanel = /Marketplace Snapshots/.test(body)
  // Provider active ⇔ FAQ omits PSA 9 (adapter sets psa9_usd=null) OR
  // the muted-dash grade pattern for PSA 7 is present OR the marketplace
  // panel renders. Any of these implies useProvider=true on this request.
  const provider_active = (faq.length > 0 && !psa9InFaq) || psa7MutedDash || hasMarketplacePanel
  return {
    attempt,
    elapsed_ms: Date.now() - started_at,
    status: res.status,
    cache: res.headers.get('x-vercel-cache'),
    age: res.headers.get('age'),
    provider_active,
    has_marketplace_panel: hasMarketplacePanel,
    faq_snip: faq.slice(0, 120).trim(),
  }
}

async function pollUntilContent(expected: boolean): Promise<{ attempts: ProbeAttempt[]; reached: boolean }> {
  const started_at = Date.now()
  const attempts: ProbeAttempt[] = []
  for (let i = 1; i <= POLL_MAX_ATTEMPTS; i++) {
    const probe = await probePublicPage(i, started_at)
    attempts.push(probe)
    if (probe.provider_active === expected) return { attempts, reached: true }
    if (i < POLL_MAX_ATTEMPTS) await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  return { attempts, reached: false }
}

type Step = { step: string; detail: string; ok: boolean }

async function callRevalidateEndpoint(adminJwt: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(REVALIDATE_ENDPOINT, {
    method:  'POST',
    headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pp_card_slugs: [PILOT_SLUG] }),
  })
  const body = await res.text()
  return { ok: res.ok, status: res.status, body: body.slice(0, 400) }
}

async function flipCohort(sb: ReturnType<typeof getSupabaseServiceClient>, prices_enabled: boolean): Promise<string> {
  const now = new Date().toISOString()
  const patch = prices_enabled
    ? { prices_enabled: true, deactivated_at: null, activated_at: now, updated_at: now }
    : { prices_enabled: false, deactivated_at: now, updated_at: now }
  const { error } = await sb.from('pokemon_tcg_pilot_cohort')
    .update(patch).eq('pp_card_slug', PILOT_SLUG)
  if (error) throw new Error(`cohort update (prices_enabled=${prices_enabled}): ${error.message}`)
  return `cohort → prices_enabled=${prices_enabled}`
}

async function runRollbackCycle(): Promise<{
  started_at: string
  steps: Step[]
  final_cohort_prices_enabled: boolean | null
  restore_verified: boolean
  verdict: 'PASS' | 'FAIL'
}> {
  'use server'
  await requireAdminPage(ADMIN_PAGE_PATH)

  // Grab the admin's own session JWT via the cookie-bound server
  // Supabase client. This is NOT impersonation — the signed-in admin
  // is calling an endpoint using their own credentials. If the
  // session is missing (expired cookie, etc.) we fail BEFORE touching
  // cohort state so the cohort stays as the operator left it.
  const supa  = await getSupabaseServerClient()
  const { data: sessData } = await supa.auth.getSession()
  const adminJwt = sessData?.session?.access_token
  if (!adminJwt) {
    return {
      started_at: new Date().toISOString(),
      steps: [{ step: 'pre_session', detail: 'no session access token on cookie — sign in again', ok: false }],
      final_cohort_prices_enabled: null,
      restore_verified: false,
      verdict: 'FAIL',
    }
  }

  const steps: Step[] = []
  const sb = getSupabaseServiceClient()
  const started_at = new Date().toISOString()
  let restoreVerified = false

  try {
    // A. verify active before touching anything
    const probeA = await probePublicPage(1, Date.now())
    steps.push({ step: 'A_verify_active_pre', detail: JSON.stringify(probeA), ok: probeA.provider_active })
    if (!probeA.provider_active) {
      steps.push({ step: 'warn_A', detail: 'provider was NOT active before cycle began — cohort flip still runs so state is consistent', ok: false })
    }

    // B. flip cohort off
    steps.push({ step: 'B_flip_cohort_off', detail: await flipCohort(sb, false), ok: true })

    // C. call existing authenticated revalidate endpoint
    const rvC = await callRevalidateEndpoint(adminJwt)
    steps.push({
      step: 'C_revalidate_after_off',
      detail: `POST ${REVALIDATE_ENDPOINT} status=${rvC.status} body=${rvC.body}`,
      ok: rvC.ok,
    })

    // D. poll until content flips to legacy
    const pollD = await pollUntilContent(false)
    steps.push({
      step: 'D_poll_legacy',
      detail: `reached=${pollD.reached} attempts=${pollD.attempts.length} evidence=${JSON.stringify(pollD.attempts)}`,
      ok: pollD.reached,
    })

    // E. flip cohort on
    steps.push({ step: 'E_flip_cohort_on', detail: await flipCohort(sb, true), ok: true })

    // F. revalidate again
    const rvF = await callRevalidateEndpoint(adminJwt)
    steps.push({
      step: 'F_revalidate_after_on',
      detail: `POST ${REVALIDATE_ENDPOINT} status=${rvF.status} body=${rvF.body}`,
      ok: rvF.ok,
    })

    // G. poll until content flips back to provider-active
    const pollG = await pollUntilContent(true)
    steps.push({
      step: 'G_poll_active_restored',
      detail: `reached=${pollG.reached} attempts=${pollG.attempts.length} evidence=${JSON.stringify(pollG.attempts)}`,
      ok: pollG.reached,
    })
    restoreVerified = pollG.reached
  } catch (e) {
    steps.push({ step: 'error', detail: `cycle threw: ${(e as Error).message}`, ok: false })
    // Fallthrough to restore
  }

  // RESTORE (always runs). If cohort was already true, this is a no-op flip,
  // but we still revalidate + poll so restoreVerified reflects public HTML state.
  try {
    const { data: curr } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled').eq('pp_card_slug', PILOT_SLUG).maybeSingle()
    if (curr?.prices_enabled !== true) {
      steps.push({ step: 'restore_flip', detail: await flipCohort(sb, true), ok: true })
      const rvR = await callRevalidateEndpoint(adminJwt)
      steps.push({ step: 'restore_revalidate', detail: `status=${rvR.status} body=${rvR.body}`, ok: rvR.ok })
      const pollR = await pollUntilContent(true)
      steps.push({
        step: 'restore_poll_active',
        detail: `reached=${pollR.reached} attempts=${pollR.attempts.length} evidence=${JSON.stringify(pollR.attempts)}`,
        ok: pollR.reached,
      })
      restoreVerified = pollR.reached
    }
  } catch (e) {
    steps.push({ step: 'restore_error', detail: `restore threw: ${(e as Error).message}`, ok: false })
  }

  const { data: fin } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('prices_enabled,images_enabled,history_enabled').eq('pp_card_slug', PILOT_SLUG).maybeSingle()

  const allStepsOk = steps.every(s => s.ok || s.step.startsWith('warn'))
  const verdict: 'PASS' | 'FAIL' = (allStepsOk && fin?.prices_enabled === true && restoreVerified) ? 'PASS' : 'FAIL'
  return {
    started_at,
    steps,
    final_cohort_prices_enabled: fin?.prices_enabled ?? null,
    restore_verified: restoreVerified,
    verdict,
  }
}

export default async function PilotRollbackPage() {
  await requireAdminPage(ADMIN_PAGE_PATH)
  const sb = getSupabaseServiceClient()
  const { data: cohort } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('prices_enabled,images_enabled,history_enabled,activated_at,deactivated_at,updated_at')
    .eq('pp_card_slug', PILOT_SLUG).maybeSingle()

  return (
    <main style={{ maxWidth: 920, margin: '40px auto', padding: '0 20px', fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>Pilot rollback round-trip — Sinistea #89</h1>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        One-click admin-only verification of the TCGGraph pilot rollback mechanism for pp_card_slug <code>{PILOT_SLUG}</code>.
        Public target: <a href={PILOT_PUBLIC_URL} target="_blank" rel="noreferrer">{PILOT_PUBLIC_URL}</a>.
        Revalidate endpoint: <code>/api/admin/pilot/revalidate</code> (your own admin session JWT, no new credentials).
      </p>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginTop: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.4, color: 'var(--text-muted)' }}>Current cohort row</div>
        <pre style={{ fontSize: 12, overflowX: 'auto', marginTop: 10 }}>{JSON.stringify(cohort, null, 2)}</pre>
      </div>

      <form action={async () => {
        'use server'
        const result = await runRollbackCycle()
        const jar = await cookies()
        jar.set('pilot_rollback_result', JSON.stringify(result), { httpOnly: true, sameSite: 'lax', path: ADMIN_PAGE_PATH, maxAge: 300 })
        redirect(ADMIN_PAGE_PATH)
      }} style={{ marginTop: 24 }}>
        <button type="submit" style={{
          background: '#1a5fad', color: 'white', border: 'none', borderRadius: 8,
          padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>
          Run rollback round-trip (A → G, with bounded content polling)
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          Executes: verify active → flip cohort off → <code>POST /api/admin/pilot/revalidate</code> (your session JWT) →
          poll pilot URL up to {POLL_MAX_ATTEMPTS}× (every {POLL_INTERVAL_MS / 1000}s) until legacy content appears →
          flip cohort on → revalidate → poll until TCGGraph content returns. On any failure, the cohort is
          explicitly flipped back to <code>prices_enabled=true</code> and the restored public HTML is verified by a final poll.
          ~20–45 seconds. Only this one card URL is revalidated; no sitewide purge.
        </p>
      </form>

      <ResultBlock />

      <div style={{ marginTop: 32, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>Scope &amp; safety</strong>
        <ul>
          <li>Hard-coded to slug <code>5732721</code>. No parameter accepts an external slug.</li>
          <li>Uses <strong>your signed-in admin session JWT</strong> to call the existing authenticated revalidate endpoint — no new secret env, no impersonation.</li>
          <li>Admin cookie session required (same gate as the rest of <code>/admin/*</code>).</li>
          <li>Images / history / currency flags are not touched.</li>
          <li>Final cohort state is <code>prices_enabled = true</code> whether the probe steps pass or fail, with the restored HTML verified by a final poll.</li>
        </ul>
      </div>
    </main>
  )
}

async function ResultBlock() {
  const jar = await cookies()
  const raw = jar.get('pilot_rollback_result')?.value
  if (!raw) return null
  let parsed: Awaited<ReturnType<typeof runRollbackCycle>>
  try { parsed = JSON.parse(raw) } catch { return null }
  const colour = parsed.verdict === 'PASS' ? '#15803d' : '#b91c1c'
  return (
    <div style={{ marginTop: 24, background: 'var(--card)', border: `2px solid ${colour}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: colour }}>{parsed.verdict}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Started: {parsed.started_at}</div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>Final cohort prices_enabled: <strong>{String(parsed.final_cohort_prices_enabled)}</strong></div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>Restore verified in public HTML: <strong>{String(parsed.restore_verified)}</strong></div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.5 }}>
        {parsed.steps.map((s, i) => (
          <li key={i} style={{ color: s.ok ? 'var(--text)' : '#b91c1c', marginBottom: 6 }}>
            <strong>{s.step}</strong> {s.ok ? '✓' : '✗'}
            <pre style={{ fontSize: 11, margin: '4px 0 0', background: 'var(--bg-light)', padding: 6, borderRadius: 4, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s.detail}</pre>
          </li>
        ))}
      </ol>
    </div>
  )
}
