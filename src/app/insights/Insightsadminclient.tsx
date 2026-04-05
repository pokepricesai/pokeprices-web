'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Article {
  id: string
  slug: string
  headline: string
  intro: string
  theme: string
  theme_label: string
  status: string
  published_at: string | null
  created_at: string
  image_url: string | null
  author: string | null
  read_time_mins: number | null
  meta_title: string | null
  meta_description: string | null
  body_json: any
}

const THEMES = [
  { value: 'grading',    label: 'Grading & PSA'       },
  { value: 'collecting', label: 'Collecting Strategy'  },
  { value: 'market',     label: 'Market Analysis'      },
  { value: 'vintage',    label: 'Vintage Cards'        },
  { value: 'modern',     label: 'Modern Sets'          },
  { value: 'investing',  label: 'Investing'            },
  { value: 'community',  label: 'Community'            },
]

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
}

function estimateReadTime(text: string): number {
  return Math.max(1, Math.round(text.split(/\s+/).length / 200))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── AI Writing Assistant (calls Claude via Anthropic API) ─────────────────────

async function generateWithAI(prompt: string, system: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) { onLogin() }
    else { setErr(true); setPw('') }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 48px', width: 360, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 4px', color: 'var(--text)' }}>Insights Admin</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 28px' }}>PokePrices content management</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(false) }}
            placeholder="Password"
            autoFocus
            style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
          />
          {err && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>Incorrect password</p>}
          <button type="submit" style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Article Editor ────────────────────────────────────────────────────────────

