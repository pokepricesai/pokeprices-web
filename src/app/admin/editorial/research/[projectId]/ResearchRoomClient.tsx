'use client'
// src/app/admin/editorial/research/[projectId]/ResearchRoomClient.tsx
//
// EIC Block 6 — Research Room dashboard client.
//
// Sections:
//   1. Header + project brief
//   2. Status pill + action buttons (Build / Rebuild / Analyze / Approve / Revoke)
//   3. Methodology + Quality
//   4. Verified evidence (facts + findings)
//   5. Data tables
//   6. Warnings + research gaps + rejected claims
//   7. External sources (add/remove)
//   8. Research notes (add/remove)
//   9. Research Analyst
//   10. Visual opportunities

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AdminToolHeader from '@/components/admin/AdminToolHeader'
import type {
  EditorialResearchRow, EvidencePack, ResearchAnalysis,
  Warning, DataTable, VerifiedFact, DerivedFinding,
  ExternalSource, ResearchNote, QuarantineEntry,
} from '@/lib/editorial/research/types'

type ProjectRow = {
  id: number
  title: string
  angle: string | null
  article_type: string
  status: string
  target_publish_at: string | null
  notes: string | null
  insights_id: string | null
}

type Props = {
  project:         ProjectRow
  initialResearch: EditorialResearchRow | null
  chosenRecipe:    string
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}

async function post(url: string, body: any): Promise<any> {
  const auth = await authHeader()
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
  return j
}

