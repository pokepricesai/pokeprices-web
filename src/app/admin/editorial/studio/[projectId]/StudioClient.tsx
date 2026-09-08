'use client'
// src/app/admin/editorial/studio/[projectId]/StudioClient.tsx
//
// EIC Block 7 — Article Studio.
//
// Layout:
//   * Top bar: breadcrumbs, save-state, preview toggle
//   * Writing column: headline, intro, TipTap editor
//   * Right sidebar tabs: Research (read-only) / SEO / Settings
//
// Autosave: debounced 1.2s after any change. Explicit "Save now"
// button as well. beforeunload guard warns on unsaved changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TiptapLink from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import AdminToolHeader from '@/components/admin/AdminToolHeader'
import { supabase } from '@/lib/supabase'
import type { EditorialResearchRow, EvidencePack } from '@/lib/editorial/research/types'
import type { StudioDocument, StudioHeroImage } from '@/lib/studio/types'
import { studioDocumentToInsightBody } from '@/lib/studio/adapter'
import { StudioPreview } from './StudioPreview'
import { DataBlockNode } from './DataBlockNode'
import { InsertDataBlockMenu } from './InsertDataBlockMenu'
import React from 'react'
import type { WriterMetadata, FactCheckResult } from '@/lib/editorial/writer/types'
import { GenerateAndFactCheckPanel } from './WriterPanel'
import { PublicationPanel } from './PublicationPanel'

type ProjectRow = {
  id: number
  title: string
  angle: string | null
  article_type: string
  status: string
  target_publish_at: string | null
  insights_id: string | null
}

type Props = {
  project:       ProjectRow
  initialDoc:    StudioDocument
  research:      EditorialResearchRow | null
  initialWriter: WriterMetadata | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}

const AUTOSAVE_DEBOUNCE_MS = 1200

