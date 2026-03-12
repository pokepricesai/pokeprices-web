'use client'
import { useState, useEffect, useRef } from 'react'
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

interface DealCard {
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
  customPct: number | null
  urlSlug: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const USD_TO_GBP         = 0.79
const DEFAULT_CASH_PCT   = 50   // dealer buying outright — pays below market
const DEFAULT_TRADE_PCT  = 70   // store credit — more generous

const GRADE_LABELS: Record<Grade, string> = {
  raw: 'Raw', psa9: 'PSA 9', psa10: 'PSA 10', cgc95: 'CGC 9.5', cgc10: 'CGC 10',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function convert(usd: number, region: Region): number {
  return region === 'UK' ? usd * USD_TO_GBP : usd
}

function fmt(v: number, region: Region): string {
  return region === 'UK' ? `£${Math.abs(v).toFixed(2)}` : `$${Math.abs(v).toFixed(2)}`
}

function getGradePrice(card: DealCard, region: Region): number {
  let usd = card.rawUsd
  if (card.grade === 'psa9'  && card.psa9Usd)  usd = card.psa9Usd
  if (card.grade === 'psa10' && card.psa10Usd) usd = card.psa10Usd
  if (card.grade === 'cgc95' && card.cgc95Usd) usd = card.cgc95Usd
  if (card.grade === 'cgc10' && card.cgc10Usd) usd = card.cgc10Usd
  return convert(usd, region)
}

function gradeAvailable(card: DealCard, grade: Grade): boolean {
  if (grade === 'raw')   return true
  if (grade === 'psa9')  return !!card.psa9Usd
  if (grade === 'psa10') return !!card.psa10Usd
  if (grade === 'cgc95') return !!card.cgc95Usd
  if (grade === 'cgc10') return !!card.cgc10Usd
  return false
}

function cardOfferValue(card: DealCard, mode: DealMode, cashPct: number, tradePct: number, region: Region): number {
  const market = getGradePrice(card, region)
  const cp = card.customPct ?? cashPct
  const tp = card.customPct ?? tradePct
  if (mode === 'cash')    return market * (cp / 100)
  if (mode === 'trade')   return market * (tp / 100)
  return market * ((cp + tp) / 200)   // blended = midpoint
}

function ebayUrl(card: DealCard, region: Region): string {
  const gradeStr = card.grade !== 'raw' ? ` ${GRADE_LABELS[card.grade]}` : ''
  const q = encodeURIComponent(`${card.name} ${card.set}${gradeStr} pokemon card`)
  const base = region === 'UK' ? 'https://www.ebay.co.uk' : 'https://www.ebay.com'
  return `${base}/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_sop=13`
}

// ── Search Box ─────────────────────────────────────────────────────────────────

function SearchBox({ region, onAdd }: { region: Region; onAdd: (card: DealCard) => void }) {
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
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function handleAdd(r: SearchResult) {
    if (!r.price_usd) return
    setQuery(''); setResults([]); setOpen(false)

    let psa9Usd: number | null = null, psa10Usd: number | null = null
    let cgc95Usd: number | null = null, cgc10Usd: number | null = null

    try {
      const { data: cardRow } = await supabase
        .from('cards').select('card_slug')
        .eq('card_url_slug', r.url_slug).maybeSingle()

      if (cardRow?.card_slug) {
        const { data: dp } = await supabase
          .from('daily_prices')
          .select('psa9_usd, psa10_usd, cgc95_usd, cgc10_usd')
          .eq('card_slug', 'pc-' + cardRow.card_slug)
          .order('date', { ascending: false }).limit(1).maybeSingle()

        if (dp) {
          psa9Usd  = dp.psa9_usd  ? dp.psa9_usd  / 100 : null
          psa10Usd = dp.psa10_usd ? dp.psa10_usd / 100 : null
          cgc95Usd = dp.cgc95_usd ? dp.cgc95_usd / 100 : null
          cgc10Usd = dp.cgc10_usd ? dp.cgc10_usd / 100 : null
        }
      }
    } catch {}

    onAdd({
      id: `${r.url_slug}-${Date.now()}`,
      name: r.name, set: r.subtitle, image: r.image_url,
      rawUsd: r.price_usd / 100, psa9Usd, psa10Usd, cgc95Usd, cgc10Usd,
      grade: 'raw', customPct: null, urlSlug: r.url_slug,
    })
  }

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
            <div
              key={r.url_slug} onMouseDown={() => handleAdd(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)' }}
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

// ── Card Row ───────────────────────────────────────────────────────────────────

function CardRow({
  card, mode, cashPct, tradePct, region,
  onRemove, onOverride, onGradeChange,
}: {
  card: DealCard; mode: DealMode; cashPct: number; tradePct: number; region: Region
  onRemove: () => void; onOverride: (pct: number | null) => void; onGradeChange: (g: Grade) => void
}) {
  const [editingPct, setEditingPct] = useState(false)
  const [pctInput, setPctInput]     = useState('')

  const marketPrice = getGradePrice(card, region)
  const offerValue  = cardOfferValue(card, mode, cashPct, tradePct, region)
  const grades: Grade[] = ['raw', 'psa9', 'psa10', 'cgc95', 'cgc10']

  const modeLabel = mode === 'cash' ? 'Cash offer' : mode === 'trade' ? 'Trade credit' : 'Blended'
  const modeColor = mode === 'cash' ? '#16a34a'   : mode === 'trade' ? 'var(--primary)' : '#7c3aed'

  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 12, border: '1px solid var(--border-light)', marginBottom: 8, overflow: 'hidden' }}>
      {/* Card info row */}
      <div style={{ display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 10, padding: '10px 12px', alignItems: 'start' }}>
        {card.image
          ? <img src={card.image} alt={card.name} style={{ width: 44, height: 61, objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ width: 44, height: 61, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🃏</div>}

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{card.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 7 }}>{card.set}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
            {grades.map(g => {
              const avail  = gradeAvailable(card, g)
              const active = card.grade === g
              return (
                <button key={g} onClick={() => avail && onGradeChange(g)}
                  title={!avail ? 'No price data for this grade' : ''}
                  style={{
                    padding: '2px 7px', borderRadius: 5,
                    cursor: avail ? 'pointer' : 'not-allowed',
                    fontSize: 10, fontWeight: active ? 700 : 500,
                    fontFamily: "'Figtree', sans-serif",
                    background: active ? 'var(--primary)' : 'var(--bg)',
                    color: active ? '#fff' : avail ? 'var(--text-muted)' : 'var(--border)',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                    opacity: avail ? 1 : 0.35, transition: 'all 0.1s',
                  }}
                >{GRADE_LABELS[g]}</button>
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

      {/* Price bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const,
        padding: '8px 12px', background: 'var(--bg)', borderTop: '1px solid var(--border-light)', gap: 8,
      }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
            Market ({GRADE_LABELS[card.grade]})
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
            {fmt(marketPrice, region)}
          </div>
        </div>

        {/* Per-card % override */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
            Override %
          </div>
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
              <button
                onClick={() => { setPctInput(String(card.customPct ?? '')); setEditingPct(true) }}
                style={{
                  background: card.customPct != null ? 'rgba(245,158,11,0.12)' : 'var(--bg-light)',
                  border: `1px solid ${card.customPct != null ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
                  borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 700,
                  color: card.customPct != null ? '#d97706' : 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif",
                }}
              >
                {card.customPct != null ? `${card.customPct}%` : '—'}
              </button>
            )}
            {card.customPct != null && !editingPct && (
              <button onClick={() => onOverride(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: 'underline', padding: 0 }}
              >reset</button>
            )}
          </div>
        </div>

        {/* Offer value */}
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
            {modeLabel}
          </div>
          <div style={{ fontSize: 18, fontWeight: 900, color: modeColor, fontFamily: "'Figtree', sans-serif" }}>
            {fmt(offerValue, region)}
          </div>
        </div>

        <a href={ebayUrl(card, region)} target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8,
            background: 'rgba(232,121,0,0.08)', border: '1px solid rgba(232,121,0,0.2)',
            color: '#c05500', fontSize: 11, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
          }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.15)'}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'rgba(232,121,0,0.08)'}
        >🛒 eBay last sold ↗</a>
      </div>
    </div>
  )
}

// ── Deal Panel ─────────────────────────────────────────────────────────────────

function DealPanel({
  title, side, cards, mode, cashPct, tradePct, region,
  accentColor, emptyText,
  onAdd, onRemove, onOverride, onGradeChange,
}: {
  title: string; side: 'dealer' | 'customer'
  cards: DealCard[]; mode: DealMode; cashPct: number; tradePct: number; region: Region
  accentColor: string; emptyText: string
  onAdd: (c: DealCard) => void; onRemove: (id: string) => void
  onOverride: (id: string, pct: number | null) => void; onGradeChange: (id: string, g: Grade) => void
}) {
  const total = cards.reduce((s, c) => s + cardOfferValue(c, mode, cashPct, tradePct, region), 0)

  return (
    <div style={{ background: 'var(--card)', border: `2px solid ${accentColor}22`, borderRadius: 16, padding: '18px 16px', display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: accentColor, fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>
            {side === 'dealer' ? 'Dealer' : 'Customer'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{title}</div>
        </div>
        {cards.length > 0 && (
          <div style={{ textAlign: 'right' as const }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
              {cards.length} card{cards.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: accentColor, fontFamily: "'Figtree', sans-serif" }}>
              {fmt(total, region)}
            </div>
          </div>
        )}
      </div>

      {/* Cards */}
      <div>
        {cards.length === 0 ? (
          <div style={{
            textAlign: 'center' as const, padding: '24px 16px',
            color: 'var(--text-muted)', fontSize: 13,
            fontFamily: "'Figtree', sans-serif", lineHeight: 1.5,
            border: '1px dashed var(--border)', borderRadius: 10,
          }}>
            {emptyText}
          </div>
        ) : cards.map(card => (
          <CardRow
            key={card.id} card={card} mode={mode}
            cashPct={cashPct} tradePct={tradePct} region={region}
            onRemove={() => onRemove(card.id)}
            onOverride={pct => onOverride(card.id, pct)}
            onGradeChange={g => onGradeChange(card.id, g)}
          />
        ))}
      </div>

      <SearchBox region={region} onAdd={onAdd} />
    </div>
  )
}

// ── Deal Verdict ───────────────────────────────────────────────────────────────

function DealVerdict({
  dealerCards, customerCards, mode, cashPct, tradePct, region, onModeChange,
}: {
  dealerCards: DealCard[]; customerCards: DealCard[]
  mode: DealMode; cashPct: number; tradePct: number; region: Region
  onModeChange: (m: DealMode) => void
}) {
  if (dealerCards.length === 0 && customerCards.length === 0) return null

  const dealerTotal   = dealerCards.reduce((s, c)   => s + cardOfferValue(c, mode, cashPct, tradePct, region), 0)
  const customerTotal = customerCards.reduce((s, c) => s + cardOfferValue(c, mode, cashPct, tradePct, region), 0)

  // diff > 0 → dealer cards worth more → dealer is giving more value → customer should add cash
  // diff < 0 → customer cards worth more → customer is giving more value → dealer should add cash
  const diff    = dealerTotal - customerTotal
  const absDiff = Math.abs(diff)
  const isEven  = absDiff < 0.50
  const whoOwes = diff > 0 ? 'customer' : 'dealer'

  const modeColors: Record<DealMode, string> = {
    cash: '#16a34a', trade: 'var(--primary)', blended: '#7c3aed',
  }
  const modeDescriptions: Record<DealMode, string> = {
    cash:    `Dealer pays cash — ${cashPct}% of market value`,
    trade:   `Dealer gives store credit — ${tradePct}% of market value`,
    blended: `Split: cash at ${cashPct}% + trade credit at ${tradePct}%, averaged`,
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>

      {/* Mode selector */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 10,
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
            Deal type
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {(['cash', 'trade', 'blended'] as DealMode[]).map(m => (
              <button key={m} onClick={() => onModeChange(m)}
                style={{
                  padding: '7px 18px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                  background: mode === m ? modeColors[m] : 'var(--bg)',
                  color: mode === m ? '#fff' : 'var(--text-muted)',
                  border: `1px solid ${mode === m ? modeColors[m] : 'var(--border)'}`,
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
      </div>

      {/* Totals */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', padding: '18px 24px', gap: 16,
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
            {dealerCards.length} card{dealerCards.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--bg)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif", flexShrink: 0,
        }}>VS</div>

        <div style={{ textAlign: 'right' as const }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#b45309', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
            Customer cards
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#b45309', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>
            {fmt(customerTotal, region)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 3 }}>
            {customerCards.length} card{customerCards.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div style={{ padding: '20px 24px' }}>
        {isEven ? (
          <div style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#16a34a', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
              ✓ Even deal
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              Both sides are within {fmt(0.50, region)} — this trade is fair as-is, no cash needed.
            </div>
          </div>
        ) : (
          <>
            {/* Main verdict */}
            <div style={{
              background: whoOwes === 'customer' ? 'rgba(180,83,9,0.06)' : 'rgba(29,78,216,0.06)',
              border: `1px solid ${whoOwes === 'customer' ? 'rgba(180,83,9,0.2)' : 'rgba(29,78,216,0.2)'}`,
              borderRadius: 12, padding: '16px 20px', marginBottom: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 }}>
                To make this deal fair
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Figtree', sans-serif", color: whoOwes === 'customer' ? '#b45309' : '#1d4ed8', marginBottom: 6 }}>
                {whoOwes === 'customer'
                  ? `Customer adds ${fmt(absDiff, region)} cash`
                  : `Dealer adds ${fmt(absDiff, region)} cash`}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5 }}>
                {whoOwes === 'customer'
                  ? `The dealer's cards are worth ${fmt(absDiff, region)} more at these rates. Customer tops up with cash to balance the deal.`
                  : `The customer's cards are worth ${fmt(absDiff, region)} more at these rates. Dealer tops up with cash to balance the deal.`}
              </div>
            </div>

            {/* Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
                  Dealer cards
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#1d4ed8', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(dealerTotal, region)}
                </div>
              </div>
              <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
                  Customer cards
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#b45309', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(customerTotal, region)}
                </div>
              </div>
              <div style={{
                background: whoOwes === 'customer' ? 'rgba(180,83,9,0.06)' : 'rgba(29,78,216,0.06)',
                border: `1px solid ${whoOwes === 'customer' ? 'rgba(180,83,9,0.15)' : 'rgba(29,78,216,0.15)'}`,
                borderRadius: 10, padding: '10px 14px',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
                  Cash to add
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: whoOwes === 'customer' ? '#b45309' : '#1d4ed8', fontFamily: "'Figtree', sans-serif" }}>
                  {fmt(absDiff, region)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>
                  from {whoOwes}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Rate Controls ──────────────────────────────────────────────────────────────

function RateControls({
  cashPct, tradePct, onCashChange, onTradeChange,
}: {
  cashPct: number; tradePct: number
  onCashChange: (v: number) => void; onTradeChange: (v: number) => void
}) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 16px',
      display: 'flex', gap: 24, flexWrap: 'wrap' as const, alignItems: 'center',
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
        Default rates
      </div>
      {([
        { label: '💵 Cash offer', value: cashPct, onChange: onCashChange, color: '#16a34a' },
        { label: '🔄 Trade credit', value: tradePct, onChange: onTradeChange, color: '#1d4ed8' },
      ] as const).map(({ label, value, onChange, color }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap' as const }}>{label}</span>
          <input type="range" min={20} max={100} value={value}
            onChange={e => onChange(parseInt(e.target.value))}
            style={{ width: 80, accentColor: color }}
          />
          <span style={{ fontSize: 15, fontWeight: 800, color, fontFamily: "'Figtree', sans-serif", minWidth: 36 }}>
            {value}%
          </span>
        </div>
      ))}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginLeft: 'auto' }}>
        Click — on any card to set a per-card rate
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function DealerPageClient() {
  const [region, setRegion]               = useState<Region>('UK')
  const [mode, setMode]                   = useState<DealMode>('cash')
  const [cashPct, setCashPct]             = useState(DEFAULT_CASH_PCT)
  const [tradePct, setTradePct]           = useState(DEFAULT_TRADE_PCT)
  const [dealerCards, setDealerCards]     = useState<DealCard[]>([])
  const [customerCards, setCustomerCards] = useState<DealCard[]>([])

  const addDealer      = (c: DealCard) => setDealerCards(prev => [...prev, c])
  const addCustomer    = (c: DealCard) => setCustomerCards(prev => [...prev, c])
  const removeDealer   = (id: string)  => setDealerCards(prev => prev.filter(x => x.id !== id))
  const removeCustomer = (id: string)  => setCustomerCards(prev => prev.filter(x => x.id !== id))

  const overrideDealer   = (id: string, pct: number | null) => setDealerCards(prev => prev.map(x => x.id === id ? { ...x, customPct: pct } : x))
  const overrideCustomer = (id: string, pct: number | null) => setCustomerCards(prev => prev.map(x => x.id === id ? { ...x, customPct: pct } : x))
  const gradeDealer      = (id: string, g: Grade)           => setDealerCards(prev => prev.map(x => x.id === id ? { ...x, grade: g } : x))
  const gradeCustomer    = (id: string, g: Grade)           => setCustomerCards(prev => prev.map(x => x.id === id ? { ...x, grade: g } : x))

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: '0 0 6px', color: 'var(--text)', letterSpacing: -0.5 }}>
          Deal Calculator
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Build both sides of a trade or purchase. Pick cash, trade credit, or blended — the verdict tells you exactly who needs to add cash and how much.
        </p>
      </div>

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 }}>
        {/* Region toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Region</span>
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
            {(['UK', 'US'] as Region[]).map(r => (
              <button key={r} onClick={() => setRegion(r)} style={{
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
        </div>

        <button
          onClick={() => { setDealerCards([]); setCustomerCards([]) }}
          style={{
            marginLeft: 'auto', padding: '7px 16px', borderRadius: 8,
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 700,
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

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <DealPanel
          title="Cards you're giving out" side="dealer"
          cards={dealerCards} mode={mode} cashPct={cashPct} tradePct={tradePct} region={region}
          accentColor="#1d4ed8"
          emptyText="Add cards the dealer is giving to the customer"
          onAdd={addDealer} onRemove={removeDealer}
          onOverride={overrideDealer} onGradeChange={gradeDealer}
        />
        <DealPanel
          title="Cards coming in" side="customer"
          cards={customerCards} mode={mode} cashPct={cashPct} tradePct={tradePct} region={region}
          accentColor="#b45309"
          emptyText="Add cards the customer is bringing in to sell or trade"
          onAdd={addCustomer} onRemove={removeCustomer}
          onOverride={overrideCustomer} onGradeChange={gradeCustomer}
        />
      </div>

      {/* Verdict */}
      <DealVerdict
        dealerCards={dealerCards} customerCards={customerCards}
        mode={mode} cashPct={cashPct} tradePct={tradePct}
        region={region} onModeChange={setMode}
      />

    </div>
  )
}
