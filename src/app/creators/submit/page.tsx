'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SPECIALISMS = [
  'Vintage', 'Modern', 'Grading', 'Investing', 'Pack Opening',
  'Collecting', 'Competitive', 'Japanese Cards', 'Sealed Product',
]

const PLATFORMS = ['YouTube', 'X/Twitter', 'TikTok', 'Instagram', 'Reddit', 'Twitch', 'Podcast']

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export default function SubmitCreatorPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [country, setCountry] = useState('')
  const [specialisms, setSpecialisms] = useState<string[]>([])
  const [platforms, setPlatforms] = useState<{ name: string; url: string }[]>([{ name: '', url: '' }])
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function toggleSpecialism(s: string) {
    setSpecialisms(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  function updatePlatform(i: number, field: 'name' | 'url', value: string) {
    setPlatforms(prev => prev.map((p, idx) => idx === i ? { ...p, [field]: value } : p))
  }

  function addPlatform() {
    setPlatforms(prev => [...prev, { name: '', url: '' }])
  }

  function removePlatform(i: number) {
    setPlatforms(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setError('Image must be under 5MB'); return }
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (platforms.filter(p => p.name && p.url).length === 0) { setError('At least one platform link is required'); return }

    setSubmitting(true)
    try {
      let image_url = ''

      if (imageFile) {
        const ext = imageFile.name.split('.').pop()
        const path = `${slugify(name)}-${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('creator-images')
          .upload(path, imageFile, { upsert: true })
        if (uploadError) throw new Error('Image upload failed: ' + uploadError.message)
        const { data: urlData } = supabase.storage.from('creator-images').getPublicUrl(path)
        image_url = urlData.publicUrl
      }

      const slug = slugify(name) + '-' + Date.now().toString(36)
      const validPlatforms = platforms.filter(p => p.name && p.url)

      const { error: insertError } = await supabase.from('creators').insert({
        name: name.trim(),
        slug,
        description: description.trim(),
        country: country.trim(),
        specialisms,
        platforms: validPlatforms,
        image_url,
        status: 'pending',
      })

      if (insertError) throw new Error(insertError.message)
      setDone(true)
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    }
    setSubmitting(false)
  }

  if (done) {
    return (
      <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 12px' }}>Submission received!</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, fontFamily: "'Figtree', sans-serif", marginBottom: 24 }}>
          Your profile is under review and will appear in the directory once approved. Usually 1-2 days.
        </p>
        <button onClick={() => router.push('/creators')} style={{
          background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 12,
          padding: '12px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          fontFamily: "'Figtree', sans-serif",
        }}>View Creator Directory</button>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: 'var(--text)', fontSize: 14, fontFamily: "'Figtree', sans-serif",
    outline: 'none', boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
    marginBottom: 6, fontFamily: "'Figtree', sans-serif",
    textTransform: 'uppercase' as const, letterSpacing: 0.8,
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px 60px' }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 8px' }}>
          Submit Your Channel
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: 0 }}>
          Get listed in the PokePrices creator directory. Free, no strings attached. Reviewed before going live.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Channel or creator name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. PokeRev, Leonhart, FlowWithThePoke" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Profile photo or logo</label>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {imagePreview && (
              <img src={imagePreview} alt="Preview" style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border)' }} />
            )}
            <label style={{
              display: 'inline-block', padding: '10px 18px', background: 'var(--bg-light)',
              border: '1px dashed var(--border)', borderRadius: 10, cursor: 'pointer',
              fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
            }}>
              {imageFile ? imageFile.name : 'Choose image (max 5MB)'}
              <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>About your channel</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What kind of content do you make? Who is it for?"
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' as const }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Country</label>
          <input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. United Kingdom, USA, Australia" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Content focus (select all that apply)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SPECIALISMS.map(s => (
              <button key={s} type="button" onClick={() => toggleSpecialism(s)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'Figtree', sans-serif",
                border: '1px solid var(--border)',
                background: specialisms.includes(s) ? 'var(--primary)' : 'var(--bg-light)',
                color: specialisms.includes(s) ? '#fff' : 'var(--text)',
                transition: 'all 0.15s',
              }}>{s}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>Your links *</label>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px', fontFamily: "'Figtree', sans-serif" }}>
            Add all your channels — YouTube, TikTok, X, wherever you post.
          </p>
          {platforms.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select value={p.name} onChange={e => updatePlatform(i, 'name', e.target.value)}
                style={{ ...inputStyle, width: 140, flexShrink: 0 }}>
                <option value="">Platform</option>
                {PLATFORMS.map(pl => <option key={pl} value={pl}>{pl}</option>)}
              </select>
              <input value={p.url} onChange={e => updatePlatform(i, 'url', e.target.value)}
                placeholder="https://..." style={{ ...inputStyle, flex: 1 }} />
              {platforms.length > 1 && (
                <button type="button" onClick={() => removePlatform(i)} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, flexShrink: 0,
                }}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addPlatform} style={{
            background: 'none', border: '1px dashed var(--border)', borderRadius: 10,
            padding: '8px 16px', cursor: 'pointer', color: 'var(--text-muted)',
            fontSize: 13, fontFamily: "'Figtree', sans-serif", fontWeight: 600, marginTop: 4,
          }}>+ Add another platform</button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 16,
            fontSize: 13, color: '#dc2626', fontFamily: "'Figtree', sans-serif",
          }}>{error}</div>
        )}

        <button type="submit" disabled={submitting} style={{
          width: '100%', background: 'var(--primary)', color: '#fff',
          border: 'none', borderRadius: 12, padding: '14px',
          fontSize: 15, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer',
          fontFamily: "'Figtree', sans-serif", opacity: submitting ? 0.7 : 1,
        }}>{submitting ? 'Submitting...' : 'Submit for review'}</button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, fontFamily: "'Figtree', sans-serif" }}>
          Reviewed before going live. No spam, no follow-for-follow.
        </p>
      </form>
    </div>
  )
}