export default function StudioClient({ project, initialDoc, research, initialWriter }: Props) {
  const [doc, setDoc] = useState<StudioDocument>(initialDoc)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(initialDoc.updatedAt || null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [tab, setTab] = useState<'research' | 'seo' | 'settings' | 'writer' | 'publish'>('research')
  const [projectRow, setProjectRow] = useState<ProjectRow>(project)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [insertOpen, setInsertOpen]   = useState(false)
  const [writer, setWriter] = useState<WriterMetadata | null>(initialWriter)
  const [factCheckStale, setFactCheckStale] = useState(false)

  const dirtyRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,   // avoid code node; not renderable in public renderer
        code:      false,
      }),
      Underline,             // rendered as italic by the adapter's fallback
      TiptapLink.configure({ openOnClick: false, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: 'Write the article body here.' }),
      DataBlockNode,
    ],
    content: (doc.bodyDoc as any) ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'pp-studio-editor',
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor }) => {
      dirtyRef.current = true
      setFactCheckStale(true)
      const json = editor.getJSON()
      setDoc(prev => ({ ...prev, bodyDoc: json }))
      scheduleSave()
    },
    immediatelyRender: false,
  }, [project.id])

  // ── Autosave ──
  const runSave = useCallback(async (payload: StudioDocument, statusHint?: 'drafting') => {
    setSaveState('saving'); setLastError(null)
    try {
      const auth = await authHeader()
      const res = await fetch(`/api/admin/editorial/studio/${project.id}`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ studioDocument: payload, statusHint }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      dirtyRef.current = false
      setSaveState('saved')
      setLastSavedAt(j.savedAt ?? new Date().toISOString())
    } catch (e) {
      setSaveState('error')
      setLastError(e instanceof Error ? e.message : 'unknown')
    }
  }, [project.id])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // A change means the writer is drafting — nudge the project
      // status only on the first save from planned/idea.
      const hint = (project.status === 'planned' || project.status === 'idea') ? 'drafting' : undefined
      runSave(docRef.current, hint)
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [runSave, project.status])

  // Always read the latest doc when the timer fires.
  const docRef = useRef(doc)
  useEffect(() => { docRef.current = doc }, [doc])

  // ── beforeunload guard ──
  useEffect(() => {
    const handler = (ev: BeforeUnloadEvent) => {
      if (!dirtyRef.current && saveState !== 'saving') return
      ev.preventDefault()
      ev.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveState])

  // Any change to a non-editor field (headline / intro / SEO / theme / hero)
  // marks dirty + triggers autosave via the same path.
  const mutate = useCallback((patch: Partial<StudioDocument> | ((prev: StudioDocument) => Partial<StudioDocument>)) => {
    dirtyRef.current = true
    setFactCheckStale(true)
    setDoc(prev => {
      const p = typeof patch === 'function' ? (patch as any)(prev) : patch
      return { ...prev, ...p }
    })
    scheduleSave()
  }, [scheduleSave])

  const explicitSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    runSave(docRef.current)
  }, [runSave])

  const pack = (research?.evidence_json ?? null) as EvidencePack | null

  return (
    <>
      <AdminToolHeader toolName="Article Studio" />
      <StudioStyles />
      <div style={S.page}>
        <div style={S.topBar}>
          <div style={S.crumbs}>
            <Link href="/admin/editorial" style={S.crumbLink}>Editorial HQ</Link>
            <span style={S.crumbSep}>/</span>
            <Link href={`/admin/editorial/research/${project.id}`} style={S.crumbLink}>Research Room</Link>
            <span style={S.crumbSep}>/</span>
            <span>Studio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} error={lastError} />
            <FactCheckPill writer={writer} stale={factCheckStale} onOpen={() => setTab('writer')} />
            <button style={S.btnGhost} onClick={explicitSave}>Save now</button>
            <button style={S.btnPrimary} onClick={() => setPreviewOpen(true)}>Preview</button>
          </div>
        </div>

        <WorkflowBar
          project={projectRow}
          research={research}
          writer={writer}
          factCheckStale={factCheckStale}
          onOpenTab={setTab}
        />

        <div style={S.grid}>
          <div style={S.writingCol}>
            <div style={S.styleReminder}>
              American English · evidence-led · no em dashes · no generic AI filler
            </div>
            <input
              style={S.headlineInput}
              placeholder="Article headline"
              value={doc.headline}
              onChange={e => mutate({ headline: e.target.value })}
              maxLength={500}
            />
            <textarea
              style={S.introInput}
              placeholder="Intro / deck (2-3 sentences)"
              value={doc.intro}
              onChange={e => mutate({ intro: e.target.value })}
              maxLength={4000}
              rows={3}
            />
            <EditorToolbar editor={editor} onOpenInsert={() => setInsertOpen(true)} />
            <div style={S.editorSurface}>
              <EditorContent editor={editor} />
            </div>
          </div>

          <div style={S.sidebar}>
            <div style={S.tabRow}>
              <TabButton active={tab === 'research'} onClick={() => setTab('research')}>Research</TabButton>
              <TabButton active={tab === 'writer'}   onClick={() => setTab('writer')}>Writer</TabButton>
              <TabButton active={tab === 'publish'}  onClick={() => setTab('publish')}>Publish</TabButton>
              <TabButton active={tab === 'seo'}      onClick={() => setTab('seo')}>SEO</TabButton>
              <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</TabButton>
            </div>
            {tab === 'research' && <ResearchSidebar project={project} research={research} pack={pack} />}
            {tab === 'writer'   && (
              <GenerateAndFactCheckPanel
                projectId={project.id}
                researchStatus={research?.status ?? 'not_started'}
                hasMeaningfulBody={hasMeaningfulBodyClient(doc)}
                writer={writer}
                factCheckStale={factCheckStale}
                onWriterResult={(nextWriter, nextStudio) => {
                  setWriter(nextWriter)
                  if (nextStudio) {
                    setDoc(nextStudio)
                    if (editor) editor.commands.setContent(nextStudio.bodyDoc as any, false)
                  }
                  setFactCheckStale(false)
                  setLastError(null)
                }}
                onFactCheckResult={(fc) => {
                  setWriter(prev => prev ? { ...prev, factCheck: fc, checkedStudioHash: fc.checkedStudioHash } : prev)
                  setFactCheckStale(false)
                }}
              />
            )}
            {tab === 'publish'  && (
              <PublicationPanel
                projectId={project.id}
                projectStatus={projectRow.status}
                projectTitle={projectRow.title}
                insightsId={projectRow.insights_id}
                onInsightsIdChange={(id) => setProjectRow(p => ({ ...p, insights_id: id }))}
                onProjectStatusChange={(s) => setProjectRow(p => ({ ...p, status: s }))}
              />
            )}
            {tab === 'seo'      && <SeoPanel doc={doc} mutate={mutate} />}
            {tab === 'settings' && <SettingsPanel project={projectRow} doc={doc} mutate={mutate} />}
          </div>
        </div>

        {previewOpen && <PreviewModal doc={doc} project={project} onClose={() => setPreviewOpen(false)} />}
        {insertOpen && (
          <InsertDataBlockMenu
            editor={editor}
            pack={pack}
            analysis={research?.analyst_json ?? null}
            onClose={() => setInsertOpen(false)}
          />
        )}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// Editor toolbar
// ─────────────────────────────────────────────────────────────────

