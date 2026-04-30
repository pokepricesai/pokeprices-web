'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase, CHAT_ENDPOINT } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import {
  HOLDING_TYPES as ALL_HOLDING_TYPES,
  GRADE_LABELS as ALL_GRADE_LABELS,
  isManualGrade,
  NO_MARKET_DATA_NOTE,
  type HoldingType,
} from '@/lib/portfolioGrades'

const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

type Currency = 'GBP' | 'USD'

// Currency-aware money formatters. cents are stored as USD cents in the DB
// (the *127 conversion in handleAddCard implies GBP * 127 ≈ USD cents).
function fmt(cents: number | null | undefined, currency: Currency = 'GBP', decimals = 2): string {
  if (!cents || cents <= 0) return '—'
  if (currency === 'USD') {
    const v = cents / 100
    if (v >= 10000) return `$${(v / 1000).toFixed(1)}k`
    return `$${v.toFixed(decimals)}`
  }
  const v = cents / 127
  if (v >= 10000) return `£${(v / 1000).toFixed(1)}k`
  return `£${v.toFixed(decimals)}`
}
function fmtBig(cents: number, currency: Currency = 'GBP'): string {
  if (currency === 'USD') {
    const v = cents / 100
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
    if (v >= 1000)      return `$${(v / 1000).toFixed(1)}k`
    return `$${v.toFixed(2)}`
  }
  const v = cents / 127
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000)      return `£${(v / 1000).toFixed(1)}k`
  return `£${v.toFixed(2)}`
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortfolioItem {
  id: string
  card_slug: string
  card_name: string
  set_name: string
  image_url: string | null
  quantity: number
  holding_type: string
  purchase_price_cents: number | null
  purchase_currency: string | null
  purchase_date: string | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  current_value_cents: number | null
  position_value_cents: number | null
  pct_7d: number | null
  pct_30d: number | null
  pct_90d: number | null
  pct_365d: number | null
  notes: string | null
}

interface PortfolioSummary {
  total_value_cents: number
  item_count: number
  unique_cards: number
  items: PortfolioItem[]
}

// HOLDING_TYPES and GRADE_LABELS now live in src/lib/portfolioGrades.ts
// (shared with CardQuickActions). Re-export for in-file convenience.
const HOLDING_TYPES = ALL_HOLDING_TYPES
const GRADE_LABELS = ALL_GRADE_LABELS

// Group grades by company for the dropdown.
const GRADE_GROUPS: { company: string; types: HoldingType[] }[] = (() => {
  const map = new Map<string, HoldingType[]>()
  for (const t of HOLDING_TYPES) {
    if (!map.has(t.company)) map.set(t.company, [])
    map.get(t.company)!.push(t)
  }
  return Array.from(map.entries()).map(([company, types]) => ({ company, types }))
})()

// ── Helpers ───────────────────────────────────────────────────────────────────

// Back-compat wrappers — most internal call sites still use these. The
// real implementations live above (fmt / fmtBig) and accept a currency.
function fmtGbp(cents: number | null | undefined, decimals = 2): string {
  return fmt(cents, 'GBP', decimals)
}
function fmtLarge(cents: number): string {
  return fmtBig(cents, 'GBP')
}

function fmtPct(pct: number | null): { text: string; color: string } {
  if (pct == null) return { text: '—', color: 'var(--text-muted)' }
  const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : 'var(--text-muted)'
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, color }
}

// Pattern-based sealed-product detection. Used as a fallback when
// cards.is_sealed isn't populated for the portfolio item — which we've
// observed is intermittent. A holding is treated as "sealed" if either
// the DB flag says so OR the card name contains one of these terms.
const SEALED_NAME_PATTERNS: RegExp[] = [
  /\bbooster\s+(box|bundle|pack|display)\b/i,
  /\betb\b/i,
  /\belite\s+trainer\s+box\b/i,
  /\bpremium\s+(collection|box|trainer)\b/i,
  /\b(top|ultra|deluxe)\s+trainer\b/i,
  /\bcollection\s+box\b/i,
  /\bgift\s+(box|set)\b/i,
  /\b(theme|starter|battle)\s+deck\b/i,
  /\b(mini\s+)?tin\b/i,
  /\bblister\b/i,
  /\bbuild\s*&\s*battle\b/i,
  /\bbox\s+set\b/i,
  /\bbinder\s+collection\b/i,
  /\bhidden\s+potential\b/i,
  /\bsealed\b/i,
]

export function isSealedByName(name: string | null | undefined): boolean {
  if (!name) return false
  return SEALED_NAME_PATTERNS.some(p => p.test(name))
}

function inferEra(setName: string): string {
  const s = setName.toLowerCase()
  if (/base set|jungle|fossil|team rocket|gym|neo|legendary collection/.test(s)) return 'vintage'
  if (/ruby|sapphire|emerald|deoxys|delta|legend maker|power keepers|ex |unseen forces/.test(s)) return 'ex-era'
  if (/diamond|pearl|platinum|heartgold|soulsilver|call of legends/.test(s)) return 'dp-era'
  if (/black|white|xy|flashfire|phantom|roaring|ancient origins/.test(s)) return 'bw-xy-era'
  if (/sun|moon|team up|unbroken bonds|cosmic eclipse/.test(s)) return 'sm-era'
  if (/sword|shield|battle styles|chilling reign|evolving skies|fusion strike|brilliant stars/.test(s)) return 'swsh-era'
  if (/scarlet|violet|paldea|paradox|obsidian|twilight|stellar|surging|prismatic|ascended|perfect order|journey/.test(s)) return 'sv-era'
  return 'other'
}

