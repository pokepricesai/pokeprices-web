'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  HOLDING_TYPES,
  isManualGrade,
  NO_MARKET_DATA_NOTE,
  type HoldingType,
} from '@/lib/portfolioGrades'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug?: string | null
  image_url?: string | null
  card_number_display?: string | null
  card_number?: string | null
  raw_usd?: number | null
  psa10_usd?: number | null
}

// Group HOLDING_TYPES by company so the dropdown reads cleanly.
const GRADE_GROUPS: { company: string; types: HoldingType[] }[] = (() => {
  const map = new Map<string, HoldingType[]>()
  for (const t of HOLDING_TYPES) {
    if (!map.has(t.company)) map.set(t.company, [])
    map.get(t.company)!.push(t)
  }
  return Array.from(map.entries()).map(([company, types]) => ({ company, types }))
})()

export default function CardQuickActions({ card }: { card: Card }) {
  const [user, setUser] = useState<any>(null)
  const [watchId, setWatchId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPortfolioModal, setShowPortfolioModal] = useState(false)
  const cardSlug = (card.card_url_slug || card.card_slug || '').toString().replace(/^pc-/, '')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user || !cardSlug) { setWatchId(null); return }
    supabase
      .from('watchlist')
      .select('id')
      .eq('user_id', user.id)
      .eq('card_slug', cardSlug)
      .maybeSingle()
      .then(({ data }) => setWatchId(data?.id ?? null))
  }, [user, cardSlug])

  async function handleWatch() {
    if (!user) return
    setBusy(true)
    if (watchId) {
      await supabase.from('watchlist').delete().eq('id', watchId)
      setWatchId(null)
    } else {
      const { data: row, error } = await supabase.from('watchlist').insert([{
        user_id: user.id,
        card_slug: cardSlug,
        card_name: card.card_name,
        set_name: card.set_name,
        card_url_slug: cardSlug,
        image_url: card.image_url || null,
        card_number: card.card_number_display || card.card_number || null,
        raw_at_add: card.raw_usd ?? null,
        psa10_at_add: card.psa10_usd ?? null,
      }]).select('id').single()
      if (!error && row) setWatchId(row.id)
    }
    setBusy(false)
  }

  const baseBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 13px', borderRadius: 18,
    fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
    border: '1px solid var(--border)',
    background: 'var(--card)', color: 'var(--text)',
    cursor: 'pointer', textDecoration: 'none',
    transition: 'all 0.15s',
  }

  const watchingBtn: React.CSSProperties = {
    ...baseBtn,
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid #22c55e',
    color: '#16a34a',
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <Link href="/dashboard/login" style={baseBtn}>
          <span>👁</span> Watch
        </Link>
        <Link href="/dashboard/login" style={baseBtn}>
          <span>📊</span> Add to portfolio
        </Link>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", alignSelf: 'center' }}>
          Free — no card required to register.
        </span>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={handleWatch} disabled={busy} style={watchId ? watchingBtn : baseBtn}>
          {watchId ? <><span>✓</span> Watching</> : <><span>👁</span> Watch</>}
        </button>
        <button onClick={() => setShowPortfolioModal(true)} style={baseBtn}>
          <span>📊</span> Add to portfolio
        </button>
      </div>
      {showPortfolioModal && (
        <CardPortfolioAddModal
          card={card}
          cardSlug={cardSlug}
          user={user}
          onClose={() => setShowPortfolioModal(false)}
        />
      )}
    </>
  )
}

// ── Quick-add to portfolio modal ─────────────────────────────────────────────