function EditorToolbar({ editor, onOpenInsert }: { editor: Editor | null; onOpenInsert: () => void }) {
  if (!editor) return <div style={{ ...S.toolbar, opacity: 0.5 }}>Loading editor…</div>

  const [imageBusy, setImageBusy] = useState(false)

  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL (internal /path or https://…):', previousUrl ?? '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const insertImage = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setImageBusy(true)
      try {
        const url = await uploadArticleImage(file)
        const alt = window.prompt('Alt text for the image:', '') ?? ''
        editor.chain().focus().setImage({ src: url, alt }).run()
      } catch (e) {
        alert(`Upload failed: ${e instanceof Error ? e.message : 'unknown'}`)
      } finally {
        setImageBusy(false)
      }
    }
    input.click()
  }, [editor])

  return (
    <div style={S.toolbar}>
      <ToolbarBtn active={editor.isActive('bold')}      onClick={() => editor.chain().focus().toggleBold().run()}>B</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('italic')}    onClick={() => editor.chain().focus().toggleItalic().run()} style={{ fontStyle: 'italic' }}>I</ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarBtn>
      <Sep />
      <ToolbarBtn active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('blockquote')}  onClick={() => editor.chain().focus().toggleBlockquote().run()}>“ Quote”</ToolbarBtn>
      <Sep />
      <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()}>— HR</ToolbarBtn>
      <ToolbarBtn active={editor.isActive('link')} onClick={setLink}>Link</ToolbarBtn>
      <ToolbarBtn onClick={insertImage} disabled={imageBusy}>{imageBusy ? 'Uploading…' : 'Image'}</ToolbarBtn>
      <Sep />
      <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>Undo</ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>Redo</ToolbarBtn>
      <Sep />
      <ToolbarBtn onClick={onOpenInsert}>+ Data block</ToolbarBtn>
    </div>
  )
}
function ToolbarBtn({ children, active, disabled, onClick, style }: { children: any; active?: boolean; disabled?: boolean; onClick: () => void; style?: any }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...S.tbBtn,
        ...(active ? S.tbBtnActive : {}),
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
        ...style,
      }}
    >{children}</button>
  )
}
function Sep() { return <span style={S.tbSep}>|</span> }

// ─────────────────────────────────────────────────────────────────
// Save indicator
// ─────────────────────────────────────────────────────────────────

// Final Cleanup — Workflow bar. One primary next-action button so
// the admin does not need to figure out which tab to open next.
function WorkflowBar({ project, research, writer, factCheckStale, onOpenTab }: {
  project: ProjectRow
  research: EditorialResearchRow | null
  writer: WriterMetadata | null
  factCheckStale: boolean
  onOpenTab: (t: 'research' | 'writer' | 'publish' | 'seo' | 'settings') => void
}) {
  // Derive stage states + primary next action from persisted state.
  const researchOk = research?.status === 'approved'
  const draftOk    = !!(writer && writer.currentRun && writer.currentRun.stage === 'complete')
  const factOk     = !!(writer?.factCheck && writer.factCheck.status === 'pass' && !factCheckStale)
  const publishOk  = project.status === 'published'

  type Step = { key: string; label: string; ok: boolean; active: boolean }
  const steps: Step[] = [
    { key: 'research', label: 'Research',    ok: researchOk, active: !researchOk },
    { key: 'draft',    label: 'Draft',       ok: draftOk,    active:  researchOk && !draftOk },
    { key: 'review',   label: 'Fact check',  ok: factOk,     active:  draftOk    && !factOk },
    { key: 'publish',  label: 'Publish',     ok: publishOk,  active:  factOk     && !publishOk },
  ]

  let cta:  { label: string; tab: 'research' | 'writer' | 'publish' } = { label: 'Approve research', tab: 'research' }
  let ctaHint = ''
  if (!researchOk) {
    cta = { label: 'Review research', tab: 'research' }
    ctaHint = research ? `Research status: ${research.status}` : 'No research pack yet — open the Research Room.'
  } else if (!draftOk) {
    cta = { label: 'Generate draft', tab: 'writer' }
    ctaHint = 'Research is approved. Generate the first draft.'
  } else if (factCheckStale) {
    cta = { label: 'Rerun fact check', tab: 'writer' }
    ctaHint = 'Draft has changed since the last fact check.'
  } else if (!factOk) {
    cta = { label: 'Run fact check', tab: 'writer' }
    ctaHint = 'Fact check has issues or has not been run.'
  } else if (!publishOk) {
    cta = { label: 'Review & publish', tab: 'publish' }
    ctaHint = 'Ready to publish.'
  } else {
    cta = { label: 'Update published', tab: 'publish' }
    ctaHint = 'Live article. Edit + republish when needed.'
  }

  return (
    <div style={styles.workflowBar}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0 }}>
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <span style={styles.stepArrow}>→</span>}
            <span style={{ ...styles.step, ...(s.active ? styles.stepActive : {}), ...(s.ok ? styles.stepDone : {}) }}>
              {s.ok ? '✓' : s.active ? '●' : '·'} {s.label}
            </span>
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ctaHint && <span style={styles.ctaHint}>{ctaHint}</span>}
        <button style={styles.ctaBtn} onClick={() => onOpenTab(cta.tab)}>{cta.label} →</button>
      </div>
    </div>
  )
}

