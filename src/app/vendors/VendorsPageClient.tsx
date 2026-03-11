'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const VENDOR_TYPE_LABELS: Record<string, string> = {
  physical_shop:    '🏪 Physical Shop',
  online_shop:      '🌐 Online Shop',
  ebay_store:       '🛒 eBay Store',
  retailer:         '📦 Retailer',
  grading_service:  '🏆 Grading Service',
  marketplace:      '🔄 Marketplace',
  private_seller:   '👤 Private Seller',
}

const SPECIALISM_LABELS: Record<string, string> = {
  singles:     'Singles',
  sealed:      'Sealed',
  graded:      'Graded',
  vintage:     'Vintage',
  bulk:        'Bulk',
  accessories: 'Accessories',
}

interface Vendor {
  id: string
  name: string
  vendor_type: string
  city: string | null
  county: string | null
  country: string
  website: string | null
  ebay_store_url: string | null
  phone: string | null
  instagram: string | null
  specialisms: string[] | null
  buys_cards: boolean
  runs_tournaments: boolean
  ships_internationally: boolean
  description: string | null
  verified: boolean
}

function VendorCard({ vendor }: { vendor: Vendor }) {
  const isPhysical = vendor.vendor_type === 'physical_shop'
  const location = [vendor.city, vendor.county, vendor.country].filter(Boolean).join(', ')
  const mainUrl = vendor.website || vendor.ebay_store_url || null

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <h3 style={{ fontFamily: "'Playfair Display', serif", fontSize: 17, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
              {vendor.name}
            </h3>
            {vendor.verified && (
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.08)', padding: '2px 7px', borderRadius: 20, fontFamily: "'Figtree', sans-serif", letterSpacing: 0.5 }}>
                ✓ VERIFIED
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {VENDOR_TYPE_LABELS[vendor.vendor_type] ?? vendor.vendor_type}
            {location && <span style={{ marginLeft: 8 }}>· 📍 {location}</span>}
          </div>
        </div>
      </div>

      {/* Description */}
      {vendor.description && (
        <p style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, margin: 0 }}>
          {vendor.description}
        </p>
      )}

      {/* Specialisms */}
      {vendor.specialisms && vendor.specialisms.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {vendor.specialisms.map(s => (
            <span key={s} style={{
              fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '2px 10px', color: 'var(--text-muted)',
            }}>
              {SPECIALISM_LABELS[s] ?? s}
            </span>
          ))}
          {vendor.buys_cards && (
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.2)', borderRadius: 20, padding: '2px 10px', color: 'var(--green)' }}>
              💰 Buys Cards
            </span>
          )}
          {vendor.runs_tournaments && (
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'rgba(26,95,173,0.08)', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 20, padding: '2px 10px', color: 'var(--primary)' }}>
              🏆 Tournaments
            </span>
          )}
          {vendor.ships_internationally && (
            <span style={{ fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 20, padding: '2px 10px', color: 'var(--text-muted)' }}>
              ✈️ Ships Worldwide
            </span>
          )}
        </div>
      )}

      {/* Links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        {vendor.website && (
          <a href={vendor.website} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            color: 'var(--primary)', textDecoration: 'none',
            background: 'rgba(26,95,173,0.06)', border: '1px solid rgba(26,95,173,0.15)',
            borderRadius: 8, padding: '5px 12px',
          }}>
            🌐 Website
          </a>
        )}
        {vendor.ebay_store_url && (
          <a href={vendor.ebay_store_url} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            color: 'var(--text)', textDecoration: 'none',
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '5px 12px',
          }}>
            🛒 eBay Store
          </a>
        )}
        {vendor.instagram && (
          <a href={`https://instagram.com/${vendor.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" style={{
            fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            color: 'var(--text)', textDecoration: 'none',
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '5px 12px',
          }}>
            📸 Instagram
          </a>
        )}
        {vendor.phone && (
          <a href={`tel:${vendor.phone}`} style={{
            fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            color: 'var(--text)', textDecoration: 'none',
            background: 'var(--bg-light)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '5px 12px',
          }}>
            📞 {vendor.phone}
          </a>
        )}
      </div>
    </div>
  )
}

export default function VendorsPageClient() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [filtered, setFiltered] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [buyingFilter, setBuyingFilter] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('vendors')
        .select('*')
        .eq('active', true)
        .order('verified', { ascending: false })
        .order('name', { ascending: true })
      setVendors(data ?? [])
      setFiltered(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    let result = [...vendors]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(v =>
        v.name.toLowerCase().includes(q) ||
        v.city?.toLowerCase().includes(q) ||
        v.county?.toLowerCase().includes(q) ||
        v.description?.toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') {
      result = result.filter(v => v.vendor_type === typeFilter)
    }
    if (buyingFilter) {
      result = result.filter(v => v.buys_cards)
    }
    setFiltered(result)
  }, [search, typeFilter, buyingFilter, vendors])

  const typeCounts = vendors.reduce((acc, v) => {
    acc[v.vendor_type] = (acc[v.vendor_type] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, margin: '0 0 8px', color: 'var(--text)' }}>
          Vendor Directory
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: '0 0 16px' }}>
          Pokémon card shops, online stores, eBay sellers and grading services.
        </p>
        <Link href="/vendors/submit" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'var(--primary)', color: '#fff',
          padding: '8px 18px', borderRadius: 10, textDecoration: 'none',
          fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
        }}>
          + List Your Store — It's Free
        </Link>
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, city, or type..."
          style={{
            flex: 1, minWidth: 220, padding: '10px 16px', fontSize: 14,
            border: '1px solid var(--border)', borderRadius: 10,
            background: 'var(--card)', color: 'var(--text)',
            fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            onClick={() => setTypeFilter('all')}
            className={`sort-btn ${typeFilter === 'all' ? 'active' : ''}`}
            style={{ fontFamily: "'Figtree', sans-serif" }}
          >
            All ({vendors.length})
          </button>
          {Object.entries(VENDOR_TYPE_LABELS).map(([key, label]) => {
            const count = typeCounts[key] ?? 0
            if (count === 0) return null
            return (
              <button
                key={key}
                onClick={() => setTypeFilter(key)}
                className={`sort-btn ${typeFilter === key ? 'active' : ''}`}
                style={{ fontFamily: "'Figtree', sans-serif" }}
              >
                {label} ({count})
              </button>
            )
          })}
        </div>
        <button
          onClick={() => setBuyingFilter(b => !b)}
          className={`sort-btn ${buyingFilter ? 'active' : ''}`}
          style={{ fontFamily: "'Figtree', sans-serif" }}
        >
          💰 Buying Cards
        </button>
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 14 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '48px 24px', textAlign: 'center',
        }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", marginBottom: 16 }}>
            {vendors.length === 0
              ? 'No vendors listed yet — be the first!'
              : 'No vendors match your search.'}
          </p>
          <Link href="/vendors/submit" style={{
            background: 'var(--primary)', color: '#fff',
            padding: '8px 18px', borderRadius: 10, textDecoration: 'none',
            fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
          }}>
            List Your Store
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 4px' }}>
            {filtered.length} vendor{filtered.length !== 1 ? 's' : ''}
          </p>
          {filtered.map(v => <VendorCard key={v.id} vendor={v} />)}
        </div>
      )}
    </div>
  )
}
