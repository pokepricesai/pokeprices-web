'use client'
// src/app/admin/editorial/studio/[projectId]/InsertDataBlockMenu.tsx
//
// EIC Block 8 — "Insert data block" flow.
//
// Modal-style panel with two sections:
//   * FROM RESEARCH — enabled only when a research pack exists.
//     Offers ranking-table, stat, methodology, price-chart, and
//     raw/PSA comparison inserters. Quarantined rows never enter
//     the offered inputs (the factories drop them belt-and-braces).
//   * MANUAL — card block + set block + blank stat callout. Uses
//     supabase directly to search the cards/set_metadata catalogues.
//
// Every "Insert" action produces a fully-validated block via the
// factories and inserts a dataBlock TipTap node.

import React, { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { supabase } from '@/lib/supabase'
import type { EvidencePack, ResearchAnalysis, DataTable } from '@/lib/editorial/research/types'
import {
  createRankingTableFromResearch, createStatCalloutFromFact, createMethodologyBlock,
  createPriceChartLive, createRawPsaComparisonFromResearch, createCardBlock, createSetBlock,
} from '@/lib/studio/dataBlocks/factories'
import type { CardIdentity, SetIdentity } from '@/lib/studio/dataBlocks/types'

type Props = {
  editor:   Editor | null
  pack:     EvidencePack | null
  analysis: ResearchAnalysis | null
  onClose:  () => void
}

export function InsertDataBlockMenu({ editor, pack, analysis, onClose }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'menu' | 'ranking' | 'stat' | 'chart' | 'compare' | 'card' | 'set'>('menu')

  const insert = (block: any) => {
    if (!editor) return
    try {
      editor.chain().focus().insertContent({ type: 'dataBlock', attrs: { variant: block.variant, payload: block.payload } }).run()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.panel} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <div style={S.title}>Insert data block</div>
          <button style={S.close} onClick={onClose}>Close</button>
        </div>
        {error && <div style={S.error}>{error}</div>}

        {mode === 'menu' && (
          <>
            <Section title="From Research" hint={pack ? undefined : 'No research pack — build one to unlock these.'}>
              <MenuBtn disabled={!pack} onClick={() => setMode('ranking')}>Ranking table from Research</MenuBtn>
              <MenuBtn disabled={!pack} onClick={() => setMode('stat')}>Stat from Research</MenuBtn>
              <MenuBtn
                disabled={!pack}
                onClick={() => {
                  if (!pack) return
                  try { insert(createMethodologyBlock(pack, analysis)) }
                  catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
                }}
              >Methodology from Research</MenuBtn>
              <MenuBtn disabled={!pack} onClick={() => setMode('chart')}>Chart from Research</MenuBtn>
              <MenuBtn
                disabled={!pack || pack.quality.status === 'blocked' || pack.warnings.some(w => w.severity === 'critical')}
                title={pack && (pack.quality.status === 'blocked' || pack.warnings.some(w => w.severity === 'critical'))
                  ? 'Pack is blocked / research-required — comparison cannot be built from these figures.'
                  : undefined}
                onClick={() => setMode('compare')}
              >Card comparison from Research</MenuBtn>
            </Section>

            <Section title="Manual">
              <MenuBtn onClick={() => setMode('card')}>Manual canonical card block</MenuBtn>
              <MenuBtn onClick={() => setMode('set')}>Manual canonical set block</MenuBtn>
              <MenuBtn onClick={() => {
                try {
                  insert({
                    variant: 'stat_callout',
                    payload: { value: '0', label: 'Edit this stat', mode: 'snapshot' },
                  })
                } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
              }}>Blank stat callout</MenuBtn>
            </Section>
          </>
        )}

        {mode === 'ranking' && pack && <RankingInserter pack={pack} onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
        {mode === 'stat'    && pack && <StatInserter    pack={pack} onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
        {mode === 'chart'   && pack && <ChartInserter   pack={pack} onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
        {mode === 'compare' && pack && <CompareInserter pack={pack} onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
        {mode === 'card'    &&        <CardInserter    onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
        {mode === 'set'     &&        <SetInserter     onInsert={insert} onBack={() => setMode('menu')} setError={setError} />}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={S.section}>
      <div style={S.sectionTitle}>{title}</div>
      {hint && <div style={S.hint}>{hint}</div>}
      <div style={S.buttonGrid}>{children}</div>
    </div>
  )
}
function MenuBtn({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} style={{ ...S.menuBtn, ...(rest.disabled ? S.menuBtnDisabled : {}) }}>{children}</button>
}

// ─────────────────────────────────────────────────────────────────
// Ranking inserter — pick a research DataTable + configure
// ─────────────────────────────────────────────────────────────────

function RankingInserter({ pack, onInsert, onBack, setError }: {
  pack: EvidencePack; onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void
}) {
  const [tableId, setTableId] = useState<string>(pack.dataTables[0]?.id ?? '')
  const [limit, setLimit] = useState<number>(10)
  const [title, setTitle] = useState<string>(pack.dataTables[0]?.title ?? '')
  const [selectedCols, setSelectedCols] = useState<string[]>(pack.dataTables[0]?.columns.map(c => c.key) ?? [])

  const table: DataTable | undefined = pack.dataTables.find(t => t.id === tableId)
  useEffect(() => {
    if (table) { setTitle(table.title); setSelectedCols(table.columns.map(c => c.key)); if (limit > table.rows.length) setLimit(table.rows.length) }
  }, [tableId])
  if (!table) return <div style={S.error}>This pack has no data tables to insert.</div>

  const doInsert = () => {
    try {
      const block = createRankingTableFromResearch(pack, {
        dataTableId: tableId,
        title:       title,
        limit,
        columns:     selectedCols,
        cardFromRow: rowToCardIdentity,
      })
      onInsert(block)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
  }

  return (
    <>
      <SubHeader onBack={onBack}>Ranking table from Research</SubHeader>
      <label style={S.label}>Source table</label>
      <select style={S.input} value={tableId} onChange={e => setTableId(e.target.value)}>
        {pack.dataTables.map(t => <option key={t.id} value={t.id}>{t.title} ({t.rows.length} rows)</option>)}
      </select>
      <label style={S.label}>Title</label>
      <input style={S.input} value={title} onChange={e => setTitle(e.target.value)} maxLength={300} />
      <label style={S.label}>Show top N rows (max {table.rows.length})</label>
      <input style={S.input} type="number" min={1} max={table.rows.length} value={limit} onChange={e => setLimit(Math.max(1, Math.min(table.rows.length, Number(e.target.value) || 1)))} />
      <label style={S.label}>Columns</label>
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 4, padding: 8 }}>
        {table.columns.map(c => (
          <label key={c.key} style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={selectedCols.includes(c.key)}
              onChange={e => setSelectedCols(prev => e.target.checked ? [...prev, c.key] : prev.filter(k => k !== c.key))}
              style={{ marginRight: 6 }}
            />
            {c.label} <span style={S.muted}>({c.key})</span>
          </label>
        ))}
      </div>
      <button style={S.primary} onClick={doInsert}>Insert ranking table</button>
    </>
  )
}

// Best-effort card identity from a ranking-table row.
function rowToCardIdentity(row: Record<string, string | number | null>): CardIdentity | null {
  const cardName = pickStr(row, ['cardName', 'card', 'name'])
  const urlSlug  = pickStr(row, ['urlSlug', 'url_slug', 'card_url_slug'])
  const setName  = pickStr(row, ['setName', 'set_name', 'set'])
  const number   = pickStr(row, ['cardNumber', 'card_number', 'number', '#'])
  if (!cardName) return null
  return {
    cardSlug: urlSlug ? urlSlug.replace(/^pc-/, '') : '',
    cardName,
    cardNumber: number || undefined,
    setName:    setName || undefined,
    urlSlug:    urlSlug || undefined,
  }
}
function pickStr(row: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    if (typeof row[k] === 'string' && row[k]) return row[k]
    if (typeof row[k] === 'number') return String(row[k])
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────
// Stat inserter
// ─────────────────────────────────────────────────────────────────

function StatInserter({ pack, onInsert, onBack, setError }: { pack: EvidencePack; onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void }) {
  const items = useMemo(() => [
    ...pack.verifiedFacts.map(f => ({ id: f.id, statement: f.statement, kind: 'fact' as const })),
    ...pack.derivedFindings.map(f => ({ id: f.id, statement: f.statement, kind: 'finding' as const })),
  ], [pack])
  const [selectedId, setSelectedId] = useState<string>(items[0]?.id ?? '')
  const [value, setValue] = useState<string>('')
  const [label, setLabel] = useState<string>('')
  const [context, setContext] = useState<string>('')

  useEffect(() => {
    const chosen = items.find(i => i.id === selectedId)
    if (chosen) setLabel(chosen.statement.slice(0, 200))
  }, [selectedId, items])

  const doInsert = () => {
    try {
      if (!selectedId || !value.trim() || !label.trim()) { setError('Value + label required'); return }
      const block = createStatCalloutFromFact(pack, selectedId, { value: value.trim(), label: label.trim(), context: context.trim() || undefined })
      onInsert(block)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
  }

  if (items.length === 0) return <div style={S.error}>This pack has no verified facts or derived findings.</div>
  return (
    <>
      <SubHeader onBack={onBack}>Stat callout from Research</SubHeader>
      <label style={S.label}>Backing fact / finding</label>
      <select style={S.input} value={selectedId} onChange={e => setSelectedId(e.target.value)}>
        {items.map(i => <option key={i.id} value={i.id}>[{i.kind}] {i.id} — {i.statement.slice(0, 80)}</option>)}
      </select>
      <label style={S.label}>Big number / value</label>
      <input style={S.input} value={value} onChange={e => setValue(e.target.value)} placeholder="e.g. 62,645 or 39.1%" maxLength={60} />
      <label style={S.label}>Short label</label>
      <input style={S.input} value={label} onChange={e => setLabel(e.target.value)} maxLength={200} />
      <label style={S.label}>Context (optional)</label>
      <input style={S.input} value={context} onChange={e => setContext(e.target.value)} maxLength={400} />
      <button style={S.primary} onClick={doInsert}>Insert stat callout</button>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// Chart inserter — LIVE (Block 8 keeps snapshot charts to factories)
// ─────────────────────────────────────────────────────────────────

function ChartInserter({ pack, onInsert, onBack, setError }: { pack: EvidencePack; onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void }) {
  const [q, setQ] = useState<string>('')
  const [results, setResults] = useState<CardIdentity[]>([])
  const [days, setDays] = useState<number>(180)
  const [rawOn, setRawOn] = useState(true)
  const [psa9On, setPsa9On] = useState(false)
  const [psa10On, setPsa10On] = useState(true)

  useEffect(() => {
    const run = async () => {
      if (!q.trim()) { setResults([]); return }
      const { data } = await supabase.from('cards')
        .select('card_slug, card_name, set_name, card_number, url_slug')
        .ilike('card_name', `%${q}%`)
        .eq('language', 'en')
        .limit(15)
      setResults((data ?? []).map((c: any) => ({ cardSlug: c.card_slug, cardName: String(c.card_name).replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim(), cardNumber: c.card_number, setName: c.set_name, urlSlug: c.url_slug })))
    }
    const t = setTimeout(run, 200)
    return () => clearTimeout(t)
  }, [q])

  const insertChart = (card: CardIdentity) => {
    const series: Array<'raw' | 'psa9' | 'psa10'> = []
    if (rawOn) series.push('raw'); if (psa9On) series.push('psa9'); if (psa10On) series.push('psa10')
    if (series.length === 0) { setError('Pick at least one series'); return }
    try {
      const block = createPriceChartLive({ card, series, days })
      onInsert(block)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
  }

  return (
    <>
      <SubHeader onBack={onBack}>Chart from Research (live)</SubHeader>
      <div style={S.hint}>Live charts resolve daily_prices at render time bounded by the day window. Snapshot charts are produced by the AI Writer factories at publish time.</div>
      <label style={S.label}>Card search</label>
      <input style={S.input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a card name…" />
      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 4 }}>
        {results.map((c, i) => (
          <button key={i} style={S.pickRow} onClick={() => insertChart(c)}>
            <strong>{c.cardName}</strong> <span style={S.muted}>{c.setName} · #{c.cardNumber}</span>
          </button>
        ))}
      </div>
      <label style={S.label}>Day window</label>
      <select style={S.input} value={days} onChange={e => setDays(Number(e.target.value))}>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
        <option value={180}>180 days</option>
        <option value={365}>1 year</option>
      </select>
      <label style={S.label}>Series</label>
      <label style={{ marginRight: 12 }}><input type="checkbox" checked={rawOn}   onChange={e => setRawOn(e.target.checked)} /> Raw</label>
      <label style={{ marginRight: 12 }}><input type="checkbox" checked={psa9On}  onChange={e => setPsa9On(e.target.checked)} /> PSA 9</label>
      <label><input type="checkbox" checked={psa10On} onChange={e => setPsa10On(e.target.checked)} /> PSA 10</label>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// Compare inserter (raw / PSA)
// ─────────────────────────────────────────────────────────────────

function CompareInserter({ pack, onInsert, onBack, setError }: { pack: EvidencePack; onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void }) {
  const [rows, setRows] = useState<Array<{ card: CardIdentity; rawCents?: number; psa9Cents?: number; psa10Cents?: number }>>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CardIdentity[]>([])
  const [showRatios, setShowRatios] = useState(false)

  useEffect(() => {
    const run = async () => {
      if (!q.trim()) { setResults([]); return }
      const { data } = await supabase.from('cards').select('card_slug, card_name, set_name, card_number, url_slug').ilike('card_name', `%${q}%`).eq('language', 'en').limit(10)
      setResults((data ?? []).map((c: any) => ({ cardSlug: c.card_slug, cardName: String(c.card_name).replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim(), cardNumber: c.card_number, setName: c.set_name, urlSlug: c.url_slug })))
    }
    const t = setTimeout(run, 200); return () => clearTimeout(t)
  }, [q])

  const addCard = async (card: CardIdentity) => {
    const { data } = await supabase.from('card_latest_prices').select('raw_usd, psa9_usd, psa10_usd').eq('card_slug', `pc-${card.cardSlug}`).maybeSingle()
    setRows(prev => [...prev, {
      card,
      rawCents: data?.raw_usd ?? undefined,
      psa9Cents: data?.psa9_usd ?? undefined,
      psa10Cents: data?.psa10_usd ?? undefined,
    }])
    setQ('')
  }
  const removeRow = (i: number) => setRows(prev => prev.filter((_, j) => j !== i))
  const doInsert = () => {
    if (rows.length === 0) { setError('Add at least one card'); return }
    try {
      const block = createRawPsaComparisonFromResearch(pack, { rows, showRatios })
      onInsert(block)
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
  }
  return (
    <>
      <SubHeader onBack={onBack}>Card comparison from Research</SubHeader>
      {pack.quality.status === 'blocked' && <div style={S.error}>This pack is blocked; comparisons cannot be inserted.</div>}
      <label style={S.label}>Add card</label>
      <input style={S.input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a card name…" />
      <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 4 }}>
        {results.map((c, i) => (
          <button key={i} style={S.pickRow} onClick={() => addCard(c)}>
            <strong>{c.cardName}</strong> <span style={S.muted}>{c.setName} · #{c.cardNumber}</span>
          </button>
        ))}
      </div>
      {rows.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={S.label}>Comparison rows</div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
              <span style={{ flex: 1 }}>{r.card.cardName} <span style={S.muted}>({r.card.setName})</span></span>
              <span>raw {r.rawCents != null ? `$${(r.rawCents/100).toFixed(2)}` : '—'}</span>
              <span>psa9 {r.psa9Cents != null ? `$${(r.psa9Cents/100).toFixed(2)}` : '—'}</span>
              <span>psa10 {r.psa10Cents != null ? `$${(r.psa10Cents/100).toFixed(2)}` : '—'}</span>
              <button style={S.linkBtn} onClick={() => removeRow(i)}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <label style={{ ...S.label, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={showRatios} onChange={e => setShowRatios(e.target.checked)} /> Show PSA10/Raw ratios
      </label>
      <button style={S.primary} onClick={doInsert}>Insert comparison</button>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// Card / Set inserters
// ─────────────────────────────────────────────────────────────────

function CardInserter({ onInsert, onBack, setError }: { onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CardIdentity[]>([])
  useEffect(() => {
    const run = async () => {
      if (!q.trim()) { setResults([]); return }
      const { data } = await supabase.from('cards').select('card_slug, card_name, set_name, card_number, url_slug, image_url').ilike('card_name', `%${q}%`).eq('language', 'en').limit(15)
      setResults((data ?? []).map((c: any) => ({ cardSlug: c.card_slug, cardName: String(c.card_name).replace(/\s*#\s*[0-9a-zA-Z\-\/]+\s*$/, '').trim(), cardNumber: c.card_number, setName: c.set_name, urlSlug: c.url_slug, imageUrl: c.image_url })))
    }
    const t = setTimeout(run, 200); return () => clearTimeout(t)
  }, [q])
  const insertCard = async (card: CardIdentity, mode: 'snapshot' | 'live') => {
    try {
      if (mode === 'live') {
        onInsert(createCardBlock({ card, mode: 'live' }))
        return
      }
      const { data } = await supabase.from('card_latest_prices').select('raw_usd, psa9_usd, psa10_usd, price_date').eq('card_slug', `pc-${card.cardSlug}`).maybeSingle()
      onInsert(createCardBlock({
        card,
        mode: 'snapshot',
        snapshot: {
          rawUsd:   data?.raw_usd ?? null,
          psa9Usd:  data?.psa9_usd ?? null,
          psa10Usd: data?.psa10_usd ?? null,
          asOf:     data?.price_date ?? new Date().toISOString().slice(0, 10),
        },
      }))
    } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
  }
  return (
    <>
      <SubHeader onBack={onBack}>Manual canonical card block</SubHeader>
      <input style={S.input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a card name…" />
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 4 }}>
        {results.map((c, i) => (
          <div key={i} style={S.pickRow}>
            <strong style={{ flex: 1 }}>{c.cardName}</strong>
            <span style={{ ...S.muted, marginRight: 10 }}>{c.setName} · #{c.cardNumber}</span>
            <button style={S.linkBtn} onClick={() => insertCard(c, 'snapshot')}>Snapshot</button>
            <button style={S.linkBtn} onClick={() => insertCard(c, 'live')}>Live</button>
          </div>
        ))}
      </div>
    </>
  )
}

function SetInserter({ onInsert, onBack, setError }: { onInsert: (b: any) => void; onBack: () => void; setError: (v: string | null) => void }) {
  const [sets, setSets] = useState<Array<SetIdentity & { totalCards?: number }>>([])
  const [q, setQ] = useState('')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('set_metadata').select('set_name, release_date, card_count').order('release_date', { ascending: false }).limit(1000)
      if (cancelled) return
      setSets((data ?? []).map((s: any) => ({ setName: String(s.set_name), releaseDate: s.release_date, cardCount: s.card_count, urlSlug: encodeURIComponent(String(s.set_name)) })))
    })()
    return () => { cancelled = true }
  }, [])
  const filtered = q.trim() ? sets.filter(s => s.setName.toLowerCase().includes(q.toLowerCase())).slice(0, 30) : sets.slice(0, 40)
  return (
    <>
      <SubHeader onBack={onBack}>Manual canonical set block</SubHeader>
      <input style={S.input} value={q} onChange={e => setQ(e.target.value)} placeholder="Filter sets…" />
      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: 4 }}>
        {filtered.map((s, i) => (
          <button key={i} style={S.pickRow} onClick={() => {
            try { onInsert(createSetBlock({ set: s, mode: 'live' })) } catch (e) { setError(e instanceof Error ? e.message : 'unknown') }
          }}>
            <strong>{s.setName}</strong>
            <span style={S.muted}> · {s.releaseDate || 'no release date'} · {s.cardCount ?? '?'} cards</span>
          </button>
        ))}
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────

function SubHeader({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <button style={S.linkBtn} onClick={onBack}>← Back</button>
      <div style={{ fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>{children}</div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', zIndex: 1000, overflow: 'auto', padding: 24 },
  panel:   { maxWidth: 640, margin: '0 auto', background: 'white', borderRadius: 8, padding: 20, fontFamily: "'Figtree', sans-serif" },
  header:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title:   { fontSize: 16, fontWeight: 700 },
  close:   { border: '1px solid #cbd5e1', background: 'white', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#334155', marginBottom: 6 },
  hint:    { fontSize: 11, color: '#64748b', marginBottom: 8 },
  buttonGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  menuBtn: { padding: '10px 12px', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree', sans-serif" },
  menuBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  label:   { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: '#334155', marginTop: 10, marginBottom: 4 },
  input:   { display: 'block', width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' as any, fontFamily: "'Figtree', sans-serif" },
  primary: { marginTop: 14, padding: '8px 14px', background: '#0369a1', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  linkBtn: { background: 'transparent', border: 'none', color: '#0369a1', cursor: 'pointer', fontSize: 12, padding: '2px 6px' },
  pickRow: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', width: '100%', border: 'none', borderBottom: '1px solid #f1f5f9', background: 'white', cursor: 'pointer', fontSize: 12, textAlign: 'left' as any, fontFamily: "'Figtree', sans-serif" },
  muted:   { fontSize: 11, color: '#64748b', fontWeight: 400 },
  error:   { padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 4, marginBottom: 10, fontSize: 12 },
}