function hasMeaningfulBodyClient(doc: StudioDocument): boolean {
  const b: any = doc.bodyDoc
  if (!b || !Array.isArray(b.content)) return (doc.headline?.trim().length ?? 0) > 0 || (doc.intro?.trim().length ?? 0) > 0
  const anyRealNode = b.content.some((n: any) => {
    if (n?.type === 'heading' || n?.type === 'dataBlock') return true
    if (n?.type === 'paragraph' && Array.isArray(n.content)) return n.content.some((c: any) => typeof c?.text === 'string' && c.text.trim().length > 0)
    return false
  })
  return anyRealNode || (doc.headline?.trim().length ?? 0) > 0 || (doc.intro?.trim().length ?? 0) > 0
}

function FactCheckPill({ writer, stale, onOpen }: { writer: WriterMetadata | null; stale: boolean; onOpen: () => void }) {
  const fc = writer?.factCheck
  let label = 'Fact check: not run'
  let bg = '#f1f5f9', fg = '#64748b'
  if (fc) {
    if (stale) { label = 'Fact check: Out of date'; bg = '#fef3c7'; fg = '#92400e' }
    else if (fc.status === 'pass')            { label = 'Fact check: pass';           bg = '#dcfce7'; fg = '#166534' }
    else if (fc.status === 'review_required') { label = 'Fact check: review required'; bg = '#fef3c7'; fg = '#92400e' }
    else                                      { label = 'Fact check: fail';           bg = '#fee2e2'; fg = '#991b1b' }
  }
  return (
    <button onClick={onOpen} style={{ padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' as any, border: 'none', cursor: 'pointer', background: bg, color: fg, fontFamily: "'Figtree', sans-serif" }}>
      {label}
    </button>
  )
}

function SaveIndicator({ state, lastSavedAt, error }: { state: SaveState; lastSavedAt: string | null; error: string | null }) {
  let label: string
  let color = '#64748b'
  if (state === 'saving')       { label = 'Saving…' }
  else if (state === 'saved')   { label = lastSavedAt ? `Saved · ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Saved'; color = '#166534' }
  else if (state === 'error')   { label = `Save failed${error ? ` (${error.slice(0, 100)})` : ''}`; color = '#991b1b' }
  else                          { label = lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Not saved yet' }
  return <span style={{ fontSize: 12, color, fontFamily: "'Figtree', sans-serif" }}>{label}</span>
}

// ─────────────────────────────────────────────────────────────────
// Sidebar tabs
// ─────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: any }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 12px',
        fontSize: 12, fontWeight: 700,
        border: 'none',
        background: active ? 'var(--card, #fff)' : 'var(--bg-light, #f1f5f9)',
        borderBottom: active ? '2px solid var(--primary, #0369a1)' : '2px solid transparent',
        color: active ? 'var(--text, #0f172a)' : 'var(--text-muted, #64748b)',
        cursor: 'pointer',
        fontFamily: "'Figtree', sans-serif",
      }}
    >{children}</button>
  )
}

function ResearchSidebar({ project, research, pack }: { project: ProjectRow; research: EditorialResearchRow | null; pack: EvidencePack | null }) {
  const analysis = research?.analyst_json ?? null
  const criticalWarnings = pack ? pack.warnings.filter(w => w.severity === 'critical') : []
  const majorWarnings    = pack ? pack.warnings.filter(w => w.severity === 'major')    : []

  // Final Cleanup — a single summary view replaces the previous
  // technical dump. What we know / Data quality / Caveats / Excluded.
  // Sophisticated evidence + formulas + IDs sit under Advanced.

  const findings = (analysis?.strongestFindings?.length ?? 0) > 0
    ? analysis!.strongestFindings.slice(0, 10).map(f => f.finding)
    : pack ? [
        ...pack.verifiedFacts.slice(0, 5).map(f => f.statement),
        ...pack.derivedFindings.slice(0, 5).map(f => f.statement),
      ].slice(0, 10) : []

  const dataQuality: { label: string; tone: 'ok' | 'caution' | 'blocked' } =
    !pack                                            ? { label: 'Not built', tone: 'caution' } :
    pack.quality.status === 'blocked'                ? { label: 'Blocked', tone: 'blocked' } :
    (pack.quality.status !== 'ok' || criticalWarnings.length > 0 || pack.quality.freshness.isStale) ? { label: 'Caution', tone: 'caution' } :
    { label: 'Good', tone: 'ok' }
  const dqBg = dataQuality.tone === 'ok' ? '#dcfce7' : dataQuality.tone === 'caution' ? '#fef3c7' : '#fee2e2'
  const dqFg = dataQuality.tone === 'ok' ? '#166534' : dataQuality.tone === 'caution' ? '#92400e' : '#991b1b'

  const caveats: string[] = analysis?.requiredCaveats?.length
    ? analysis.requiredCaveats.slice(0, 5)
    : pack ? pack.quality.reasons.filter(r => /caveat|frame|stale/i.test(r)).slice(0, 3) : []

  return (
    <div style={S.sidebarInner}>
      <div style={S.sidebarHeader}>
        <div style={S.sidebarStatus}>Research: {research?.status ?? 'not started'}</div>
        <Link href={`/admin/editorial/research/${project.id}`} style={S.sidebarLink}>Open full Research Room →</Link>
      </div>

      {!pack && (
        <div style={S.sidebarNote}>
          No research pack yet. Build one in the Research Room before writing evidence-based claims.
        </div>
      )}

      {pack && (
        <>
          <div style={{ padding: 12, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10 }}>
            <div style={S.smallTitle}>Data quality</div>
            <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, background: dqBg, color: dqFg, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' as any }}>
              {dataQuality.label}
            </span>
            {pack.marketSignalStrength && (
              <div style={{ ...S.meta, marginTop: 4 }}>Market signal: <strong>{pack.marketSignalStrength}</strong></div>
            )}
          </div>

          {findings.length > 0 && (
            <SidebarSection title="What we know">
              <ul style={S.list}>{findings.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </SidebarSection>
          )}

          {caveats.length > 0 && (
            <SidebarSection title="Important caveats" tone="warn">
              <ul style={S.list}>{caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </SidebarSection>
          )}

          {(criticalWarnings.length > 0 || pack.quarantinedRows.length > 0) && (
            <SidebarSection title="What will be excluded" tone="warn">
              <ul style={S.list}>
                {criticalWarnings.map(w => <li key={w.id} style={{ color: '#991b1b' }}>{w.message}</li>)}
                {pack.quarantinedRows.length > 0 && (
                  <li>{pack.quarantinedRows.length} suspicious observation{pack.quarantinedRows.length === 1 ? '' : 's'} quarantined and hidden from automated rankings.</li>
                )}
              </ul>
            </SidebarSection>
          )}

          <details style={{ padding: 12, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10 }}>
            <summary style={{ ...S.smallTitle, cursor: 'pointer' }}>Advanced research</summary>
            <div style={{ marginTop: 8 }}>
              {analysis?.summary && <>
                <div style={S.smallTitle}>Analyst summary</div>
                <p style={S.body}>{analysis.summary}</p>
              </>}
              {analysis?.recommendedAngle && <>
                <div style={S.smallTitle}>Recommended angle</div>
                <p style={S.body}>{analysis.recommendedAngle}</p>
              </>}
              {pack.verifiedFacts.length > 0 && <>
                <div style={S.smallTitle}>Verified facts ({pack.verifiedFacts.length})</div>
                <ul style={S.list}>{pack.verifiedFacts.map(f => <li key={f.id}>{f.statement} <span style={S.muted}>[{f.id}]</span></li>)}</ul>
              </>}
              {pack.derivedFindings.length > 0 && <>
                <div style={S.smallTitle}>Derived findings ({pack.derivedFindings.length})</div>
                <ul style={S.list}>{pack.derivedFindings.map(f => <li key={f.id}>{f.statement}{f.formula ? <span style={{ color: '#64748b', fontFamily: 'monospace' }}> ({f.formula})</span> : null}</li>)}</ul>
              </>}
              {majorWarnings.length > 0 && <>
                <div style={S.smallTitle}>Other warnings ({majorWarnings.length})</div>
                <ul style={S.list}>{majorWarnings.map(w => <li key={w.id} style={{ color: '#b45309' }}>{w.message}</li>)}</ul>
              </>}
              {pack.researchGaps.length > 0 && <>
                <div style={S.smallTitle}>Research gaps</div>
                <ul style={S.list}>{pack.researchGaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
              </>}
              {pack.externalSources.length > 0 && <>
                <div style={S.smallTitle}>External sources ({pack.externalSources.length})</div>
                <ul style={S.list}>{pack.externalSources.map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0369a1' }}>{s.title}</a>{s.publisher ? ` — ${s.publisher}` : ''}</li>)}</ul>
              </>}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function SidebarSafetyPanel({ pack }: { pack: EvidencePack }) {
  const criticals = pack.warnings.filter(w => w.severity === 'critical')
  const stale     = pack.quality.freshness.isStale
  const quarantineCount = pack.quarantinedRows.length
  const anyIssue = criticals.length > 0 || stale || quarantineCount > 0

  if (!anyIssue) {
    return (
      <div style={{ ...S.sidebarNote, background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }}>
        Research is clean: no critical warnings, no stale data, no quarantined rows.
      </div>
    )
  }
  return (
    <div style={{ ...S.sidebarNote, background: '#fffbeb', border: '1px solid #fbbf24', color: '#92400e' }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Research safety</div>
      <ul style={{ ...S.list, marginTop: 0 }}>
        {criticals.map(w => <li key={w.id} style={{ color: '#991b1b' }}>[critical] {w.message}</li>)}
        {stale && <li>Data snapshot is {pack.quality.freshness.daysOld} days old (as of {pack.quality.freshness.asOf}). Frame any current-state claims accordingly.</li>}
        {quarantineCount > 0 && <li>{quarantineCount} row(s) quarantined and excluded from publishable claims — do not restore without verification.</li>}
      </ul>
    </div>
  )
}

function SidebarSection({ title, children, tone }: { title: string; children: any; tone?: 'warn' | 'ok' }) {
  const border = tone === 'warn' ? '#fbbf24' : '#e2e8f0'
  return (
    <div style={{ padding: 12, background: 'white', border: `1px solid ${border}`, borderRadius: 6, marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 }}>{title}</div>
      {children}
    </div>
  )
}

function SeoPanel({ doc, mutate }: { doc: StudioDocument; mutate: (patch: Partial<StudioDocument>) => void }) {
  const setSeo = (patch: Partial<StudioDocument['seo']>) => mutate({ seo: { ...doc.seo, ...patch } })
  return (
    <div style={S.sidebarInner}>
      <label style={S.fieldLabel}>SEO title <span style={S.counter}>{doc.seo.title.length}/60 recommended</span></label>
      <input style={S.textInput} value={doc.seo.title} onChange={e => setSeo({ title: e.target.value })} maxLength={200} placeholder="60-character search title" />
      <label style={S.fieldLabel}>Meta description <span style={S.counter}>{doc.seo.description.length}/160 recommended</span></label>
      <textarea style={{ ...S.textInput, minHeight: 90 }} value={doc.seo.description} onChange={e => setSeo({ description: e.target.value })} maxLength={400} placeholder="Short description used in Google + social." />
      <p style={S.hint}>Guidance only. Nothing is auto-scored. Empty fields will fall back to headline + intro at publish time.</p>
    </div>
  )
}

function SettingsPanel({ project, doc, mutate }: { project: ProjectRow; doc: StudioDocument; mutate: (patch: Partial<StudioDocument>) => void }) {
  const readMins = useMemo(() => estimateReadTime(doc), [doc])
  const [heroUploading, setHeroUploading] = useState(false)

  const pickHero = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setHeroUploading(true)
      try {
        const url = await uploadArticleImage(file, 'hero')
        const alt = window.prompt('Alt text for the hero image:', doc.heroImage?.alt ?? '') ?? ''
        mutate({ heroImage: { url, alt, caption: doc.heroImage?.caption } })
      } catch (e) {
        alert(`Upload failed: ${e instanceof Error ? e.message : 'unknown'}`)
      } finally {
        setHeroUploading(false)
      }
    }
    input.click()
  }, [doc.heroImage, mutate])

  return (
    <div style={S.sidebarInner}>
      <label style={S.fieldLabel}>Theme key</label>
      <input style={S.textInput} value={doc.themeKey} onChange={e => mutate({ themeKey: e.target.value })} maxLength={60} placeholder="e.g. grading, market, investing" />
      <label style={S.fieldLabel}>Theme label</label>
      <input style={S.textInput} value={doc.themeLabel} onChange={e => mutate({ themeLabel: e.target.value })} maxLength={60} placeholder="e.g. Grading, Market" />
      <label style={S.fieldLabel}>Author</label>
      <input style={S.textInput} value={doc.authorName} onChange={e => mutate({ authorName: e.target.value })} maxLength={120} placeholder="Author byline (optional)" />

      <label style={S.fieldLabel}>Hero image</label>
      {doc.heroImage ? (
        <div style={{ marginBottom: 8 }}>
          <img src={doc.heroImage.url} alt={doc.heroImage.alt} style={{ width: '100%', borderRadius: 6, marginBottom: 6 }} />
          <input style={S.textInput} value={doc.heroImage.alt} onChange={e => mutate({ heroImage: { ...doc.heroImage!, alt: e.target.value } })} placeholder="Alt text" maxLength={400} />
          <input style={S.textInput} value={doc.heroImage.caption ?? ''} onChange={e => mutate({ heroImage: { ...doc.heroImage!, caption: e.target.value } })} placeholder="Caption (optional)" maxLength={400} />
          <button style={{ ...S.btnGhost, marginTop: 6 }} onClick={() => mutate({ heroImage: null })}>Remove hero image</button>
        </div>
      ) : (
        <button style={S.btnPrimary} onClick={pickHero} disabled={heroUploading}>{heroUploading ? 'Uploading…' : 'Upload hero image'}</button>
      )}

      <div style={{ marginTop: 20, padding: 10, background: 'var(--bg-light, #f1f5f9)', borderRadius: 6, fontSize: 12, color: '#334155' }}>
        <div><strong>Project status:</strong> {project.status}</div>
        {project.target_publish_at && <div><strong>Target publish:</strong> {project.target_publish_at}</div>}
        <div><strong>Article type:</strong> {project.article_type}</div>
        <div><strong>Read-time estimate:</strong> {readMins} min</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Preview modal
// ─────────────────────────────────────────────────────────────────

function PreviewModal({ doc, project, onClose }: { doc: StudioDocument; project: ProjectRow; onClose: () => void }) {
  const conversion = useMemo(() => studioDocumentToInsightBody(doc.bodyDoc), [doc.bodyDoc])
  return (
    <div style={S.previewOverlay} onClick={onClose}>
      <div style={S.previewBody} onClick={e => e.stopPropagation()}>
        <div style={S.previewHeader}>
          <div>
            <div style={S.previewEyebrow}>Preview · approximate public rendering</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{conversion.warnings.length} conversion warning{conversion.warnings.length === 1 ? '' : 's'}</div>
          </div>
          <button style={S.btnGhost} onClick={onClose}>Close</button>
        </div>
        <StudioPreview doc={doc} body={conversion.body} />
        {conversion.warnings.length > 0 && (
          <div style={{ margin: '20px auto', maxWidth: 720, padding: 12, background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: '#92400e' }}>Conversion warnings</div>
            <ul style={S.list}>
              {conversion.warnings.slice(0, 20).map((w, i) => <li key={i}>[{w.kind}] at {w.path} — {w.detail}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function estimateReadTime(doc: StudioDocument): number {
  const bodyText = plainTextFromDoc(doc.bodyDoc)
  const total = `${doc.headline} ${doc.intro} ${bodyText}`.trim()
  const words = total.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function plainTextFromDoc(node: any): string {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(plainTextFromDoc).join(' ')
}

async function uploadArticleImage(file: File, purpose: 'hero' | 'body' = 'body'): Promise<string> {
  // The server validator (/api/admin/insights/upload) rejects
  // requests that don't include purpose: 'hero' | 'body'. This call
  // previously omitted the field entirely and every upload failed
  // with `purpose must be "hero" or "body"`. Hero-image control
  // must pass 'hero'; the TipTap in-body image insert defaults to
  // 'body'.
  const auth = await authHeader()
  const filename = `studio-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]+/g, '_')}`
  const signRes = await fetch('/api/admin/insights/upload', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ filename, contentType: file.type, sizeBytes: file.size, purpose }),
  })
  const signJson = await signRes.json().catch(() => ({}))
  if (!signRes.ok || !signJson?.uploadUrl || !signJson?.publicUrl) {
    throw new Error(signJson?.error || `${signRes.status} ${signRes.statusText}`)
  }
  const putRes = await fetch(signJson.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file })
  if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`)
  return signJson.publicUrl as string
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

