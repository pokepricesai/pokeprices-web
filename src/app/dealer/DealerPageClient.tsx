'use client'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

type Region   = 'UK' | 'US'
type Grade    = 'raw' | 'psa9' | 'psa10' | 'cgc95' | 'cgc10'
type DealMode = 'cash' | 'trade' | 'blended'

interface SearchResult {
  result_type: string
  name: string
  subtitle: string
  card_number_display: string | null
  price_usd: number | null
  image_url: string | null
  url_slug: string
}

// Dealer card: selling price (defaults to market, override with actual £ amount)
interface DealerCard {
  id: string
  name: string
  set: string
  image: string | null
  rawUsd: number
  psa9Usd: number | null
  psa10Usd: number | null
  cgc95Usd: number | null
  cgc10Usd: number | null
  grade: Grade
  urlSlug: string
  sellingPrice: number | null // null = use market price; set = dealer's actual price
}

// Customer card: market value can be overridden (e.g. dealer checks eBay last sold and uses that instead)
// Offer = overrideMarket (or grade market) × cash/trade %
// customPct overrides the global rate for this card only
interface CustomerCard {
  id: string
  name: string
  set: string
  image: string | null
  rawUsd: number
  psa9Usd: number | null
  psa10Usd: number | null
  cgc95Usd: number | null
  cgc10Usd: number | null
  grade: Grade
  urlSlug: string
  customPct: number | null      // null = global default
  marketOverride: number | null // null = use grade market; set = dealer's agreed market value
}

// ── Constants ──────────────────────────────────────────────────────────────────

const USD_TO_GBP        = 0.79
const DEFAULT_CASH_PCT  = 50
const DEFAULT_TRADE_PCT = 70

const GRADE_LABELS: Record<Grade, string> = {
  raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10', cgc95: 'CGC 9.5', cgc10: 'CGC 10',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function convert(usd: number, region: Region): number {
  return region === 'UK' ? usd * USD_TO_GBP : usd
}

function fmt(v: number, region: Region): string {
  return (region === 'UK' ? '£' : '$') + Math.abs(v).toFixed(2)
}

function sym(region: Region): string { return region === 'UK' ? '£' : '$' }

type GradedCard = Pick<DealerCard, 'rawUsd' | 'psa9Usd' | 'psa10Usd' | 'cgc95Usd' | 'cgc10Usd' | 'grade'>

function getGradeMarket(card: GradedCard, region: Region): number {
  let usd = card.rawUsd
  if (card.grade === 'psa9'  && card.psa9Usd)  usd = card.psa9Usd
  if (card.grade === 'psa10' && card.psa10Usd) usd = card.psa10Usd
  if (card.grade === 'cgc95' && card.cgc95Usd) usd = card.cgc95Usd
  if (card.grade === 'cgc10' && card.cgc10Usd) usd = card.cgc10Usd
  return convert(usd, region)
}

function gradeAvailable(card: Pick<DealerCard, 'psa9Usd' | 'psa10Usd' | 'cgc95Usd' | 'cgc10Usd'>, grade: Grade): boolean {
  if (grade === 'raw')   return true
  if (grade === 'psa9')  return !!card.psa9Usd
  if (grade === 'psa10') return !!card.psa10Usd
  if (grade === 'cgc95') return !!card.cgc95Usd
  if (grade === 'cgc10') return !!card.cgc10Usd
  return false
}

function ebayUrl(name: string, set: string, grade: Grade, region: Region): string {
  const g = grade !== 'raw' ? ` ${GRADE_LABELS[grade]}` : ''
  const q = encodeURIComponent(`${name} ${set}${g} pokemon card`)
  const base = region === 'UK' ? 'https://www.ebay.co.uk' : 'https://www.ebay.com'
  return `${base}/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13`
}

function dealerCardValue(card: DealerCard, region: Region): number {
  return card.sellingPrice ?? getGradeMarket(card, region)
}

function customerCardValue(
  card: CustomerCard,
  mode: DealMode,
  cashPct: number,
  tradePct: number,
  region: Region
): number {
  // Use overridden market value if set, otherwise grade market price
  const market = card.marketOverride ?? getGradeMarket(card, region)
  const cp = card.customPct ?? cashPct
  const tp = card.customPct ?? tradePct
  if (mode === 'cash')  return market * (cp / 100)
  if (mode === 'trade') return market * (tp / 100)
  return market * ((cp + tp) / 200)
}

async function fetchGradedPrices(urlSlug: string) {
  try {
    const { data: cardRow } = await supabase
      .from('cards').select('card_slug')
      .eq('card_url_slug', urlSlug).maybeSingle()
    if (!cardRow?.card_slug) return { psa9Usd: null, psa10Usd: null, cgc95Usd: null, cgc10Usd: null }
    const { data: dp } = await supabase
      .from('daily_prices')
      .select('psa9_usd, psa10_usd, cgc95_usd, cgc10_usd')
      .eq('card_slug', 'pc-' + cardRow.card_slug)
      .order('date', { ascending: false }).limit(1).maybeSingle()
    return {
      psa9Usd:  dp?.psa9_usd  ? dp.psa9_usd  / 100 : null,
      psa10Usd: dp?.psa10_usd ? dp.psa10_usd / 100 : null,
      cgc95Usd: dp?.cgc95_usd ? dp.cgc95_usd / 100 : null,
      cgc10Usd: dp?.cgc10_usd ? dp.cgc10_usd / 100 : null,
    }
  } catch {
    return { psa9Usd: null, psa10Usd: null, cgc95Usd: null, cgc10Usd: null }
  }
}

