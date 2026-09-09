'use client'
// src/app/admin/editorial/studio/[projectId]/PublicationPanel.tsx
//
// EIC Block 10 — Studio Publication tab.
//
// Sections:
//   * Preflight — colour-coded check list, warnings, refresh button
//   * Slug — editable, server-side re-validated
//   * Actions: Prepare draft / Mark ready / Publish / Update
//     published / Unpublish. Each explicit; publish and unpublish
//     require a confirmation click.
//   * Payload preview — deterministic insights row that will be
//     written, plus the canonical URL

import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { PreflightResult } from '@/lib/editorial/publishing/preflight'
import type { InsightPayload } from '@/lib/editorial/publishing/payload'
import { generateSlug } from '@/lib/editorial/publishing/slug'

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}

type Props = {
  projectId:     number
  projectStatus: string
  projectTitle:  string
  insightsId:    string | null
  onInsightsIdChange: (id: string | null) => void
  onProjectStatusChange: (status: string) => void
}

export function PublicationPanel({ projectId, projectStatus, projectTitle, insightsId, onInsightsIdChange, onProjectStatusChange }: Props) {
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [loading, setLoading]     = useState(true)
  const [busy, setBusy]           = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [slug, setSlug]           = useState<string>('')

  const load = useCallback(async (override?: string) => {
    setLoading(true); setError(null)
    try {
      const auth = await authHeader()
      const url = new URL(`/api/admin/editorial/studio/${projectId}/preflight`, window.location.origin)
      if (override) url.searchParams.set('slug', override)
      const res = await fetch(url, { headers: auth })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      setPreflight(j.preflight as PreflightResult)
      // Only reset slug from server when user hasn't typed one yet.
      if (!slug) setSlug((j.preflight as PreflightResult).suggestedSlug)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally { setLoading(false) }
  }, [projectId, slug])

  useEffect(() => { load() }, [projectId])   // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = useCallback(async (action: string) => {
    setBusy(action); setError(null)
    try {
      const auth = await authHeader()
      const res = await fetch(`/api/admin/editorial/studio/${projectId}/publish`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ action, slugOverride: slug || undefined }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      setPreflight(j.preflight as PreflightResult)
      if (j.insightsId != null) onInsightsIdChange(j.insightsId as string | null)
      if (j.preflight?.linkedInsightsId != null) onInsightsIdChange(j.preflight.linkedInsightsId as string | null)
      // Bump the project status locally so HQ chips + the Studio
      // header refresh even though we haven't re-fetched the page.
      if (action === 'publish' || action === 'update_published') onProjectStatusChange('published')
      if (action === 'unpublish') onProjectStatusChange('drafting')
      if (action === 'mark_ready') onProjectStatusChange('ready')
      // Override does not itself change status — the admin still
      // clicks Mark ready afterwards. Just close the confirmation.
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally { setBusy(null) }
  }, [projectId, slug, onInsightsIdChange, onProjectStatusChange])

  const pass = preflight?.status === 'pass'
  const canonicalUrl = slug ? `https://www.pokeprices.io/insights/${slug}` : ''
  const isReady = projectStatus === 'ready' || projectStatus === 'published'
  const hasPublished = !!insightsId && preflight?.checks.some(c => c.id === 'slug.unique' && c.severity === 'ok') && projectStatus === 'published'

  // Editorial override affordance — internal projects only. The
  // override lets an admin bypass the automated fact/numeric gates
  // AFTER manually reviewing the article. It cannot bypass missing
  // research approval, CMS essentials, invalid/duplicate slugs, or
  // adapter conversion failures — those remain blockers.
  const blockers = preflight?.checks.filter(c => c.severity === 'blocker') ?? []
  const factBlockers  = blockers.filter(c => c.id.startsWith('factcheck.'))
  const otherBlockers = blockers.filter(c => !c.id.startsWith('factcheck.'))
  const isInternal = (preflight?.checks.some(c => c.id === 'research.approved') ?? false)
    || (preflight?.checks.some(c => c.id.startsWith('factcheck.')) ?? false)
    || !!preflight?.editorialOverride
  const activeOverride = preflight?.editorialOverride && preflight.editorialOverride.boundToCurrentDraft ? preflight.editorialOverride : null
  const canOverride = isInternal && !activeOverride && factBlockers.length > 0 && otherBlockers.length === 0

  return (
    <div style={S.wrap}>
      <div style={S.section}>
        <div style={S.title}>Slug</div>
        <div style={S.hint}>Public URL: <code>{canonicalUrl || '(needs a slug)'}</code></div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            style={S.input}
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder={generateSlug(projectTitle)}
          />
          <button style={S.btnGhost} onClick={() => load(slug)}>Recheck</button>
        </div>
      </div>

      <div style={S.section}>
        <div style={S.titleRow}>
          <div style={S.title}>Preflight</div>
          <button style={S.btnGhost} onClick={() => load(slug)}>Refresh</button>
        </div>
        {loading && <div style={S.hint}>Loading…</div>}
        {error && <div style={S.error}>{error}</div>}
        {preflight && (
          <>
            <div style={{ ...S.pill, background: pass ? '#dcfce7' : '#fee2e2', color: pass ? '#166534' : '#991b1b', marginBottom: 8 }}>
              {pass ? 'Preflight: pass' : 'Preflight: blocked'}
            </div>
            <ul style={S.list}>
              {preflight.checks.map(c => (
                <li key={c.id} style={{ color: c.severity === 'blocker' ? '#991b1b' : c.severity === 'warning' ? '#b45309' : '#166534' }}>
                  {c.severity === 'ok' ? '✓' : c.severity === 'warning' ? '⚠' : '✗'} {c.label}
                  {c.detail && <span style={S.muted}> — {c.detail}</span>}
                </li>
              ))}
            </ul>
            {preflight.warnings.length > 0 && (
              <>
                <div style={{ ...S.title, marginTop: 8, color: '#b45309' }}>Warnings</div>
                <ul style={S.list}>
                  {preflight.warnings.map((w, i) => (
                    <li key={i} style={{ color: '#b45309' }}>⚠ {w.label}{w.detail ? ` — ${w.detail}` : ''}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {activeOverride && (
        <div style={S.overrideBanner}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Automated checks overridden</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            {activeOverride.overriddenBy} on {activeOverride.overriddenAt.slice(0, 10)}
            {activeOverride.unresolvedIssueCount ? ` · ${activeOverride.unresolvedIssueCount} unresolved issue(s) at time of override` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#78350f', marginBottom: 8 }}>
            The override applies to the current draft only. Regenerating the article will clear it automatically and require a fresh review.
          </div>
          <button style={S.btnGhost} disabled={!!busy} onClick={() => runAction('clear_override')} title="Retract the override and require automated checks to pass again">
            {busy === 'clear_override' ? 'Clearing…' : 'Clear override'}
          </button>
        </div>
      )}

      {canOverride && (
        confirming === 'override' ? (
          <div style={S.overrideConfirm}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Override automated checks?</div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              This article still has unresolved automated fact/data checks. You are confirming that you have manually reviewed the article and want to publish it anyway.
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.btnPrimary} disabled={!!busy} onClick={() => runAction('override_checks')}>
                {busy === 'override_checks' ? 'Overriding…' : 'Override & Mark Ready'}
              </button>
              <button style={S.btnGhost} onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={S.overridePrompt}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Automated checks found unresolved issues.</div>
            <ul style={{ ...S.list, marginBottom: 8, color: '#991b1b' }}>
              {factBlockers.map(b => <li key={b.id}>✗ {b.label}{b.detail ? ` — ${b.detail}` : ''}</li>)}
            </ul>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.btnGhost} disabled={!!busy} onClick={() => load(slug)}>Retry Validation</button>
              <button style={S.btnGhost} disabled={!!busy} onClick={() => setConfirming('override')}>Override Checks &amp; Mark Ready</button>
            </div>
          </div>
        )
      )}

      <div style={S.section}>
        <div style={S.title}>Actions</div>
        {!isReady && (
          <button style={{ ...S.btnPrimary, marginRight: 6 }} disabled={!!busy || !pass} onClick={() => runAction('mark_ready')}>
            {busy === 'mark_ready' ? 'Marking…' : 'Mark ready'}
          </button>
        )}
        <button style={{ ...S.btnGhost, marginRight: 6 }} disabled={!!busy} onClick={() => runAction('prepare_draft')}>
          {busy === 'prepare_draft' ? 'Preparing…' : insightsId ? 'Update draft' : 'Prepare draft'}
        </button>

        {!insightsId && (
          confirming === 'publish' ? (
            <div style={S.confirmBox}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>Publish "{projectTitle}"?</div>
              <div style={{ marginBottom: 8, fontSize: 12 }}>URL: <code>{canonicalUrl}</code></div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={S.btnGreen} disabled={!!busy || !pass} onClick={() => runAction('publish')}>{busy === 'publish' ? 'Publishing…' : 'Publish'}</button>
                <button style={S.btnGhost} onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button style={pass && projectStatus === 'ready' ? S.btnGreen : S.btnDisabled} disabled={!pass || projectStatus !== 'ready' || !!busy} onClick={() => setConfirming('publish')} title={!pass ? 'Preflight must pass' : projectStatus !== 'ready' ? 'Mark ready first' : ''}>
              Publish article
            </button>
          )
        )}

        {insightsId && projectStatus === 'published' && (
          confirming === 'update' ? (
            <div style={S.confirmBox}>
              <div style={{ marginBottom: 8, fontWeight: 700 }}>Update published article?</div>
              <div style={{ marginBottom: 8, fontSize: 12 }}>URL: <code>{canonicalUrl}</code> — slug and first-publish date will be preserved.</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={S.btnGreen} disabled={!!busy || !pass} onClick={() => runAction('update_published')}>{busy === 'update_published' ? 'Updating…' : 'Update'}</button>
                <button style={S.btnGhost} onClick={() => setConfirming(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button style={pass ? S.btnGreen : S.btnDisabled} disabled={!pass || !!busy} onClick={() => setConfirming('update')}>Update published article</button>
          )
        )}

        {insightsId && (
          <>
            <span style={{ margin: '0 8px', color: '#cbd5e1' }}>|</span>
            {confirming === 'unpublish' ? (
              <>
                <button style={S.btnWarn} disabled={!!busy} onClick={() => runAction('unpublish')}>{busy === 'unpublish' ? 'Unpublishing…' : 'Confirm unpublish'}</button>
                <button style={S.btnGhost} onClick={() => setConfirming(null)}>Cancel</button>
              </>
            ) : (
              projectStatus === 'published' && <button style={S.btnWarn} onClick={() => setConfirming('unpublish')}>Unpublish</button>
            )}
          </>
        )}
      </div>

      {preflight?.payloadPreview && (
        <div style={S.section}>
          <div style={S.title}>Payload preview</div>
          <PayloadPreview payload={preflight.payloadPreview} slug={slug} />
        </div>
      )}
    </div>
  )
}

function PayloadPreview({ payload, slug }: { payload: InsightPayload; slug: string }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['slug', <code key="s">{slug}</code>],
    ['status', payload.status],
    ['headline', payload.headline],
    ['theme', payload.theme ?? '(none)'],
    ['theme_label', payload.theme_label],
    ['author', payload.author ?? '(none)'],
    ['read_time_mins', payload.read_time_mins ?? '(none)'],
    ['seo_title', payload.seo_title ?? '(none)'],
    ['seo_description', payload.seo_description ?? '(none)'],
    ['image_url', payload.image_url ?? '(no hero)'],
    ['card_refs', <span key="c">{payload.card_refs.length} refs</span>],
    ['set_refs',  <span key="s">{payload.set_refs.length} refs</span>],
    ['body_json.blocks', <span key="b">{payload.body_json.blocks.length} blocks</span>],
  ]
  return (
    <table style={S.previewTable}>
      <tbody>{rows.map(([k, v]) => (<tr key={k}><td style={S.previewKey}>{k}</td><td style={S.previewVal}>{v}</td></tr>))}</tbody>
    </table>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:     { padding: 12 },
  section:  { padding: 12, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10 },
  title:    { fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 8, textTransform: 'uppercase' as any, letterSpacing: 0.4 },
  titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  hint:     { fontSize: 11, color: '#64748b', marginBottom: 4 },
  input:    { flex: 1, padding: '6px 10px', fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 4, fontFamily: 'monospace' },
  pill:     { padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' as any, display: 'inline-block' },
  list:     { fontSize: 12, margin: '0 0 0 18px', padding: 0 },
  muted:    { color: '#64748b' },
  error:    { padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 4, fontSize: 12, marginBottom: 8 },
  btnPrimary:  { padding: '6px 12px', borderRadius: 4, background: '#0369a1', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnGreen:    { padding: '6px 12px', borderRadius: 4, background: '#16a34a', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnWarn:     { padding: '6px 12px', borderRadius: 4, background: '#b45309', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnGhost:    { padding: '6px 12px', borderRadius: 4, background: 'white', color: '#334155', border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnDisabled: { padding: '6px 12px', borderRadius: 4, background: '#cbd5e1', color: '#475569', border: 'none', cursor: 'not-allowed', fontSize: 12, fontWeight: 600 },
  confirmBox:  { display: 'inline-block', padding: 10, background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 4, marginTop: 6 },
  overrideBanner:  { padding: 12, marginBottom: 10, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 6, color: '#92400e' },
  overridePrompt:  { padding: 12, marginBottom: 10, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, color: '#9a3412' },
  overrideConfirm: { padding: 12, marginBottom: 10, background: '#fef3c7', border: '2px solid #f59e0b', borderRadius: 6, color: '#78350f' },
  previewTable:{ width: '100%', fontSize: 11, borderCollapse: 'collapse' },
  previewKey:  { padding: '3px 6px', color: '#64748b', fontWeight: 600, width: 130, verticalAlign: 'top' },
  previewVal:  { padding: '3px 6px', color: '#0f172a', wordBreak: 'break-all' },
}
