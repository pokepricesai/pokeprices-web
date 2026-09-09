'use client'
// src/app/admin/editorial/EditorialHqSimpleClient.tsx
//
// Simplified Editorial HQ.
//
// Everything that used to live at /admin/editorial (This Week
// slots, weekly targets, Opportunity Radar panel with scores +
// evidence dumps, Research Room chips, publish preflight browser)
// is gone from the normal workflow. The whole page fits the three-
// bucket lifecycle in ./lib/editorial/simpleBuckets:
//
//   Possible Ideas → Ideas → Pipeline → (Content Library, elsewhere)
//
// Interaction shape:
//   1. Admin picks a lane (external / internal).
//   2. Admin chats with the Idea Assistant. Responses come back with
//      candidate cards containing Yes / No buttons.
//   3. Yes performs a REAL POST /api/admin/editorial/projects and
//      the item lands in Possible Ideas. The AI does NOT persist
//      anything through prose.
//   4. Bucket cards expose bucket-appropriate actions
//      (Develop → PATCH title/angle; Move → PATCH status; Delete;
//       for external Pipeline items: Copy Deep Research Prompt).
//
// The old EditorialHqClient stays in the repo — it is no longer
// mounted anywhere but continues to work if the page.tsx swap is
// ever reverted.

import React, { useCallback, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { EditorialProject } from '@/lib/editorial/projects'
import { ARTICLE_TYPE_LABELS } from '@/lib/editorial/projects'
import { bucketOfProject, statusForBucket, type SimpleBucket } from '@/lib/editorial/simpleBuckets'
import { getEditorialMode } from '@/lib/editorial/editorialMode'
import type { CandidateIdea, IdeaChatResponse } from '@/lib/editorial/ideaChatPrompt'

// ── HTTP helpers ─────────────────────────────────────────────────

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}
async function apiJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const auth = await authHeader()
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...auth, ...(init.body ? { 'content-type': 'application/json' } : {}) } })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}
async function apiCreateProject(payload: Partial<EditorialProject>): Promise<EditorialProject> {
  const j = await apiJson<{ project: EditorialProject }>('/api/admin/editorial/projects', { method: 'POST', body: JSON.stringify(payload) })
  return j.project
}
async function apiPatchProject(id: number, patch: Partial<EditorialProject>): Promise<EditorialProject> {
  const j = await apiJson<{ project: EditorialProject }>(`/api/admin/editorial/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  return j.project
}
async function apiDeleteProject(id: number): Promise<void> {
  await apiJson(`/api/admin/editorial/projects/${id}`, { method: 'DELETE' })
}

// ── Idea-chat wire ───────────────────────────────────────────────

type ChatTurn = { role: 'user' | 'assistant'; content: string; ts: string; parsed?: IdeaChatResponse }
type ChatState = { history: ChatTurn[]; sessionId: string; lastError: string | null; busy: boolean; totalCostUsd: number }

async function callIdeaChat(args: {
  lane: 'external' | 'internal'
  sessionId: string
  history: ChatTurn[]
  userMessage: string
  developIdea?: { title: string; angle: string | null; articleType: string }
}): Promise<{ ok: boolean; error?: string; response?: IdeaChatResponse; rawText?: string; sessionId?: string; costUsd?: number }> {
  try {
    const j = await apiJson<any>('/api/admin/editorial/idea-chat', {
      method: 'POST',
      body: JSON.stringify({
        lane: args.lane, sessionId: args.sessionId,
        userMessage: args.userMessage,
        history: args.history.map(t => ({ role: t.role, content: t.content })),
        developIdea: args.developIdea ?? null,
      }),
    })
    return { ok: Boolean(j?.ok), error: j?.error, response: j?.response, rawText: j?.rawText, sessionId: j?.sessionId, costUsd: j?.usage?.cost_usd }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'idea chat failed' }
  }
}

// ── Root component ──────────────────────────────────────────────

type Props = { projects: readonly EditorialProject[] }

export default function EditorialHqSimpleClient({ projects: initialProjects }: Props) {
  const [projects, setProjects] = useState<EditorialProject[]>(() => initialProjects.filter(p => bucketOfProject(p) !== 'archived' && bucketOfProject(p) !== 'published').slice())
  const [lane, setLane] = useState<'external' | 'internal' | null>(null)
  const [chat, setChat] = useState<ChatState>({ history: [], sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`, lastError: null, busy: false, totalCostUsd: 0 })
  const [rejectedCandidateKeys, setRejectedCandidateKeys] = useState<Set<string>>(new Set())
  const [developProjectId, setDevelopProjectId] = useState<number | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)

  const upsertProject = useCallback((p: EditorialProject) => {
    setProjects(prev => {
      const idx = prev.findIndex(x => x.id === p.id)
      if (idx === -1) return [p, ...prev]
      const next = prev.slice(); next[idx] = p; return next
    })
  }, [])
  const removeProject = useCallback((id: number) => setProjects(prev => prev.filter(p => p.id !== id)), [])

  const grouped = useMemo(() => {
    const out: Record<SimpleBucket, EditorialProject[]> = { possible: [], idea: [], pipeline: [], published: [], archived: [] }
    for (const p of projects) out[bucketOfProject(p)].push(p)
    // Newest first inside each bucket
    for (const bucket of Object.keys(out) as SimpleBucket[]) {
      out[bucket].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    }
    return out
  }, [projects])

  const developingProject = useMemo(() => projects.find(p => p.id === developProjectId) ?? null, [projects, developProjectId])

  // ── Chat handlers ────────────────────────────────────────────
  const sendChat = useCallback(async (userMessage: string) => {
    if (!lane) { setGlobalError('Select External or Internal before chatting.'); return }
    if (!userMessage.trim()) return
    const userTurn: ChatTurn = { role: 'user', content: userMessage.trim(), ts: new Date().toISOString() }
    setChat(prev => ({ ...prev, history: [...prev.history, userTurn], busy: true, lastError: null }))
    const res = await callIdeaChat({
      lane, sessionId: chat.sessionId,
      history: chat.history,
      userMessage: userMessage.trim(),
      developIdea: developingProject ? { title: developingProject.title, angle: developingProject.angle, articleType: developingProject.article_type } : undefined,
    })
    if (!res.ok || !res.response) {
      setChat(prev => ({ ...prev, busy: false, lastError: res.error ?? 'unknown' }))
      return
    }
    const assistantTurn: ChatTurn = { role: 'assistant', content: res.rawText ?? '', ts: new Date().toISOString(), parsed: res.response }
    setChat(prev => ({
      ...prev,
      busy: false,
      history: [...prev.history, assistantTurn],
      sessionId: res.sessionId ?? prev.sessionId,
      totalCostUsd: prev.totalCostUsd + (res.costUsd ?? 0),
    }))
  }, [lane, chat.history, chat.sessionId, developingProject])

  const acceptCandidate = useCallback(async (turnIdx: number, ideaIdx: number, cand: CandidateIdea) => {
    setGlobalError(null)
    const key = `${turnIdx}:${ideaIdx}`
    try {
      if (developingProject) {
        // Develop mode: Yes REPLACES the existing project's fields
        // instead of creating a new one.
        const patched = await apiPatchProject(developingProject.id, {
          title:        cand.title,
          angle:        cand.angle || null,
          article_type: cand.articleType,
        })
        upsertProject(patched)
      } else {
        // Discover mode: Yes creates a NEW project in the Possible
        // Ideas bucket.
        const created = await apiCreateProject({
          title:        cand.title,
          angle:        cand.angle || null,
          article_type: cand.articleType,
          status:       statusForBucket('possible'),
          priority:     3,
          notes:        [
            `Created via AI Editorial Idea Assistant on ${new Date().toISOString().slice(0, 10)}.`,
            cand.why ? `Why: ${cand.why}` : null,
          ].filter(Boolean).join('\n'),
        })
        upsertProject(created)
      }
      setRejectedCandidateKeys(prev => { const n = new Set(prev); n.add(key); return n })
    } catch (e) {
      setGlobalError(`Could not save "${cand.title}": ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }, [developingProject, upsertProject])

  const rejectCandidate = useCallback((turnIdx: number, ideaIdx: number) => {
    const key = `${turnIdx}:${ideaIdx}`
    setRejectedCandidateKeys(prev => { const n = new Set(prev); n.add(key); return n })
  }, [])

  // ── Bucket action handlers ───────────────────────────────────
  const moveToBucket = useCallback(async (project: EditorialProject, target: Exclude<SimpleBucket, 'archived' | 'published'>) => {
    setGlobalError(null)
    try {
      const patched = await apiPatchProject(project.id, { status: statusForBucket(target) })
      upsertProject(patched)
    } catch (e) {
      setGlobalError(`Move failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }, [upsertProject])

  const deleteProject = useCallback(async (project: EditorialProject) => {
    if (!confirm(`Delete "${project.title}"? This removes the working project record. Published articles are not affected.`)) return
    setGlobalError(null)
    try { await apiDeleteProject(project.id); removeProject(project.id) }
    catch (e) { setGlobalError(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`) }
  }, [removeProject])

  const startDevelop = useCallback((project: EditorialProject) => {
    setDevelopProjectId(project.id)
    // Fresh chat scoped to this idea, mode inferred from the project.
    setChat({ history: [], sessionId: `dev_${project.id}_${Math.random().toString(36).slice(2, 8)}`, lastError: null, busy: false, totalCostUsd: 0 })
    setLane(getEditorialMode({ article_type: project.article_type, title: project.title, angle: project.angle }) as 'external' | 'internal')
  }, [])

  const stopDevelop = useCallback(() => {
    setDevelopProjectId(null)
    setChat({ history: [], sessionId: `sess_${Math.random().toString(36).slice(2, 10)}`, lastError: null, busy: false, totalCostUsd: 0 })
  }, [])

  // ── UI ───────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <div style={S.headerRow}>
        <h1 style={S.h1}>Editorial HQ</h1>
        <a href="/admin/insights" style={S.libraryLink}>Content Library →</a>
      </div>

      {globalError && <div style={S.errorBanner} role="alert">{globalError}</div>}

      <LaneSelector lane={lane} setLane={setLane} developing={!!developingProject} />

      {developingProject && (
        <div style={S.developBanner}>
          Developing idea: <strong>{developingProject.title}</strong>
          <button style={S.btnGhost} onClick={stopDevelop}>Back to discover</button>
        </div>
      )}

      <ChatPanel
        lane={lane}
        chat={chat}
        onSend={sendChat}
        onAccept={acceptCandidate}
        onReject={rejectCandidate}
        rejectedKeys={rejectedCandidateKeys}
        developingProject={developingProject}
      />

      <BucketSection
        title="Possible Ideas"
        subtitle="Candidates you have said Yes to. Develop or move them on when ready."
        projects={grouped.possible}
        render={(p) => (
          <ProjectCard
            key={p.id}
            project={p}
            actions={[
              { label: 'Develop',           onClick: () => startDevelop(p),               style: S.btnPrimary },
              { label: 'Move to Ideas',     onClick: () => moveToBucket(p, 'idea'),       style: S.btnGhost },
              { label: 'Delete',            onClick: () => deleteProject(p),              style: S.btnDanger },
            ]}
          />
        )}
      />

      <BucketSection
        title="Ideas"
        subtitle="Articles you intend to write soon."
        projects={grouped.idea}
        render={(p) => (
          <ProjectCard
            key={p.id}
            project={p}
            actions={[
              { label: 'Edit / Chat',       onClick: () => startDevelop(p),               style: S.btnPrimary },
              { label: 'Move to Pipeline',  onClick: () => moveToBucket(p, 'pipeline'),   style: S.btnGhost },
              { label: 'Delete',            onClick: () => deleteProject(p),              style: S.btnDanger },
            ]}
          />
        )}
      />

      <BucketSection
        title="Pipeline"
        subtitle="Articles you are actively working on."
        projects={grouped.pipeline}
        render={(p) => {
          const external = getEditorialMode({ article_type: p.article_type, title: p.title, angle: p.angle }) === 'external'
          return (
            <ProjectCard
              key={p.id}
              project={p}
              actions={[
                ...(external ? [{ label: 'Copy Deep Research Prompt', onClick: () => copyDeepResearchPrompt(p, setGlobalError), style: S.btnPrimary }] : []),
                { label: 'Open Studio', onClick: () => { window.location.href = `/admin/editorial/studio/${p.id}` }, style: S.btnGhost },
                { label: 'Delete',      onClick: () => deleteProject(p), style: S.btnDanger },
              ]}
            />
          )
        }}
      />
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────

function LaneSelector({ lane, setLane, developing }: { lane: 'external' | 'internal' | null; setLane: (l: 'external' | 'internal') => void; developing: boolean }) {
  return (
    <div style={S.laneRow}>
      <button
        style={{ ...S.laneBtn, ...(lane === 'external' ? S.laneBtnActive : {}) }}
        onClick={() => setLane('external')}
        disabled={developing}
        title={developing ? 'Lane is locked to the idea you are developing.' : ''}
      >External</button>
      <button
        style={{ ...S.laneBtn, ...(lane === 'internal' ? S.laneBtnActive : {}) }}
        onClick={() => setLane('internal')}
        disabled={developing}
      >Internal</button>
      <div style={S.laneHint}>
        {lane === 'external' && 'General Pokémon TCG SEO / evergreen / news / release ideas. Facts come from web research.'}
        {lane === 'internal' && 'Ideas grounded in PokePrices data (trends, movers, PSA population signals).'}
        {!lane && 'Choose a lane before chatting.'}
      </div>
    </div>
  )
}

function ChatPanel({
  lane, chat, onSend, onAccept, onReject, rejectedKeys, developingProject,
}: {
  lane: 'external' | 'internal' | null
  chat: ChatState
  onSend: (msg: string) => void | Promise<void>
  onAccept: (turnIdx: number, ideaIdx: number, cand: CandidateIdea) => void | Promise<void>
  onReject: (turnIdx: number, ideaIdx: number) => void
  rejectedKeys: Set<string>
  developingProject: EditorialProject | null
}) {
  const [input, setInput] = useState('')
  const canSend = !!lane && !chat.busy && input.trim().length > 0
  const submit = () => {
    if (!canSend) return
    void onSend(input)
    setInput('')
  }

  return (
    <section style={S.chatPanel}>
      <div style={S.sectionTitle}>AI Editorial Chat</div>
      <div style={S.chatThread}>
        {chat.history.length === 0 && (
          <div style={S.chatEmpty}>
            {developingProject
              ? 'Ask for a stronger angle, better SEO framing, or specific sections.'
              : lane === 'external'
                ? 'Ask for external article ideas. Example: "Give me 5 evergreen Pikachu SEO articles."'
                : lane === 'internal'
                  ? 'Ask for internal article ideas. Example: "Give me 5 article ideas from the current PokePrices analytics."'
                  : 'Select a lane above, then chat.'}
          </div>
        )}
        {chat.history.map((turn, i) => (
          <ChatTurnBubble
            key={i}
            turn={turn}
            turnIdx={i}
            onAccept={onAccept}
            onReject={onReject}
            rejectedKeys={rejectedKeys}
          />
        ))}
        {chat.busy && <div style={S.chatBusy}>Thinking…</div>}
        {chat.lastError && <div style={S.errorBanner}>{chat.lastError}</div>}
      </div>
      <div style={S.chatInputRow}>
        <textarea
          style={S.chatInput}
          rows={2}
          placeholder={lane ? 'Ask for ideas or refine a brief…' : 'Select a lane first'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          disabled={!lane || chat.busy}
        />
        <button style={{ ...S.btnPrimary, opacity: canSend ? 1 : 0.5 }} onClick={submit} disabled={!canSend}>Send</button>
      </div>
    </section>
  )
}

function ChatTurnBubble({
  turn, turnIdx, onAccept, onReject, rejectedKeys,
}: {
  turn: ChatTurn
  turnIdx: number
  onAccept: (t: number, i: number, c: CandidateIdea) => void | Promise<void>
  onReject: (t: number, i: number) => void
  rejectedKeys: Set<string>
}) {
  const isUser = turn.role === 'user'
  const message = turn.parsed?.message?.trim() ?? (isUser ? turn.content : '')
  return (
    <div style={{ ...S.bubbleRow, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 8, alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {(message || isUser) && (
          <div style={isUser ? S.bubbleUser : S.bubbleAssistant}>{message || '(no message)'}</div>
        )}
        {!isUser && turn.parsed?.ideas?.map((cand, i) => {
          const key = `${turnIdx}:${i}`
          if (rejectedKeys.has(key)) return null
          return (
            <CandidateCard
              key={key}
              cand={cand}
              onYes={() => onAccept(turnIdx, i, cand)}
              onNo={() => onReject(turnIdx, i)}
            />
          )
        })}
      </div>
    </div>
  )
}

function CandidateCard({ cand, onYes, onNo }: { cand: CandidateIdea; onYes: () => void; onNo: () => void }) {
  const typeLabel = ARTICLE_TYPE_LABELS[cand.articleType as keyof typeof ARTICLE_TYPE_LABELS] ?? cand.articleType
  return (
    <div style={S.candidate}>
      <div style={S.candidateHeader}>
        <span style={{ ...S.candidateBadge, background: cand.mode === 'external' ? '#fef3c7' : '#dbeafe', color: cand.mode === 'external' ? '#78350f' : '#1e3a8a' }}>
          {cand.mode === 'external' ? 'External' : 'Internal'}
        </span>
        <span style={S.candidateType}>{typeLabel}</span>
      </div>
      <div style={S.candidateTitle}>{cand.title}</div>
      {cand.angle && <div style={S.candidateAngle}>{cand.angle}</div>}
      {cand.why   && <div style={S.candidateWhy}>Why: {cand.why}</div>}
      <div style={S.candidateActions}>
        <button style={S.btnPrimary} onClick={onYes}>Yes</button>
        <button style={S.btnGhost}   onClick={onNo}>No</button>
      </div>
    </div>
  )
}

function BucketSection<T extends EditorialProject>({ title, subtitle, projects, render }: { title: string; subtitle: string; projects: T[]; render: (p: T) => React.ReactNode }) {
  return (
    <section style={S.bucket}>
      <div style={S.sectionTitleRow}>
        <div>
          <div style={S.sectionTitle}>{title}</div>
          <div style={S.sectionSubtitle}>{subtitle}</div>
        </div>
        <span style={S.bucketCount}>{projects.length}</span>
      </div>
      {projects.length === 0
        ? <div style={S.bucketEmpty}>Nothing here yet.</div>
        : <div style={S.projectGrid}>{projects.map(render)}</div>}
    </section>
  )
}

function ProjectCard({ project, actions }: { project: EditorialProject; actions: Array<{ label: string; onClick: () => void; style?: React.CSSProperties }> }) {
  const mode = getEditorialMode({ article_type: project.article_type, title: project.title, angle: project.angle })
  const typeLabel = ARTICLE_TYPE_LABELS[project.article_type as keyof typeof ARTICLE_TYPE_LABELS] ?? project.article_type
  return (
    <div style={S.projectCard}>
      <div style={S.projectHeader}>
        <span style={{ ...S.candidateBadge, background: mode === 'external' ? '#fef3c7' : '#dbeafe', color: mode === 'external' ? '#78350f' : '#1e3a8a' }}>
          {mode === 'external' ? 'External' : 'Internal'}
        </span>
        <span style={S.candidateType}>{typeLabel}</span>
      </div>
      <div style={S.projectTitle}>{project.title}</div>
      {project.angle && <div style={S.projectAngle}>{project.angle}</div>}
      <div style={S.projectMeta}>Updated {project.updated_at ? new Date(project.updated_at).toLocaleDateString('en-GB') : '—'}</div>
      <div style={S.projectActions}>
        {actions.map(a => (
          <button key={a.label} style={a.style ?? S.btnGhost} onClick={a.onClick}>{a.label}</button>
        ))}
      </div>
    </div>
  )
}

// ── Deep Research prompt copy (external Pipeline action) ─────────

async function copyDeepResearchPrompt(project: EditorialProject, onError: (msg: string) => void): Promise<void> {
  try {
    const j = await apiJson<{ prompt: string; internalLinkCount?: number }>(`/api/admin/editorial/deep-research-prompt/${project.id}`)
    try {
      await navigator.clipboard.writeText(j.prompt)
      alert('Deep Research prompt copied to clipboard.')
    } catch {
      // Clipboard permission may be denied — surface the prompt in a
      // simple prompt() so the admin can still copy it manually.
      window.prompt('Copy this Deep Research prompt manually:', j.prompt)
    }
  } catch (e) {
    onError(`Deep Research prompt failed: ${e instanceof Error ? e.message : 'unknown'}`)
  }
}

// ── Styles ────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page:            { padding: '24px 20px 60px', maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 20 },
  headerRow:       { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  h1:              { fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: 0, color: 'var(--text)' },
  libraryLink:     { fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' },
  errorBanner:     { padding: '10px 14px', background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 8, fontSize: 13 },
  laneRow:         { display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: 10, alignItems: 'center' },
  laneBtn:         { padding: '10px 20px', borderRadius: 999, background: 'white', color: 'var(--text)', border: '1px solid var(--border, #cbd5e1)', cursor: 'pointer', fontSize: 14, fontWeight: 700 },
  laneBtnActive:   { background: '#0f172a', color: 'white', borderColor: '#0f172a' },
  laneHint:        { fontSize: 12, color: 'var(--text-muted, #64748b)' },
  developBanner:   { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 8, fontSize: 13 },
  chatPanel:       { background: 'white', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, padding: 16, display: 'grid', gap: 12 },
  sectionTitleRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  sectionTitle:    { fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  sectionSubtitle: { fontSize: 12, color: 'var(--text-muted, #64748b)' },
  chatThread:      { display: 'grid', gap: 10, maxHeight: 500, overflow: 'auto', paddingRight: 4 },
  chatEmpty:       { fontSize: 12, color: 'var(--text-muted, #64748b)', padding: '12px 0' },
  chatBusy:        { fontSize: 12, color: 'var(--text-muted, #64748b)' },
  bubbleRow:       { display: 'flex' },
  bubbleUser:      { padding: '8px 12px', borderRadius: 12, background: 'var(--primary, #0369a1)', color: 'white', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  bubbleAssistant: { padding: '8px 12px', borderRadius: 12, background: '#f8fafc', color: 'var(--text)', border: '1px solid var(--border, #e2e8f0)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  chatInputRow:    { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 },
  chatInput:       { padding: 10, border: '1px solid var(--border, #cbd5e1)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' },
  candidate:       { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: 'white', display: 'grid', gap: 6, minWidth: 300 },
  candidateHeader: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  candidateBadge:  { padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' as any },
  candidateType:   { fontSize: 11, color: 'var(--text-muted, #64748b)' },
  candidateTitle:  { fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 },
  candidateAngle:  { fontSize: 12, color: 'var(--text)', lineHeight: 1.5 },
  candidateWhy:    { fontSize: 11, color: 'var(--text-muted, #64748b)', lineHeight: 1.5 },
  candidateActions:{ display: 'flex', gap: 6, marginTop: 6 },
  bucket:          { background: 'white', border: '1px solid var(--border, #e2e8f0)', borderRadius: 10, padding: 16, display: 'grid', gap: 12 },
  bucketCount:     { fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #64748b)' },
  bucketEmpty:     { fontSize: 12, color: 'var(--text-muted, #64748b)', padding: '10px 0' },
  projectGrid:     { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' },
  projectCard:     { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: 'white', display: 'grid', gap: 6 },
  projectHeader:   { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  projectTitle:    { fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 },
  projectAngle:    { fontSize: 12, color: 'var(--text)', lineHeight: 1.5 },
  projectMeta:     { fontSize: 11, color: 'var(--text-muted, #64748b)' },
  projectActions:  { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  btnPrimary:      { padding: '6px 12px', borderRadius: 6, background: '#0f172a', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  btnGhost:        { padding: '6px 12px', borderRadius: 6, background: 'white', color: 'var(--text)', border: '1px solid var(--border, #cbd5e1)', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  btnDanger:       { padding: '6px 12px', borderRadius: 6, background: 'white', color: '#991b1b', border: '1px solid #fca5a5', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
}
