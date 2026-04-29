'use client'
import { useEffect, useRef } from 'react'
import Link from 'next/link'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import VendorSchema from '@/components/VendorSchema'

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

function Panel({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px', ...style }}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.8, color: 'var(--text-muted)', marginBottom: 14, fontFamily: "'Figtree', sans-serif" }}>
      {children}
    </div>
  )
}

function MapEmbed({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', height: 300 }}>
      <iframe
        width="100%"
        height="300"
        style={{ border: 0 }}
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.01}%2C${lng + 0.01}%2C${lat + 0.01}&layer=mapnik&marker=${lat}%2C${lng}`}
        title={`Map showing location of ${name}`}
      />
    </div>
  )
}

export default function VendorDetailClient({ vendor }: { vendor: any }) {
  const isPhysical = ['physical_shop', 'retailer'].includes(vendor.vendor_type)
  const isGrader = vendor.vendor_type === 'grading_service'
  const hasMap = vendor.latitude && vendor.longitude && isPhysical && !vendor.multiple_locations
  const location = [vendor.address, vendor.city, vendor.county, vendor.postcode, vendor.country].filter(Boolean).join(', ')

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '36px 24px' }}>
      <BreadcrumbSchema items={[
        { name: 'Vendors', url: '/vendors' },
        { name: vendor.name },
      ]} />
      <VendorSchema vendor={vendor} />
      <Link href="/vendors" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 16, display: 'inline-block', fontFamily: "'Figtree', sans-serif" }}>
        ← Back to directory
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: 0, color: 'var(--text)' }}>
            {vendor.name}
          </h1>
          {vendor.verified && (
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.08)', padding: '3px 10px', borderRadius: 20, fontFamily: "'Figtree', sans-serif" }}>
              ✓ VERIFIED
            </span>
          )}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>{VENDOR_TYPE_LABELS[vendor.vendor_type] ?? vendor.vendor_type}</span>
          {location && <span>📍 {location}</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: hasMap ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
        {/* Description */}
        {vendor.description && (
          <Panel>
            <SectionLabel>About</SectionLabel>
            <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, margin: 0 }}>
              {vendor.description}
            </p>
          </Panel>
        )}

        {/* Map */}
        {hasMap && (
          <div>
            <MapEmbed lat={vendor.latitude} lng={vendor.longitude} name={vendor.name} />
            {vendor.store_finder_url && (
              <a href={vendor.store_finder_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'block', textAlign: 'center', marginTop: 8, fontSize: 12, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
                Find all locations →
              </a>
            )}
          </div>
        )}
      </div>

      {/* Specialisms */}
      {!isGrader && vendor.specialisms && vendor.specialisms.length > 0 && (
        <Panel style={{ marginBottom: 16 }}>
          <SectionLabel>What They Sell</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {vendor.specialisms.map((s: string) => (
              <span key={s} style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', color: 'var(--text-muted)' }}>
                {SPECIALISM_LABELS[s] ?? s}
              </span>
            ))}
            {vendor.buys_cards && (
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'rgba(39,174,96,0.08)', border: '1px solid rgba(39,174,96,0.2)', borderRadius: 20, padding: '4px 12px', color: 'var(--green)' }}>
                💰 Buys Cards
              </span>
            )}
            {vendor.runs_tournaments && (
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'rgba(26,95,173,0.08)', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 20, padding: '4px 12px', color: 'var(--primary)' }}>
                🏆 Runs Tournaments
              </span>
            )}
            {vendor.ships_internationally && (
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', color: 'var(--text-muted)' }}>
                ✈️ Ships Worldwide
              </span>
            )}
          </div>
        </Panel>
      )}

      {/* Grading info */}
      {isGrader && (
        <Panel style={{ marginBottom: 16 }}>
          <SectionLabel>Grading Services</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
            {vendor.grading_services && vendor.grading_services.length > 0 && (
              <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Grades Offered</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{vendor.grading_services.join(', ')}</div>
              </div>
            )}
            {vendor.grading_turnaround && (
              <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Turnaround</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{vendor.grading_turnaround}</div>
              </div>
            )}
            {vendor.grading_starting_price && (
              <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Starting Price</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{vendor.grading_starting_price}</div>
              </div>
            )}
          </div>
          {vendor.grading_submission_url && (
            <a href={vendor.grading_submission_url} target="_blank" rel="noopener noreferrer" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--primary)', color: '#fff',
              padding: '8px 18px', borderRadius: 10, textDecoration: 'none',
              fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
            }}>
              Submit Cards for Grading →
            </a>
          )}
        </Panel>
      )}

      {/* Opening hours */}
      {vendor.opening_hours && (
        <Panel style={{ marginBottom: 16 }}>
          <SectionLabel>Opening Hours</SectionLabel>
          <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.7 }}>
            {vendor.opening_hours}
          </p>
        </Panel>
      )}

      {/* Contact & links */}
      <Panel>
        <SectionLabel>Contact & Links</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {vendor.website && (
  <a href={vendor.website.startsWith('http') ? vendor.website : `https://${vendor.website}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--primary)', color: '#fff', padding: '8px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
    🌐 Website
  </a>
)}
          {vendor.ebay_store_url && (
            <a href={vendor.ebay_store_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-light)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
              🛒 eBay Store
            </a>
          )}
          {vendor.instagram && (
            <a href={`https://instagram.com/${vendor.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-light)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
              📸 Instagram
            </a>
          )}
          {vendor.twitter && (
            <a href={`https://twitter.com/${vendor.twitter.replace('@', '')}`} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-light)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
              🐦 Twitter
            </a>
          )}
          {vendor.phone && (
            <a href={`tel:${vendor.phone}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--bg-light)', color: 'var(--text)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>
              📞 {vendor.phone}
            </a>
          )}
        </div>
      </Panel>
    </div>
  )
}
