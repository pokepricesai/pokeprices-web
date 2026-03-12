'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

type Region = 'UK' | 'US'
type Grade = 'raw' | 'psa9' | 'psa10' | 'cgc95' | 'cgc10'

interface SearchResult {
  result_type: string
  name: string
  subtitle: string
  card_number_display: string | null
  price_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  image_url: string | null
  url_slug: string
}

interface DealCard {
  id: string
  name: string
  set: string
  image: string | null
  rawUsd: number
  psa9Usd: number | null
  psa10Usd: number | null
  grade: Grade
  customPct: number | null
  urlSlug: string
}

interface HotMover {
  card_name: string
  set_name: string
  current_raw: number
  raw_pct_30d: number
  card_url_slug?: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const USD_TO_GBP = 0.79
const GRADE_LABELS: Record<Grade, string> = {
  raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10', cgc95: 'CGC 9.5', cgc10: 'CGC 10',
}

function convert(usd: number, region: Region) {
  return region === 'UK' ? usd * USD_TO_GBP : usd
}
function fmt(v: number, region: Region) {
  return region === 'UK' ? `£${v.toFixed(2)}` : `$${v.toFixed(2)}`
}
function currSymbol(region: Region) { return region === 'UK' ? '£' : '$' }

function getGradePrice(card: DealCard, region: Region): number {
  let usd = card.rawUsd
  if (card.grade === 'psa9' && card.psa9Usd) usd = card.psa9Usd
  else if (card.grade === 'psa10' && card.psa10Usd) usd = card.psa10Usd
  else if (card.grade === 'cgc95' && card.psa9Usd) usd = card.psa9Usd * 0.9
  else if (card.grade === 'cgc10' && card.psa10Usd) usd = card.psa10Usd * 0.85
  return convert(usd, region)
}

function gradeAvailable(card: DealCard, grade: Grade): boolean {
  if (grade === 'raw') return true
  if ((grade === 'psa9' || grade === 'cgc95') && card.psa9Usd) return true
  if ((grade === 'psa10' || grade === 'cgc10') && card.psa10Usd) return true
  return false
}

function ebayUrl(card: DealCard, region: Region): string {
  const gradeStr = card.grade !== 'raw' ? ` ${GRADE_LABELS[card.grade]}` : ''
  const q = encodeURIComponent(`${card.name} ${card.set}${gradeStr} pokemon card`)
  const base = region === 'UK' ? 'https://www.ebay.co.uk' : 'https://www.ebay.com'
  return `${base}/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13`
}

// ── Region Toggle ─────────────────────────────────────────────────────────────

function RegionToggle({ region, onChange }: { region: Region; onChange: (r: Region) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Region</span>
      <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
        {(['UK', 'US'] as Region[]).map(r => (
          <button key={r} onClick={() => onChange(r)} style={{
            padding: '6px 16px', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            background: region === r ? 'var(--primary)' : 'transparent',
            color: region === r ? '#fff' : 'var(--text-muted)',
            transition: 'all 0.15s',
          }}>
            {r === 'UK' ? '🇬🇧 UK' : '🇺🇸 US'}
          </button>
        ))}
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
        {region === 'UK' ? '£ GBP' : '$ USD'}
      </span>
    </div>
  )
}

// ── Search Box ────────────────────────────────────────────────────────────────

function SearchBox({ region, onAdd }: { region: Region; onAdd: (card: DealCard) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_global', { query })
      const cards = (data || []).filter((r: SearchResult) => r.result_type === 'card' && r.price_usd)
      setResults(cards.slice(0, 8))
      setOpen(cards.length > 0)
      setLoading(false)
    }, 250)
  }, [query])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function handleAdd(r: SearchResult) {
    if (!r.price_usd) return
    setQuery(''); setResults([]); setOpen(false)
    // price_usd from search_global is in cents
    let psa9Usd: number | null = null
    let psa10Usd: number | null = null
    try {
      const { data } = await supabase
        .from('cards')
        .select('psa9_usd, psa10_usd')
        .eq('card_url_slug', r.url_slug)
        .maybeSingle()
      if (data) {
        psa9Usd = data.psa9_usd ? data.psa9_usd / 100 : null
        psa10Usd = data.psa10_usd ? data.psa10_usd / 100 : null
      }
    } catch {}
    onAdd({
      id: `${r.url_slug}-${Date.now()}`,
      name: r.name, set: r.subtitle,
      image: r.image_url,
      rawUsd: r.price_usd / 100,
      psa9Usd,
      psa10Usd,
      grade: 'raw', customPct: null,
      urlSlug: r.url_slug,
    })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search card to add..."
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '9px 12px 9px 36px',
            color: 'var(--text)', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)'; if (results.length) setOpen(true) }}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
        />
        {loading && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 11 }}>...</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          {results.map(r => (
            <div key={r.url_slug} onMouseDown={() => handleAdd(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                : <div style={{ width: 26, height: 36, background: 'var(--bg)', borderRadius: 3, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}{r.card_number_display ? ` · ${r.card_number_display}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(convert(r.price_usd! / 100, region), region)}</div>
                {r.psa10_usd && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>PSA 10: {fmt(convert(r.psa10_usd / 100, region), region)}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>+ ADD</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Card Row ──────────────────────────────────────────────────────────────────

function CardRow({ card, pct, region, valueLabel, valueColor, onRemove, onOverride, onGradeChange }: {
  card: DealCard; pct: number; region: Region
  valueLabel: string; valueColor: string
  onRemove: () => void
  onOverride: (pct: number | null) => void
  onGradeChange: (grade: Grade) => void
}) {
  const [editingPct, setEditingPct] = useState(false)
  const [pctInput, setPctInput] = useState('')

  const marketPrice = getGradePrice(card, region)
  const effectivePct = card.customPct ?? pct
  const offerPrice = marketPrice * (effectivePct / 100)
  const grades: Grade[] = ['raw', 'psa9', 'psa10', 'cgc95', 'cgc10']

  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border-light)', marginBottom: 8, overflow: 'hidden' }}>
      {/* Top: image + name + grade + remove */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 10, padding: '10px 12px', alignItems: 'start' }}>
        {card.image
          ? <img src={card.image} alt={card.name} style={{ width: 44, height: 61, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 44, height: 61, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{card.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 7 }}>{card.set}</div>
          {/* Grade pills */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {grades.map(g => {
              const avail = gradeAvailable(card, g)
              const active = card.grade === g
              return (
                <button key={g} onClick={() => avail && onGradeChange(g)} title={!avail ? 'No data for this grade' : ''}
                  style={{
                    padding: '2px 7px', borderRadius: 5, cursor: avail ? 'pointer' : 'not-allowed',
                    fontSize: 10, fontWeight: active ? 700 : 500, fontFamily: "'Figtree', sans-serif",
                    background: active ? 'var(--primary)' : 'var(--bg)',
                    color: active ? '#fff' : avail ? 'var(--text-muted)' : 'var(--border)',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    opacity: avail ? 1 : 0.35, transition: 'all 0.1s',
                  }}>
                  {GRADE_LABELS[g]}
                </button>
              )
            })}
          </div>
        </div>
        <button onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 20, padding: '0 4px', lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >×</button>
      </div>

      {/* Bottom bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border-light)', gap: 8,
      }}>
        {/* Market price */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>Market ({GRADE_LABELS[card.grade]})</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(marketPrice, region)}</div>
        </div>

        {/* % override */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>Rate</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {editingPct ? (
              <>
                <input autoFocus type="number" min={10} max={100} value={pctInput}
                  onChange={e => setPctInput(e.target.value)}
                  onBlur={() => {
                    const v = parseInt(pctInput)
                    onOverride(!isNaN(v) && v >= 10 && v <= 100 ? v : null)
                    setEditingPct(false)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 44, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '3px 5px', fontFamily: "'Figtree', sans-serif" }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>%</span>
              </>
            ) : (
              <button onClick={() => { setPctInput(String(effectivePct)); setEditingPct(true) }}
                style={{
                  background: card.customPct != null ? 'rgba(245,158,11,0.12)' : 'var(--bg-light)',
                  border: `1px solid ${card.customPct != null ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700,
                  color: card.customPct != null ? '#d97706' : 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif",
                }}>
                {effectivePct}%
              </button>
            )}
            {card.customPct != null && !editingPct && (
              <button onClick={() => onOverride(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: 'underline', padding: 0 }}>reset</button>
            )}
          </div>
        </div>

        {/* Offer */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>{valueLabel}</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: valueColor, fontFamily: "'Figtree', sans-serif" }}>{fmt(offerPrice, region)}</div>
        </div>

        {/* eBay last sold */}
        <a href={ebayUrl(card, region)} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
            background: 'rgba(232,121,0,0.08)', border: '1px solid rgba(232,121,0,0.2)',
            color: '#c05500', fontSize: 11, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none', transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.15)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.08)'}
        >
          🛒 eBay {region === 'UK' ? '.co.uk' : '.com'} last sold ↗
        </a>
      </div>
    </div>
  )
}