const ERA_LABELS: Record<string, string> = {
  'vintage': 'Vintage (WotC)', 'ex-era': 'EX Era', 'dp-era': 'DP Era',
  'bw-xy-era': 'BW/XY Era', 'sm-era': 'Sun & Moon', 'swsh-era': 'Sword & Shield',
  'sv-era': 'Scarlet & Violet', 'other': 'Other',
}

// ── Edit Holding Modal ────────────────────────────────────────────────────────

function EditHoldingModal({
  item, currency, onSave, onClose,
}: {
  item: PortfolioItem
  currency: Currency
  onSave: (patch: any, manualValueCents: number | null) => Promise<void>
  onClose: () => void
}) {
  const symbol = currency === 'USD' ? '$' : '£'
  const cps   = currency === 'USD' ? 100 : 127  // cents per unit of currency
  const fromCents = (cents: number | null | undefined) =>
    cents != null ? (cents / cps).toFixed(2) : ''

  const [holdingType,    setHoldingType]    = useState(item.holding_type)
  const [quantity,       setQuantity]       = useState(item.quantity)
  const [purchasePrice,  setPurchasePrice]  = useState(fromCents(item.purchase_price_cents))
  const [purchaseDate,   setPurchaseDate]   = useState(item.purchase_date || '')
  const [notes,          setNotes]          = useState(item.notes || '')
  // The current per-card value the user sees. Empty = use market price.
  const [manualValue,    setManualValue]    = useState(fromCents(item.current_value_cents))
  const [overrideValue,  setOverrideValue]  = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')

  // If they leave the value field empty, treat as "use market". Otherwise
  // store the override.
  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const patch: any = {
        holding_type: holdingType,
        quantity: Math.max(1, quantity),
        purchase_price_cents: purchasePrice ? Math.round(parseFloat(purchasePrice) * cps) : null,
        purchase_date: purchaseDate || null,
        notes: notes || null,
      }
      const manualCents = overrideValue && manualValue
        ? Math.round(parseFloat(manualValue) * cps)
        : null
      await onSave(patch, manualCents)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Failed to save')
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif",
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card)', borderRadius: 20, border: '1px solid var(--border)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>Edit holding</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12, marginBottom: 18 }}>
          {item.image_url && <img src={item.image_url} alt={item.card_name} style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{item.card_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{item.set_name}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Grade</label>
            <select value={holdingType} onChange={e => setHoldingType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {GRADE_GROUPS.map(g => (
                <optgroup key={g.company} label={g.company}>
                  {g.types.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}{t.manual ? ' (manual value)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Quantity</label>
            <input type="number" min={1} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inputStyle} />
          </div>
        </div>

        {isManualGrade(holdingType) && (
          <div style={{ padding: '12px 14px', background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.25)', borderRadius: 10, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#b8741f', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
              ⚠ Manual value required
            </div>
            <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.55, fontFamily: "'Figtree', sans-serif" }}>
              {NO_MARKET_DATA_NOTE} Tick "Override current value manually" below.
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelStyle}>Purchase price ({symbol})</label>
            <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Purchase date</label>
            <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Great centering" style={inputStyle} />
        </div>

        {/* Manual value override */}
        <div style={{
          padding: 14, background: 'var(--bg-light)',
          border: '1px solid var(--border)', borderRadius: 10, marginBottom: 18,
        }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={overrideValue}
              onChange={e => setOverrideValue(e.target.checked)}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                Override current value manually
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>
                Useful if market data is wrong or missing for this card.
              </div>
            </div>
          </label>
          {overrideValue && (
            <div style={{ marginTop: 10 }}>
              <label style={labelStyle}>Custom value per card ({symbol})</label>
              <input
                type="number"
                step="0.01"
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
          )}
        </div>

        {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>{error}</p>}

        <button onClick={handleSave} disabled={saving}
          style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

// ── Add Card Modal ────────────────────────────────────────────────────────────

function AddCardModal({ onAdd, onClose, currency }: { onAdd: (item: any) => Promise<void>; onClose: () => void; currency: Currency }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [holdingType, setHoldingType] = useState('raw')
  const [quantity, setQuantity] = useState(1)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [notes, setNotes] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isManual = isManualGrade(holdingType)
  const symbol  = currency === 'USD' ? '$' : '£'

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query })
      // De-duplicate by url_slug + subtitle so the user never sees the same
      // card listed twice. Search RPCs occasionally return overlap when a
      // term matches via multiple indexes (name AND set, etc).
      const cardRows = (data || []).filter((r: any) => r.result_type === 'card')
      const seen = new Set<string>()
      const unique: any[] = []
      for (const r of cardRows) {
        const key = `${r.url_slug}|${r.subtitle || ''}`
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(r)
        if (unique.length >= 12) break
      }
      setResults(unique)
      setSearching(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  async function handleAdd() {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const cps = currency === 'USD' ? 100 : 127
      const priceCents  = purchasePrice ? Math.round(parseFloat(purchasePrice) * cps) : null
      const manualCents = isManual && manualValue ? Math.round(parseFloat(manualValue) * cps) : null
      if (isManual && !manualCents) {
        throw new Error('Please enter a current value — we don\'t have live market data for this grade.')
      }
      // Only include manual-value columns when set — keeps the write working
      // even if the 2026-04-30 portfolio-improvements migration hasn't run.
      const payload: Record<string, any> = {
        card_slug: selected.url_slug,
        card_name_snapshot: selected.name,
        set_name_snapshot: selected.subtitle || '',
        image_url_snapshot: selected.image_url || null,
        holding_type: holdingType,
        quantity,
        purchase_price_cents: priceCents,
        purchase_currency: currency,
        purchase_date: purchaseDate || null,
        notes: notes || null,
      }
      if (manualCents != null) {
        payload.manual_value_cents = manualCents
        payload.manual_value_updated_at = new Date().toISOString()
      }
      await onAdd(payload)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to add card')
    }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif",
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card)', borderRadius: 20, border: '1px solid var(--border)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>Add to Portfolio</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {!selected ? (
          <>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cards e.g. Charizard Base Set..." autoFocus style={inputStyle} />
              {searching && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>...</span>}
            </div>
            {results.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {results.map((r, i) => (
                  <div key={i} onClick={() => setSelected(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                    {r.image_url ? <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} /> : <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 4, flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.name}{r.card_number_display ? ` · ${r.card_number_display}` : ''}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subtitle}</div>
                    </div>
                    {r.price_usd && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
                        {fmt(r.price_usd, currency, 0)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {query.length >= 2 && !searching && results.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', padding: '20px 0' }}>No cards found</p>
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12, marginBottom: 20 }}>
              {selected.image_url && <img src={selected.image_url} alt={selected.name} style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selected.subtitle}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Change</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Grade</label>
                <select value={holdingType} onChange={e => setHoldingType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {GRADE_GROUPS.map(g => (
                    <optgroup key={g.company} label={g.company}>
                      {g.types.map(t => (
                        <option key={t.value} value={t.value}>
                          {t.label}{t.manual ? ' (manual value)' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Quantity</label>
                <input type="number" min={1} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inputStyle} />
              </div>
            </div>

            {isManual && (
              <>
                <div style={{ padding: '12px 14px', background: 'rgba(255,165,0,0.08)', border: '1px solid rgba(255,165,0,0.25)', borderRadius: 10, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#b8741f', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
                    ⚠ Manual value required
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.55, fontFamily: "'Figtree', sans-serif" }}>
                    {NO_MARKET_DATA_NOTE}
                  </p>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Current value per card ({symbol}) <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span></label>
                  <input type="number" step="0.01" min="0" value={manualValue} onChange={e => setManualValue(e.target.value)} placeholder="0.00" style={inputStyle} />
                </div>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Purchase Price ({symbol}) <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Purchase Date <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Notes <span style={{ fontWeight: 400 }}>optional</span></label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Great centering, from eBay" style={inputStyle} />
            </div>

            {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>{error}</p>}

            <button onClick={handleAdd} disabled={saving}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Adding...' : 'Add to Portfolio'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Portfolio DNA ─────────────────────────────────────────────────────────────

function PortfolioDNA({ items, totalValue }: { items: PortfolioItem[]; totalValue: number }) {
  if (!items.length || !totalValue) return null

  // Raw vs graded
  const rawValue = items.filter(i => i.holding_type === 'raw').reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const gradedValue = items.filter(i => i.holding_type !== 'raw').reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const rawPct = Math.round((rawValue / totalValue) * 100)
  const gradedPct = 100 - rawPct

  // By era
  const byEra: Record<string, number> = {}
  items.forEach(i => {
    const era = inferEra(i.set_name)
    byEra[era] = (byEra[era] || 0) + (i.position_value_cents || 0)
  })
  const topEras = Object.entries(byEra).sort((a, b) => b[1] - a[1]).slice(0, 4)

  // Concentration — top card % of portfolio
  const topCard = [...items].sort((a, b) => (b.position_value_cents || 0) - (a.position_value_cents || 0))[0]
  const concentration = topCard ? Math.round(((topCard.position_value_cents || 0) / totalValue) * 100) : 0

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 16 }}>Portfolio DNA</div>

      {/* Raw vs Graded bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Raw vs Graded</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{rawPct}% raw · {gradedPct}% graded</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-light)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${rawPct}%`, background: '#94a3b8', borderRadius: '99px 0 0 99px' }} />
          <div style={{ width: `${gradedPct}%`, background: 'var(--primary)', borderRadius: '0 99px 99px 0' }} />
        </div>
      </div>

      {/* By era */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>By Era</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topEras.map(([era, value]) => {
            const pct = Math.round((value / totalValue) * 100)
            return (
              <div key={era}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{ERA_LABELS[era] || era}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{pct}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: 'var(--bg-light)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 99 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Concentration warning */}
      {concentration > 40 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: '#f59e0b', fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}>
            ⚠ {topCard?.card_name} makes up {concentration}% of your portfolio — consider diversifying
          </div>
        </div>
      )}
    </div>
  )
}

// ── Portfolio Splits (sealed/cards · raw/graded · era) ──────────────────────

type Slice = { label: string; value: number; color: string }

function DonutChart({ slices, size = 160 }: { slices: Slice[]; size?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return null

  const radius = size / 2 - 12
  const cx     = size / 2
  const cy     = size / 2
  const stroke = 22

  // Single non-zero slice — draw a plain stroked circle (no path math, no seam).
  const nonZero = slices.filter(s => s.value > 0)
  if (nonZero.length === 1) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={nonZero[0].color} strokeWidth={stroke} />
      </svg>
    )
  }

  // Multi-slice: render each slice as an explicit SVG arc path. This avoids
  // the sub-pixel gaps and visible "seam" you get with stroke-dasharray when
  // float math doesn't line dashes up exactly.
  const polar = (deg: number) => {
    const rad = (deg - 90) * Math.PI / 180
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
  }
  const arcPath = (startDeg: number, endDeg: number) => {
    const a = polar(startDeg)
    const b = polar(endDeg)
    const largeArc = endDeg - startDeg > 180 ? 1 : 0
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x} ${b.y}`
  }

  let cumulativeDeg = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((s, i) => {
        if (s.value <= 0) return null
        const sweep = (s.value / total) * 360
        // Tiny overlap (0.5°) between adjacent arcs hides any 1px subpixel gap.
        const start = Math.max(0, cumulativeDeg - 0.25)
        const end   = Math.min(360, cumulativeDeg + sweep + 0.25)
        cumulativeDeg += sweep
        return (
          <path
            key={i}
            d={arcPath(start, end)}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeLinecap="butt"
          />
        )
      })}
    </svg>
  )
}

function SplitsPanel({
  items, sealedMap, totalValue, currency,
}: {
  items: PortfolioItem[]
  sealedMap: Record<string, boolean>
  totalValue: number
  currency: Currency
}) {
  if (!items.length || totalValue <= 0) return null

  // ── Sealed vs cards ──
  // cards.is_sealed isn't always populated, so we OR it with a pattern
  // match on the card name (booster box / ETB / tin / theme deck / …).
  const isSealedItem = (i: PortfolioItem): boolean =>
    sealedMap[i.card_slug] === true || isSealedByName(i.card_name)
  const sealedValue = items
    .filter(isSealedItem)
    .reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const cardsValue = totalValue - sealedValue
  const sealedSlices: Slice[] = [
    { label: 'Cards',  value: cardsValue,  color: '#3b82f6' },
    { label: 'Sealed', value: sealedValue, color: '#a78bfa' },
  ]

  // ── Raw vs graded ──
  const rawValue    = items.filter(i => i.holding_type === 'raw').reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const gradedValue = totalValue - rawValue
  const rawSlices: Slice[] = [
    { label: 'Raw',    value: rawValue,    color: '#f59e0b' },
    { label: 'Graded', value: gradedValue, color: '#22c55e' },
  ]

  // ── By era ──
  const eraTotals: Record<string, number> = {}
  for (const i of items) {
    const era = inferEra(i.set_name)
    eraTotals[era] = (eraTotals[era] || 0) + (i.position_value_cents || 0)
  }
  const ERA_COLORS: Record<string, string> = {
    'vintage':   '#FFD166',
    'ex-era':    '#FF7A47',
    'dp-era':    '#74CEC0',
    'bw-xy-era': '#A565BF',
    'sm-era':    '#5BBC3F',
    'swsh-era':  '#5598E0',
    'sv-era':    '#E8538F',
    'other':     '#94a3b8',
  }
  const eraSlices: Slice[] = Object.entries(eraTotals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([era, value]) => ({
      label: ERA_LABELS[era] || era,
      value,
      color: ERA_COLORS[era] || '#94a3b8',
    }))

  function pct(v: number) {
    return totalValue > 0 ? Math.round((v / totalValue) * 100) : 0
  }

  function ChartBlock({ title, slices }: { title: string; slices: Slice[] }) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '16px 18px',
        display: 'flex', gap: 16, alignItems: 'center', minWidth: 0,
      }}>
        <div style={{ flexShrink: 0 }}>
          <DonutChart slices={slices} size={120} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
            color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8,
          }}>{title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {slices.filter(s => s.value > 0).map(s => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontFamily: "'Figtree', sans-serif" }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{pct(s.value)}%</span>
                <span style={{ color: 'var(--text)', fontWeight: 800, minWidth: 60, textAlign: 'right' }}>{fmt(s.value, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
      <ChartBlock title="Cards vs Sealed" slices={sealedSlices} />
      <ChartBlock title="Raw vs Graded"   slices={rawSlices} />
      {eraSlices.length > 0 && <ChartBlock title="By Era" slices={eraSlices} />}
    </div>
  )
}

// ── AI Insight Panel ──────────────────────────────────────────────────────────

function AIInsightPanel({ items, totalValue, currency }: { items: PortfolioItem[]; totalValue: number; currency: Currency }) {
  const [insight, setInsight] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  async function generate() {
    if (!items.length) return
    setLoading(true)

    // Build a compact, redacted summary. We give the model card names + sets
    // + grades + numeric performance — no user identity, no email, etc.
    const fmtCurNum = (cents: number | null | undefined) =>
      cents ? Number((cents / (currency === 'USD' ? 100 : 127)).toFixed(0)) : null
    const symbol = currency === 'USD' ? '$' : '£'

    const portfolioSummary = {
      currency,
      total_value: `${symbol}${fmtCurNum(totalValue)}`,
      card_count: items.length,
      top_cards: items.slice(0, 5).map(i => ({
        name: i.card_name,
        set: i.set_name,
        grade: GRADE_LABELS[i.holding_type] || i.holding_type,
        value: fmtCurNum(i.position_value_cents),
        pct_30d: i.pct_30d,
        pct_365d: i.pct_365d,
        purchase_price: fmtCurNum(i.purchase_price_cents),
      })),
      risers:  items.filter(i => i.pct_30d && i.pct_30d > 10).map(i => ({ name: i.card_name, pct_30d: i.pct_30d })),
      fallers: items.filter(i => i.pct_30d && i.pct_30d < -10).map(i => ({ name: i.card_name, pct_30d: i.pct_30d })),
    }

    // Route through the existing pokeprices-chat Supabase Edge Function. The
    // direct browser-to-Anthropic fetch the previous version used could not
    // work — Anthropic's API blocks browser CORS and we'd never expose an
    // API key client-side. The chat endpoint already wraps Claude Haiku
    // server-side and returns { answer }.
    const message = `[Portfolio analysis]
Give me a 2-3 sentence summary of how this Pokémon TCG portfolio is performing and what to watch. Plain prose only — no bullets, no bold, no headers. Sound like a knowledgeable collector friend, not a financial advisor. Use real card names. End with "Not financial advice."

Portfolio:
${JSON.stringify(portfolioSummary, null, 2)}`

    try {
      const res = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({
          message,
          session_id: 'portfolio-summary-' + Math.random().toString(36).slice(2, 10),
          history: [],
        }),
      })
      const data = await res.json()
      const answer = (data?.answer || '').trim()
      setInsight(answer || 'No summary returned. Try again in a moment.')
      setGenerated(true)
    } catch (err) {
      console.error('[portfolio AI insight] failed:', err)
      setInsight('Unable to generate insight right now. Try again later.')
    }
    setLoading(false)
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: insight ? 12 : 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
          ✦ AI Portfolio Summary
        </div>
        {!generated && (
          <button onClick={generate} disabled={loading || !items.length}
            style={{ padding: '6px 14px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Analysing...' : 'Generate'}
          </button>
        )}
        {generated && (
          <button onClick={() => { setInsight(null); setGenerated(false) }}
            style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Refresh
          </button>
        )}
      </div>
      {insight && (
        <p style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, margin: 0 }}>
          {insight}
        </p>
      )}
      {!insight && !loading && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '10px 0 0', lineHeight: 1.6 }}>
          Get a personalised AI summary of your portfolio performance and what to watch.
        </p>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function PortfolioDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [sortBy, setSortBy] = useState<'value' | 'pct_30d' | 'name'>('value')
  const [activeTab, setActiveTab] = useState<'holdings' | 'insights'>('holdings')
  const [editingItem, setEditingItem] = useState<PortfolioItem | null>(null)
  const [currency, setCurrency] = useState<Currency>('GBP')
  const [manualOverrides, setManualOverrides] = useState<Record<string, number | null>>({})
  const [manualValueUpdatedAt, setManualValueUpdatedAt] = useState<Record<string, string | null>>({})
  const [sealedMap, setSealedMap] = useState<Record<string, boolean>>({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  const loadPortfolio = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: portfolios } = await supabase.from('portfolios').select('id').eq('user_id', user.id).eq('is_default', true).limit(1)
    let pid = portfolios?.[0]?.id
    if (!pid) {
      const { data: newP } = await supabase.from('portfolios').insert([{ user_id: user.id, name: 'My Collection', is_default: true }]).select('id').single()
      pid = newP?.id
    }
    setPortfolioId(pid)
    if (pid) {
      const [summaryRes, prefsRes, manualsRes] = await Promise.all([
        supabase.rpc('get_portfolio_summary', { p_portfolio_id: pid }),
        // Defensive: try-with-display_currency, then fall back if column missing
        supabase.from('user_email_preferences').select('display_currency').eq('user_id', user.id).maybeSingle()
          .then((res: any) => res.error ? { data: null } : res),
        // Defensive: try-with-manual-columns, then fall back if migration not run
        supabase
          .from('portfolio_items')
          .select('id, card_slug, manual_value_cents, manual_value_updated_at')
          .eq('portfolio_id', pid)
          .then(async (res: any) => {
            if (!res.error) return res
            return await supabase
              .from('portfolio_items')
              .select('id, card_slug')
              .eq('portfolio_id', pid)
          }),
      ])

      if (summaryRes.data && !summaryRes.data.error) {
        // DEFENSIVE DEDUPE: if the get_portfolio_summary RPC has a
        // join that produces cartesian rows (e.g. one item × many price
        // variants), we end up with the same id repeated. Keep the first
        // occurrence so the UI shows each holding once.
        const rawItems: PortfolioItem[] = summaryRes.data.items || []
        const dedupedById = Array.from(
          new Map(rawItems.map(i => [i.id, i])).values()
        )
        setSummary({ ...summaryRes.data, items: dedupedById })
      }

      const cur = prefsRes.data?.display_currency
      if (cur === 'USD' || cur === 'GBP') setCurrency(cur)

      const manualMap: Record<string, number | null> = {}
      const stampMap: Record<string, string | null> = {}
      const cardSlugs = new Set<string>()
      ;(manualsRes.data || []).forEach((r: any) => {
        manualMap[r.id] = r.manual_value_cents ?? null
        stampMap[r.id] = r.manual_value_updated_at ?? null
        if (r.card_slug) cardSlugs.add(r.card_slug)
      })
      setManualOverrides(manualMap)
      setManualValueUpdatedAt(stampMap)

      // Look up is_sealed for each portfolio card so the insights tab can
      // show a Sealed vs Cards split. Uses card_url_slug since portfolio
      // items store the URL slug (not bare numeric).
      if (cardSlugs.size > 0) {
        const { data: cardRows } = await supabase
          .from('cards')
          .select('card_url_slug, is_sealed')
          .in('card_url_slug', Array.from(cardSlugs))
        const sealed: Record<string, boolean> = {}
        ;(cardRows || []).forEach((c: any) => {
          if (c.card_url_slug) sealed[c.card_url_slug] = !!c.is_sealed
        })
        setSealedMap(sealed)
      } else {
        setSealedMap({})
      }
    }
    setLoading(false)
  }, [user])

  useEffect(() => { loadPortfolio() }, [loadPortfolio])

  async function handleAddCard(itemData: any) {
    if (!portfolioId || !user) return
    await supabase.from('portfolio_items').upsert([{
      ...itemData, portfolio_id: portfolioId, user_id: user.id,
    }], { onConflict: 'portfolio_id,card_slug,holding_type' })
    await loadPortfolio()
  }

  async function handleRemove(itemId: string, cardName?: string) {
    const label = cardName ? `Remove "${cardName}" from your portfolio?` : 'Remove this card from your portfolio?'
    if (!confirm(label)) return
    await supabase.from('portfolio_items').delete().eq('id', itemId)
    await loadPortfolio()
  }

  async function handleEditSave(itemId: string, patch: any, manualValueCents: number | null) {
    // Try the full update first. If the manual_value_* columns aren't in the
    // schema yet (migration not run), retry without them so other edits still
    // save and the user sees a clear failure for the manual-value field.
    const fullPatch: Record<string, any> = {
      ...patch,
      manual_value_cents: manualValueCents,
      manual_value_updated_at: manualValueCents != null ? new Date().toISOString() : null,
    }
    const { error } = await supabase.from('portfolio_items').update(fullPatch).eq('id', itemId)
    if (error && /manual_value/.test(error.message || '')) {
      await supabase.from('portfolio_items').update(patch).eq('id', itemId)
    }
    await loadPortfolio()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />)}
      </div>
    </div>
  )

  const items = summary?.items || []
  const totalValue = summary?.total_value_cents || 0

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'value') return (b.position_value_cents || 0) - (a.position_value_cents || 0)
    if (sortBy === 'pct_30d') return (b.pct_30d || -999) - (a.pct_30d || -999)
    return a.card_name.localeCompare(b.card_name)
  })

  // Analytics
  const topMover    = items.length ? [...items].sort((a, b) => (b.pct_30d || -999) - (a.pct_30d || -999))[0] : null
  const biggestDrop = items.length ? [...items].sort((a, b) => (a.pct_30d || 999) - (b.pct_30d || 999))[0] : null
  const mostVal     = items.length ? [...items].sort((a, b) => (b.position_value_cents || 0) - (a.position_value_cents || 0))[0] : null
  const totalCost   = items.reduce((s, i) => s + (i.purchase_price_cents ? i.purchase_price_cents * i.quantity : 0), 0)
  const totalPnl    = totalCost > 0 ? totalValue - totalCost : null
  const totalPnlPct = totalPnl && totalCost > 0 ? (totalPnl / totalCost) * 100 : null

  // Grading opps — raw items where PSA 10 > 3x raw
  const gradingOpps = items.filter(i =>
    i.holding_type === 'raw' && i.current_psa10 && i.current_raw && i.current_psa10 > i.current_raw * 3
  ).sort((a, b) => {
    const multA = (a.current_psa10 || 0) / (a.current_raw || 1)
    const multB = (b.current_psa10 || 0) / (b.current_raw || 1)
    return multB - multA
  })

  // Dead weight — no price data or flat for 90d
  const deadWeight = items.filter(i => !i.current_value_cents || (!i.pct_90d && !i.pct_30d))

  // Recommended to sell — combines fast-rising signal (30d) with sustained
  // appreciation (90d). Each card gets a score; we surface the top candidates.
  // No volume signal yet (no per-item volume on portfolio_summary), but the
  // 30d cut excludes thin-tape moves the way users would intuit.
  const sellRecommendations = items
    .map(i => {
      const p30 = i.pct_30d ?? 0
      const p90 = i.pct_90d ?? 0
      // Score: 90-day weight 1.0, 30-day weight 0.6 (recent breakouts also count)
      const score = (p90 >= 30 ? p90 : 0) + 0.6 * (p30 >= 20 ? p30 : 0)
      return { item: i, score, p30, p90 }
    })
    .filter(r => r.score >= 30 && r.item.current_value_cents)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(r => r.item)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="portfolio" email={user?.email} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 2px', color: 'var(--text)' }}>My Collection</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>Track what you own — value, P&amp;L, grading insights.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            + Add Card
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Start tracking your collection</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Add your cards to see their current value, track performance, and get personalised insights.
          </p>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '12px 28px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Add your first card
          </button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Collection Value', value: fmtBig(totalValue, currency), sub: `${summary?.unique_cards || 0} unique cards`, highlight: true },
              { label: 'Total Cards', value: String(summary?.item_count || 0), sub: `${summary?.unique_cards || 0} unique` },
              ...(totalPnl !== null ? [{ label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl, currency)}`, sub: totalPnlPct ? `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%` : '', color: totalPnl >= 0 ? '#22c55e' : '#ef4444' }] : []),
              ...(topMover?.pct_30d ? [{ label: 'Best 30d', value: fmtPct(topMover.pct_30d).text, sub: topMover.card_name, color: '#22c55e' }] : []),
              ...(items.filter(i => i.pct_30d && i.pct_30d > 0).length > 0 ? [{ label: 'Cards Rising', value: String(items.filter(i => (i.pct_30d || 0) > 0).length), sub: 'in last 30 days', color: '#22c55e' }] : []),
            ].map((stat, i) => (
              <div key={i} style={{ background: stat.highlight ? 'rgba(26,95,173,0.06)' : 'var(--card)', border: `1px solid ${stat.highlight ? 'rgba(26,95,173,0.2)' : 'var(--border)'}`, borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: (stat as any).color || 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{stat.value}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{stat.label}</div>
                {stat.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.sub}</div>}
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['holdings', 'insights'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ padding: '8px 18px', borderRadius: 20, border: activeTab === tab ? '1px solid var(--primary)' : '1px solid var(--border)', background: activeTab === tab ? 'rgba(26,95,173,0.08)' : 'transparent', color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', textTransform: 'capitalize' }}>
                {tab === 'holdings' ? `Holdings (${items.length})` : `Insights${(gradingOpps.length + sellRecommendations.length) > 0 ? ` · ${gradingOpps.length + sellRecommendations.length}` : ''}`}
              </button>
            ))}
          </div>

          {/* ── Holdings tab ── */}
          {activeTab === 'holdings' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['value', 'By Value'], ['pct_30d', 'Best 30d'], ['name', 'A–Z']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    className={`sort-btn ${sortBy === val ? 'active' : ''}`}
                    style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedItems.map(item => {
                  const pct30    = fmtPct(item.pct_30d)
                  // If user has set a manual override, prefer that for the
                  // per-card current value (and recompute position value).
                  const manualPerCard = manualOverrides[item.id]
                  const manualStamp   = manualValueUpdatedAt[item.id]
                  const isManual      = isManualGrade(item.holding_type) || manualPerCard != null
                  const effPerCard    = manualPerCard ?? item.current_value_cents
                  const posVal        = manualPerCard != null
                    ? manualPerCard * item.quantity
                    : item.position_value_cents
                  const pnl      = item.purchase_price_cents && effPerCard
                    ? (effPerCard - item.purchase_price_cents) * item.quantity
                    : null
                  const cardUrl  = `/set/${encodeURIComponent(item.set_name)}/card/${item.card_slug}`
                  const grade    = GRADE_LABELS[item.holding_type] || item.holding_type
                  // Manual values that haven't been touched in 60+ days
                  // get a soft "refresh?" nudge.
                  const stale = manualStamp
                    ? (Date.now() - new Date(manualStamp).getTime()) > 60 * 24 * 60 * 60 * 1000
                    : false
                  const stampLabel = manualStamp
                    ? new Date(manualStamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : null

                  return (
                    <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <Link href={cardUrl} style={{ flexShrink: 0 }}>
                        {item.image_url
                          ? <img src={item.image_url} alt={item.card_name} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 4 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 44, height: 62, background: 'var(--bg-light)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>
                        }
                      </Link>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Link href={cardUrl} style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{item.card_name}</div>
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                          {item.set_name} · {grade}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                          {isManual && manualPerCard != null && (
                            <span
                              style={{
                                marginLeft: 6, color: '#b8741f', fontWeight: 700,
                                background: 'rgba(255,165,0,0.12)',
                                padding: '1px 7px', borderRadius: 6,
                              }}
                              title={stampLabel ? `Last updated ${stampLabel}` : ''}
                            >
                              manual value{stampLabel ? ` · ${stampLabel}` : ''}
                            </span>
                          )}
                          {isManual && manualPerCard == null && (
                            <span
                              style={{
                                marginLeft: 6, color: '#ef4444', fontWeight: 700,
                                background: 'rgba(239,68,68,0.1)',
                                padding: '1px 7px', borderRadius: 6,
                              }}
                              title="Click Edit to set a value"
                            >
                              no value set
                            </span>
                          )}
                          {stale && (
                            <span
                              style={{
                                marginLeft: 6, color: '#b8741f', fontWeight: 700,
                                background: 'rgba(255,165,0,0.18)',
                                padding: '1px 7px', borderRadius: 6,
                              }}
                              title="Manual value is over 60 days old — open Edit to refresh"
                            >
                              ↻ refresh
                            </span>
                          )}
                        </div>
                        {pnl !== null && (
                          <div style={{ fontSize: 11, color: pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: "'Figtree', sans-serif", marginTop: 2, fontWeight: 600 }}>
                            {pnl >= 0 ? '+' : ''}{fmt(pnl, currency)} P&L
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(posVal, currency)}</div>
                        <div style={{ fontSize: 11, color: pct30.color, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>{pct30.text} 30d</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button
                          onClick={() => setEditingItem(item)}
                          aria-label="Edit holding"
                          title="Edit holding"
                          style={{
                            width: 32, height: 32, borderRadius: 8,
                            border: '1px solid var(--border)', background: 'var(--card)',
                            color: 'var(--text-muted)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'border-color 0.15s, color 0.15s',
                          }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'var(--primary)'; el.style.color = 'var(--primary)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--text-muted)' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleRemove(item.id, item.card_name)}
                          aria-label="Remove from portfolio"
                          title="Remove from portfolio"
                          style={{
                            width: 32, height: 32, borderRadius: 8,
                            border: '1px solid rgba(239,68,68,0.25)',
                            background: 'rgba(239,68,68,0.06)',
                            color: '#ef4444', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'background 0.15s, border-color 0.15s',
                          }}
                          onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = 'rgba(239,68,68,0.18)'; el.style.borderColor = 'rgba(239,68,68,0.5)' }}
                          onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = 'rgba(239,68,68,0.06)'; el.style.borderColor = 'rgba(239,68,68,0.25)' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ── Insights tab ── */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Splits / charts */}
              <SplitsPanel items={items} sealedMap={sealedMap} totalValue={totalValue} currency={currency} />

              {/* Coming-soon note for non-PSA grading data */}
              <div style={{
                background: 'rgba(255,165,0,0.06)',
                border: '1px solid rgba(255,165,0,0.18)',
                borderRadius: 12, padding: '12px 16px',
                fontSize: 12, fontFamily: "'Figtree', sans-serif",
                color: 'var(--text)', lineHeight: 1.55,
              }}>
                <strong style={{ color: '#b8741f' }}>Heads up:</strong>{' '}
                live market data for BGS, CGC, SGC, ACE and TAG is coming soon. For
                now, those grades require a manual value — you can update yours
                from the Edit screen any time.
              </div>

              {/* AI summary */}
              <AIInsightPanel items={items} totalValue={totalValue} currency={currency} />

              {/* Portfolio DNA */}
              <PortfolioDNA items={items} totalValue={totalValue} />

              {/* Recommended to Sell — fast-rising + sustained appreciation */}
              {sellRecommendations.length > 0 && (
                <div style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.25)', borderLeft: '3px solid #22c55e', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: '#22c55e', fontFamily: "'Figtree', sans-serif" }}>
                      🔥 Recommended to sell
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                      Fast risers + sustained 90-day moves · {sellRecommendations.length} candidate{sellRecommendations.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {sellRecommendations.map(item => {
                      const p30 = item.pct_30d ?? 0
                      const p90 = item.pct_90d ?? 0
                      const aboveBuy = item.purchase_price_cents && item.current_value_cents
                        ? item.current_value_cents > item.purchase_price_cents * 1.5
                        : false
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{item.card_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>
                              {item.set_name} · now {fmt(item.current_value_cents, currency)}
                              {aboveBuy && <span style={{ marginLeft: 6, color: '#22c55e', fontWeight: 700 }}>· well above your buy price</span>}
                            </div>
                            <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, fontFamily: "'Figtree', sans-serif" }}>
                              {p30 >= 20 && <span style={{ color: '#22c55e', fontWeight: 700 }}>↑ 30d +{p30.toFixed(1)}%</span>}
                              {p90 >= 30 && <span style={{ color: '#16a34a', fontWeight: 700 }}>↑ 90d +{p90.toFixed(1)}%</span>}
                            </div>
                          </div>
                          <Link href={`/set/${encodeURIComponent(item.set_name)}/card/${item.card_slug}`} style={{ fontSize: 12, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap' }}>
                            View →
                          </Link>
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '12px 0 0', lineHeight: 1.5 }}>
                    Suggestions only — based on price momentum (30d ≥ 20% or 90d ≥ 30%). Not financial advice.
                  </p>
                </div>
              )}

              {/* Top mover */}
              {topMover?.pct_30d && topMover.pct_30d > 5 && (
                <div style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#22c55e', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📈 Top Performer This Month</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 3 }}>{topMover.card_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        +{topMover.pct_30d.toFixed(1)}% in 30 days · {fmt(topMover.current_value_cents, currency)} per card
                        {topMover.purchase_price_cents && topMover.current_value_cents && topMover.current_value_cents > topMover.purchase_price_cents * 1.3 ? ' · significantly above your buy price' : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', fontFamily: "'Figtree', sans-serif" }}>+{topMover.pct_30d.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Biggest drop */}
              {biggestDrop?.pct_30d && biggestDrop.pct_30d < -10 && (
                <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📉 Biggest Drop This Month</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 3 }}>{biggestDrop.card_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {biggestDrop.pct_30d.toFixed(1)}% in 30 days · now {fmt(biggestDrop.current_value_cents, currency)}
                        {biggestDrop.purchase_price_cents && biggestDrop.current_value_cents && biggestDrop.current_value_cents < biggestDrop.purchase_price_cents ? ' · below your purchase price' : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#ef4444', fontFamily: "'Figtree', sans-serif" }}>{biggestDrop.pct_30d.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Grading opportunities */}
              {gradingOpps.length > 0 && (
                <div style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderLeft: '3px solid #a78bfa', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#a78bfa', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>⭐ Grading Opportunities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {gradingOpps.slice(0, 4).map(item => {
                      const mult = item.current_psa10 && item.current_raw ? (item.current_psa10 / item.current_raw) : null
                      const upside = item.current_psa10 && item.current_raw ? ((item.current_psa10 - item.current_raw - 2500) / 127).toFixed(0) : null
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>{item.card_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                              {fmt(item.current_raw, currency)} raw → {fmt(item.current_psa10, currency)} PSA 10
                              {upside && parseInt(upside) > 0 ? ` · ~£${upside} upside if PSA 10` : ''}
                            </div>
                          </div>
                          {mult && <div style={{ fontSize: 16, fontWeight: 800, color: '#a78bfa', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{mult.toFixed(1)}x</div>}
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '12px 0 0', lineHeight: 1.5 }}>
                    Upside estimate assumes £20 grading cost and a PSA 10 result. Actual outcome depends on card condition and gem rate. Not financial advice.
                  </p>
                </div>
              )}

              {/* Dead weight */}
              {deadWeight.length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>💤 No Price Data</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
                    {deadWeight.length} card{deadWeight.length !== 1 ? 's' : ''} in your portfolio {deadWeight.length !== 1 ? 'have' : 'has'} no current market data — these may be rare, very new, or thinly traded.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {deadWeight.slice(0, 3).map(item => (
                      <div key={item.id} style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>· {item.card_name} ({item.set_name})</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty insights state */}
              {gradingOpps.length === 0 && sellRecommendations.length === 0 && (!topMover?.pct_30d) && (!biggestDrop?.pct_30d) && deadWeight.length === 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, fontSize: 14 }}>
                    Add more cards with purchase prices to unlock portfolio insights
                  </p>
                </div>
              )}

            </div>
          )}
        </>
      )}

      {showAddModal && <AddCardModal onAdd={handleAddCard} onClose={() => setShowAddModal(false)} currency={currency} />}
      {editingItem && (
        <EditHoldingModal
          item={editingItem}
          currency={currency}
          onSave={(patch, manualValueCents) => handleEditSave(editingItem.id, patch, manualValueCents)}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  )
}