export function CardPortfolioAddModal({
  card, cardSlug, user, onClose,
}: {
  card: Card
  cardSlug: string
  user: any
  onClose: () => void
}) {
  // Currency comes from the user's email-prefs row. Fall back to GBP.
  const [currency, setCurrency] = useState<'GBP' | 'USD'>('GBP')
  const [holdingType, setHoldingType] = useState('raw')
  const [quantity, setQuantity] = useState(1)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [manualValue, setManualValue] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const manual = isManualGrade(holdingType)
  const symbol = currency === 'USD' ? '$' : '£'
  const cps = currency === 'USD' ? 100 : 127

  useEffect(() => {
    supabase
      .from('user_email_preferences')
      .select('display_currency')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const cur = data?.display_currency
        if (cur === 'USD' || cur === 'GBP') setCurrency(cur)
      })
  }, [user.id])

  async function getOrCreatePortfolioId(): Promise<string | null> {
    const { data: existing } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .limit(1)
    if (existing?.[0]?.id) return existing[0].id
    const { data: created } = await supabase
      .from('portfolios')
      .insert([{ user_id: user.id, name: 'My Collection', is_default: true }])
      .select('id')
      .single()
    return created?.id ?? null
  }

  async function handleAdd() {
    setSaving(true)
    setError('')
    try {
      if (manual && !manualValue) {
        throw new Error('Please enter a current value — we don\'t have live market data for this grade.')
      }
      const portfolio_id = await getOrCreatePortfolioId()
      if (!portfolio_id) throw new Error('Could not load your portfolio.')

      const purchaseCents = purchasePrice ? Math.round(parseFloat(purchasePrice) * cps) : null
      const manualCents   = manual && manualValue ? Math.round(parseFloat(manualValue) * cps) : null

      // Only include the manual-value columns when actually setting them, so
      // PostgREST doesn't fail with "column not found in schema cache" if the
      // 2026-04-30-portfolio-improvements migration hasn't been applied yet.
      const payload: Record<string, any> = {
        portfolio_id,
        user_id: user.id,
        card_slug: cardSlug,
        card_name_snapshot: card.card_name,
        set_name_snapshot: card.set_name,
        image_url_snapshot: card.image_url || null,
        holding_type: holdingType,
        quantity: Math.max(1, quantity),
        purchase_price_cents: purchaseCents,
        purchase_currency: currency,
        purchase_date: purchaseDate || null,
        notes: notes || null,
      }
      if (manualCents != null) {
        payload.manual_value_cents = manualCents
        payload.manual_value_updated_at = new Date().toISOString()
      }

      const { error: err } = await supabase.from('portfolio_items').upsert([payload], {
        onConflict: 'portfolio_id,card_slug,holding_type',
      })

      if (err) throw err
      setDone(true)
    } catch (e: any) {
      setError(e?.message || 'Failed to add to portfolio')
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
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>Add to portfolio</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>✓</div>
            <p style={{ fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: '0 0 16px', color: 'var(--text)' }}>
              Added to your portfolio.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Link href="/dashboard/portfolio" style={{ padding: '8px 16px', borderRadius: 10, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
                View portfolio
              </Link>
              <button
                onClick={() => { setDone(false); setQuantity(1); setPurchasePrice(''); setManualValue(''); setNotes('') }}
                style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 13, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}
              >
                Add another
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--bg-light)', borderRadius: 12, marginBottom: 18 }}>
              {card.image_url && <img src={card.image_url} alt={card.card_name} style={{ width: 36, height: 50, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {card.card_name}{card.card_number_display ? ` · ${card.card_number_display}` : ''}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{card.set_name}</div>
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

            {manual && (
              <div style={{
                padding: '12px 14px', background: 'rgba(255,165,0,0.08)',
                border: '1px solid rgba(255,165,0,0.25)', borderRadius: 10,
                marginBottom: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#b8741f', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
                  ⚠ Manual value required
                </div>
                <p style={{ fontSize: 12, color: 'var(--text)', margin: 0, lineHeight: 1.55, fontFamily: "'Figtree', sans-serif" }}>
                  {NO_MARKET_DATA_NOTE}
                </p>
              </div>
            )}

            {manual && (
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Current value per card ({symbol}) <span style={{ color: '#ef4444', fontWeight: 700 }}>*</span></label>
                <input type="number" step="0.01" min="0" value={manualValue} onChange={e => setManualValue(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Purchase price ({symbol}) <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Purchase date <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>Notes <span style={{ fontWeight: 400 }}>optional</span></label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Great centering" style={inputStyle} />
            </div>

            {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>{error}</p>}

            <button onClick={handleAdd} disabled={saving}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Adding…' : 'Add to portfolio'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
