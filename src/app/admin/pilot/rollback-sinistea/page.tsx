// PP-TCG-PUBLIC-PILOT-02 §2 — admin-authored rollback round-trip for
// the Sinistea #89 pilot. Hard-coded to pp_card_slug = 5732721.
//
// Access: cookie-based admin session via requireAdminPage, same gate
// as the rest of /admin/*. Non-admins get notFound(). Everything
// executes server-side; nothing is exposed to the browser bundle.
//
// Flow when the operator clicks "Run rollback round-trip":
//   1. Record pre-flip cohort state (audit trail returned inline).
//   2. Flip pokemon_tcg_pilot_cohort.prices_enabled = false.
//   3. revalidatePath(pilotUrl) — invalidates ISR cache for just
//      this card URL; no sitewide purge.
//   4. Fetch pilotUrl unauthenticated; probe for "legacy" signal.
//   5. Flip pokemon_tcg_pilot_cohort.prices_enabled = true.
//   6. revalidatePath(pilotUrl) again.
//   7. Fetch pilotUrl again; probe for "provider active" signal.
//   8. Final: cohort row is restored to prices_enabled = true. If
//      any step errored, we attempt the restore flip regardless and
//      surface the error.
//
// The page renders the recorded output inline so the operator can
// paste it back to the pilot workstream.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { revalidatePath } from 'next/cache'
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
const PILOT_REVALIDATE_PATH = `/set/${encodeURIComponent(PILOT_SET_NAME)}/card/${encodeURIComponent(PILOT_URL_SLUG)}`
const ADMIN_PAGE_PATH = '/admin/pilot/rollback-sinistea'

type ProbeResult = {
  status: number
  cache: string | null
  age: string | null
  provider_active: boolean
  faq_hint: string
}

