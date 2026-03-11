'use client'
import { useState, useEffect, useRef } from 'react'
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
  sealed:      'Sealed Product',
  graded:      'Graded Cards',
  vintage:     'Vintage',
  bulk:        'Bulk',
  accessories: 'Accessories',
}

const FILTER_TYPES = [
  { value: 'all',             label: 'All' },
  { value: 'physical_shop',   label: '🏪 Shops' },
  { value: 'retailer',        label: '📦 Retailers' },
  { value: 'grading_service', label: '🏆 Grading' },
]

interface Vendor {
  id: string
  name: string
  slug: string
  vendor_type: string
  address: string | null
  city: string | null
  county: string | null
  postcode: string | null
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
  multiple_locations: boolean
  store_finder_url: string | null
  grading_services: string[] | null
  distance_miles: number | null
}

interface Suggestion {
  display_name: string
  lat: string
  lon: string
}

async function geocodeLocation(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
  } catch {}
  return null
}

function VendorCard({ vendor }: { vendor: Vendor }) {
  const location = [vendor.city, vendor.county].filter(Boolean).join(', ')
  const isChain = vendor.multiple_locations

  return (
    <Link href={`/vendors/${vendor.slug}`} style={{ textDecoration: 'none' }}>
      <div
        style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: 10,
          transition: 'border-color 0.15s, transform 0.15s', cursor: 'pointer',
        }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = 'var(--primary)'
          el.style.transform = 'translateY(-2px)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = 'var(--border)'
          el.style.transform = 'translateY(0)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
              <h3 style={{
                fontFamily: "'Playfair Display', serif", fontSize: 17,
                fontWeight: 700, color: 'var(--text)', margin: 0,
              }}>
                {vendor.name}
              </h3>
              {vendor.verified && (
                <span style={{
                  fontSize: 10, fontWeight: 800, color: 'var(--primary)',
                  background: 'rgba(26,95,173,0.08)', padding: '2px 7px',
                  borderRadius: 20, fontFamily: "'Figtree', sans-serif", letterSpacing: 0.5,
                }}>
                  ✓ VERIFIED
                </span>
              )}
            </div>
            <div style={{
              fontSize: 12, color: 'var(--text-muted)',
              fontFamily: "'Figtree', sans-serif",
              display: 'flex', gap: 10, flexWrap: 'wrap',
            }}>
              <span>{VENDOR_TYPE_LABELS[vendor.vendor_type] ?? vendor.vendor_type}</span>
              {isChain
                ? <span>📍 Multiple locations</span>
                : location && <span>📍 {location}</span>}
              {vendor.country && !isChain && (
                <span style={{ opacity: 0.6 }}>{vendor.country}</span>
              )}
            </div>
          </div>

          {/* Distance badge */}
          {vendor.distance_miles != null && (
            <div style={{
              background: vendor.distance_miles < 10
                ? 'rgba(39,174,96,0.08)' : 'var(--bg-light)',
              border: `1px solid ${vendor.distance_miles < 10
                ? 'rgba(39,174,96,0.2)' : 'var(--border)'}`,
              borderRadius: 10, padding: '6px 12px',
              textAlign: 'center', flexShrink: 0,
            }}>
              <div style={{
                fontSize: 16, fontWeight: 800,
                color: vendor.distance_miles < 10 ? 'var(--green)' : 'var(--text)',
                fontFamily: "'Figtree', sans-serif", lineHeight: 1,
              }}>
                {vendor.distance_miles}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)',
                fontFamily: "'Figtree', sans-serif", fontWeight: 700,
              }}>
                miles
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        {vendor.description && (
          <p style={{
            fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
            lineHeight: 1.6, margin: 0,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as any, overflow: 'hidden',
          }}>
            {vendor.description}
          </p>
        )}

        {/* Tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {vendor.specialisms?.map(s => (
            <span key={s} style={{
              fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              borderRadius: 20, padding: '2px 10px', color: 'var(--text-muted)',
            }}>
              {SPECIALISM_LABELS[s] ?? s}
            </span>
          ))}
          {vendor.grading_services && vendor.grading_services.length > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
              background: 'rgba(26,95,173,0.06)', border: '1px solid rgba(26,95,173,0.15)',
              borderRadius: 20, padding: '2px 10px', color: 'var(--primary)',
            }}>
              {vendor.grading_services.join(' · ')}
            </span>
          )}
          {vendor.buys_cards && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
              background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.2)',
              borderRadius: 20, padding: '2px 10px', color: 'var(--green)',
            }}>
              💰 Buys Cards
            </span>
          )}
          {vendor.runs_tournaments && (
            <span style={{
              fontSize: 11, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
              background: 'rgba(26,95,173,0.08)', border: '1px solid rgba(26,95,173,0.2)',
              borderRadius: 20, padding: '2px 10px', color: 'var(--primary)',
            }}>
              🏆 Tournaments
            </span>
          )}
        </div>

        {isChain && vendor.store_finder_url && (
          <div style={{
            fontSize: 12, color: 'var(--primary)',
            fontFamily: "'Figtree', sans-serif", fontWeight: 600,
          }}>
            Find nearest location →
          </div>
        )}
      </div>
    </Link>
  )
}

export default function VendorsPageClient() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [chainVendors, setChainVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [locationQuery, setLocationQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeError, setGeocodeError] = useState(false)
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    loadVendors(null, 'all')
  }, [])

  useEffect(() => {
    loadVendors(userCoords, typeFilter)
  }, [typeFilter])

  async function loadVendors(
    coords: { lat: number; lng: number } | null,
    type: string
  ) {
    setLoading(true)
    if (coords) {
      const { data } = await supabase.rpc('get_vendors_by_proximity', {
        user_lat: coords.lat,
        user_lng: coords.lng,
        vendor_type_filter: type,
      })
      const all = (data ?? []) as Vendor[]
      setVendors(all.filter(v => !v.multiple_locations))
      setChainVendors(all.filter(v => v.multiple_locations))
    } else {
      let query = supabase
        .from('vendors')
        .select('*')
        .eq('active', true)
        .not('vendor_type', 'in', '(online_shop,ebay_store,marketplace,private_seller)')
        .order('verified', { ascending: false })
        .order('name', { ascending: true })
      if (type !== 'all') query = query.eq('vendor_type', type)
      const { data } = await query
      const all = (data ?? []) as Vendor[]
      setVendors(all.filter(v => !v.multiple_locations))
      setChainVendors(all.filter(v => v.multiple_locations))
    }
    setLoading(false)
  }

  function handleLocationInput(val: string) {
    setLocationQuery(val)
    setGeocodeError(false)
    if (val.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=6&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        )
        const data = await res.json()
        setSuggestions(data ?? [])
        setShowSuggestions(true)
      } catch {}
    }, 300)
  }

  function selectSuggestion(s: Suggestion) {
    const coords = { lat: parseFloat(s.lat), lng: parseFloat(s.lon) }
    const parts = s.display_name.split(',')
    const shortName = parts.slice(0, 2).join(',').trim()
    setLocationQuery(shortName)
    setUserCoords(coords)
    setHasSearched(true)
    setSuggestions([])
    setShowSuggestions(false)
    loadVendors(coords, typeFilter)
  }

  async function handleManualSearch() {
    if (!locationQuery.trim()) return
    setGeocoding(true)
    setGeocodeError(false)
    const coords = await geocodeLocation(locationQuery)
    if (!coords) {
      setGeocodeError(true)
      setGeocoding(false)
      return
    }
    setUserCoords(coords)
    setHasSearched(true)
    setGeocoding(false)
    loadVendors(coords, typeFilter)
  }

  function handleClearLocation() {
    setUserCoords(null)
    setLocationQuery('')
    setHasSearched(false)
    setGeocodeError(false)
    setSuggestions([])
    setShowSuggestions(false)
    loadVendors(null, typeFilter)
  }

  const totalCount = vendors.length + chainVendors.length

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Playfair Display', serif", fontSize: 32,
          margin: '0 0 8px', color: 'var(--text)',
        }}>
          Vendor Directory
        </h1>
        <p style={{
          color: 'var(--text-muted)', fontSize: 14,
          fontFamily: "'Figtree', sans-serif", margin: '0 0 16px',
        }}>
          Find Pokémon card shops, retailers and grading services near you.
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

      {/* Location search */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '18px 20px', marginBottom: 16,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const,
          letterSpacing: 1.8, color: 'var(--text-muted)', marginBottom: 10,
          fontFamily: "'Figtree', sans-serif",
        }}>
          📍 Find Nearest Vendors
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>

          {/* Input + dropdown wrapper */}
          <div style={{ flex: 1, minWidth: 240, position: 'relative' as const }}>
            <input
              value={locationQuery}
              onChange={e => handleLocationInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  setShowSuggestions(false)
                  handleManualSearch()
                }
                if (e.key === 'Escape') setShowSuggestions(false)
              }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="Enter postcode, town or city (UK or US)..."
              style={{
                width: '100%', padding: '10px 16px', fontSize: 14,
                border: `1px solid ${geocodeError ? '#ef4444' : 'var(--border)'}`,
                borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif", outline: 'none',
                boxSizing: 'border-box' as const,
              }}
            />

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div style={{
                position: 'absolute' as const, top: '100%', left: 0, right: 0,
                zIndex: 100, background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 10,
                marginTop: 4, overflow: 'hidden',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
              }}>
                {suggestions.map((s, i) => {
                  const parts = s.display_name.split(',')
                  const title = parts[0].trim()
                  const subtitle = parts.slice(1, 3).join(',').trim()
                  return (
                    <div
                      key={i}
                      onMouseDown={() => selectSuggestion(s)}
                      style={{
                        padding: '10px 16px', fontSize: 13, cursor: 'pointer',
                        fontFamily: "'Figtree', sans-serif", color: 'var(--text)',
                        borderBottom: i < suggestions.length - 1
                          ? '1px solid var(--border)' : 'none',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{title}</div>
                      {subtitle && (
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
                        }}>
                          {subtitle}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => { setShowSuggestions(false); handleManualSearch() }}
            disabled={geocoding || !locationQuery.trim()}
            style={{
              padding: '10px 20px', borderRadius: 10, border: 'none',
              background: 'var(--primary)', color: '#fff',
              fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
              cursor: geocoding ? 'wait' : 'pointer',
              whiteSpace: 'nowrap' as const,
              opacity: !locationQuery.trim() ? 0.5 : 1,
            }}
          >
            {geocoding ? 'Finding...' : 'Find Nearest'}
          </button>

          {hasSearched && (
            <button
              onClick={handleClearLocation}
              style={{
                padding: '10px 16px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-light)',
                color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
                fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>

        {geocodeError && (
          <p style={{
            fontSize: 12, color: '#ef4444',
            fontFamily: "'Figtree', sans-serif", margin: '8px 0 0',
          }}>
            Could not find that location. Try a postcode or city name.
          </p>
        )}
        {hasSearched && !geocodeError && (
          <p style={{
            fontSize: 12, color: 'var(--green)',
            fontFamily: "'Figtree', sans-serif", margin: '8px 0 0', fontWeight: 600,
          }}>
            ✓ Showing nearest vendors to {locationQuery}
          </p>
        )}
      </div>

      {/* Type filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {FILTER_TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className={`sort-btn ${typeFilter === t.value ? 'active' : ''}`}
            style={{ fontFamily: "'Figtree', sans-serif" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 14 }} />
          ))}
        </div>
      ) : totalCount === 0 ? (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '48px 24px', textAlign: 'center',
        }}>
          <p style={{
            color: 'var(--text-muted)', fontSize: 14,
            fontFamily: "'Figtree', sans-serif", marginBottom: 16,
          }}>
            No vendors listed yet — be the first!
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
        <>
          <p style={{
            fontSize: 12, color: 'var(--text-muted)',
            fontFamily: "'Figtree', sans-serif", margin: '0 0 12px',
          }}>
            {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
            {hasSearched ? ' · sorted by distance' : ''}
            {chainVendors.length > 0
              ? ` · ${chainVendors.length} chain retailer${chainVendors.length !== 1 ? 's' : ''}`
              : ''}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {vendors.map(v => <VendorCard key={v.id} vendor={v} />)}
          </div>

          {/* Chain retailers */}
          {chainVendors.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <div style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif", letterSpacing: 0.5,
                }}>
                  📦 CHAIN RETAILERS & NATIONWIDE STORES
                </div>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {chainVendors.map(v => <VendorCard key={v.id} vendor={v} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