// ── Grade Pills ────────────────────────────────────────────────────────────────

function GradePills({ card, onGradeChange }: {
  card: Pick<DealerCard, 'psa9Usd' | 'psa10Usd' | 'cgc95Usd' | 'cgc10Usd' | 'grade'>
  onGradeChange: (g: Grade) => void
}) {
  const grades: Grade[] = ['raw', 'psa9', 'psa10', 'cgc95', 'cgc10']
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
      {grades.map(g => {
        const avail  = gradeAvailable(card, g)
        const active = card.grade === g
        return (
          <button key={g} onClick={() => avail && onGradeChange(g)}
            title={!avail ? 'No price data for this grade' : ''}
            style={{
              padding: '3px 8px', borderRadius: 5, cursor: avail ? 'pointer' : 'not-allowed',
              fontSize: 11, fontWeight: active ? 700 : 500, fontFamily: "'Figtree', sans-serif",
              background: active ? 'var(--primary)' : 'var(--bg)',
              color: active ? '#fff' : avail ? 'var(--text-muted)' : 'var(--border)',
              border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
              opacity: avail ? 1 : 0.35, transition: 'all 0.1s',
            }}
          >{GRADE_LABELS[g]}</button>
        )
      })}
    </div>
  )
}

// ── Search Box ─────────────────────────────────────────────────────────────────

