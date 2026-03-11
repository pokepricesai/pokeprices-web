'use client'
import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const VENDOR_TYPES = [
  { value: 'physical_shop',   label: '🏪 Physical Shop' },
  { value: 'online_shop',     label: '🌐 Online Shop' },
  { value: 'ebay_store',      label: '🛒 eBay Store' },
  { value: 'retailer',        label: '📦 Retailer' },
  { value: 'grading_service', label: '🏆 Grading Service' },
  { value: 'marketplace',     label: '🔄 Marketplace' },
  { value: 'private_seller',  label: '👤 Private Seller' },
]

const SPECIALISMS = [
  { value: 'singles',     label: 'Singles' },
  { value: 'sealed',      label: 'Sealed Product' },
  { value: 'graded',      label: 'Graded Cards' },
  { value: 'vintage',     label: 'Vintage' },
  { value: 'bulk',        label: 'Bulk' },
  { value: 'accessories', label: 'Accessories' },
]

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '10px 14px', fontSize: 14,
        border: '1px solid var(--border)', borderRadius: 10,
        background: 'var(--bg-light)', color: 'var(--text)',
        fontFamily: "'Figtree', sans-serif", outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

function Textarea({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        width: '100%', padding: '10px 14px', fontSize: 14,
        border: '1px solid var(--border)', borderRadius: 10,
        background: 'var(--bg-light)', color: 'var(--text)',
        fontFamily: "'Figtree', sans-serif", outline: 'none',
        boxSizing: 'border-box', resize: 'vertical',
      }}
    />
  )
}

function Toggle({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 40, height: 22, borderRadius: 99,
          background: checked ? 'var(--primary)' : 'var(--border)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: checked ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </div>
      <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</span>
    </label>
  )
}