export default function ResearchRoomClient({ project, initialResearch, chosenRecipe }: Props) {
  const [research, setResearch] = useState<EditorialResearchRow | null>(initialResearch)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingRebuild, setConfirmingRebuild] = useState(false)

  const url = `/api/admin/editorial/research/${project.id}`
  const pack = research?.evidence_json ?? null
  const analysis = research?.analyst_json ?? null

  const run = useCallback(async (label: string, body: any) => {
    setBusy(label); setError(null)
    try {
      const j = await post(url, body)
      setResearch(j.research ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally { setBusy(null) }
  }, [url])

  const doBuild   = () => run('build',    { action: 'build' })
  const doRebuild = () => run('rebuild',  { action: 'rebuild', force: research?.status === 'approved' ? confirmingRebuild : false })
  const doAnalyze = () => run('analyze',  { action: 'analyze' })
  const doApprove = () => run('approve',  { action: 'approve' })
  const doRevoke  = () => run('revoke',   { action: 'revoke' })

  const rebuildBlockedByApproval = research?.status === 'approved' && !confirmingRebuild

  return (
    <>
      <AdminToolHeader toolName="Research Room" />
      <div style={S.page}>
        <div style={S.container}>
          <div style={S.crumbs}>
            <Link href="/admin/editorial" style={S.crumbLink}>Editorial HQ</Link>
            <span style={S.crumbSep}>/</span>
            <span>Research Room</span>
          </div>

          <ProjectHeader project={project} chosenRecipe={chosenRecipe} research={research} />

          <div style={S.actionBar}>
            {!pack && (
              <button style={S.btnPrimary} disabled={!!busy} onClick={doBuild}>
                {busy === 'build' ? 'Building…' : 'Build research'}
              </button>
            )}
            {pack && (
              <>
                {rebuildBlockedByApproval ? (
                  <button style={S.btnWarn} disabled={!!busy} onClick={() => setConfirmingRebuild(true)}>
                    Rebuild (will revoke approval)…
                  </button>
                ) : (
                  <button style={S.btnPrimary} disabled={!!busy} onClick={doRebuild}>
                    {busy === 'rebuild' ? 'Rebuilding…' : (confirmingRebuild ? 'Confirm rebuild + revoke' : 'Rebuild')}
                  </button>
                )}
                <button style={S.btnPrimary} disabled={!!busy} onClick={doAnalyze}>
                  {busy === 'analyze' ? 'Analyzing…' : (analysis ? 'Re-run Analyst' : 'Analyze with AI')}
                </button>
                {research?.status !== 'approved' && (
                  <button
                    style={pack.quality.publishable && !pack.warnings.some(w => w.severity === 'critical') ? S.btnGreen : S.btnDisabled}
                    disabled={!!busy || !pack.quality.publishable || pack.warnings.some(w => w.severity === 'critical')}
                    onClick={doApprove}
                    title={!pack.quality.publishable ? pack.quality.reasons.join(' · ') : ''}
                  >
                    {busy === 'approve' ? 'Approving…' : 'Approve evidence'}
                  </button>
                )}
                {research?.status === 'approved' && (
                  <button style={S.btnWarn} disabled={!!busy} onClick={doRevoke}>
                    {busy === 'revoke' ? 'Revoking…' : 'Revoke approval'}
                  </button>
                )}
              </>
            )}
          </div>

          {error && <div style={S.errorBox}>{error}</div>}

          {!pack && (
            <div style={S.emptyBox}>
              No research pack yet. Click <strong>Build research</strong> to run the <code>{chosenRecipe}</code> recipe against live data.
            </div>
          )}

          {pack && (
            <>
              <QualityCard pack={pack} />
              <Methodology pack={pack} />
              <VerifiedEvidence pack={pack} />
              <DataTables pack={pack} />
              <Warnings pack={pack} />
              <Quarantined pack={pack} />
              <ResearchGaps pack={pack} />
              <ExternalSources pack={pack} projectUrl={url} onUpdated={setResearch} busy={busy} setBusy={setBusy} setError={setError} />
              <ResearchNotes    pack={pack} projectUrl={url} onUpdated={setResearch} busy={busy} setBusy={setBusy} setError={setError} />
              <AnalystSection   analysis={analysis} onAnalyze={doAnalyze} busy={busy} />
              <VisualOpportunities pack={pack} />
              <RejectedClaims pack={pack} />
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// Components
// ─────────────────────────────────────────────────────────────────

function ProjectHeader({ project, chosenRecipe, research }: { project: ProjectRow; chosenRecipe: string; research: EditorialResearchRow | null }) {
  return (
    <div style={S.header}>
      <div style={{ flex: 1 }}>
        <div style={S.eyebrow}>Research Room · {chosenRecipe}</div>
        <h1 style={S.h1}>{project.title}</h1>
        <div style={S.brief}>
          <span><strong>Type:</strong> {project.article_type}</span>
          {project.target_publish_at && <span><strong>Target:</strong> {project.target_publish_at}</span>}
          <span><strong>Project status:</strong> {project.status}</span>
        </div>
        {project.angle && <p style={S.angle}>{project.angle}</p>}
      </div>
      <div>
        <StatusPill status={research?.status ?? 'not_started'} />
        {research?.approved_at && <div style={S.approvedBy}>Approved by {research.approved_by} · {new Date(research.approved_at).toLocaleString()}</div>}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    not_started:     { bg: '#f1f5f9', fg: '#334155', label: 'Not started' },
    gathering:       { bg: '#e0f2fe', fg: '#0369a1', label: 'Gathering' },
    review_required: { bg: '#fef3c7', fg: '#92400e', label: 'Review required' },
    blocked:         { bg: '#fee2e2', fg: '#991b1b', label: 'Blocked' },
    approved:        { bg: '#dcfce7', fg: '#166534', label: 'Approved' },
  }
  const s = map[status] ?? map.not_started
  return <span style={{ ...S.pill, background: s.bg, color: s.fg }}>{s.label}</span>
}

function QualityCard({ pack }: { pack: EvidencePack }) {
  const q = pack.quality
  const bg = q.status === 'blocked' ? '#fef2f2' : q.status === 'needs_review' ? '#fffbeb' : '#f0fdf4'
  const border = q.status === 'blocked' ? '#fca5a5' : q.status === 'needs_review' ? '#fbbf24' : '#86efac'
  return (
    <div style={{ ...S.section, background: bg, border: `1px solid ${border}` }}>
      <h2 style={S.h2}>Quality</h2>
      <div style={S.qGrid}>
        <div><strong>Status:</strong> {q.status}</div>
        <div><strong>Data strength:</strong> {q.dataStrength}</div>
        <div><strong>Sample size:</strong> {q.sampleSize.toLocaleString()}</div>
        <div><strong>Publishable:</strong> {q.publishable ? 'yes' : 'no'}</div>
        <div><strong>Freshness:</strong> {q.freshness.asOf} ({q.freshness.daysOld}d old{q.freshness.isStale ? ', stale' : ''})</div>
      </div>
      <ul style={S.reasons}>
        {q.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  )
}

function Methodology({ pack }: { pack: EvidencePack }) {
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Methodology</h2>
      <p style={S.body}>{pack.methodology.summary}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <h3 style={S.h3}>Filters</h3>
          <ul style={S.list}>
            {pack.methodology.filters.map((f, i) => <li key={i}><strong>{f.label}:</strong> {f.value}</li>)}
          </ul>
        </div>
        <div>
          <h3 style={S.h3}>Excluded groups</h3>
          {pack.methodology.excludedGroups.length === 0 ? (
            <p style={S.muted}>None</p>
          ) : (
            <ul style={S.list}>
              {pack.methodology.excludedGroups.map((e, i) => <li key={i}><strong>{e.label}:</strong> {e.reason}</li>)}
            </ul>
          )}
        </div>
      </div>
      <p style={S.muted}><strong>Dedup key:</strong> {pack.methodology.dedupKey}</p>
    </div>
  )
}

function VerifiedEvidence({ pack }: { pack: EvidencePack }) {
  if (pack.verifiedFacts.length === 0 && pack.derivedFindings.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Verified evidence</h2>
      <h3 style={S.h3}>Verified facts ({pack.verifiedFacts.length})</h3>
      <ul style={S.list}>
        {pack.verifiedFacts.map((f: VerifiedFact) => (
          <li key={f.id}>
            {f.statement}
            <span style={S.evidenceRefs}> [{f.evidenceRefs.join(', ') || '—'}{f.asOf ? ` · as of ${f.asOf}` : ''}]</span>
          </li>
        ))}
      </ul>
      <h3 style={S.h3}>Derived findings ({pack.derivedFindings.length})</h3>
      <ul style={S.list}>
        {pack.derivedFindings.map((f: DerivedFinding) => (
          <li key={f.id}>
            {f.statement}
            {f.formula && <span style={S.formula}> ({f.formula})</span>}
            <span style={S.evidenceRefs}> [{f.evidenceRefs.join(', ') || '—'}]</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DataTables({ pack }: { pack: EvidencePack }) {
  if (pack.dataTables.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Data tables</h2>
      {pack.dataTables.map((t: DataTable) => (
        <div key={t.id} style={{ marginBottom: 20 }}>
          <h3 style={S.h3}>{t.title}</h3>
          <div style={S.muted}>Source: {t.source} · as of {t.asOf} · {t.rows.length} row{t.rows.length === 1 ? '' : 's'}</div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {t.columns.map(c => <th key={c.key} style={{ ...S.th, textAlign: (c.align ?? 'left') as any }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, i) => (
                  <tr key={i}>
                    {t.columns.map(c => {
                      const v = row[c.key]
                      return <td key={c.key} style={{ ...S.td, textAlign: (c.align ?? 'left') as any }}>{v == null || v === '' ? '—' : String(v)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function Warnings({ pack }: { pack: EvidencePack }) {
  if (pack.warnings.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Warnings ({pack.warnings.length})</h2>
      <ul style={S.list}>
        {pack.warnings.map((w: Warning) => (
          <li key={w.id} style={{ color: sevColor(w.severity) }}>
            <strong>[{w.severity}]</strong> {w.message}
            {w.affects && <span style={S.muted}> · {w.affects}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
function sevColor(sev: string): string {
  return sev === 'critical' ? '#991b1b' : sev === 'major' ? '#b45309' : sev === 'minor' ? '#334155' : '#64748b'
}

function Quarantined({ pack }: { pack: EvidencePack }) {
  const rows = pack.quarantinedRows ?? []
  if (rows.length === 0) return null
  // Union of every rowSnapshot key so the table shows every column
  // any quarantined row provides (data tables differ per recipe).
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r.rowSnapshot))))
  return (
    <div style={{ ...S.section, background: '#fff7ed', border: '1px solid #fdba74' }}>
      <h2 style={S.h2}>Quarantined rows ({rows.length})</h2>
      <p style={S.body}>These rows were considered by the recipe but excluded from every publishable table because they failed a deterministic integrity check. They are shown here so reviewers can see what was removed and why. A row is only restored after manual verification.</p>
      {rows.map((q: QuarantineEntry) => (
        <div key={q.id} style={{ padding: 12, marginBottom: 10, background: 'white', border: '1px solid #fed7aa', borderRadius: 6 }}>
          <div style={{ fontWeight: 700, color: sevColor(q.severity) }}>
            [{q.reason}] · {q.severity}{q.contaminatesPublishable ? ' · CONTAMINATES PUBLISHABLE (blocks approval)' : ' · isolated'}
          </div>
          <div style={{ ...S.body, marginTop: 4 }}>{q.message}</div>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={S.table}>
              <thead><tr>{keys.map(k => <th key={k} style={S.th}>{k}</th>)}</tr></thead>
              <tbody>
                <tr>
                  {keys.map(k => {
                    const v = q.rowSnapshot[k]
                    return <td key={k} style={S.td}>{v == null || v === '' ? '—' : String(v)}</td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={S.muted}>Would have joined: {q.wouldHaveJoined}</div>
        </div>
      ))}
    </div>
  )
}

function ResearchGaps({ pack }: { pack: EvidencePack }) {
  if (pack.researchGaps.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Research gaps</h2>
      <ul style={S.list}>{pack.researchGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
    </div>
  )
}

function RejectedClaims({ pack }: { pack: EvidencePack }) {
  if (pack.rejectedClaims.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Rejected claims</h2>
      <p style={S.muted}>These claims are NOT supported by the current evidence pack. The article must not make them.</p>
      <ul style={S.list}>
        {pack.rejectedClaims.map((r, i) => (
          <li key={i}><strong>{r.claim}</strong> — {r.reason}</li>
        ))}
      </ul>
    </div>
  )
}

function VisualOpportunities({ pack }: { pack: EvidencePack }) {
  if (pack.visualOpportunities.length === 0) return null
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Visual opportunities</h2>
      <ul style={S.list}>{pack.visualOpportunities.map((v, i) => <li key={i}>{v}</li>)}</ul>
    </div>
  )
}

function ExternalSources({ pack, projectUrl, onUpdated, busy, setBusy, setError }: {
  pack: EvidencePack; projectUrl: string;
  onUpdated: (r: EditorialResearchRow | null) => void;
  busy: string | null; setBusy: (v: string | null) => void; setError: (v: string | null) => void;
}) {
  const [form, setForm] = useState({ url: '', title: '', publisher: '', publicationDate: '', note: '', supportsFactId: '' })

  const add = useCallback(async () => {
    if (!form.url.trim() || !form.title.trim()) { setError('URL and title required'); return }
    setBusy('add-source'); setError(null)
    try {
      const j = await post(projectUrl, { action: 'add_external_source', ...form })
      onUpdated(j.research)
      setForm({ url: '', title: '', publisher: '', publicationDate: '', note: '', supportsFactId: '' })
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
    finally { setBusy(null) }
  }, [form, projectUrl, onUpdated, setBusy, setError])

  const remove = useCallback(async (id: string) => {
    setBusy(`remove-source-${id}`); setError(null)
    try {
      const j = await post(projectUrl, { action: 'remove_external_source', sourceId: id })
      onUpdated(j.research)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
    finally { setBusy(null) }
  }, [projectUrl, onUpdated, setBusy, setError])

  return (
    <div style={S.section}>
      <h2 style={S.h2}>External sources ({pack.externalSources.length})</h2>
      {pack.externalSources.length === 0 ? (
        <p style={S.muted}>No external sources attached yet.</p>
      ) : (
        <ul style={S.list}>
          {pack.externalSources.map((s: ExternalSource) => (
            <li key={s.id} style={{ marginBottom: 8 }}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0369a1' }}>{s.title}</a>
              {s.publisher && <span style={S.muted}> · {s.publisher}</span>}
              {s.publicationDate && <span style={S.muted}> · {s.publicationDate}</span>}
              {s.note && <div style={S.muted}>Note: {s.note}</div>}
              {s.supportsFactId && <div style={S.muted}>Supports fact: {s.supportsFactId}</div>}
              <button style={S.btnLink} disabled={!!busy} onClick={() => remove(s.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div style={S.formRow}>
        <input placeholder="URL" style={S.input} value={form.url}   onChange={e => setForm({ ...form, url: e.target.value })} />
        <input placeholder="Title" style={S.input} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        <input placeholder="Publisher (optional)" style={S.input} value={form.publisher} onChange={e => setForm({ ...form, publisher: e.target.value })} />
        <input placeholder="Publication date (optional)" style={S.input} value={form.publicationDate} onChange={e => setForm({ ...form, publicationDate: e.target.value })} />
        <input placeholder="Supports fact id (optional)" style={S.input} value={form.supportsFactId} onChange={e => setForm({ ...form, supportsFactId: e.target.value })} />
        <input placeholder="Note (optional)" style={S.input} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
        <button style={S.btnPrimary} disabled={!!busy} onClick={add}>{busy === 'add-source' ? 'Adding…' : 'Add source'}</button>
      </div>
    </div>
  )
}

function ResearchNotes({ pack, projectUrl, onUpdated, busy, setBusy, setError }: {
  pack: EvidencePack; projectUrl: string;
  onUpdated: (r: EditorialResearchRow | null) => void;
  busy: string | null; setBusy: (v: string | null) => void; setError: (v: string | null) => void;
}) {
  const [body, setBody] = useState('')
  const add = useCallback(async () => {
    if (!body.trim()) return
    setBusy('add-note'); setError(null)
    try {
      const j = await post(projectUrl, { action: 'add_note', body })
      onUpdated(j.research); setBody('')
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
    finally { setBusy(null) }
  }, [body, projectUrl, onUpdated, setBusy, setError])
  const remove = useCallback(async (id: string) => {
    setBusy(`remove-note-${id}`); setError(null)
    try {
      const j = await post(projectUrl, { action: 'remove_note', noteId: id })
      onUpdated(j.research)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
    finally { setBusy(null) }
  }, [projectUrl, onUpdated, setBusy, setError])
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Research notes ({pack.notes.length})</h2>
      {pack.notes.length === 0 ? <p style={S.muted}>No notes yet.</p> : (
        <ul style={S.list}>
          {pack.notes.map((n: ResearchNote) => (
            <li key={n.id} style={{ marginBottom: 8 }}>
              <div>{n.body}</div>
              <div style={S.muted}>{new Date(n.addedAt).toLocaleString()} · {n.addedBy ?? 'admin'}</div>
              <button style={S.btnLink} disabled={!!busy} onClick={() => remove(n.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <textarea rows={3} style={{ ...S.input, width: '100%' }} placeholder="Add a research note (what you observed, what you resolved, what's still uncertain)" value={body} onChange={e => setBody(e.target.value)} />
      <button style={S.btnPrimary} disabled={!!busy || !body.trim()} onClick={add}>{busy === 'add-note' ? 'Adding…' : 'Add note'}</button>
    </div>
  )
}

function AnalystSection({ analysis, onAnalyze, busy }: { analysis: ResearchAnalysis | null; onAnalyze: () => void; busy: string | null }) {
  return (
    <div style={S.section}>
      <h2 style={S.h2}>Research Analyst</h2>
      {!analysis ? (
        <div>
          <p style={S.muted}>No AI interpretation yet.</p>
          <button style={S.btnPrimary} disabled={!!busy} onClick={onAnalyze}>{busy === 'analyze' ? 'Analyzing…' : 'Analyze with AI'}</button>
        </div>
      ) : (
        <div>
          <div style={{ ...S.pill, background: recBg(analysis.publishRecommendation), color: recFg(analysis.publishRecommendation), display: 'inline-block', marginBottom: 12 }}>
            Publish recommendation: {analysis.publishRecommendation}
          </div>
          <p style={S.body}>{analysis.summary}</p>
          {analysis.recommendedAngle && <>
            <h3 style={S.h3}>Recommended angle</h3>
            <p style={S.body}>{analysis.recommendedAngle}</p>
          </>}
          {analysis.headlineCandidates.length > 0 && <>
            <h3 style={S.h3}>Headline candidates</h3>
            <ul style={S.list}>{analysis.headlineCandidates.map((h, i) => <li key={i}>{h}</li>)}</ul>
          </>}
          {analysis.strongestFindings.length > 0 && <>
            <h3 style={S.h3}>Strongest findings</h3>
            <ul style={S.list}>{analysis.strongestFindings.map((f, i) => <li key={i}><strong>{f.finding}</strong>{f.reason ? ` — ${f.reason}` : ''}</li>)}</ul>
          </>}
          {analysis.weakerFindings.length > 0 && <>
            <h3 style={S.h3}>Weaker findings</h3>
            <ul style={S.list}>{analysis.weakerFindings.map((f, i) => <li key={i}><strong>{f.finding}</strong>{f.reason ? ` — ${f.reason}` : ''}</li>)}</ul>
          </>}
          {analysis.requiredCaveats.length > 0 && <>
            <h3 style={S.h3}>Required caveats</h3>
            <ul style={S.list}>{analysis.requiredCaveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>}
          {analysis.missingResearch.length > 0 && <>
            <h3 style={S.h3}>Missing research</h3>
            <ul style={S.list}>{analysis.missingResearch.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>}
          {analysis.unresolvedQuestions.length > 0 && <>
            <h3 style={S.h3}>Unresolved questions</h3>
            <ul style={S.list}>{analysis.unresolvedQuestions.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>}
          {analysis.recommendedVisuals.length > 0 && <>
            <h3 style={S.h3}>Recommended visuals</h3>
            <ul style={S.list}>{analysis.recommendedVisuals.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </>}
          {analysis.contradictions.length > 0 && <>
            <h3 style={S.h3}>Contradictions</h3>
            <ul style={S.list}>{analysis.contradictions.map((c, i) => <li key={i}>{c.description} <span style={S.muted}>({c.involves.join(', ')})</span></li>)}</ul>
          </>}
          <h3 style={S.h3}>Why this recommendation</h3>
          <ul style={S.list}>{analysis.publishRecommendationReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div style={S.muted}>Generated {new Date(analysis.generatedAt).toLocaleString()} for pack v{analysis.packRecipe}@{analysis.packGeneratedAt}</div>
        </div>
      )}
    </div>
  )
}
function recBg(v: string): string { return v === 'ready' ? '#dcfce7' : v === 'ready_with_caveats' ? '#fef3c7' : v === 'more_research_needed' ? '#e0f2fe' : '#fee2e2' }
function recFg(v: string): string { return v === 'ready' ? '#166534' : v === 'ready_with_caveats' ? '#92400e' : v === 'more_research_needed' ? '#0369a1' : '#991b1b' }

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const S: Record<string, any> = {
  page:      { minHeight: '100vh', background: 'var(--bg-light, #f8fafc)', padding: '24px 16px' },
  container: { maxWidth: 1200, margin: '0 auto' },
  crumbs:    { fontSize: 13, marginBottom: 12, color: '#64748b' },
  crumbLink: { color: '#0369a1', textDecoration: 'none' },
  crumbSep:  { margin: '0 8px' },
  header:    { display: 'flex', alignItems: 'flex-start', gap: 16, padding: 20, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 },
  eyebrow:   { fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: '#64748b', marginBottom: 4 },
  h1:        { fontSize: 24, fontWeight: 700, margin: '0 0 8px 0' },
  brief:     { display: 'flex', gap: 16, fontSize: 13, color: '#334155', flexWrap: 'wrap' },
  angle:     { marginTop: 8, color: '#475569', fontSize: 14 },
  approvedBy:{ fontSize: 11, color: '#64748b', marginTop: 6, textAlign: 'right' as any },
  pill:      { padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600, textTransform: 'uppercase' as any, letterSpacing: 0.4 },
  actionBar: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as any },
  btnPrimary:{ padding: '8px 14px', borderRadius: 6, background: '#0369a1', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGreen:  { padding: '8px 14px', borderRadius: 6, background: '#16a34a', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnWarn:   { padding: '8px 14px', borderRadius: 6, background: '#b45309', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnDisabled:{ padding: '8px 14px', borderRadius: 6, background: '#cbd5e1', color: '#475569', border: 'none', cursor: 'not-allowed', fontSize: 13, fontWeight: 600 },
  btnLink:   { padding: '2px 6px', background: 'transparent', color: '#dc2626', border: 'none', cursor: 'pointer', fontSize: 12, marginLeft: 8 },
  section:   { padding: 20, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 16 },
  h2:        { fontSize: 18, fontWeight: 700, margin: '0 0 12px 0', color: '#0f172a' },
  h3:        { fontSize: 14, fontWeight: 700, margin: '12px 0 6px 0', color: '#334155' },
  body:      { fontSize: 14, color: '#334155', lineHeight: 1.6, margin: 0 },
  list:      { fontSize: 13, color: '#334155', lineHeight: 1.55, margin: '0 0 8px 20px', padding: 0 },
  qGrid:     { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: 13, marginBottom: 8 },
  reasons:   { fontSize: 12, color: '#334155', margin: '0 0 0 20px' },
  errorBox:  { padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 6, marginBottom: 12 },
  emptyBox:  { padding: 20, background: 'white', border: '1px dashed #cbd5e1', borderRadius: 8, color: '#475569', fontSize: 14 },
  muted:     { fontSize: 12, color: '#64748b' },
  table:     { width: '100%', borderCollapse: 'collapse' as any, fontSize: 12 },
  th:        { padding: '6px 8px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#334155' },
  td:        { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', color: '#334155' },
  evidenceRefs: { fontSize: 11, color: '#64748b' },
  formula:   { fontSize: 12, color: '#64748b', fontFamily: 'monospace' },
  formRow:   { display: 'flex', gap: 8, flexWrap: 'wrap' as any, marginTop: 8 },
  input:     { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13, minWidth: 180 },
}
