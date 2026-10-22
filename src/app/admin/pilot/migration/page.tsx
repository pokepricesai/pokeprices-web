// Admin dashboard — automated migration index. Lists all runs with
// current status + aggregate counts. Create-run form at the top.
//
// Access: cookie-based admin session via requireAdminPage. Same gate
// as the rest of /admin/*.

import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runMetrics } from '@/lib/providerData/migration/metrics'
import { createRun } from './actions'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { MigrationRun } from '@/lib/providerData/migration/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const metadata = {
  title: 'PP-TCG migration dashboard',
  robots: { index: false, follow: false, nocache: true, noarchive: true },
}

const PATH = '/admin/pilot/migration'

export default async function Page() {
  await requireAdminPage(PATH)
  const sb = getSupabaseServiceClient()
  const { data: runsRaw } = await sb.from('pp_tcg_migration_run')
    .select('*').order('created_at', { ascending: false })
  const runs: MigrationRun[] = (runsRaw ?? []) as unknown as MigrationRun[]

  // Headline counts: current provider-active cards + staged pool
  const { count: cohortActive } = await sb.from('pokemon_tcg_pilot_cohort').select('*', { count: 'exact', head: true }).eq('prices_enabled', true)
  const { count: cohortTotal } = await sb.from('pokemon_tcg_pilot_cohort').select('*', { count: 'exact', head: true })

  const metricsByRun: Record<string, Awaited<ReturnType<typeof runMetrics>>> = {}
  for (const r of runs) metricsByRun[r.id] = await runMetrics(sb, r.id)

  return (
    <main style={{ maxWidth: 1200, margin: '32px auto', padding: '0 20px', fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800 }}>PP-TCG migration dashboard</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Automated full-catalogue migration runs. Deploys inactive. No run auto-starts; operator transitions
        draft → ready → running via the detail page. All operations gated by cookie admin session.
        <br />
        <strong>Current cohort state:</strong> {cohortActive}/{cohortTotal} rows prices_enabled=true.
      </p>

      <section style={{ marginTop: 24, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Create new run</h2>
        <form action={async (fd: FormData) => {
          'use server'
          const name = (fd.get('name') ?? '').toString().trim() || `run-${new Date().toISOString().slice(0,16)}`
          const language = ((fd.get('language') ?? 'any').toString()) as 'en' | 'jp' | 'any'
          const strategy = ((fd.get('strategy') ?? 'gsc_rank').toString()) as 'gsc_rank' | 'set_proximity_then_rank' | 'all_strict'
          const daily_cap = Number(fd.get('daily_cap') ?? 5) || 5
          const batch_size = Number(fd.get('batch_size') ?? 5) || 5
          const r = await createRun(name, { language, selection_strategy: strategy, daily_cap, batch_size })
          if ('error' in r) throw new Error(r.error)
          redirect(`${PATH}/${r.id}`)
        }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input name="name" placeholder="Run name (e.g. phase2-en-catalogue)" style={{ padding: 8, fontSize: 13, flex: '1 1 220px' }} />
          <select name="language" style={{ padding: 8, fontSize: 13 }}>
            <option value="any">any</option>
            <option value="en">en</option>
            <option value="jp">jp</option>
          </select>
          <select name="strategy" style={{ padding: 8, fontSize: 13 }}>
            <option value="gsc_rank">gsc_rank</option>
            <option value="set_proximity_then_rank">set_proximity_then_rank</option>
            <option value="all_strict">all_strict</option>
          </select>
          <input name="daily_cap" type="number" min={1} max={5000} defaultValue={5} style={{ padding: 8, fontSize: 13, width: 100 }} placeholder="daily_cap" />
          <input name="batch_size" type="number" min={1} max={25} defaultValue={5} style={{ padding: 8, fontSize: 13, width: 100 }} placeholder="batch_size" />
          <button type="submit" style={{ background: '#1a5fad', color: 'white', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Create draft run
          </button>
        </form>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          New runs start in <strong>draft</strong>. Enrol items on the detail page, then transition draft → ready → running.
        </p>
      </section>

      <h2 style={{ fontSize: 16, marginTop: 32 }}>All runs ({runs.length})</h2>
      {runs.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No migration runs yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 10 }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>name</th>
              <th style={{ textAlign: 'left', padding: 8 }}>status</th>
              <th style={{ textAlign: 'right', padding: 8 }}>total</th>
              <th style={{ textAlign: 'right', padding: 8 }}>pending</th>
              <th style={{ textAlign: 'right', padding: 8 }}>verified</th>
              <th style={{ textAlign: 'right', padding: 8 }}>failed</th>
              <th style={{ textAlign: 'right', padding: 8 }}>today</th>
              <th style={{ textAlign: 'right', padding: 8 }}>last 24h</th>
              <th style={{ textAlign: 'right', padding: 8 }}>ETA h</th>
              <th style={{ textAlign: 'left', padding: 8 }}>pause reason</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => {
              const m = metricsByRun[r.id]
              return (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8 }}><strong>{r.name}</strong></td>
                  <td style={{ padding: 8 }}><StatusBadge status={r.status} /></td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.totals.total ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.totals.pending ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.totals.verified ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right', color: (m?.totals.failed ?? 0) > 0 ? '#b91c1c' : undefined }}>{m?.totals.failed ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.throughput.today ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.throughput.last_24h ?? '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{m?.eta_hours ?? '—'}</td>
                  <td style={{ padding: 8, fontSize: 11, color: '#a16207' }}>{r.pause_reason ?? ''}</td>
                  <td style={{ padding: 8 }}><Link href={`${PATH}/${r.id}`} style={{ color: '#1a5fad', fontWeight: 700 }}>open →</Link></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 32, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>Scope invariants</strong>
        <ul>
          <li>Only slugs enrolled in <code>pp_tcg_migration_run_item</code> can be mutated by any run.</li>
          <li>14 original pilot + 4 thin + 10 manual expansion cards are not in any run_item — invisible to automation.</li>
          <li>Cron fires every 10 min. Hits <code>/api/cron/pp-tcg-migration-tick</code> with <code>Authorization: Bearer $CRON_SECRET</code>. Rejects anything else.</li>
          <li>Each tick: atomic claim (FOR UPDATE SKIP LOCKED), per-item strict re-check, flip, revalidate, poll-verify. Rollback on verify failure. Never auto-re-enables.</li>
        </ul>
      </div>
    </main>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: '#64748b', ready: '#1a5fad', running: '#15803d',
    paused: '#a16207', stopped: '#991b1b', completed: '#065f46',
  }
  const bg = colors[status] ?? '#64748b'
  return <span style={{ background: bg, color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{status}</span>
}