export default function VendorSubmitClient() {
  const [form, setForm] = useState({
    name: '',
    vendor_type: '',
    address: '',
    city: '',
    county: '',
    postcode: '',
    country: 'UK',
    website: '',
    ebay_store_url: '',
    phone: '',
    email: '',
    instagram: '',
    facebook: '',
    twitter: '',
    specialisms: [] as string[],
    buys_cards: false,
    runs_tournaments: false,
    ships_internationally: false,
    opening_hours: '',
    description: '',
    submitted_by: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPhysical = ['physical_shop', 'retailer'].includes(form.vendor_type)

  function toggleSpecialism(value: string) {
    setForm(f => ({
      ...f,
      specialisms: f.specialisms.includes(value)
        ? f.specialisms.filter(s => s !== value)
        : [...f.specialisms, value],
    }))
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.vendor_type) {
      setError('Please fill in your store name and type.')
      return
    }
    setSubmitting(true)
    setError(null)

    const { error: err } = await supabase.from('vendors').insert({
      ...form,
      active: false, // requires manual approval
      verified: false,
    })

    if (err) {
      setError('Something went wrong. Please try again.')
      setSubmitting(false)
    } else {
      setSubmitted(true)
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: 600, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, marginBottom: 12, color: 'var(--text)' }}>
          You're on the list!
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, marginBottom: 24 }}>
          We'll review your listing and get it live shortly. Thanks for being part of PokePrices.
        </p>
        <Link href="/vendors" style={{
          background: 'var(--primary)', color: '#fff',
          padding: '10px 24px', borderRadius: 10, textDecoration: 'none',
          fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
        }}>
          View Directory
        </Link>
      </div>
    )
  }

  const section: React.CSSProperties = {
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: 14, padding: '20px 22px', marginBottom: 16,
  }
  const grid2: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14,
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '36px 24px' }}>
      <Link href="/vendors" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 16, display: 'inline-block', fontFamily: "'Figtree', sans-serif" }}>
        ← Back to directory
      </Link>

      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: '12px 0 6px', color: 'var(--text)' }}>
        List Your Store
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', lineHeight: 1.6 }}>
        Free listing in the PokePrices vendor directory. Your store will also be discoverable via our AI chat — collectors searching for shops near them will find you.
      </p>

      {/* Basics */}
      <div style={section}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
          The Basics
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Store / Business Name *</Label>
            <Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Charizard's Den" />
          </div>
          <div>
            <Label>Type *</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VENDOR_TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setForm(f => ({ ...f, vendor_type: t.value }))}
                  className={`sort-btn ${form.vendor_type === t.value ? 'active' : ''}`}
                  style={{ fontFamily: "'Figtree', sans-serif" }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Tell collectors what makes your store special..." />
          </div>
        </div>
      </div>

      {/* Location */}
      <div style={section}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
          Location
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {isPhysical && (
            <div>
              <Label>Street Address</Label>
              <Input value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="123 High Street" />
            </div>
          )}
          <div style={grid2}>
            <div>
              <Label>City / Town</Label>
              <Input value={form.city} onChange={v => setForm(f => ({ ...f, city: v }))} placeholder="Manchester" />
            </div>
            <div>
              <Label>County / Region</Label>
              <Input value={form.county} onChange={v => setForm(f => ({ ...f, county: v }))} placeholder="Greater Manchester" />
            </div>
          </div>
          <div style={grid2}>
            <div>
              <Label>Postcode</Label>
              <Input value={form.postcode} onChange={v => setForm(f => ({ ...f, postcode: v }))} placeholder="M1 1AA" />
            </div>
            <div>
              <Label>Country</Label>
              <select
                value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 14,
                  border: '1px solid var(--border)', borderRadius: 10,
                  background: 'var(--bg-light)', color: 'var(--text)',
                  fontFamily: "'Figtree', sans-serif", outline: 'none',
                }}
              >
                <option value="UK">🇬🇧 UK</option>
                <option value="US">🇺🇸 US</option>
                <option value="EU">🇪🇺 EU</option>
                <option value="AU">🇦🇺 Australia</option>
                <option value="CA">🇨🇦 Canada</option>
                <option value="Other">🌍 Other</option>
              </select>
            </div>
          </div>
          {isPhysical && (
            <div>
              <Label>Opening Hours</Label>
              <Input value={form.opening_hours} onChange={v => setForm(f => ({ ...f, opening_hours: v }))} placeholder="Mon–Sat 10am–6pm, Sun Closed" />
            </div>
          )}
        </div>
      </div>

      {/* Contact & Links */}
      <div style={section}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
          Contact & Links
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={grid2}>
            <div>
              <Label>Website</Label>
              <Input value={form.website} onChange={v => setForm(f => ({ ...f, website: v }))} placeholder="https://yourstore.com" />
            </div>
            <div>
              <Label>eBay Store URL</Label>
              <Input value={form.ebay_store_url} onChange={v => setForm(f => ({ ...f, ebay_store_url: v }))} placeholder="https://ebay.co.uk/str/..." />
            </div>
          </div>
          <div style={grid2}>
            <div>
              <Label>Phone</Label>
              <Input value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="07700 900000" />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" placeholder="hello@yourstore.com" />
            </div>
          </div>
          <div style={grid2}>
            <div>
              <Label>Instagram</Label>
              <Input value={form.instagram} onChange={v => setForm(f => ({ ...f, instagram: v }))} placeholder="@yourstore" />
            </div>
            <div>
              <Label>Twitter / X</Label>
              <Input value={form.twitter} onChange={v => setForm(f => ({ ...f, twitter: v }))} placeholder="@yourstore" />
            </div>
          </div>
        </div>
      </div>

      {/* What you do */}
      <div style={section}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
          What You Sell
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Specialisms (select all that apply)</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              {SPECIALISMS.map(s => (
                <button
                  key={s.value}
                  onClick={() => toggleSpecialism(s.value)}
                  className={`sort-btn ${form.specialisms.includes(s.value) ? 'active' : ''}`}
                  style={{ fontFamily: "'Figtree', sans-serif" }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Toggle checked={form.buys_cards} onChange={v => setForm(f => ({ ...f, buys_cards: v }))} label="We buy cards from collectors" />
            <Toggle checked={form.runs_tournaments} onChange={v => setForm(f => ({ ...f, runs_tournaments: v }))} label="We run tournaments / events" />
            <Toggle checked={form.ships_internationally} onChange={v => setForm(f => ({ ...f, ships_internationally: v }))} label="We ship internationally" />
          </div>
        </div>
      </div>

      {/* Your details */}
      <div style={section}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
          Your Details
        </div>
        <div>
          <Label>Your Name (so we can follow up)</Label>
          <Input value={form.submitted_by} onChange={v => setForm(f => ({ ...f, submitted_by: v }))} placeholder="Jane Smith" />
        </div>
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          width: '100%', padding: '14px', borderRadius: 12,
          background: submitting ? 'var(--border)' : 'var(--primary)',
          color: '#fff', fontSize: 15, fontWeight: 800,
          fontFamily: "'Figtree', sans-serif", border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {submitting ? 'Submitting...' : 'Submit for Review'}
      </button>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        Listings are reviewed before going live. We'll be in touch if we need anything.
      </p>
    </div>
  )
}