function StudioStyles() {
  return (
    <style dangerouslySetInnerHTML={{ __html: `
      .pp-studio-editor { outline: none; min-height: 400px; font-family: 'Figtree', sans-serif; font-size: 16px; line-height: 1.7; color: #0f172a; }
      .pp-studio-editor h2 { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 800; margin: 24px 0 10px; }
      .pp-studio-editor h3 { font-family: 'Outfit', sans-serif; font-size: 18px; font-weight: 800; margin: 20px 0 8px; }
      .pp-studio-editor p  { margin: 0 0 14px; }
      .pp-studio-editor ul, .pp-studio-editor ol { margin: 0 0 14px 24px; padding: 0; }
      .pp-studio-editor li { margin-bottom: 4px; }
      .pp-studio-editor blockquote { border-left: 3px solid #0369a1; padding: 6px 14px; margin: 14px 0; color: #64748b; font-style: italic; }
      .pp-studio-editor hr { border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0; }
      .pp-studio-editor a  { color: #0369a1; text-decoration: underline; font-weight: 600; }
      .pp-studio-editor img { max-width: 100%; height: auto; display: block; margin: 12px auto; border-radius: 6px; }
      .pp-studio-editor .is-editor-empty:first-child::before { content: attr(data-placeholder); color: #94a3b8; float: left; height: 0; pointer-events: none; }
    ` }} />
  )
}