async function probePublicPage(): Promise<ProbeResult> {
  const res = await fetch(PILOT_PUBLIC_URL, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
  const body = await res.text()
  const faq = body.match(/currently reads([^"]{0,200})/)?.[1] ?? ''
  const psa9InFaq = /PSA\s*9:/i.test(faq)
  const psa7MutedDash = /PSA\s*7<\/div><div[^>]*color:var\(--border\)[^>]*>—<\/div>/i.test(body)
  const marketplacePanel = /Marketplace Snapshots/.test(body)
  return {
    status: res.status,
    cache: res.headers.get('x-vercel-cache'),
    age: res.headers.get('age'),
    provider_active: (faq.length > 0 && !psa9InFaq) || psa7MutedDash || marketplacePanel,
    faq_hint: faq.slice(0, 160).trim(),
  }
}

async function runRollbackCycle(): Promise<{
  started_at: string
  steps: Array<{ step: string; detail: string; ok: boolean }>
  final_cohort_prices_enabled: boolean | null
  verdict: 'PASS' | 'FAIL' | 'FAIL_WITH_RESTORE'
}> {
  'use server'
  // Defence in depth: re-verify admin session for the mutating action.
  // The page already gates this, but a server-action call could in
  // theory be reached from a POST without first loading the page.
  await requireAdminPage(ADMIN_PAGE_PATH)

  const steps: Array<{ step: string; detail: string; ok: boolean }> = []
  const sb = getSupabaseServiceClient()
  const started_at = new Date().toISOString()

  // Helper that attempts the restore flip regardless of prior state.
  async function restoreCohortTrue(reason: string): Promise<void> {
    try {
      await sb.from('pokemon_tcg_pilot_cohort')
        .update({ prices_enabled: true, deactivated_at: null, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('pp_card_slug', PILOT_SLUG)
      steps.push({ step: 'restore_cohort_true', detail: reason, ok: true })
    } catch (e) {
      steps.push({ step: 'restore_cohort_true', detail: `${reason} | restore error: ${(e as Error).message}`, ok: false })
    }
  }

  try {
    // A. Verify provider mode is currently active on the live page.
    const probeA = await probePublicPage()
    steps.push({ step: 'A_verify_active_pre', detail: JSON.stringify(probeA), ok: probeA.provider_active })
    if (!probeA.provider_active) {
      // Still try the full cycle so the user sees state anyway, but mark FAIL early.
      steps.push({ step: 'warn', detail: 'provider was NOT active before rollback — continuing cycle to show the full flow', ok: false })
    }

    // B. Flip cohort prices_enabled = false.
    const { data: pre, error: preErr } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled,images_enabled,history_enabled,activated_at').eq('pp_card_slug', PILOT_SLUG).maybeSingle()
    if (preErr) throw new Error(`cohort select pre: ${preErr.message}`)
    const { error: bErr } = await sb.from('pokemon_tcg_pilot_cohort')
      .update({ prices_enabled: false, deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('pp_card_slug', PILOT_SLUG)
    if (bErr) throw new Error(`cohort flip-off: ${bErr.message}`)
    steps.push({ step: 'B_flip_cohort_off', detail: `pre=${JSON.stringify(pre)} → prices_enabled=false`, ok: true })

    // C. Revalidate the pilot URL.
    revalidatePath(PILOT_REVALIDATE_PATH)
    steps.push({ step: 'C_revalidate_after_off', detail: `revalidatePath(${PILOT_REVALIDATE_PATH})`, ok: true })

    // Small settle delay so Vercel's edge consistently returns the fresh render.
    await new Promise(r => setTimeout(r, 2000))

    // D. Verify legacy renders.
    const probeD = await probePublicPage()
    steps.push({ step: 'D_verify_legacy_after_off', detail: JSON.stringify(probeD), ok: probeD.provider_active === false })

    // E. Flip cohort prices_enabled = true.
    const { error: eErr } = await sb.from('pokemon_tcg_pilot_cohort')
      .update({ prices_enabled: true, deactivated_at: null, activated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('pp_card_slug', PILOT_SLUG)
    if (eErr) throw new Error(`cohort flip-on: ${eErr.message}`)
    steps.push({ step: 'E_flip_cohort_on', detail: 'prices_enabled=true', ok: true })

    // F. Revalidate again.
    revalidatePath(PILOT_REVALIDATE_PATH)
    steps.push({ step: 'F_revalidate_after_on', detail: `revalidatePath(${PILOT_REVALIDATE_PATH})`, ok: true })

    await new Promise(r => setTimeout(r, 2000))

    // G. Verify provider active again.
    const probeG = await probePublicPage()
    steps.push({ step: 'G_verify_active_after_restore', detail: JSON.stringify(probeG), ok: probeG.provider_active === true })

    // Final cohort state check.
    const { data: fin } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled,images_enabled,history_enabled').eq('pp_card_slug', PILOT_SLUG).maybeSingle()
    const allPass = steps.every(s => s.ok || s.step === 'warn')
    const verdict: 'PASS' | 'FAIL' | 'FAIL_WITH_RESTORE' = allPass && fin?.prices_enabled === true ? 'PASS' : 'FAIL'
    return { started_at, steps, final_cohort_prices_enabled: fin?.prices_enabled ?? null, verdict }
  } catch (e) {
    await restoreCohortTrue(`error during cycle: ${(e as Error).message}`)
    const { data: fin } = await sb.from('pokemon_tcg_pilot_cohort')
      .select('prices_enabled').eq('pp_card_slug', PILOT_SLUG).maybeSingle()
    return { started_at, steps, final_cohort_prices_enabled: fin?.prices_enabled ?? null, verdict: 'FAIL_WITH_RESTORE' }
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
        Target URL: <a href={PILOT_PUBLIC_URL} target="_blank" rel="noreferrer">{PILOT_PUBLIC_URL}</a>.
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
          Run rollback round-trip (A → G)
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
          Executes: verify active → flip cohort off → revalidate → verify legacy → flip cohort on → revalidate → verify active.
          Finishes with prices_enabled restored to true. ~10 seconds. No sitewide purge.
        </p>
      </form>

      <ResultBlock />

      <div style={{ marginTop: 32, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>Scope &amp; safety</strong>
        <ul>
          <li>Hard-coded to slug <code>5732721</code>. No parameter accepts an external slug.</li>
          <li>Admin cookie session required (same gate as the rest of <code>/admin/*</code>).</li>
          <li>Images / history / currency flags are not touched.</li>
          <li>Final cohort state is <code>prices_enabled = true</code> whether the probe steps pass or fail.</li>
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
  const colour =
    parsed.verdict === 'PASS' ? '#15803d' :
    parsed.verdict === 'FAIL' ? '#b91c1c' : '#a16207'
  return (
    <div style={{ marginTop: 24, background: 'var(--card)', border: `2px solid ${colour}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: colour }}>{parsed.verdict}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Started: {parsed.started_at}</div>
      <div style={{ fontSize: 12, marginBottom: 10 }}>Final cohort prices_enabled: <strong>{String(parsed.final_cohort_prices_enabled)}</strong></div>
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.5 }}>
        {parsed.steps.map((s, i) => (
          <li key={i} style={{ color: s.ok ? 'var(--text)' : '#b91c1c' }}>
            <strong>{s.step}</strong> {s.ok ? '✓' : '✗'} — <code style={{ fontSize: 11 }}>{s.detail}</code>
          </li>
        ))}
      </ol>
    </div>
  )
}