function SearchBox({ region, onAdd }: { region: Region; onAdd: (r: SearchResult) => void }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)
  const debounceRef           = useRef<NodeJS.Timeout>()
  const wrapRef               = useRef<HTMLDivElement>(null)

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
    function onOut(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOut)
    return () => document.removeEventListener('mousedown', onOut)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search card to add..."
          style={{
            width: '100%', boxSizing: 'border-box' as const,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '11px 12px 11px 38px',
            color: 'var(--text)', fontSize: 15, fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)'; if (results.length) setOpen(true) }}
          onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
        />
        {loading && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 11 }}>...</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}>
          {results.map(r => (
            <div key={r.url_slug}
              onMouseDown={() => { onAdd(r); setQuery(''); setResults([]); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                : <div style={{ width: 26, height: 36, background: 'var(--bg)', borderRadius: 3, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
                {fmt(convert(r.price_usd! / 100, region), region)}
              </div>
              <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>+ ADD</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Inline price editor ────────────────────────────────────────────────────────

function PriceEditor({ value, region, isOverridden, label, color, onCommit, onReset }: {
  value: number
  region: Region
  isOverridden: boolean
  label: string
  color: string
  onCommit: (v: number) => void
  onReset: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [input, setInput]     = useState('')

  function start() { setInput(value.toFixed(2)); setEditing(true) }
  function commit() {
    const v = parseFloat(input)
    if (!isNaN(v) && v >= 0) onCommit(v)
    setEditing(false)
  }

  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginBottom: 3 }}>
        {label}
      </div>
      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Figtree', sans-serif" }}>{sym(region)}</span>
          <input
            autoFocus type="number" min={0} step={0.01} value={input}
            onChange={e => setInput(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit() }}
            style={{
              width: 80, background: 'var(--bg-light)', border: `1px solid ${color}`,
              borderRadius: 6, color: 'var(--text)', fontSize: 16, fontWeight: 800,
              padding: '3px 6px', fontFamily: "'Figtree', sans-serif", outline: 'none',
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={start} style={{
            background: isOverridden ? `${color}15` : 'transparent',
            border: `1px solid ${isOverridden ? color + '55' : 'var(--border)'}`,
            borderRadius: 8, padding: '4px 12px', cursor: 'pointer',
            fontSize: 20, fontWeight: 900, color: isOverridden ? color : 'var(--text)',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {fmt(value, region)}
          </button>
          {isOverridden && (
            <button onClick={onReset}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: 'underline', padding: 0 }}
            >reset</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Dealer Card Row ────────────────────────────────────────────────────────────

function DealerCardRow({ card, region, onRemove, onPriceChange, onGradeChange }: {
  card: DealerCard
  region: Region
  onRemove: () => void
  onPriceChange: (price: number | null) => void
  onGradeChange: (g: Grade) => void
}) {
  const marketPrice    = getGradeMarket(card, region)
  const effectivePrice = dealerCardValue(card, region)
  const isOverridden   = card.sellingPrice !== null

  function handleCommit(v: number) {
    // If they type the market price exactly, clear override so it tracks naturally
    onPriceChange(Math.abs(v - marketPrice) < 0.005 ? null : v)
  }

  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border-light)', marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 10, padding: '10px 12px', alignItems: 'start' }}>
        {card.image
          ? <img src={card.image} alt={card.name} style={{ width: 44, height: 61, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 44, height: 61, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{card.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 7 }}>{card.set}</div>
          <GradePills card={card} onGradeChange={onGradeChange} />
        </div>
        <button onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, padding: '0 4px', lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >×</button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const,
        padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border-light)', gap: 14,
      }}>
        {/* Market reference — greyed out */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
            Market
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: isOverridden ? 'line-through' : 'none' }}>
            {fmt(marketPrice, region)}
          </div>
        </div>

        <div style={{ color: 'var(--border)', fontSize: 16 }}>→</div>

        {/* Selling price — click to edit */}
        <div style={{ flex: 1 }}>
          <PriceEditor
            value={effectivePrice}
            region={region}
            isOverridden={isOverridden}
            label="Your selling price"
            color="#1d4ed8"
            onCommit={handleCommit}
            onReset={() => onPriceChange(null)}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {isOverridden ? 'Using your price — click to change, or reset to market' : 'Defaults to market — click to set your store price'}
          </div>
        </div>

        <a href={ebayUrl(card.name, card.set, card.grade, region)} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
            background: 'rgba(232,121,0,0.08)', border: '1px solid rgba(232,121,0,0.2)',
            color: '#c05500', fontSize: 11, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none', whiteSpace: 'nowrap' as const,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.15)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.08)'}
        >🛒 eBay sold ↗</a>
      </div>
    </div>
  )
}

// ── Customer Card Row ──────────────────────────────────────────────────────────

function CustomerCardRow({ card, mode, cashPct, tradePct, region, onRemove, onPctChange, onMarketOverride, onGradeChange }: {
  card: CustomerCard
  mode: DealMode
  cashPct: number
  tradePct: number
  region: Region
  onRemove: () => void
  onPctChange: (pct: number | null) => void
  onMarketOverride: (v: number | null) => void
  onGradeChange: (g: Grade) => void
}) {
  const [editingPct, setEditingPct] = useState(false)
  const [pctInput, setPctInput]     = useState('')

  const gradeMarket      = getGradeMarket(card, region)
  const effectiveMarket  = card.marketOverride ?? gradeMarket
  const isMarketOverride = card.marketOverride !== null
  const offerValue       = customerCardValue(card, mode, cashPct, tradePct, region)
  const isPctCustom      = card.customPct !== null

  const activePct = (() => {
    const cp = card.customPct ?? cashPct
    const tp = card.customPct ?? tradePct
    if (mode === 'cash')  return cp
    if (mode === 'trade') return tp
    return Math.round((cp + tp) / 2)
  })()

  const modeLabel = mode === 'cash' ? 'Cash offer' : mode === 'trade' ? 'Trade credit' : 'Blended'
  const modeColor = mode === 'cash' ? '#16a34a' : mode === 'trade' ? 'var(--primary)' : '#7c3aed'

  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border-light)', marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 10, padding: '10px 12px', alignItems: 'start' }}>
        {card.image
          ? <img src={card.image} alt={card.name} style={{ width: 44, height: 61, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 44, height: 61, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{card.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 7 }}>{card.set}</div>
          <GradePills card={card} onGradeChange={onGradeChange} />
        </div>
        <button onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, padding: '0 4px', lineHeight: 1 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
        >×</button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' as const,
        padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border-light)', gap: 14,
      }}>

        {/* Market value — editable */}
        <div style={{ flex: 1 }}>
          <PriceEditor
            value={effectiveMarket}
            region={region}
            isOverridden={isMarketOverride}
            label="Market value"
            color="#b45309"
            onCommit={v => {
              onMarketOverride(Math.abs(v - gradeMarket) < 0.005 ? null : v)
            }}
            onReset={() => onMarketOverride(null)}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {isMarketOverride ? 'Using your value — click to change, or reset to data' : 'From our data — click to set your own (e.g. eBay last sold)'}
          </div>
        </div>

        {/* % rate */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginBottom: 3 }}>
            Rate %
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {editingPct ? (
              <>
                <input autoFocus type="number" min={1} max={100} value={pctInput}
                  onChange={e => setPctInput(e.target.value)}
                  onBlur={() => {
                    const v = parseInt(pctInput)
                    onPctChange(!isNaN(v) && v >= 1 && v <= 100 ? v : null)
                    setEditingPct(false)
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 48, background: 'var(--bg-light)', border: '1px solid var(--primary)', borderRadius: 6, color: 'var(--text)', fontSize: 14, fontWeight: 700, padding: '3px 6px', fontFamily: "'Figtree', sans-serif", outline: 'none' }}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>%</span>
              </>
            ) : (
              <button
                onClick={() => { setPctInput(String(card.customPct ?? activePct)); setEditingPct(true) }}
                style={{
                  background: isPctCustom ? 'rgba(245,158,11,0.1)' : 'var(--bg-light)',
                  border: `1px solid ${isPctCustom ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                  fontSize: 14, fontWeight: 700,
                  color: isPctCustom ? '#d97706' : 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif",
                }}
              >
                {activePct}%
              </button>
            )}
            {isPctCustom && !editingPct && (
              <button onClick={() => onPctChange(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: 'underline', padding: 0 }}
              >reset</button>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {isPctCustom ? 'Card-specific rate set' : 'Click to override for this card'}
          </div>
        </div>

        {/* Calculated offer — read only, derived from market × % */}
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginBottom: 3 }}>
            {modeLabel}
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: modeColor, fontFamily: "'Figtree', sans-serif" }}>
            {fmt(offerValue, region)}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {effectiveMarket > 0 ? `${activePct}% of ${fmt(effectiveMarket, region)}` : ''}
          </div>
        </div>

        <a href={ebayUrl(card.name, card.set, card.grade, region)} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
            background: 'rgba(232,121,0,0.08)', border: '1px solid rgba(232,121,0,0.2)',
            color: '#c05500', fontSize: 11, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none', whiteSpace: 'nowrap' as const,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.15)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.08)'}
        >🛒 eBay sold ↗</a>
      </div>
    </div>
  )
}

// ── Rate Controls ──────────────────────────────────────────────────────────────

function RateControls({ cashPct, tradePct, onCashChange, onTradeChange }: {
  cashPct: number; tradePct: number
  onCashChange: (v: number) => void; onTradeChange: (v: number) => void
}) {
  const [cashInput, setCashInput]   = useState(String(cashPct))
  const [tradeInput, setTradeInput] = useState(String(tradePct))

  // Keep inputs in sync if sliders change
  useEffect(() => { setCashInput(String(cashPct)) },  [cashPct])
  useEffect(() => { setTradeInput(String(tradePct)) }, [tradePct])

  function handleCashInput(raw: string) {
    setCashInput(raw)
    const v = parseInt(raw)
    if (!isNaN(v) && v >= 1 && v <= 100) onCashChange(v)
  }
  function handleTradeInput(raw: string) {
    setTradeInput(raw)
    const v = parseInt(raw)
    if (!isNaN(v) && v >= 1 && v <= 100) onTradeChange(v)
  }

  const rates = [
    { label: '💵 Cash offer %', value: cashPct, input: cashInput, onChange: onCashChange, onInputChange: handleCashInput, color: '#16a34a' },
    { label: '🔄 Trade credit %', value: tradePct, input: tradeInput, onChange: onTradeChange, onInputChange: handleTradeInput, color: '#1d4ed8' },
  ]

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 14,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
        Default offer rates
      </div>
      {rates.map(({ label, value, input, onChange, onInputChange, color }) => (
        <div key={label}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number" min={1} max={100} value={input}
                onChange={e => onInputChange(e.target.value)}
                style={{
                  width: 56, background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 7, padding: '5px 8px', fontSize: 16, fontWeight: 800,
                  color, fontFamily: "'Figtree', sans-serif", outline: 'none', textAlign: 'center' as const,
                }}
                onFocus={e => e.currentTarget.style.borderColor = color}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              <span style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Figtree', sans-serif" }}>%</span>
            </div>
          </div>
          <input
            type="range" min={1} max={100} value={value}
            onChange={e => onChange(parseInt(e.target.value))}
            style={{ width: '100%', height: 8, accentColor: color, cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>
            <span>1%</span><span>50%</span><span>100%</span>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", paddingTop: 4, borderTop: '1px solid var(--border-light)' }}>
        Override per card by clicking its offer value
      </div>
    </div>
  )
}

// ── Deal Verdict ───────────────────────────────────────────────────────────────

function DealVerdict({ dealerCards, customerCards, mode, cashPct, tradePct, region, onModeChange }: {
  dealerCards: DealerCard[]
  customerCards: CustomerCard[]
  mode: DealMode
  cashPct: number
  tradePct: number
  region: Region
  onModeChange: (m: DealMode) => void
}) {
  if (dealerCards.length === 0 && customerCards.length === 0) return null

  const dealerTotal   = dealerCards.reduce((s, c) => s + dealerCardValue(c, region), 0)
  const customerTotal = customerCards.reduce((s, c) => s + customerCardValue(c, mode, cashPct, tradePct, region), 0)

  // For trade mode we need a second pass at cash rates — if dealer is ahead,
  // the customer pays cash (not trade credit), so the gap should be based on cash %
  const customerTotalAtCash = customerCards.reduce((s, c) => s + customerCardValue(c, 'cash', cashPct, tradePct, region), 0)

  // diff = dealerTotal - customerTotal
  // positive → dealer giving more → customer owes the difference
  // negative → customer giving more → dealer owes the difference
  const diff    = dealerTotal - customerTotal
  const isEven  = Math.abs(diff) < 0.50
  const whoOwes = diff > 0 ? 'customer' : 'dealer'

  // In trade mode when dealer is winning, gap is calculated at cash rates
  const effectiveCustomerTotal = (mode === 'trade' && whoOwes === 'customer') ? customerTotalAtCash : customerTotal
  const effectiveDiff    = dealerTotal - effectiveCustomerTotal
  const absDiff  = Math.abs(effectiveDiff)
  const isEffectiveEven = absDiff < 0.50

  // Compute blended split
  const tradeWeight  = tradePct / (cashPct + tradePct || 1)
  const cashWeight   = cashPct  / (cashPct + tradePct || 1)
  const tradePortion = absDiff * tradeWeight
  const cashPortion  = absDiff * cashWeight

  const modeColors: Record<DealMode, string> = {
    cash: '#16a34a', trade: '#1d4ed8', blended: '#7c3aed',
  }
  const modeDescriptions: Record<DealMode, string> = {
    cash:    `Paying cash at ${cashPct}% of market`,
    trade:   `Giving store credit at ${tradePct}% of market`,
    blended: `Half cash (${cashPct}%) + half store credit (${tradePct}%), averaged`,
  }

  function renderVerdict() {
    if (isEven || isEffectiveEven) return (
      <div style={{ textAlign: 'center' as const, padding: '8px 0' }}>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#16a34a', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>✓ Even deal</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Both sides are within {fmt(0.50, region)} — no cash needed.
        </div>
      </div>
    )

    if (mode === 'cash') {
      return (
        <VerdictBox
          color={whoOwes === 'customer' ? '#b45309' : '#1d4ed8'}
          headline={whoOwes === 'customer'
            ? `Customer adds ${fmt(absDiff, region)} cash`
            : `Dealer adds ${fmt(absDiff, region)} cash`}
          subtext={whoOwes === 'customer'
            ? `Dealer's cards are worth ${fmt(absDiff, region)} more. Customer tops up in cash.`
            : `Customer's cards are worth ${fmt(absDiff, region)} more. Dealer tops up in cash.`}
          breakdown={[
            { label: 'Dealer cards', value: fmt(dealerTotal, region), color: '#1d4ed8' },
            { label: 'Customer offer', value: fmt(customerTotal, region), color: '#b45309' },
            { label: 'Cash to add', value: fmt(absDiff, region), sublabel: `from ${whoOwes}`, color: whoOwes === 'customer' ? '#b45309' : '#1d4ed8' },
          ]}
        />
      )
    }

    if (mode === 'trade') {
      if (whoOwes === 'dealer') {
        // Customer's cards worth more at trade % → customer has store credit to spend
        return (
          <VerdictBox
            color="#b45309"
            headline={`Customer has ${fmt(absDiff, region)} store credit`}
            subtext={`Customer's cards are worth ${fmt(absDiff, region)} more than the dealer's offer at trade credit rates. That difference becomes store credit to spend in store.`}
            breakdown={[
              { label: 'Dealer cards', value: fmt(dealerTotal, region), color: '#1d4ed8' },
              { label: 'Customer offer', value: fmt(customerTotal, region), color: '#b45309' },
              { label: 'Store credit', value: fmt(absDiff, region), sublabel: 'customer to spend', color: '#b45309' },
            ]}
          />
        )
      } else {
        // Dealer cards worth more → customer pays cash (valued at cash % rate, not trade %)
        return (
          <VerdictBox
            color="#b45309"
            headline={`Customer pays ${fmt(absDiff, region)} cash`}
            subtext={`Dealer's cards are worth more. Store credit only flows dealer → customer, so the shortfall is treated as a cash payment at your ${cashPct}% cash rate.`}
            breakdown={[
              { label: 'Dealer cards', value: fmt(dealerTotal, region), color: '#1d4ed8' },
              { label: 'Customer offer (cash rate)', value: fmt(customerTotalAtCash, region), color: '#b45309' },
              { label: 'Cash to pay', value: fmt(absDiff, region), sublabel: 'from customer', color: '#b45309' },
            ]}
          />
        )
      }
    }

    // Blended mode — split the difference proportionally
    if (whoOwes === 'customer') {
      // Dealer giving more → customer gets store credit for trade portion, pays cash for cash portion
      return (
        <VerdictBox
          color="#7c3aed"
          headline={`Split: ${fmt(tradePortion, region)} store credit + ${fmt(cashPortion, region)} cash from customer`}
          subtext={`Dealer's cards are worth ${fmt(absDiff, region)} more. Blended deal: part store credit back to customer, part cash from customer.`}
          breakdown={[
            { label: 'Dealer cards', value: fmt(dealerTotal, region), color: '#1d4ed8' },
            { label: 'Customer offer', value: fmt(customerTotal, region), color: '#b45309' },
            { label: 'Store credit', value: fmt(tradePortion, region), sublabel: 'to customer', color: '#1d4ed8' },
            { label: 'Cash to add', value: fmt(cashPortion, region), sublabel: 'from customer', color: '#b45309' },
          ]}
        />
      )
    } else {
      // Customer giving more → dealer tops up with cash portion, gives store credit for trade portion
      return (
        <VerdictBox
          color="#7c3aed"
          headline={`Split: dealer adds ${fmt(cashPortion, region)} cash + ${fmt(tradePortion, region)} store credit`}
          subtext={`Customer's cards are worth ${fmt(absDiff, region)} more. Dealer balances with a cash payment and additional store credit.`}
          breakdown={[
            { label: 'Dealer cards', value: fmt(dealerTotal, region), color: '#1d4ed8' },
            { label: 'Customer offer', value: fmt(customerTotal, region), color: '#b45309' },
            { label: 'Cash from dealer', value: fmt(cashPortion, region), sublabel: 'dealer pays', color: '#1d4ed8' },
            { label: 'Store credit', value: fmt(tradePortion, region), sublabel: 'dealer gives', color: '#7c3aed' },
          ]}
        />
      )
    }
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
      {/* Mode selector */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>
          Deal type
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginBottom: 8 }}>
          {(['cash', 'trade', 'blended'] as DealMode[]).map(m => (
            <button key={m} onClick={() => onModeChange(m)}
              style={{
                padding: '8px 20px', borderRadius: 20, cursor: 'pointer',
                fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                background: mode === m ? modeColors[m] : 'var(--bg)',
                color: mode === m ? '#fff' : 'var(--text-muted)',
                border: `2px solid ${mode === m ? modeColors[m] : 'var(--border)'}`,
                transition: 'all 0.15s',
              }}
            >
              {m === 'cash' ? '💵 Cash' : m === 'trade' ? '🔄 Trade Credit' : '⚖️ Blended'}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          {modeDescriptions[mode]}
        </div>
      </div>

      {/* Totals VS bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '18px 24px', gap: 12,
        borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#1d4ed8', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
            Dealer cards
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>
            {fmt(dealerTotal, region)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {dealerCards.length} card{dealerCards.length !== 1 ? 's' : ''} · selling prices
          </div>
        </div>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'var(--bg)', border: '2px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 800, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif", flexShrink: 0,
        }}>VS</div>
        <div style={{ textAlign: 'right' as const }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#b45309', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
            Customer cards
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#b45309', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>
            {fmt(effectiveCustomerTotal, region)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {customerCards.length} card{customerCards.length !== 1 ? 's' : ''} · {mode === 'trade' && whoOwes === 'customer' ? `${cashPct}% cash rate` : mode === 'cash' ? `${cashPct}%` : mode === 'trade' ? `${tradePct}%` : 'blended'} offer
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div style={{ padding: '20px 24px' }}>
        {renderVerdict()}
      </div>
    </div>
  )
}

// ── Verdict Box ────────────────────────────────────────────────────────────────

function VerdictBox({ color, headline, subtext, breakdown }: {
  color: string
  headline: string
  subtext: string
  breakdown: { label: string; value: string; sublabel?: string; color: string }[]
}) {
  return (
    <>
      <div style={{
        background: `${color}0d`, border: `1px solid ${color}33`,
        borderRadius: 12, padding: '16px 20px', marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 }}>
          To make this deal fair
        </div>
        <div style={{ fontSize: 20, fontWeight: 900, color, fontFamily: "'Figtree', sans-serif", marginBottom: 6, lineHeight: 1.2 }}>
          {headline}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
          {subtext}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${breakdown.length}, 1fr)`, gap: 8 }}>
        {breakdown.map(({ label, value, sublabel, color: c }) => (
          <div key={label} style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: c, fontFamily: "'Figtree', sans-serif" }}>
              {value}
            </div>
            {sublabel && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>{sublabel}</div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function DealerPageClient() {
  const [region, setRegion]               = useState<Region>('UK')
  const [mode, setMode]                   = useState<DealMode>('cash')
  const [cashPct, setCashPct]             = useState(DEFAULT_CASH_PCT)
  const [tradePct, setTradePct]           = useState(DEFAULT_TRADE_PCT)
  const [dealerCards, setDealerCards]     = useState<DealerCard[]>([])
  const [customerCards, setCustomerCards] = useState<CustomerCard[]>([])

  async function addDealerCard(r: SearchResult) {
    if (!r.price_usd) return
    const graded = await fetchGradedPrices(r.url_slug)
    setDealerCards(prev => [...prev, {
      id: `${r.url_slug}-${Date.now()}`,
      name: r.name, set: r.subtitle, image: r.image_url,
      rawUsd: r.price_usd / 100, ...graded,
      grade: 'raw', urlSlug: r.url_slug, sellingPrice: null,
    }])
  }

  async function addCustomerCard(r: SearchResult) {
    if (!r.price_usd) return
    const graded = await fetchGradedPrices(r.url_slug)
    setCustomerCards(prev => [...prev, {
      id: `${r.url_slug}-${Date.now()}`,
      name: r.name, set: r.subtitle, image: r.image_url,
      rawUsd: r.price_usd / 100, ...graded,
      grade: 'raw', urlSlug: r.url_slug, customPct: null, marketOverride: null,
    }])
  }

  async function fetchGradedPrices(urlSlug: string) {
    try {
      const { data: cardRow } = await supabase
        .from('cards').select('card_slug').eq('card_url_slug', urlSlug).maybeSingle()
      if (!cardRow?.card_slug) return { psa9Usd: null, psa10Usd: null, cgc95Usd: null, cgc10Usd: null }
      const { data: dp } = await supabase
        .from('daily_prices').select('psa9_usd, psa10_usd, cgc95_usd, cgc10_usd')
        .eq('card_slug', 'pc-' + cardRow.card_slug)
        .order('date', { ascending: false }).limit(1).maybeSingle()
      return {
        psa9Usd:  dp?.psa9_usd  ? dp.psa9_usd  / 100 : null,
        psa10Usd: dp?.psa10_usd ? dp.psa10_usd / 100 : null,
        cgc95Usd: dp?.cgc95_usd ? dp.cgc95_usd / 100 : null,
        cgc10Usd: dp?.cgc10_usd ? dp.cgc10_usd / 100 : null,
      }
    } catch { return { psa9Usd: null, psa10Usd: null, cgc95Usd: null, cgc10Usd: null } }
  }

  const removeDealer   = (id: string) => setDealerCards(p => p.filter(x => x.id !== id))
  const removeCustomer = (id: string) => setCustomerCards(p => p.filter(x => x.id !== id))

  const updateDealer = (id: string, patch: Partial<DealerCard>) =>
    setDealerCards(p => p.map(x => x.id === id ? { ...x, ...patch } : x))
  const updateCustomer = (id: string, patch: Partial<CustomerCard>) =>
    setCustomerCards(p => p.map(x => x.id === id ? { ...x, ...patch } : x))

  const dealerTotal   = dealerCards.reduce((s, c) => s + dealerCardValue(c, region), 0)
  const customerTotal = customerCards.reduce((s, c) => s + customerCardValue(c, mode, cashPct, tradePct, region), 0)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

      {/* Back to dashboard — matches the chip pattern used on /dashboard sub-pages */}
      <div style={{ marginBottom: 16 }}>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
          textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
          padding: '7px 14px', borderRadius: 20,
          border: '1px solid var(--border)', background: 'var(--card)',
        }}>
          <span style={{ fontSize: 14 }}>←</span>
          Dashboard
        </Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 6px', color: 'var(--text)', letterSpacing: -0.5 }}>
          Deal Calculator
        </h1>
        <p style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Build both sides of a trade or purchase. Dealer sets selling prices; customer cards are valued at your offer rate. The verdict shows exactly who adds what.
        </p>
        <a href="#how-to-use" style={{ fontSize: 13, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", fontWeight: 600, textDecoration: 'none' }}>
          ↓ How to use this tool
        </a>
      </div>

      {/* Top bar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 14 }}>
        {/* Region */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Region</span>
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
            {(['UK', 'US'] as Region[]).map(r => (
              <button key={r} onClick={() => setRegion(r)} style={{
                padding: '7px 16px', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                background: region === r ? 'var(--primary)' : 'transparent',
                color: region === r ? '#fff' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
                {r === 'UK' ? '🇬🇧 UK' : '🇺🇸 US'}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setDealerCards([]); setCustomerCards([]) }}
          style={{
            marginLeft: 'auto', padding: '7px 16px', borderRadius: 8,
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 13, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >Clear all</button>
      </div>

      {/* Rate controls */}
      <div style={{ marginBottom: 14 }}>
        <RateControls cashPct={cashPct} tradePct={tradePct} onCashChange={setCashPct} onTradeChange={setTradePct} />
      </div>

      {/* Two-column panels — stacks on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginBottom: 14 }}>

        {/* Dealer panel */}
        <div style={{ background: 'var(--card)', border: '2px solid rgba(29,78,216,0.15)', borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: '#1d4ed8', fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>Dealer</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>Cards going out</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>Set your actual selling price per card</div>
            </div>
            {dealerCards.length > 0 && (
              <div style={{ textAlign: 'right' as const }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
                  {dealerCards.length} card{dealerCards.length !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#1d4ed8', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(dealerTotal, region)}
                </div>
              </div>
            )}
          </div>
          <div>
            {dealerCards.length === 0
              ? <div style={{ textAlign: 'center' as const, padding: '24px 16px', color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif", border: '1px dashed var(--border)', borderRadius: 10 }}>
                  Add cards the dealer is giving out
                </div>
              : dealerCards.map(card => (
                <DealerCardRow
                  key={card.id} card={card} region={region}
                  onRemove={() => removeDealer(card.id)}
                  onPriceChange={p => updateDealer(card.id, { sellingPrice: p })}
                  onGradeChange={g => updateDealer(card.id, { grade: g, sellingPrice: null })}
                />
              ))}
          </div>
          <SearchBox region={region} onAdd={addDealerCard} />
        </div>

        {/* Customer panel */}
        <div style={{ background: 'var(--card)', border: '2px solid rgba(180,83,9,0.15)', borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: '#b45309', fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>Customer</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>Cards coming in</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>Override % or set a fixed value per card</div>
            </div>
            {customerCards.length > 0 && (
              <div style={{ textAlign: 'right' as const }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
                  {customerCards.length} card{customerCards.length !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#b45309', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(customerTotal, region)}
                </div>
              </div>
            )}
          </div>
          <div>
            {customerCards.length === 0
              ? <div style={{ textAlign: 'center' as const, padding: '24px 16px', color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif", border: '1px dashed var(--border)', borderRadius: 10 }}>
                  Add cards the customer is bringing in
                </div>
              : customerCards.map(card => (
                <CustomerCardRow
                  key={card.id} card={card} mode={mode}
                  cashPct={cashPct} tradePct={tradePct} region={region}
                  onRemove={() => removeCustomer(card.id)}
                  onPctChange={p => updateCustomer(card.id, { customPct: p })}
                  onMarketOverride={v => updateCustomer(card.id, { marketOverride: v })}
                  onGradeChange={g => updateCustomer(card.id, { grade: g, marketOverride: null, customPct: null })}
                />
              ))}
          </div>
          <SearchBox region={region} onAdd={addCustomerCard} />
        </div>
      </div>

      {/* Verdict */}
      <DealVerdict
        dealerCards={dealerCards} customerCards={customerCards}
        mode={mode} cashPct={cashPct} tradePct={tradePct}
        region={region} onModeChange={setMode}
      />

      {/* How to use */}
      <div id="how-to-use" style={{
        marginTop: 32, background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '28px 32px',
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 24px', color: 'var(--text)' }}>
          How to use the Deal Calculator
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 0 }}>

          {([
            {
              num: '1',
              color: '#1d4ed8',
              title: 'Dealer side — cards going out',
              body: "Search for each card you're giving the customer. The price defaults to the last sold market value — click it to enter your actual store price instead.",
              tip: 'If a card is priced at £45 in your display case, type £45. That\'s what goes into the deal.',
              bullets: undefined,
            },
            {
              num: '2',
              color: '#b45309',
              title: 'Customer side — cards coming in',
              body: "Add the cards the customer is bringing. Each one pulls a market value from our data, and the offer is calculated as market value × your rate automatically.",
              tip: undefined,
              bullets: [
                'Click the market value to override it — e.g. if eBay last sold shows £150 but our data says £175, set it to £150. The cash or trade offer recalculates from that.',
                'Click the % badge to adjust the rate for that card only — e.g. lower it for a damaged card.',
              ],
            },
            {
              num: '3',
              color: '#7c3aed',
              title: 'Pick your deal type',
              body: 'Choose Cash, Trade Credit, or Blended in the verdict panel:',
              tip: undefined,
              bullets: [
                'Cash — dealer pays money. Verdict shows who adds cash and how much.',
                'Trade Credit — dealer gives store credit. Customer either has credit to spend or tops up with cash.',
                'Blended — part cash, part store credit, split proportionally across your two rates.',
              ],
            },
            {
              num: '4',
              color: '#16a34a',
              title: 'Set your default rates',
              body: 'Use the sliders at the top to set your standard cash offer % and trade credit % — these apply to all customer cards unless individually overridden. Most shops run 40–60% cash and 60–80% trade credit.',
              tip: 'You can type directly into the % field or drag the slider.',
              bullets: undefined,
            },
          ] as { num: string; color: string; title: string; body: string; tip?: string; bullets?: string[] }[]).map(({ num, color, title, body, tip, bullets }, i, arr) => (
            <div key={num} style={{
              display: 'grid', gridTemplateColumns: '28px 1fr', gap: '0 16px',
              paddingBottom: i < arr.length - 1 ? 20 : 0,
              marginBottom: i < arr.length - 1 ? 20 : 0,
              borderBottom: i < arr.length - 1 ? '1px solid var(--border-light)' : 'none',
            }}>
              {/* Number */}
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: `${color}15`, border: `1px solid ${color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 900, color, fontFamily: "'Figtree', sans-serif",
                flexShrink: 0, marginTop: 1,
              }}>{num}</div>

              {/* Content */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                  {title}
                </div>
                <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
                  {body}
                </p>
                {bullets && (
                  <ul style={{ margin: '6px 0', padding: '0 0 0 16px', fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7 }}>
                    {bullets.map(b => <li key={b}>{b}</li>)}
                  </ul>
                )}
                {tip && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 6, paddingLeft: 2 }}>
                    💡 {tip}
                  </div>
                )}
              </div>
            </div>
          ))}

        </div>

        <div style={{
          marginTop: 24, padding: '13px 18px',
          background: 'var(--bg-light)', borderRadius: 10,
          borderLeft: '3px solid var(--primary)',
        }}>
          <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6 }}>
            <strong>Remember:</strong> Market prices are based on recent sold listings and historical data — a solid baseline, but always check the eBay last sold link on each card before locking in a deal.
          </div>
        </div>
      </div>

    </div>
  )
}
