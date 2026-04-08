'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RetailerPage {
  id: string
  url: string
  raw_title: string | null
  current_price: number | null
  current_stock_state: string
  current_preorder_state: boolean
  parser_confidence: number | null
  last_seen_at: string | null
  last_changed_at: string | null
  last_error: string | null
  scrape_active: boolean
  scrape_frequency: string
  retailer: { name: string; slug: string }
  product: { canonical_name: string; product_type: string; msrp_gbp: number | null } | null
}

interface StockEvent {
  id: string
  event_type: string
  old_value: string | null
  new_value: string | null
  price: number | null
  significance_score: number
  detected_at: string
  retailer: { name: string } | null
  product: { canonical_name: string } | null
}

interface Alert {
  id: string
  title: string
  body: string | null
  url: string | null
  price: number | null
  urgency_score: number
  sent_via: string | null
  sent_at: string | null
  created_at: string
  product: { canonical_name: string } | null
  retailer: { name: string } | null
}

interface Product {
  id: string
  canonical_name: string
  product_type: string
  msrp_gbp: number | null
  release_date: string | null
  priority_score: number
  is_pokemon_center_exclusive: boolean
  active: boolean
  set: { set_name: string } | null
}

interface ScraperRun {
  id: string
  status: string
  pages_scraped: number
  events_generated: number
  alerts_sent: number
  error_message: string | null
  duration_ms: number | null
  run_at: string
  retailer: { name: string } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  in_stock:       '#22c55e',
  low_stock:      '#f59e0b',
  preorder_open:  '#3b82f6',
  notify_me:      '#8b5cf6',
  coming_soon:    '#64748b',
  sold_out:       '#ef4444',
  unavailable:    '#ef4444',
  discontinued:   '#94a3b8',
  unknown:        '#94a3b8',
  queued:         '#f59e0b',
  invite_only:    '#ec4899',
}

const STATE_LABELS: Record<string, string> = {
  in_stock: 'In Stock', low_stock: 'Low Stock', preorder_open: 'Preorder Open',
  notify_me: 'Notify Me', coming_soon: 'Coming Soon', sold_out: 'Sold Out',
  unavailable: 'Unavailable', discontinued: 'Discontinued', unknown: 'Unknown',
  queued: 'Queued', invite_only: 'Invite Only',
}

function StateBadge({ state }: { state: string }) {
  const color = STATE_COLORS[state] || '#94a3b8'
  const label = STATE_LABELS[state] || state
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: `${color}18`, color, border: `1px solid ${color}40`,
      fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

function timeAgo(ts: string | null): string {
  if (!ts) return 'never'
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function ProductTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    booster_box: '#f59e0b', etb: '#3b82f6', mini_tin: '#8b5cf6',
    collection_box: '#22c55e', tin: '#64748b', booster_bundle: '#ec4899',
    premium_collection: '#f59e0b', pc_exclusive: '#ef4444',
  }
  const color = colors[type] || '#94a3b8'
  return (
    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: `${color}18`, color, fontFamily: "'Figtree', sans-serif" }}>
      {type.replace(/_/g, ' ').toUpperCase()}
    </span>
  )
}

const s: React.CSSProperties = {
  fontFamily: "'Figtree', sans-serif",
}

// ── Add Page Modal ────────────────────────────────────────────────────────────