const styles: Record<string, React.CSSProperties> = {
  workflowBar: { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 12, fontFamily: "'Figtree', sans-serif" },
  step:        { fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' as any, letterSpacing: 0.4, whiteSpace: 'nowrap' as any },
  stepActive:  { color: '#0369a1' },
  stepDone:    { color: '#166534' },
  stepArrow:   { color: '#cbd5e1', fontSize: 12 },
  ctaHint:     { fontSize: 12, color: '#64748b', maxWidth: 300, textAlign: 'right' as any },
  ctaBtn:      { padding: '8px 14px', background: '#0369a1', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif" },
}

const S: Record<string, any> = {
  page:      { minHeight: '100vh', background: 'var(--bg-light, #f8fafc)', padding: '16px' },
  topBar:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, padding: '0 4px' },
  crumbs:    { fontSize: 13, color: '#64748b' },
  crumbLink: { color: '#0369a1', textDecoration: 'none' },
  crumbSep:  { margin: '0 8px' },
  grid:      { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 16, alignItems: 'flex-start' },
  writingCol:{ padding: 24, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8 },
  sidebar:   { position: 'sticky' as any, top: 12, maxHeight: 'calc(100vh - 24px)', overflow: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8 },
  sidebarInner: { padding: 12 },
  sidebarHeader:{ marginBottom: 10 },
  sidebarStatus:{ fontSize: 12, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  sidebarLink:  { display: 'inline-block', marginTop: 4, fontSize: 12, color: '#0369a1', textDecoration: 'none' },
  sidebarNote:  { padding: 10, borderRadius: 6, marginBottom: 10, fontSize: 12, background: '#f8fafc', border: '1px solid #e2e8f0' },
  styleReminder:{ padding: '6px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, color: '#64748b', marginBottom: 12, fontFamily: "'Figtree', sans-serif", textAlign: 'center' as any },
  headlineInput:{ display: 'block', width: '100%', border: 'none', outline: 'none', fontFamily: "'Outfit', sans-serif", fontSize: 30, fontWeight: 800, marginBottom: 10, background: 'transparent', color: '#0f172a' },
  introInput:   { display: 'block', width: '100%', border: 'none', outline: 'none', resize: 'vertical' as any, fontFamily: "'Figtree', sans-serif", fontSize: 16, lineHeight: 1.6, color: '#334155', marginBottom: 12, background: 'transparent' },
  toolbar:    { display: 'flex', flexWrap: 'wrap' as any, gap: 4, padding: 6, borderRadius: 6, background: '#f8fafc', border: '1px solid #e2e8f0', marginBottom: 10 },
  tbBtn:      { padding: '5px 10px', border: '1px solid transparent', borderRadius: 4, background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#0f172a', fontFamily: "'Figtree', sans-serif" },
  tbBtnActive:{ background: 'var(--primary, #0369a1)', color: 'white' },
  tbSep:      { color: '#cbd5e1', margin: '0 4px' },
  editorSurface: { padding: 12, minHeight: 500, borderRadius: 6, border: '1px solid #e2e8f0', background: 'white' },
  tabRow:     { display: 'flex' },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as any, letterSpacing: 0.4, color: '#334155', marginTop: 12, marginBottom: 4 },
  textInput:  { display: 'block', width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, marginBottom: 6, boxSizing: 'border-box' as any, fontFamily: "'Figtree', sans-serif" },
  counter:    { float: 'right' as any, fontWeight: 400, color: '#64748b', fontSize: 10 },
  hint:       { fontSize: 11, color: '#64748b', marginTop: 6 },
  body:       { fontSize: 13, color: '#334155', lineHeight: 1.55, margin: 0 },
  list:       { fontSize: 12, color: '#334155', lineHeight: 1.55, margin: '6px 0 0 18px', padding: 0 },
  smallTitle: { fontSize: 11, fontWeight: 700, color: '#0f172a', marginTop: 8, marginBottom: 4, textTransform: 'uppercase' as any, letterSpacing: 0.4 },
  btnPrimary: { padding: '6px 12px', borderRadius: 4, background: '#0369a1', color: 'white', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  btnGhost:   { padding: '6px 12px', borderRadius: 4, background: 'white', color: '#334155', border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  previewOverlay: { position: 'fixed' as any, inset: 0, background: 'rgba(15, 23, 42, 0.6)', zIndex: 1000, overflow: 'auto', padding: 24 },
  previewBody:    { maxWidth: 900, margin: '0 auto', background: 'white', borderRadius: 8, padding: 24 },
  previewHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid #e2e8f0' },
  previewEyebrow: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as any, letterSpacing: 0.4, color: '#64748b' },
}