// ── Deal Panel ────────────────────────────────────────────────────────────────

function DealPanel({
  title, emoji, accentColor, description,
  cards, pct, region, valueLabel, valueColor,
  cashAmount, cashLabel,
  onAdd, onRemove, onOverride, onGradeChange, onCashChange, emptyHint,
}: {
  title: string; emoji: string; accentColor: string; description: string
  cards: DealCard[]; pct: number; region: Region
  valueLabel: string; valueColor: string
  cashAmount: string; cashLabel: string
  onAdd: (c: DealCard) => void; onRemove: (id: string) => void
  onOverride: (id: string, pct: number | null) => void
  onGradeChange: (id: string, grade: Grade) => void
  onCashChange: (v: string) => void
  emptyHint: string
}) {
  const totalMarket = cards.reduce((s, c) => s + getGradePrice(c, region), 0)
  const totalOffer = cards.reduce((s, c) => s + getGradePrice(c, region) * ((c.customPct ?? pct) / 100), 0)
  const cashVal = parseFloat(cashAmount) || 0
  const grandTotal = totalOffer + cashVal

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 18px', borderTop: `3px solid ${accentColor}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 20 }}>{emoji}</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{title}</h2>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{description}</p>
      </div>

      {/* Search */}
      <SearchBox region={region} onAdd={onAdd} />

      {/* Cards + cash */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px' }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>
          Cards {cards.length > 0 && <span style={{ color: accentColor }}>({cards.length})</span>}
        </div>

        {cards.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', border: '2px dashed var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🃏</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{emptyHint}</div>
          </div>
        ) : cards.map(c => (
          <CardRow key={c.id} card={c} pct={pct} region={region}
            valueLabel={valueLabel} valueColor={valueColor}
            onRemove={() => onRemove(c.id)}
            onOverride={p => onOverride(c.id, p)}
            onGradeChange={g => onGradeChange(c.id, g)}
          />
        ))}

        {/* Cash */}
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-light)', borderRadius: 10, border: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
            💵 {cashLabel}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 700 }}>{currSymbol(region)}</span>
            <input type="number" min={0} step={0.01} value={cashAmount} onChange={e => onCashChange(e.target.value)} placeholder="0.00"
              style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', color: 'var(--text)', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", outline: 'none' }}
            />
            {cashVal > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif" }}>{fmt(cashVal, region)}</span>}
          </div>
        </div>

        {/* Panel total */}
        {(cards.length > 0 || cashVal > 0) && (
          <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>Total</div>
              {cards.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>Market: {fmt(totalMarket, region)}</div>}
              {cashVal > 0 && cards.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{fmt(totalOffer, region)} cards + {fmt(cashVal, region)} cash</div>}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: accentColor, fontFamily: "'Figtree', sans-serif" }}>{fmt(grandTotal, region)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hot Movers ────────────────────────────────────────────────────────────────

function HotMovers({ region }: { region: Region }) {
  const [risers, setRisers] = useState<HotMover[]>([])
  const [fallers, setFallers] = useState<HotMover[]>([])
  const [tab, setTab] = useState<'risers' | 'fallers'>('risers')

  useEffect(() => {
    async function load() {
      const [risersRes, fallersRes] = await Promise.all([
        supabase.from('card_trends')
          .select('card_name, set_name, current_raw, raw_pct_30d')
          .not('raw_pct_30d', 'is', null).gt('current_raw', 500)
          .gt('raw_pct_30d', 0).lte('raw_pct_30d', 300)
          .order('raw_pct_30d', { ascending: false }).limit(10),
        supabase.from('card_trends')
          .select('card_name, set_name, current_raw, raw_pct_30d')
          .not('raw_pct_30d', 'is', null).gt('current_raw', 500)
          .lt('raw_pct_30d', 0).gte('raw_pct_30d', -300)
          .order('raw_pct_30d', { ascending: true }).limit(10),
      ])
      if (risersRes.data) setRisers(risersRes.data)
      if (fallersRes.data) setFallers(fallersRes.data)
    }
    load()
  }, [])

  const rows = tab === 'risers' ? risers : fallers
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['risers', 'fallers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
            background: tab === t ? 'var(--bg-light)' : 'transparent',
            color: tab === t ? (t === 'risers' ? '#16a34a' : '#dc2626') : 'var(--text-muted)',
            borderBottom: tab === t ? `2px solid ${t === 'risers' ? '#16a34a' : '#dc2626'}` : '2px solid transparent',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {t === 'risers' ? '📈 Risers' : '📉 Fallers'}
          </button>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ width: 16, fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", flexShrink: 0, textAlign: 'right' }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.set_name}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(convert(r.current_raw / 100, region), region)}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: r.raw_pct_30d > 0 ? '#16a34a' : '#dc2626', fontFamily: "'Figtree', sans-serif" }}>
              {r.raw_pct_30d > 0 ? '+' : ''}{r.raw_pct_30d.toFixed(1)}%
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function DealerPageClient() {
  const [region, setRegion] = useState<Region>('UK')
  const [cashPct, setCashPct] = useState(55)
  const [tradePct, setTradePct] = useState(70)

  const [dealerCards, setDealerCards] = useState<DealCard[]>([])
  const [dealerCash, setDealerCash] = useState('')
  const [customerCards, setCustomerCards] = useState<DealCard[]>([])
  const [customerCash, setCustomerCash] = useState('')

  const dealerCardMarket = dealerCards.reduce((s, c) => s + getGradePrice(c, region), 0)
  const dealerCashVal = parseFloat(dealerCash) || 0
  const dealerTotal = dealerCardMarket + dealerCashVal

  const customerCardOffer = customerCards.reduce((s, c) => s + getGradePrice(c, region) * ((c.customPct ?? tradePct) / 100), 0)
  const customerCashVal = parseFloat(customerCash) || 0
  const customerTotal = customerCardOffer + customerCashVal

  const diff = customerTotal - dealerTotal
  const diffPct = dealerTotal > 0 ? (customerTotal / dealerTotal) * 100 : null
  const verdict = diff > 1 ? 'up' : diff < -1 ? 'down' : 'even'
  const verdictColor = verdict === 'up' ? '#16a34a' : verdict === 'down' ? '#dc2626' : '#d97706'

  const hasAnything = dealerCards.length > 0 || customerCards.length > 0 || dealerCashVal > 0 || customerCashVal > 0

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>🏪 Dealer Tools · PokePrices</div>
          <h1 style={{ margin: '0 0 4px', fontFamily: "'Playfair Display', serif", fontSize: 30, fontWeight: 700, color: 'var(--text)' }}>Deal Builder</h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Build both sides of a trade. See instantly if the deal works at your rates.</p>
        </div>
        <RegionToggle region={region} onChange={setRegion} />
      </div>

      {/* Rate controls */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 22px', marginBottom: 22 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14 }}>
          Your Rates — applies globally, override per card using the % button
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {[
            { label: 'Cash offer %', value: cashPct, set: setCashPct, color: '#16a34a', hint: 'You pay cash — typically lower' },
            { label: 'Trade / store credit %', value: tradePct, set: setTradePct, color: 'var(--primary)', hint: 'Store credit or trade — typically higher' },
          ].map(r => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.label}</span>
                <span style={{ fontSize: 24, fontWeight: 900, color: r.color, fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{r.value}%</span>
              </div>
              <input type="range" min={30} max={95} value={r.value} onChange={e => r.set(Number(e.target.value))}
                style={{ width: '100%', accentColor: r.color, cursor: 'pointer' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>{r.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Two-sided deal */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <DealPanel
          title="Your Side" emoji="🏪" accentColor="var(--primary)"
          description="Cards you're selling or trading, plus any cash you're adding"
          cards={dealerCards} pct={tradePct} region={region}
          valueLabel="Market ask" valueColor="var(--text)"
          cashAmount={dealerCash} cashLabel="Cash you're offering"
          onAdd={c => setDealerCards(p => [...p, c])}
          onRemove={id => setDealerCards(p => p.filter(c => c.id !== id))}
          onOverride={(id, pct) => setDealerCards(p => p.map(c => c.id === id ? { ...c, customPct: pct } : c))}
          onGradeChange={(id, g) => setDealerCards(p => p.map(c => c.id === id ? { ...c, grade: g } : c))}
          onCashChange={setDealerCash}
          emptyHint="Add what you're putting on the table"
        />
        <DealPanel
          title="Customer's Offer" emoji="🤝" accentColor="#16a34a"
          description="Cards and cash the customer is offering you"
          cards={customerCards} pct={tradePct} region={region}
          valueLabel="Your offer" valueColor="#16a34a"
          cashAmount={customerCash} cashLabel="Cash they're adding"
          onAdd={c => setCustomerCards(p => [...p, c])}
          onRemove={id => setCustomerCards(p => p.filter(c => c.id !== id))}
          onOverride={(id, pct) => setCustomerCards(p => p.map(c => c.id === id ? { ...c, customPct: pct } : c))}
          onGradeChange={(id, g) => setCustomerCards(p => p.map(c => c.id === id ? { ...c, grade: g } : c))}
          onCashChange={setCustomerCash}
          emptyHint="Add their cards and any cash they're putting in"
        />
      </div>

      {/* Verdict */}
      {hasAnything && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderLeft: `4px solid ${verdictColor}`,
          borderRadius: 14, padding: '20px 24px', marginBottom: 24,
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14 }}>Deal Verdict</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 12, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginBottom: 4 }}>Your side</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{fmt(dealerTotal, region)}</div>
              {dealerCashVal > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>incl. {fmt(dealerCashVal, region)} cash</div>}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-muted)', padding: '0 8px' }}>vs</div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginBottom: 4 }}>
                Customer's offer {diffPct != null && <span style={{ color: verdictColor }}>({diffPct.toFixed(1)}% of your ask)</span>}
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: verdictColor, fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{fmt(customerTotal, region)}</div>
              {customerCashVal > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>incl. {fmt(customerCashVal, region)} cash</div>}
            </div>
            <div style={{ background: 'var(--bg-light)', borderRadius: 12, padding: '12px 18px', textAlign: 'center', minWidth: 130 }}>
              <div style={{ fontSize: 22, marginBottom: 4 }}>{verdict === 'up' ? '✅' : verdict === 'down' ? '❌' : '⚖️'}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: verdictColor, fontFamily: "'Figtree', sans-serif" }}>
                {verdict === 'up' ? `Up ${fmt(diff, region)}` : verdict === 'down' ? `Short ${fmt(Math.abs(diff), region)}` : 'Roughly even'}
              </div>
            </div>
          </div>
          {diffPct != null && (
            <div style={{ marginTop: 16 }}>
              <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 3, transition: 'width 0.3s', width: `${Math.min(100, diffPct)}%`, background: verdictColor }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>0%</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>100% of your ask</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom: rate ref + movers */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', alignSelf: 'start' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>Rate Quick Ref</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '5px 14px', alignItems: 'center' }}>
            <span /><span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>Cash</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>Trade</span>
            {[200, 100, 50, 20, 10, 5].map(v => (
              <>
                <span key={`l${v}`} style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{currSymbol(region)}{v}</span>
                <span key={`c${v}`} style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>{currSymbol(region)}{(v * cashPct / 100).toFixed(0)}</span>
                <span key={`t${v}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>{currSymbol(region)}{(v * tradePct / 100).toFixed(0)}</span>
              </>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>Market Movers — 30d</div>
          <HotMovers region={region} />
        </div>
      </div>
    </div>
  )
}