function AddPageModal({ retailers, products, onAdd, onClose }: any) {
  const [url, setUrl] = useState('')
  const [retailerId, setRetailerId] = useState('')
  const [productId, setProductId] = useState('')
  const [frequency, setFrequency] = useState('medium')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!url || !retailerId) return
    setSaving(true)
    await supabase.from('intel_retailer_pages').insert([{
      url: url.trim(),
      retailer_id: retailerId,
      product_id: productId || null,
      scrape_frequency: frequency,
      scrape_active: true,
    }])
    await onAdd()
    setSaving(false)
    onClose()
  }

  const inputStyle: React.CSSProperties = { ...s, width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 500, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ ...s, fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text)' }}>Add Retailer Page</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ ...s, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>Product URL *</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.pokemoncenter.com/..." style={inputStyle} />
          </div>
          <div>
            <label style={{ ...s, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>Retailer *</label>
            <select value={retailerId} onChange={e => setRetailerId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">Select retailer...</option>
              {retailers.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...s, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>Product <span style={{ fontWeight: 400 }}>optional</span></label>
            <select value={productId} onChange={e => setProductId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">Link to product...</option>
              {products.map((p: any) => <option key={p.id} value={p.id}>{p.canonical_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ ...s, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }}>Scrape Frequency</label>
            <select value={frequency} onChange={e => setFrequency(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="high">High — every 5-10 min (hot items)</option>
              <option value="medium">Medium — every 30-60 min (default)</option>
              <option value="low">Low — every 6-24 hr (archive)</option>
            </select>
          </div>
          <button onClick={handleSave} disabled={!url || !retailerId || saving}
            style={{ ...s, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !url || !retailerId || saving ? 0.6 : 1 }}>
            {saving ? 'Adding...' : 'Add Page'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Product Modal ─────────────────────────────────────────────────────────

function AddProductModal({ sets, onAdd, onClose }: any) {
  const [name, setName] = useState('')
  const [setId, setSetId] = useState('')
  const [type, setType] = useState('etb')
  const [msrp, setMsrp] = useState('')
  const [releaseDate, setReleaseDate] = useState('')
  const [priority, setPriority] = useState('5')
  const [isPCExclusive, setIsPCExclusive] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  async function handleSave() {
    if (!name) return
    setSaving(true)
    await supabase.from('intel_products').insert([{
      canonical_name: name.trim(),
      slug,
      set_id: setId || null,
      product_type: type,
      msrp_gbp: msrp ? parseFloat(msrp) : null,
      release_date: releaseDate || null,
      priority_score: parseInt(priority),
      is_pokemon_center_exclusive: isPCExclusive,
      notes: notes || null,
    }])
    await onAdd()
    setSaving(false)
    onClose()
  }

  const inputStyle: React.CSSProperties = { ...s, width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { ...s, fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 5 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: 500, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ ...s, fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text)' }}>Add Product</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Canonical Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Destined Rivals Elite Trainer Box" style={inputStyle} />
            {name && <div style={{ ...s, fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>slug: {slug}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Product Type</label>
              <select value={type} onChange={e => setType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {['booster_box', 'etb', 'mini_tin', 'collection_box', 'tin', 'booster_bundle', 'premium_collection', 'pc_exclusive', 'promo_pack'].map(t => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>MSRP (£)</label>
              <input type="number" step="0.01" value={msrp} onChange={e => setMsrp(e.target.value)} placeholder="49.99" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Release Date</label>
              <input type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Priority (1-10)</label>
              <input type="number" min={1} max={10} value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Set</label>
            <select value={setId} onChange={e => setSetId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="">No set linked</option>
              {sets.map((s: any) => <option key={s.id} value={s.id}>{s.set_name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => setIsPCExclusive(v => !v)}>
            <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isPCExclusive ? '#ef4444' : 'var(--border)'}`, background: isPCExclusive ? '#ef4444' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {isPCExclusive && <svg width="10" height="8" viewBox="0 0 10 8"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <span style={{ ...s, fontSize: 13, color: 'var(--text)' }}>Pokémon Center exclusive</span>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes..." style={inputStyle} />
          </div>
          <button onClick={handleSave} disabled={!name || saving}
            style={{ ...s, padding: '10px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !name || saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

type Tab = 'today' | 'watchlist' | 'products' | 'retailers' | 'events' | 'scraper'

export default function IntelDashboard() {
  const [tab, setTab] = useState<Tab>('today')
  const [pages, setPages] = useState<RetailerPage[]>([])
  const [events, setEvents] = useState<StockEvent[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [sets, setSets] = useState<any[]>([])
  const [retailers, setRetailers] = useState<any[]>([])
  const [scraperRuns, setScraperRuns] = useState<ScraperRun[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddPage, setShowAddPage] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)

  async function loadAll() {
    setLoading(true)
    const [pagesRes, eventsRes, alertsRes, productsRes, setsRes, retailersRes, runsRes] = await Promise.all([
      supabase.from('intel_retailer_pages').select('*, retailer:intel_retailers(name,slug), product:intel_products(canonical_name,product_type,msrp_gbp)').order('last_seen_at', { ascending: false }).limit(100),
      supabase.from('intel_stock_events').select('*, retailer:intel_retailers(name), product:intel_products(canonical_name)').order('detected_at', { ascending: false }).limit(50),
      supabase.from('intel_alerts').select('*, product:intel_products(canonical_name), retailer:intel_retailers(name)').order('created_at', { ascending: false }).limit(30),
      supabase.from('intel_products').select('*, set:intel_sets(set_name)').eq('active', true).order('priority_score', { ascending: false }),
      supabase.from('intel_sets').select('id,set_name').order('release_date', { ascending: false }).limit(50),
      supabase.from('intel_retailers').select('id,name,slug').eq('active', true).order('name'),
      supabase.from('intel_scraper_runs').select('*, retailer:intel_retailers(name)').order('run_at', { ascending: false }).limit(20),
    ])
    setPages(pagesRes.data || [])
    setEvents(eventsRes.data || [])
    setAlerts(alertsRes.data || [])
    setProducts(productsRes.data || [])
    setSets(setsRes.data || [])
    setRetailers(retailersRes.data || [])
    setScraperRuns(runsRes.data || [])
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [])

  // Live pages — anything in stock or preorder
  const livePages = pages.filter(p => ['in_stock', 'low_stock', 'preorder_open', 'invite_only'].includes(p.current_stock_state))
  const recentEvents = events.filter(e => Date.now() - new Date(e.detected_at).getTime() < 24 * 60 * 60 * 1000)
  const upcomingProducts = products.filter(p => p.release_date && new Date(p.release_date) > new Date()).sort((a, b) => new Date(a.release_date!).getTime() - new Date(b.release_date!).getTime())

  const card = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, ...style }}>
      {children}
    </div>
  )

  const sectionHead = (title: string, count?: number) => (
    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>
      {title}{count !== undefined ? ` (${count})` : ''}
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: 0, color: 'var(--text)' }}>⚡ PokePrices Intel</h1>
            <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '2px 7px', fontFamily: "'Figtree', sans-serif" }}>PRIVATE</span>
          </div>
          <div style={{ ...s, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>UK retail intelligence · {pages.length} pages monitored</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddProduct(true)} style={{ ...s, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Product</button>
          <button onClick={() => setShowAddPage(true)} style={{ ...s, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>+ Monitor URL</button>
          <button onClick={loadAll} style={{ ...s, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>↻</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0, overflowX: 'auto' }}>
        {([
          ['today', `Today${livePages.length ? ` 🔴${livePages.length}` : ''}`],
          ['watchlist', `Watchlist (${pages.length})`],
          ['products', `Products (${products.length})`],
          ['events', `Events (${recentEvents.length})`],
          ['retailers', 'Retailers'],
          ['scraper', 'Scraper'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...s, padding: '8px 16px', borderRadius: '8px 8px 0 0', border: '1px solid var(--border)', borderBottom: tab === t ? '1px solid var(--card)' : '1px solid var(--border)', background: tab === t ? 'var(--card)' : 'transparent', color: tab === t ? 'var(--primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {loading && <div style={{ ...s, color: 'var(--text-muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>Loading...</div>}

      {/* ── TODAY tab ── */}
      {!loading && tab === 'today' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Live now */}
          <div style={{ gridColumn: '1 / -1' }}>
            {card(<>
              {sectionHead('🟢 Live Now', livePages.length)}
              {livePages.length === 0 ? (
                <div style={{ ...s, fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>No live stock detected</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {livePages.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(34,197,94,0.04)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.15)', flexWrap: 'wrap' }}>
                      <StateBadge state={p.current_stock_state} />
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ ...s, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.product?.canonical_name || p.raw_title || 'Unknown'}</div>
                        <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>{p.retailer?.name} · changed {timeAgo(p.last_changed_at)}</div>
                      </div>
                      {p.current_price && <div style={{ ...s, fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>£{p.current_price.toFixed(2)}</div>}
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                        style={{ ...s, padding: '5px 12px', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>
                        View →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </>)}
          </div>

          {/* Upcoming releases */}
          <div>
            {card(<>
              {sectionHead('📅 Upcoming Releases', upcomingProducts.length)}
              {upcomingProducts.length === 0 ? (
                <div style={{ ...s, fontSize: 13, color: 'var(--text-muted)' }}>No upcoming releases added</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {upcomingProducts.slice(0, 8).map(p => {
                    const daysUntil = Math.ceil((new Date(p.release_date!).getTime() - Date.now()) / 86400000)
                    return (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...s, fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.canonical_name}</div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                            <ProductTypeBadge type={p.product_type} />
                            {p.is_pokemon_center_exclusive && <span style={{ ...s, fontSize: 10, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 4 }}>PC Exclusive</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ ...s, fontSize: 13, fontWeight: 800, color: daysUntil <= 7 ? '#ef4444' : daysUntil <= 30 ? '#f59e0b' : 'var(--text)' }}>{daysUntil}d</div>
                          <div style={{ ...s, fontSize: 10, color: 'var(--text-muted)' }}>{new Date(p.release_date!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </>)}
          </div>

          {/* Recent events */}
          <div>
            {card(<>
              {sectionHead('⚡ Recent Events', recentEvents.length)}
              {recentEvents.length === 0 ? (
                <div style={{ ...s, fontSize: 13, color: 'var(--text-muted)' }}>No events in last 24h</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recentEvents.slice(0, 8).map(e => (
                    <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...s, fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {e.product?.canonical_name || 'Unknown product'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{ ...s, fontSize: 10, color: 'var(--text-muted)' }}>{e.old_value?.replace(/_/g, ' ')} →</span>
                          <StateBadge state={e.new_value || 'unknown'} />
                        </div>
                      </div>
                      <div style={{ ...s, fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(e.detected_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>)}
          </div>

        </div>
      )}

      {/* ── WATCHLIST tab ── */}
      {!loading && tab === 'watchlist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pages.length === 0 ? (
            <div style={{ ...s, textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 14 }}>
              No pages being monitored yet. Add a retailer URL to start.
            </div>
          ) : (
            pages.map(p => (
              <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <StateBadge state={p.current_stock_state} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ ...s, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {p.product?.canonical_name || p.raw_title || p.url.split('/').slice(-2).join('/')}
                  </div>
                  <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {p.retailer?.name} · seen {timeAgo(p.last_seen_at)} · changed {timeAgo(p.last_changed_at)}
                    {p.last_error && <span style={{ color: '#ef4444' }}> · ERR: {p.last_error.slice(0, 40)}</span>}
                  </div>
                </div>
                {p.current_price && <div style={{ ...s, fontSize: 14, fontWeight: 800, color: 'var(--text)', flexShrink: 0 }}>£{p.current_price.toFixed(2)}</div>}
                {p.parser_confidence && (
                  <div style={{ ...s, fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {(p.parser_confidence * 100).toFixed(0)}% conf
                  </div>
                )}
                <a href={p.url} target="_blank" rel="noopener noreferrer"
                  style={{ ...s, fontSize: 11, color: 'var(--primary)', textDecoration: 'none', flexShrink: 0, fontWeight: 600 }}>
                  Open →
                </a>
                <button onClick={async () => { await supabase.from('intel_retailer_pages').update({ scrape_active: !p.scrape_active }).eq('id', p.id); loadAll() }}
                  style={{ ...s, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}>
                  {p.scrape_active ? 'Pause' : 'Resume'}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── PRODUCTS tab ── */}
      {!loading && tab === 'products' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {products.map(p => (
            <div key={p.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...s, fontSize: 16, fontWeight: 900, color: 'var(--text-muted)', width: 20, textAlign: 'center', flexShrink: 0 }}>{p.priority_score}</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ ...s, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{p.canonical_name}</span>
                  {p.is_pokemon_center_exclusive && <span style={{ ...s, fontSize: 10, fontWeight: 700, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 4 }}>PC Exclusive</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                  <ProductTypeBadge type={p.product_type} />
                  {p.set && <span style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>{p.set.set_name}</span>}
                  {p.release_date && <span style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>· {new Date(p.release_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</span>}
                </div>
              </div>
              {p.msrp_gbp && <div style={{ ...s, fontSize: 14, fontWeight: 800, color: 'var(--text)', flexShrink: 0 }}>£{p.msrp_gbp.toFixed(2)}</div>}
            </div>
          ))}
          {products.length === 0 && (
            <div style={{ ...s, textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 14 }}>No products yet. Add products to link them to monitored URLs.</div>
          )}
        </div>
      )}

      {/* ── EVENTS tab ── */}
      {!loading && tab === 'events' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {events.map(e => (
            <div key={e.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ ...s, fontSize: 11, fontWeight: 700, width: 18, height: 18, borderRadius: '50%', background: e.significance_score >= 8 ? '#ef4444' : e.significance_score >= 6 ? '#f59e0b' : '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{e.significance_score}</div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ ...s, fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{e.product?.canonical_name || 'Unknown product'}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                  <span style={{ ...s, fontSize: 10, color: 'var(--text-muted)' }}>{e.retailer?.name}</span>
                  <span style={{ ...s, fontSize: 10, color: 'var(--text-muted)' }}>·</span>
                  <span style={{ ...s, fontSize: 10, color: 'var(--text-muted)' }}>{e.old_value?.replace(/_/g, ' ')} →</span>
                  <StateBadge state={e.new_value || 'unknown'} />
                </div>
              </div>
              {e.price && <div style={{ ...s, fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>£{e.price.toFixed(2)}</div>}
              <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{timeAgo(e.detected_at)}</div>
            </div>
          ))}
          {events.length === 0 && <div style={{ ...s, textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 14 }}>No events yet. Run a scraper to detect stock changes.</div>}
        </div>
      )}

      {/* ── RETAILERS tab ── */}
      {!loading && tab === 'retailers' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {retailers.map(r => {
            const rPages = pages.filter(p => p.retailer?.slug === r.slug)
            const live = rPages.filter(p => ['in_stock', 'low_stock', 'preorder_open'].includes(p.current_stock_state)).length
            const lastRun = scraperRuns.find(run => run.retailer?.name === r.name)
            return (
              <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
                <div style={{ ...s, fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>{r.name}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ ...s, fontSize: 12, color: 'var(--text-muted)' }}>{rPages.length} pages monitored · {live} live</div>
                  {lastRun && <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>Last run: {timeAgo(lastRun.run_at)} · {lastRun.status}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── SCRAPER tab ── */}
      {!loading && tab === 'scraper' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ ...s, fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>⚠ Manual trigger required</div>
            <div style={{ ...s, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              Scrapers run via Python scripts. Deploy to GitHub and run via GitHub Actions or locally:<br />
              <code style={{ fontSize: 11, background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>python intel_pokemon_center_uk.py pokemon-center-uk</code>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {scraperRuns.map(run => (
              <div key={run.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: run.status === 'success' ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
                <div style={{ ...s, fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{run.retailer?.name || 'Unknown'}</div>
                <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>{run.pages_scraped}p · {run.events_generated}e · {run.alerts_sent}a</div>
                {run.duration_ms && <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>{(run.duration_ms / 1000).toFixed(1)}s</div>}
                <div style={{ ...s, fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(run.run_at)}</div>
                {run.error_message && <div style={{ ...s, fontSize: 10, color: '#ef4444', width: '100%' }}>ERR: {run.error_message.slice(0, 80)}</div>}
              </div>
            ))}
            {scraperRuns.length === 0 && <div style={{ ...s, textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 14 }}>No scraper runs yet.</div>}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddPage && <AddPageModal retailers={retailers} products={products} onAdd={loadAll} onClose={() => setShowAddPage(false)} />}
      {showAddProduct && <AddProductModal sets={sets} onAdd={loadAll} onClose={() => setShowAddProduct(false)} />}
    </div>
  )
}