function ArticleEditor({ article, onSave, onBack }: {
  article: Partial<Article> | null
  onSave: (a: Partial<Article>) => Promise<void>
  onBack: () => void
}) {
  const isNew = !article?.id
  const [form, setForm] = useState<Partial<Article>>({
    headline: '', intro: '', theme: 'market', theme_label: 'Market Analysis',
    status: 'draft', author: 'PokePrices Team', meta_title: '', meta_description: '',
    image_url: null, body_json: { blocks: [] },
    ...article,
  })
  const [bodyText, setBodyText] = useState<string>(
    article?.body_json?.blocks?.map((b: any) => b.text).join('\n\n') || ''
  )
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function update(key: keyof Article, val: any) {
    setForm(f => ({ ...f, [key]: val }))
  }

  // Auto-generate slug from headline
  useEffect(() => {
    if (isNew && form.headline) update('slug', slugify(form.headline))
  }, [form.headline])

  // Auto-estimate read time
  useEffect(() => {
    const allText = (form.intro || '') + ' ' + bodyText
    update('read_time_mins', estimateReadTime(allText))
  }, [form.intro, bodyText])

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUploading(true)
    const ext = file.name.split('.').pop()
    const path = `insights/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('creator-images').upload(path, file, { upsert: true })
    if (!error) {
      const { data: urlData } = supabase.storage.from('creator-images').getPublicUrl(path)
      update('image_url', urlData.publicUrl)
    }
    setImageUploading(false)
  }

  async function aiGenerate(type: 'intro' | 'body' | 'meta') {
    if (!form.headline) { alert('Add a headline first'); return }
    setAiLoading(type)

    const system = `You are a writer for PokePrices.io — a UK-focused Pokémon TCG price and market intelligence site. 
Write in a knowledgeable, direct, collector-friendly tone. No hype, no waffle, no AI-sounding preamble. 
Write as if a well-informed collector is talking to other collectors. 
Use UK English. Never say "delve", "realm", "embark", "unleash", or similar AI clichés.`

    try {
      if (type === 'intro') {
        const text = await generateWithAI(
          `Write a 2-3 sentence introduction for an article titled "${form.headline}" about ${form.theme_label}. 
           Hook the reader with a specific, concrete observation. Don't start with "In the world of".`,
          system
        )
        update('intro', text.trim())

      } else if (type === 'body') {
        const text = await generateWithAI(
          `Write a full article body for "${form.headline}".
           Theme: ${form.theme_label}.
           ${form.intro ? `Intro already written: "${form.intro}"` : ''}
           
           Write 400-600 words. Structure with 3-4 clear sections. Each section should have a short bold heading followed by 2-3 paragraphs.
           Focus on practical, actionable information for collectors. Use specific examples where possible.
           Format: use ## for section headings, regular paragraphs otherwise. No bullet points.`,
          system
        )
        setBodyText(text.trim())

      } else if (type === 'meta') {
        const text = await generateWithAI(
          `Write SEO meta title and description for: "${form.headline}"
           Theme: ${form.theme_label}
           
           Return ONLY this format (no other text):
           TITLE: [60 char max title]
           DESC: [155 char max description]`,
          system
        )
        const titleMatch = text.match(/TITLE:\s*(.+)/i)
        const descMatch  = text.match(/DESC:\s*(.+)/i)
        if (titleMatch) update('meta_title', titleMatch[1].trim())
        if (descMatch)  update('meta_description', descMatch[1].trim())
      }
    } catch (e) {
      alert('AI generation failed — check your API key')
    }
    setAiLoading(null)
  }

  async function handleSave(status: 'draft' | 'published') {
    if (!form.headline?.trim()) { alert('Headline is required'); return }
    setSaving(true)

    // Convert body text to block format
    const blocks = bodyText.split('\n\n').filter(Boolean).map((text, i) => ({
      id: String(i), type: text.startsWith('## ') ? 'heading' : 'paragraph',
      text: text.replace(/^## /, ''),
    }))

    const toSave: Partial<Article> = {
      ...form,
      status,
      body_json: { blocks },
      slug: form.slug || slugify(form.headline || ''),
      published_at: status === 'published' ? (form.published_at || new Date().toISOString()) : form.published_at,
    }

    await onSave(toSave)
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
    letterSpacing: 1, marginBottom: 6, display: 'block', fontFamily: "'Figtree', sans-serif",
  }
  const aiBtnStyle: React.CSSProperties = {
    padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,203,5,0.3)',
    background: 'rgba(255,203,5,0.08)', color: 'var(--accent)', fontSize: 11,
    fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', whiteSpace: 'nowrap',
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button onClick={onBack} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          ← Back
        </button>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: 0, color: 'var(--text)', flex: 1 }}>
          {isNew ? 'New Article' : 'Edit Article'}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => handleSave('draft')} disabled={saving} style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Save Draft
          </button>
          <button onClick={() => handleSave('published')} disabled={saving} style={{ padding: '8px 18px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            {saving ? 'Saving…' : form.status === 'published' ? 'Update' : 'Publish'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Headline */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <label style={labelStyle}>Headline *</label>
            <input value={form.headline || ''} onChange={e => update('headline', e.target.value)}
              placeholder="e.g. Why Base Set Charizard Is Still Worth Grading in 2025"
              style={{ ...inputStyle, fontSize: 18, fontWeight: 700, fontFamily: "'Outfit', sans-serif" }} />
          </div>

          {/* Intro */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Introduction</label>
              <button style={aiBtnStyle} onClick={() => aiGenerate('intro')} disabled={!!aiLoading}>
                {aiLoading === 'intro' ? '⏳ Writing…' : '✨ Write with AI'}
              </button>
            </div>
            <textarea value={form.intro || ''} onChange={e => update('intro', e.target.value)}
              placeholder="Hook the reader in 2-3 sentences…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          {/* Body */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Article Body</label>
              <button style={aiBtnStyle} onClick={() => aiGenerate('body')} disabled={!!aiLoading}>
                {aiLoading === 'body' ? '⏳ Writing…' : '✨ Write with AI'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 10px' }}>
              Use ## for section headings. Separate paragraphs with a blank line.
            </p>
            <textarea value={bodyText} onChange={e => setBodyText(e.target.value)}
              placeholder="## Section Heading&#10;&#10;Your paragraph here...&#10;&#10;## Next Section&#10;&#10;More content..."
              rows={20}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.7, fontFamily: 'monospace', fontSize: 13 }} />
          </div>

          {/* Hero image */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <label style={labelStyle}>Hero Image</label>
            {form.image_url ? (
              <div style={{ position: 'relative', marginBottom: 10 }}>
                <img src={form.image_url} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 10 }} />
                <button onClick={() => update('image_url', null)}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif" }}>
                  Remove
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                style={{ border: '2px dashed var(--border)', borderRadius: 10, padding: '32px', textAlign: 'center', cursor: 'pointer', marginBottom: 10, transition: 'border-color 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--primary)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>{imageUploading ? '⏳' : '📷'}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                  {imageUploading ? 'Uploading…' : 'Click to upload image'}
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Or paste URL:</span>
              <input value={form.image_url || ''} onChange={e => update('image_url', e.target.value)}
                placeholder="https://…"
                style={{ ...inputStyle, fontSize: 12, flex: 1 }} />
            </div>
          </div>

        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Status */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <label style={labelStyle}>Status</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['draft', 'published'] as const).map(s => (
                <button key={s} onClick={() => update('status', s)}
                  style={{ flex: 1, padding: '8px', borderRadius: 8, border: form.status === s ? '1px solid var(--primary)' : '1px solid var(--border)', background: form.status === s ? 'rgba(26,95,173,0.08)' : 'transparent', color: form.status === s ? 'var(--primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', textTransform: 'capitalize' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <label style={labelStyle}>Theme</label>
            <select value={form.theme || 'market'} onChange={e => {
              const t = THEMES.find(th => th.value === e.target.value)
              update('theme', e.target.value)
              if (t) update('theme_label', t.label)
            }} style={{ ...inputStyle, cursor: 'pointer' }}>
              {THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {/* Slug */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <label style={labelStyle}>URL Slug</label>
            <input value={form.slug || ''} onChange={e => update('slug', e.target.value)}
              placeholder="auto-generated"
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }} />
            {form.slug && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontFamily: 'monospace' }}>/insights/{form.slug}</div>}
          </div>

          {/* Author */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <label style={labelStyle}>Author</label>
            <input value={form.author || ''} onChange={e => update('author', e.target.value)}
              placeholder="PokePrices Team"
              style={inputStyle} />
          </div>

          {/* SEO */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>SEO</label>
              <button style={{ ...aiBtnStyle, fontSize: 10 }} onClick={() => aiGenerate('meta')} disabled={!!aiLoading}>
                {aiLoading === 'meta' ? '⏳' : '✨ AI'}
              </button>
            </div>
            <label style={{ ...labelStyle, fontSize: 10 }}>Meta Title</label>
            <input value={form.meta_title || ''} onChange={e => update('meta_title', e.target.value)}
              placeholder="60 chars max"
              style={{ ...inputStyle, marginBottom: 10, fontSize: 12 }} />
            <label style={{ ...labelStyle, fontSize: 10 }}>Meta Description</label>
            <textarea value={form.meta_description || ''} onChange={e => update('meta_description', e.target.value)}
              placeholder="155 chars max"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontSize: 12 }} />
            {form.meta_description && (
              <div style={{ fontSize: 10, color: (form.meta_description.length > 155) ? '#ef4444' : 'var(--text-muted)', marginTop: 4, fontFamily: "'Figtree', sans-serif" }}>
                {form.meta_description.length}/155
              </div>
            )}
          </div>

          {/* Read time */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
            <label style={labelStyle}>Read Time</label>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
              {form.read_time_mins || 1} min
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Auto-calculated</div>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Article List ──────────────────────────────────────────────────────────────

function ArticleList({ onNew, onEdit }: { onNew: () => void; onEdit: (a: Article) => void }) {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('insights').select('*').order('created_at', { ascending: false })
    if (data) setArticles(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(id: string, headline: string) {
    if (!confirm(`Delete "${headline}"? This cannot be undone.`)) return
    setDeleting(id)
    await supabase.from('insights').delete().eq('id', id)
    setArticles(a => a.filter(x => x.id !== id))
    setDeleting(null)
  }

  async function handleToggleStatus(article: Article) {
    const newStatus = article.status === 'published' ? 'draft' : 'published'
    const updates: any = { status: newStatus }
    if (newStatus === 'published' && !article.published_at) updates.published_at = new Date().toISOString()
    await supabase.from('insights').update(updates).eq('id', article.id)
    setArticles(a => a.map(x => x.id === article.id ? { ...x, ...updates } : x))
  }

  const filtered = articles.filter(a => filter === 'all' || a.status === filter)
  const drafts    = articles.filter(a => a.status === 'draft').length
  const published = articles.filter(a => a.status === 'published').length

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Insights Admin</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            {published} published · {drafts} draft{drafts !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={onNew} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
          + New Article
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {(['all', 'published', 'draft'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '7px 16px', borderRadius: 20, border: filter === f ? '1px solid var(--primary)' : '1px solid var(--border)', background: filter === f ? 'rgba(26,95,173,0.08)' : 'transparent', color: filter === f ? 'var(--primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', textTransform: 'capitalize' }}>
            {f} {f === 'all' ? `(${articles.length})` : f === 'published' ? `(${published})` : `(${drafts})`}
          </button>
        ))}
      </div>

      {/* Article list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✍️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>No articles yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Write your first insight to get started</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(a => (
            <div key={a.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* Image thumb */}
              {a.image_url ? (
                <img src={a.image_url} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 64, height: 48, background: 'var(--bg-light)', borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📝</div>
              )}

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 3 }}>
                  {a.headline || 'Untitled'}
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    {a.theme_label || a.theme}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>·</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    {a.published_at ? formatDate(a.published_at) : formatDate(a.created_at)}
                  </span>
                  {a.read_time_mins && (
                    <>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>·</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{a.read_time_mins} min read</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20,
                  background: a.status === 'published' ? 'rgba(34,197,94,0.1)' : 'rgba(148,163,184,0.1)',
                  color: a.status === 'published' ? '#22c55e' : 'var(--text-muted)',
                  fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  {a.status}
                </span>
                <button onClick={() => onEdit(a)}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                  Edit
                </button>
                <button onClick={() => handleToggleStatus(a)}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                  {a.status === 'published' ? 'Unpublish' : 'Publish'}
                </button>
                {a.status === 'published' && (
                  <a href={`/insights/${a.slug}`} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
                    View ↗
                  </a>
                )}
                <button onClick={() => handleDelete(a.id, a.headline)} disabled={deleting === a.id}
                  style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                  {deleting === a.id ? '…' : '🗑'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InsightsAdminClient() {
  const [authed, setAuthed]     = useState(false)
  const [view, setView]         = useState<'list' | 'edit'>('list')
  const [editing, setEditing]   = useState<Partial<Article> | null>(null)
  const [articles, setArticles] = useState<Article[]>([])

  // Check session storage for auth
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('admin_authed') === '1') setAuthed(true)
  }, [])

  function handleLogin() {
    sessionStorage.setItem('admin_authed', '1')
    setAuthed(true)
  }

  function handleNew() { setEditing(null); setView('edit') }
  function handleEdit(a: Article) { setEditing(a); setView('edit') }
  function handleBack() { setView('list'); setEditing(null) }

  async function handleSave(data: Partial<Article>) {
    if (data.id) {
      const { id, created_at, ...updates } = data as any
      await supabase.from('insights').update(updates).eq('id', id)
    } else {
      await supabase.from('insights').insert([data])
    }
    handleBack()
  }

  if (!authed) return <LoginScreen onLogin={handleLogin} />

  if (view === 'edit') return (
    <ArticleEditor article={editing} onSave={handleSave} onBack={handleBack} />
  )

  return <ArticleList onNew={handleNew} onEdit={handleEdit} />
}
