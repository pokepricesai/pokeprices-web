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

const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'ACE', 'TAG', 'SGC', 'Other']

function slugify(text: string) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
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
        boxSizing: 'border-box' as const,
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
        boxSizing: 'border-box' as const, resize: 'vertical' as const,
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
          position: 'relative' as const, transition: 'background 0.2s', flexShrink: 0, cursor: 'pointer',
        }}
      >
        <div style={{
          position: 'absolute' as const, top: 3, left: checked ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </div>
      <span style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{label}</span>
    </label>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 1.8, color: 'var(--primary)', marginBottom: 16, fontFamily: "'Figtree', sans-serif" }}>
      {children}
    </div>
  )
}

async function geocodeAddress(address: string, city: string, postcode: string, country: string): Promise<{ lat: number; lng: number } | null> {
  const query = [address, city, postcode, country].filter(Boolean).join(', ')
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
    const data = await res.json()
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
  } catch {}
  return null
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
    multiple_locations: false,
    store_finder_url: '',
    grading_services: [] as string[],
    grading_turnaround: '',
    grading_starting_price: '',
    grading_submission_url: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Logo upload state
  const [logoFile,    setLogoFile]    = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoError,   setLogoError]   = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)

  function handleLogoSelect(file: File | null) {
    setLogoError(null)
    if (!file) {
      setLogoFile(null)
      setLogoPreview(null)
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError('Logo must be under 2 MB.')
      return
    }
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
      setLogoError('Please upload a PNG, JPG, WEBP, GIF or SVG.')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = () => setLogoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const isPhysical = ['physical_shop'].includes(form.vendor_type)
  const isRetailer = form.vendor_type === 'retailer'
  const isGrader = form.vendor_type === 'grading_service'
  const isOnline = ['online_shop', 'ebay_store', 'marketplace', 'private_seller'].includes(form.vendor_type)
  const showAddress = (isPhysical || (isRetailer && !form.multiple_locations))
  const showLocation = showAddress || isRetailer || isGrader

  function set(key: string, value: any) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function toggleSpecialism(value: string) {
    setForm(f => ({
      ...f,
      specialisms: f.specialisms.includes(value)
        ? f.specialisms.filter(s => s !== value)
        : [...f.specialisms, value],
    }))
  }

  function toggleGradingService(value: string) {
    setForm(f => ({
      ...f,
      grading_services: f.grading_services.includes(value)
        ? f.grading_services.filter(s => s !== value)
        : [...f.grading_services, value],
    }))
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.vendor_type) {
      setError('Please fill in your store name and type.')
      return
    }
    setSubmitting(true)
    setError(null)

    // Geocode if physical location
    let latitude = null
    let longitude = null
    if (showAddress && form.postcode) {
      const coords = await geocodeAddress(form.address, form.city, form.postcode, form.country)
      if (coords) {
        latitude = coords.lat
        longitude = coords.lng
      }
    }

    // Generate slug
    const slugBase = slugify(`${form.name} ${form.city || form.country}`)

    // Upload logo first (if any). If upload fails we still submit the row,
    // but flag it so the submitter sees what happened.
    let logo_url: string | null = null
    if (logoFile) {
      setUploadingLogo(true)
      try {
        const fd = new FormData()
        fd.append('file', logoFile)
        fd.append('vendor_slug', slugBase)
        const res = await fetch('/api/vendor-logo-upload', { method: 'POST', body: fd })
        const json = await res.json().catch(() => ({}))
        if (res.ok && json.url) {
          logo_url = json.url
        } else {
          setLogoError(json.error || 'Logo upload failed — submission saved without logo.')
        }
      } catch {
        setLogoError('Logo upload failed — submission saved without logo.')
      } finally {
        setUploadingLogo(false)
      }
    }

    const { error: err } = await supabase.from('vendors').insert({
      ...form,
      latitude,
      longitude,
      slug: slugBase,
      active: false,
      verified: false,
      logo_url,
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
          You are on the list!
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, marginBottom: 24 }}>
          We will review your listing and get it live shortly. Thanks for being part of PokePrices.
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
  const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '36px 24px' }}>
      <Link href="/vendors" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 16, display: 'inline-block', fontFamily: "'Figtree', sans-serif" }}>
        ← Back to directory
      </Link>

      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, margin: '12px 0 6px', color: 'var(--text)' }}>
        List Your Store
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', lineHeight: 1.6 }}>
        Free listing in the PokePrices vendor directory. Collectors searching for shops near them will find you via our AI chat and directory.
      </p>

      {/* Basics */}
      <div style={section}>
        <SectionTitle>The Basics</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <Label>Store / Business Name *</Label>
            <Input value={form.name} onChange={v => set('name', v)} placeholder="e.g. Charizard's Den" />
          </div>
          <div>
            <Label>Type *</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {VENDOR_TYPES.map(t => (
                <button key={t.value} onClick={() => set('vendor_type', t.value)}
                  className={`sort-btn ${form.vendor_type === t.value ? 'active' : ''}`}
                  style={{ fontFamily: "'Figtree', sans-serif" }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={v => set('description', v)}
              placeholder={
                isGrader ? 'Tell collectors about your grading service...'
                : isOnline ? 'Tell collectors what you sell and what makes you stand out...'
                : 'Tell collectors what makes your store special...'
              } />
          </div>

          {/* Logo upload */}
          <div>
            <Label>Logo (optional)</Label>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px', background: 'var(--bg-light)',
              border: '1px dashed var(--border)', borderRadius: 10,
            }}>
              {/* Preview */}
              <div style={{
                width: 72, height: 72, borderRadius: 12,
                background: 'var(--card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0,
              }}>
                {logoPreview
                  ? <img src={logoPreview} alt="Logo preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 24, opacity: 0.4 }}>🖼</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--card)',
                  fontSize: 13, fontWeight: 700, color: 'var(--text)',
                  fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                }}>
                  {logoFile ? 'Replace logo' : 'Choose logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={e => handleLogoSelect(e.target.files?.[0] ?? null)}
                    style={{ display: 'none' }}
                  />
                </label>
                {logoFile && (
                  <button
                    onClick={() => handleLogoSelect(null)}
                    style={{
                      marginLeft: 10, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid var(--border)', background: 'transparent',
                      color: 'var(--text-muted)', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', fontFamily: "'Figtree', sans-serif",
                    }}
                  >
                    Remove
                  </button>
                )}
                <p style={{
                  fontSize: 11, color: 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif",
                  margin: '8px 0 0', lineHeight: 1.5,
                }}>
                  PNG, JPG, WEBP, GIF or SVG · max 2 MB. Square images look best — they'll display next to your name in the directory and on your detail page.
                </p>
                {logoFile && (
                  <p style={{
                    fontSize: 11, color: 'var(--text)',
                    fontFamily: "'Figtree', sans-serif", margin: '4px 0 0',
                  }}>
                    {logoFile.name} · {(logoFile.size / 1024).toFixed(0)} KB
                  </p>
                )}
                {logoError && (
                  <p style={{
                    fontSize: 11, color: '#ef4444',
                    fontFamily: "'Figtree', sans-serif", margin: '4px 0 0',
                  }}>
                    {logoError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Location — shown for physical/retailer/grader */}
      {(showLocation || form.vendor_type === '') && form.vendor_type !== '' && (
        <div style={section}>
          <SectionTitle>Location</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Retailer chain toggle */}
            {isRetailer && (
              <Toggle
                checked={form.multiple_locations}
                onChange={v => set('multiple_locations', v)}
                label="We have multiple locations (chain / nationwide)"
              />
            )}

            {/* Chain retailer — coverage + store finder */}
            {isRetailer && form.multiple_locations && (
              <>
                <div>
                  <Label>Coverage Area</Label>
                  <Input value={form.city} onChange={v => set('city', v)} placeholder="e.g. Nationwide UK, or Northern England" />
                </div>
                <div>
                  <Label>Store Finder URL</Label>
                  <Input value={form.store_finder_url} onChange={v => set('store_finder_url', v)} placeholder="https://smythstoys.com/store-finder" />
                </div>
              </>
            )}

            {/* Single location address */}
            {showAddress && (
              <div>
                <Label>Street Address</Label>
                <Input value={form.address} onChange={v => set('address', v)} placeholder="123 High Street" />
              </div>
            )}

            {/* City/county/postcode for physical + graders */}
            {(showAddress || (isGrader && !isOnline)) && (
              <>
                <div style={grid2}>
                  <div>
                    <Label>City / Town</Label>
                    <Input value={form.city} onChange={v => set('city', v)} placeholder="Manchester" />
                  </div>
                  <div>
                    <Label>County / Region</Label>
                    <Input value={form.county} onChange={v => set('county', v)} placeholder="Greater Manchester" />
                  </div>
                </div>
                <div style={grid2}>
                  <div>
                    <Label>Postcode</Label>
                    <Input value={form.postcode} onChange={v => set('postcode', v)} placeholder="M1 1AA" />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <select value={form.country} onChange={e => set('country', e.target.value)}
                      style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none' }}>
                      <option value="UK">🇬🇧 UK</option>
                      <option value="US">🇺🇸 US</option>
                      <option value="EU">🇪🇺 EU</option>
                      <option value="AU">🇦🇺 Australia</option>
                      <option value="CA">🇨🇦 Canada</option>
                      <option value="Other">🌍 Other</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Country only for online */}
            {isOnline && (
              <div style={{ maxWidth: 200 }}>
                <Label>Country</Label>
                <select value={form.country} onChange={e => set('country', e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none' }}>
                  <option value="UK">🇬🇧 UK</option>
                  <option value="US">🇺🇸 US</option>
                  <option value="EU">🇪🇺 EU</option>
                  <option value="AU">🇦🇺 Australia</option>
                  <option value="CA">🇨🇦 Canada</option>
                  <option value="Other">🌍 Other</option>
                </select>
              </div>
            )}

            {/* Opening hours for physical */}
            {isPhysical && (
              <div>
                <Label>Opening Hours</Label>
                <Input value={form.opening_hours} onChange={v => set('opening_hours', v)} placeholder="Mon–Sat 10am–6pm, Sun Closed" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact & Links */}
      {form.vendor_type && (
        <div style={section}>
          <SectionTitle>Contact & Links</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={grid2}>
              <div>
                <Label>Website</Label>
                <Input value={form.website} onChange={v => set('website', v)} placeholder="https://yourstore.com" />
              </div>
              <div>
                <Label>eBay Store URL</Label>
                <Input value={form.ebay_store_url} onChange={v => set('ebay_store_url', v)} placeholder="https://ebay.co.uk/str/..." />
              </div>
            </div>
            <div style={grid2}>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={v => set('phone', v)} placeholder="07700 900000" />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={v => set('email', v)} type="email" placeholder="hello@yourstore.com" />
              </div>
            </div>
            <div style={grid2}>
              <div>
                <Label>Instagram</Label>
                <Input value={form.instagram} onChange={v => set('instagram', v)} placeholder="@yourstore" />
              </div>
              <div>
                <Label>Twitter / X</Label>
                <Input value={form.twitter} onChange={v => set('twitter', v)} placeholder="@yourstore" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grading-specific section */}
      {isGrader && (
        <div style={section}>
          <SectionTitle>Grading Services</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Label>Grades Offered</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {GRADING_COMPANIES.map(g => (
                  <button key={g} onClick={() => toggleGradingService(g)}
                    className={`sort-btn ${form.grading_services.includes(g) ? 'active' : ''}`}
                    style={{ fontFamily: "'Figtree', sans-serif" }}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div style={grid2}>
              <div>
                <Label>Typical Turnaround</Label>
                <Input value={form.grading_turnaround} onChange={v => set('grading_turnaround', v)} placeholder="e.g. 10–15 business days" />
              </div>
              <div>
                <Label>Starting Price per Card</Label>
                <Input value={form.grading_starting_price} onChange={v => set('grading_starting_price', v)} placeholder="e.g. £12 per card" />
              </div>
            </div>
            <div>
              <Label>Submission Page URL</Label>
              <Input value={form.grading_submission_url} onChange={v => set('grading_submission_url', v)} placeholder="https://yourservice.com/submit" />
            </div>
          </div>
        </div>
      )}

      {/* What you sell — non-graders */}
      {form.vendor_type && !isGrader && (
        <div style={section}>
          <SectionTitle>What You Sell</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Label>Specialisms (select all that apply)</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {SPECIALISMS.map(s => (
                  <button key={s.value} onClick={() => toggleSpecialism(s.value)}
                    className={`sort-btn ${form.specialisms.includes(s.value) ? 'active' : ''}`}
                    style={{ fontFamily: "'Figtree', sans-serif" }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Toggle checked={form.buys_cards} onChange={v => set('buys_cards', v)} label="We buy cards from collectors" />
              {(isPhysical || isRetailer) && (
                <Toggle checked={form.runs_tournaments} onChange={v => set('runs_tournaments', v)} label="We run tournaments / events" />
              )}
              <Toggle checked={form.ships_internationally} onChange={v => set('ships_internationally', v)} label="We ship internationally" />
            </div>
          </div>
        </div>
      )}

      {/* Your details */}
      {form.vendor_type && (
        <div style={section}>
          <SectionTitle>Your Details</SectionTitle>
          <div>
            <Label>Your Name (so we can follow up)</Label>
            <Input value={form.submitted_by} onChange={v => set('submitted_by', v)} placeholder="Jane Smith" />
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
          {error}
        </div>
      )}

      {form.vendor_type && (
        <button onClick={handleSubmit} disabled={submitting} style={{
          width: '100%', padding: '14px', borderRadius: 12,
          background: submitting ? 'var(--border)' : 'var(--primary)',
          color: '#fff', fontSize: 15, fontWeight: 800,
          fontFamily: "'Figtree', sans-serif", border: 'none',
          cursor: submitting ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}>
          {uploadingLogo ? 'Uploading logo…' : submitting ? 'Submitting...' : 'Submit for Review'}
        </button>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
        Listings are reviewed before going live. We will be in touch if we need anything.
      </p>
    </div>
  )
}
