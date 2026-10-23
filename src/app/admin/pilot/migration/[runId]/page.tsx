// Admin dashboard — detail page per run. Enrol / Pause / Resume /
// Stop / Emergency rollback. Shows progress + failure samples +
// verification evidence.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runMetrics } from '@/lib/providerData/migration/metrics'
import { enrollRunItems, enrollCanary, transitionRun, emergencyRollback, revalidateRolledBack } from '../actions'
import { redirect, notFound } from 'next/navigation'
import type { MigrationRun, MigrationRunConfig, MigrationStatus } from '@/lib/providerData/migration/types'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps { params: Promise<{ runId: string }> }

export default async function Page({ params }: PageProps) {
  const { runId } = await params
  const PATH = `/admin/pilot/migration/${runId}`
  await requireAdminPage(PATH)
  const sb = getSupabaseServiceClient()
  const { data: runRaw } = await sb.from('pp_tcg_migration_run').select('*').eq('id', runId).maybeSingle()
  if (!runRaw) notFound()
  const run = runRaw as unknown as MigrationRun
  const metrics = await runMetrics(sb, runId)
  const cfg: MigrationRunConfig = run.config ?? {}

  // Recent failures (last 20)
  const { data: failures } = await sb.from('pp_tcg_migration_run_item')
    .select('pp_card_slug,last_error,attempts,verification_evidence,updated_at')
    .eq('run_id', runId).eq('status', 'failed').order('updated_at', { ascending: false }).limit(20)

  // Last 10 verified (as the happy-path sample)
  const { data: recentVerified } = await sb.from('pp_tcg_migration_run_item')
    .select('pp_card_slug,verified_at,verification_evidence,gsc_rank,effective_eligibility')
    .eq('run_id', runId).eq('status', 'verified').order('verified_at', { ascending: false }).limit(10)

  // Last operator action feedback via cookie (set by server actions)
  const jar = await cookies()
  const feedbackCookie = jar.get(`migration_feedback_${runId}`)?.value

  return (
    <main style={{ maxWidth: 1200, margin: '32px auto', padding: '0 20px', fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <p style={{ fontSize: 12 }}><a href="/admin/pilot/migration" style={{ color: '#1a5fad' }}>← all runs</a></p>
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{run.name}</h1>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Run id: <code>{run.id}</code></p>

      {feedbackCookie && (
        <div style={{ background: '#dcfce7', border: '1px solid #15803d', borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12 }}>
          <strong>Last action:</strong> <code>{feedbackCookie.slice(0, 500)}</code>
        </div>
      )}

      <section style={{ marginTop: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
          <div><strong>Status:</strong> {run.status}</div>
          <div><strong>Started:</strong> {run.started_at ?? '—'}</div>
          <div><strong>Stopped:</strong> {run.stopped_at ?? '—'}</div>
          <div><strong>Pause reason:</strong> {run.pause_reason ?? '—'}</div>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer' }}>Config</summary>
          <pre style={{ fontSize: 11, background: 'var(--bg-light)', padding: 8, borderRadius: 4 }}>{JSON.stringify(cfg, null, 2)}</pre>
        </details>
      </section>

      <section style={{ marginTop: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Metrics</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 13 }}>
          <StatCell label="Total" value={metrics.totals.total} />
          <StatCell label="Pending" value={metrics.totals.pending} />
          <StatCell label="Claimed" value={metrics.totals.claimed} />
          <StatCell label="Verified" value={metrics.totals.verified} highlight={metrics.totals.verified > 0 ? '#15803d' : undefined} />
          <StatCell label="Failed" value={metrics.totals.failed} highlight={metrics.totals.failed > 0 ? '#b91c1c' : undefined} />
          <StatCell label="Skipped" value={metrics.totals.skipped} />
          <StatCell label="Rolled back" value={metrics.totals.rolled_back} />
          <StatCell label="Today / cap" value={`${metrics.throughput.today} / ${cfg.daily_cap ?? 5}`} />
          <StatCell label="Last hour" value={metrics.throughput.last_hour} />
          <StatCell label="Last 24h" value={metrics.throughput.last_24h} />
          <StatCell label="ETA h (24h rate)" value={metrics.eta_hours ?? '—'} />
          <StatCell label="Consec. failures" value={metrics.consecutive_failures} highlight={metrics.consecutive_failures > 0 ? '#a16207' : undefined} />
        </div>
      </section>

      <section style={{ marginTop: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Controls</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {run.status === 'draft' && (
            <>
              {/* Canary enrol — capped ≤25, forces gsc_rank, keeps run in draft. */}
              <form action={async (fd: FormData) => {
                'use server'
                const n = Number(fd.get('canary_n') ?? 5) || 5
                const r = await enrollCanary(runId, n)
                await writeFeedback(runId, 'enrol_canary', r)
                redirect(PATH)
              }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input name="canary_n" type="number" min={1} max={25} defaultValue={5}
                  style={{ padding: 6, fontSize: 12, width: 70, border: '1px solid #15803d', borderRadius: 4 }} />
                <button type="submit"
                  style={{ background: '#15803d', color: 'white', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  Enrol next N by GSC rank (canary — stays in draft)
                </button>
              </form>
              {/* Mark Ready — gated on at least one pending item. Transitions
                  draft → ready. The next click (on the ready-state controls)
                  then moves ready → running. Two separate clicks = two
                  separate approval gates. */}
              {metrics.totals.pending > 0 && (
                <ActionForm label={`Mark Ready (draft → ready, ${metrics.totals.pending} pending)`} bg="#1a5fad" action={async () => {
                  'use server'
                  const r = await transitionRun(runId, 'ready')
                  await writeFeedback(runId, 'mark_ready', r)
                  redirect(PATH)
                }} />
              )}
              {/* Full-catalogue enrol — DISABLED pending resumable DB-side
                  selection. The old paginated scan statement-timeouts on
                  the full view. Use canary enrol above for now. */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 12px', background: 'var(--bg-light)', borderRadius: 8 }}>
                Full-catalogue enrol disabled — pending resumable selector (see enrollRunItems).
              </div>
            </>
          )}
          {run.status === 'ready' && (
            <>
              <ActionForm label={`Start Migration (ready → running, cron activates up to daily_cap=${cfg.daily_cap ?? 5}/day)`} bg="#15803d" action={async () => {
                'use server'
                const r = await transitionRun(runId, 'running')
                await writeFeedback(runId, 'start', r)
                redirect(PATH)
              }} />
            </>
          )}
          {run.status === 'running' && (
            <>
              <ActionForm label="Pause" bg="#a16207" action={async () => {
                'use server'
                const r = await transitionRun(runId, 'paused', 'operator pause')
                await writeFeedback(runId, 'pause', r)
                redirect(PATH)
              }} />
              <ActionForm label="Emergency stop (no rollback)" bg="#991b1b" action={async () => {
                'use server'
                const r = await transitionRun(runId, 'stopped')
                await writeFeedback(runId, 'stop', r)
                redirect(PATH)
              }} />
            </>
          )}
          {run.status === 'paused' && (
            <>
              <ActionForm label="Resume" bg="#15803d" action={async () => {
                'use server'
                const r = await transitionRun(runId, 'running')
                await writeFeedback(runId, 'resume', r)
                redirect(PATH)
              }} />
              <ActionForm label="Stop (no rollback)" bg="#991b1b" action={async () => {
                'use server'
                const r = await transitionRun(runId, 'stopped')
                await writeFeedback(runId, 'stop', r)
                redirect(PATH)
              }} />
            </>
          )}

          {/* Emergency rollback — available in any non-draft state. Requires typed confirmation. */}
          {run.status !== 'draft' && (
            <form action={async (fd: FormData) => {
              'use server'
              const phrase = (fd.get('confirm') ?? '').toString()
              const r = await emergencyRollback(runId, phrase)
              await writeFeedback(runId, 'emergency_rollback', r)
              redirect(PATH)
            }} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input name="confirm" placeholder='type "rollback run"' style={{ padding: 6, fontSize: 12, border: '1px solid #991b1b', borderRadius: 4 }} />
              <button type="submit" style={{ background: '#991b1b', color: 'white', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Emergency rollback (bulk disable verified items)
              </button>
            </form>
          )}

          {run.status === 'stopped' && metrics.totals.rolled_back > 0 && (
            <ActionForm label="Revalidate next 10 rolled-back URLs" bg="#a16207" action={async () => {
              'use server'
              const r = await revalidateRolledBack(runId, 10)
              await writeFeedback(runId, 'reval_rolled_back', r)
              redirect(PATH)
            }} />
          )}
        </div>
      </section>

      {failures && failures.length > 0 && (
        <section style={{ marginTop: 20, background: '#fef2f2', border: '2px solid #b91c1c', borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, marginTop: 0, color: '#b91c1c' }}>Recent failures ({failures.length})</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6 }}>slug</th>
                <th style={{ textAlign: 'left', padding: 6 }}>last_error</th>
                <th style={{ textAlign: 'right', padding: 6 }}>attempts</th>
                <th style={{ textAlign: 'left', padding: 6 }}>updated_at</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f: Record<string, unknown>, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #fecaca' }}>
                  <td style={{ padding: 6 }}><code>{f.pp_card_slug as string}</code></td>
                  <td style={{ padding: 6 }}>{f.last_error as string}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{f.attempts as number}</td>
                  <td style={{ padding: 6 }}>{f.updated_at as string}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {recentVerified && recentVerified.length > 0 && (
        <section style={{ marginTop: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Last 10 verified</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'var(--bg-light)' }}>
                <th style={{ textAlign: 'left', padding: 6 }}>slug</th>
                <th style={{ textAlign: 'right', padding: 6 }}>gsc_rank</th>
                <th style={{ textAlign: 'left', padding: 6 }}>elig</th>
                <th style={{ textAlign: 'left', padding: 6 }}>verified_at</th>
                <th style={{ textAlign: 'right', padding: 6 }}>polls</th>
                <th style={{ textAlign: 'right', padding: 6 }}>ms activation</th>
                <th style={{ textAlign: 'right', padding: 6 }}>ms verify</th>
              </tr>
            </thead>
            <tbody>
              {recentVerified.map((r: Record<string, unknown>, i) => {
                const ev = (r.verification_evidence ?? {}) as Record<string, unknown>
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 6 }}><code>{r.pp_card_slug as string}</code></td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{(r.gsc_rank as number) ?? '—'}</td>
                    <td style={{ padding: 6 }}>{r.effective_eligibility as string}</td>
                    <td style={{ padding: 6 }}>{r.verified_at as string}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{ev.poll_attempts as number}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{ev.activation_duration_ms as number}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{ev.verification_duration_ms as number}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}

function StatCell({ label, value, highlight }: { label: string; value: number | string; highlight?: string }) {
  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: highlight ?? 'var(--text)' }}>{value}</div>
    </div>
  )
}

function ActionForm({ label, bg, action }: { label: string; bg: string; action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button type="submit" style={{ background: bg, color: 'white', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
        {label}
      </button>
    </form>
  )
}

async function writeFeedback(runId: string, kind: string, result: unknown) {
  const jar = await cookies()
  jar.set(`migration_feedback_${runId}`, `${kind}: ${JSON.stringify(result).slice(0, 450)}`, { httpOnly: true, sameSite: 'lax', path: `/admin/pilot/migration/${runId}`, maxAge: 300 })
}
