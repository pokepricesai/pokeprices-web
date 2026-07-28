'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
// Block 5A-W-47C-FIX1 — shared admin header (Admin Home + Return to
// site links). Rendered above the editor / list view so Luke can
// always return to the central dashboard.
import AdminToolHeader from '@/components/admin/AdminToolHeader'
// Block 5A-W-47A — rich-text block editor helpers.
import {
  readParagraphSegments,
  segmentsToEditorHtml,
  domToSegments,
  isSafeArticleHref,
  isSafeArticleImageSrc,
  validateArticleImageFile,
  ARTICLE_IMAGE_MIME_ALLOWLIST,
  type ArticleBlock,
  type ParagraphSegment,
} from '@/lib/insights/richText'

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

// ── W47A block helpers ───────────────────────────────────────────

/** Normalise whatever body_json shape an article carries into an
 *  editable block list. Handles:
 *   * missing / empty body_json               → empty list
 *   * modern { blocks: [...] } array          → preserved as-is
 *   * legacy plain-text single-block          → split on \n\n and
 *                                                 classify headings
 *   * legacy body_json stored as bare array   → wrapped
 */
function loadBlocks(article: Partial<Article> | null | undefined): ArticleBlock[] {
  if (!article || !article.body_json) return []
  const raw = article.body_json
  const blocks: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.blocks) ? raw.blocks : []
  if (blocks.length === 0) return []
  // Legacy plain-text-body case: single paragraph whose text carries
  // \n\n separators. Split so each editable block is one visual unit.
  if (blocks.length === 1
    && (blocks[0].type === 'paragraph' || blocks[0].type === 'text')
    && typeof blocks[0].text === 'string'
    && blocks[0].text.includes('\n\n')
  ) {
    return blocks[0].text.split(/\n\n+/).filter(Boolean).map((chunk: string) => (
      chunk.startsWith('## ')
        ? { type: 'heading', text: chunk.replace(/^##\s*/, '') } as ArticleBlock
        : { type: 'paragraph', text: chunk } as ArticleBlock
    ))
  }
  return blocks as ArticleBlock[]
}

/** Concatenate all readable text out of a block list, used only for
 *  the read-time estimate. */
function blocksToPlainText(blocks: readonly ArticleBlock[]): string {
  const chunks: string[] = []
  for (const b of blocks) {
    if (b.type === 'heading') chunks.push(b.text || '')
    else if (b.type === 'paragraph' || (b as any).type === 'text') {
      const segs = readParagraphSegments(b as any)
      chunks.push(segs.map(s => s.text).join(''))
    } else if (b.type === 'image') {
      if (b.caption) chunks.push(b.caption)
    }
  }
  return chunks.join(' ')
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
  // Block 5A-W-47A — the body is now a typed block list rather than a
  // plain-text textarea. Legacy plain-text bodies (single paragraph
  // with embedded \n\n) are normalised into per-paragraph blocks on
  // load so the editor UX is uniform. Existing rich blocks
  // (heading / paragraph / paragraph.content / image / card_grid /
  // chart) are preserved intact.
  const [blocks, setBlocks] = useState<ArticleBlock[]>(() => loadBlocks(article))
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Estimated read time is derived from intro + all block text.
  const bodyText = blocksToPlainText(blocks)

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
        // W47A: AI output is markdown-ish plain text. Split on \n\n
        // and classify headings so the result appears as separate
        // blocks in the editor. The admin can then style / rewrite
        // any block inline.
        const generated: ArticleBlock[] = text.trim().split(/\n\n+/).filter(Boolean).map((chunk: string) => (
          chunk.startsWith('## ')
            ? { type: 'heading', text: chunk.replace(/^##\s*/, '') } as ArticleBlock
            : { type: 'paragraph', text: chunk } as ArticleBlock
        ))
        setBlocks(generated)

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

    // W47A: save the block list directly. Skip empty paragraph blocks
    // (empty heading blocks are also skipped) so accidentally-added
    // blocks don't clutter the published article.
    const cleanedBlocks = blocks.filter(b => {
      if (b.type === 'heading') return typeof b.text === 'string' && b.text.trim().length > 0
      if (b.type === 'paragraph' || (b as any).type === 'text') {
        const segs = readParagraphSegments(b as any)
        return segs.some(s => s.text && s.text.trim().length > 0)
      }
      if (b.type === 'image') return isSafeArticleImageSrc(b.src)
      return true // preserve legacy card_grid / chart / anything else
    })

    // Image-block alt-text guard: require alt text unless the block
    // explicitly declares itself decorative.
    for (const b of cleanedBlocks) {
      if (b.type === 'image' && !b.decorative && (!b.alt || !b.alt.trim())) {
        alert('Every image block needs alt text (or must be marked decorative).')
        setSaving(false)
        return
      }
    }

    const toSave: Partial<Article> = {
      ...form,
      status,
      body_json: { blocks: cleanedBlocks },
      slug: form.slug || slugify(form.headline || ''),
      published_at: status === 'published' ? (form.published_at || new Date().toISOString()) : form.published_at,
    }

    try {
      await onSave(toSave)
    } catch (e: any) {
      alert('Unexpected error: ' + e.message)
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

          {/* Body — W47A block editor */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Article Body</label>
              <button style={aiBtnStyle} onClick={() => aiGenerate('body')} disabled={!!aiLoading}>
                {aiLoading === 'body' ? '⏳ Writing…' : '✨ Write with AI'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>
              Add heading, paragraph and image blocks below. Paragraphs support bold and inline links.
            </p>
            <BlockListEditor blocks={blocks} onChange={setBlocks} />
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

// ── W47A block editors ────────────────────────────────────────────
//
// A small, focused block-list editor. Keeps the existing visual design
// (card-in-a-card padding, brand colours). Every control has a text
// label; a small handful of Unicode arrows (↑ ↓ ✕) are used purely as
// affordances, not decoration. No third-party editor library, no
// drag-and-drop — plain up/down buttons for reordering.

type BlockListEditorProps = {
  blocks: ArticleBlock[]
  onChange: (next: ArticleBlock[]) => void
}

function BlockListEditor({ blocks, onChange }: BlockListEditorProps) {
  function updateAt(i: number, next: ArticleBlock) {
    const copy = blocks.slice()
    copy[i] = next
    onChange(copy)
  }
  function removeAt(i: number) {
    if (!confirm('Delete this block? This cannot be undone until you close without saving.')) return
    onChange(blocks.filter((_, idx) => idx !== i))
  }
  function moveAt(i: number, direction: -1 | 1) {
    const j = i + direction
    if (j < 0 || j >= blocks.length) return
    const copy = blocks.slice()
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
    onChange(copy)
  }
  function addBlock(kind: 'heading' | 'paragraph' | 'image') {
    const next: ArticleBlock =
      kind === 'heading'   ? { type: 'heading', text: '' }
    : kind === 'paragraph' ? { type: 'paragraph', content: [] }
                           : { type: 'image', src: '', alt: '' }
    onChange([...blocks, next])
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.length === 0 && (
        <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: '24px 18px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontSize: 13 }}>
          No content yet. Add a heading, paragraph or image below.
        </div>
      )}
      {blocks.map((block, i) => (
        <BlockRow
          key={i}
          index={i}
          total={blocks.length}
          block={block}
          onChange={next => updateAt(i, next)}
          onRemove={() => removeAt(i)}
          onMoveUp={() => moveAt(i, -1)}
          onMoveDown={() => moveAt(i, 1)}
        />
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => addBlock('heading')}   style={addBtnStyle}>+ Heading</button>
        <button type="button" onClick={() => addBlock('paragraph')} style={addBtnStyle}>+ Paragraph</button>
        <button type="button" onClick={() => addBlock('image')}     style={addBtnStyle}>+ Image</button>
      </div>
    </div>
  )
}

const addBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
}
const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text-muted)', fontSize: 13,
  fontFamily: "'Figtree', sans-serif", cursor: 'pointer', display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
}
const inputInlineStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 14, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
  boxSizing: 'border-box',
}
const blockContainerStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px',
  background: 'var(--bg-light)',
}

function BlockRow({
  index, total, block, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  index: number
  total: number
  block: ArticleBlock
  onChange: (next: ArticleBlock) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const label =
      block.type === 'heading'   ? 'Heading'
    : block.type === 'paragraph' ? 'Paragraph'
    : block.type === 'image'     ? 'Image'
    : `Legacy (${(block as any).type})`
  return (
    <div style={blockContainerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Block #{index + 1} · {label}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" title="Move up"   onClick={onMoveUp}   disabled={index === 0}         style={iconBtnStyle}>↑</button>
          <button type="button" title="Move down" onClick={onMoveDown} disabled={index === total - 1} style={iconBtnStyle}>↓</button>
          <button type="button" title="Delete block" onClick={onRemove} style={{ ...iconBtnStyle, borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>✕</button>
        </div>
      </div>
      {block.type === 'heading' && (
        <input
          type="text"
          value={block.text || ''}
          onChange={e => onChange({ type: 'heading', text: e.target.value })}
          placeholder="Section heading"
          style={{ ...inputInlineStyle, fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 16 }}
        />
      )}
      {(block.type === 'paragraph' || (block as any).type === 'text') && (
        <ParagraphBlockEditor block={block as any} onChange={onChange} />
      )}
      {block.type === 'image' && (
        <ImageBlockEditor block={block} onChange={onChange} />
      )}
      {block.type !== 'heading' && block.type !== 'paragraph' && (block as any).type !== 'text' && block.type !== 'image' && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", padding: '10px 0' }}>
          Legacy block preserved. Edit body_json directly to modify.
        </div>
      )}
    </div>
  )
}

// ── ParagraphBlockEditor — contentEditable with a small toolbar ────

function ParagraphBlockEditor({
  block, onChange,
}: {
  block: any
  onChange: (next: ArticleBlock) => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const initialHtmlRef = useRef<string | null>(null)
  const savedSelectionRef = useRef<Range | null>(null)

  // Initial HTML rendered ONCE from the segment data. We deliberately
  // do not sync HTML on every re-render — the contentEditable is the
  // source of truth while focused; state is synced back to blocks on
  // blur / on toolbar action.
  if (initialHtmlRef.current === null) {
    const segs = readParagraphSegments(block)
    initialHtmlRef.current = segmentsToEditorHtml(segs) || ''
  }

  const commitFromDom = useCallback(() => {
    if (!editorRef.current) return
    const segs = domToSegments(editorRef.current)
    onChange({ type: 'paragraph', content: segs })
  }, [onChange])

  function saveSelection() {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.rangeCount > 0) savedSelectionRef.current = sel.getRangeAt(0).cloneRange()
  }
  function restoreSelection() {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && savedSelectionRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedSelectionRef.current)
    }
  }

  function applyBold() {
    editorRef.current?.focus()
    restoreSelection()
    // execCommand is deprecated but widely supported and the simplest
    // way to toggle inline bold formatting reliably. React writes
    // nothing to the DOM here — we read back after.
    document.execCommand('bold')
    commitFromDom()
  }
  function applyLink() {
    editorRef.current?.focus()
    restoreSelection()
    const current = document.getSelection()?.toString() || ''
    if (!current.trim()) { alert('Select some text first, then click Add link.'); return }
    const url = prompt('Link URL (starts with "/" for internal or "https://" for external):', '')?.trim()
    if (!url) return
    if (!isSafeArticleHref(url)) {
      alert('That URL was not accepted. Use a /path or a full https:// URL.')
      return
    }
    document.execCommand('createLink', false, url)
    commitFromDom()
  }
  function removeLink() {
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand('unlink')
    commitFromDom()
  }

  // Editable div. We stop React from re-rendering the innerHTML by
  // rendering the initial HTML into a ref-attached div ONCE via
  // dangerouslySetInnerHTML on mount, then never again. This is safe
  // because the HTML is generated by our own escaper.
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button type="button" title="Bold selected text" onMouseDown={e => { e.preventDefault(); saveSelection() }} onClick={applyBold} style={toolbarBtnStyle}>
          <strong>B</strong>&nbsp;Bold
        </button>
        <button type="button" title="Add or edit a link on selected text" onMouseDown={e => { e.preventDefault(); saveSelection() }} onClick={applyLink} style={toolbarBtnStyle}>
          Add link
        </button>
        <button type="button" title="Remove the link from selected text" onMouseDown={e => { e.preventDefault(); saveSelection() }} onClick={removeLink} style={toolbarBtnStyle}>
          Remove link
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={commitFromDom}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        style={{
          minHeight: 88, padding: '10px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--card)',
          color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
          fontSize: 14, lineHeight: 1.7, outline: 'none', whiteSpace: 'pre-wrap',
        }}
        dangerouslySetInnerHTML={{ __html: initialHtmlRef.current || '' }}
      />
    </div>
  )
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--card)', color: 'var(--text)', fontSize: 12,
  fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 4,
}

// ── ImageBlockEditor — URL + upload + alt + caption ────────────────

function ImageBlockEditor({
  block, onChange,
}: {
  block: { type: 'image'; src: string; alt: string; caption?: string; decorative?: boolean }
  onChange: (next: ArticleBlock) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  function set<K extends keyof typeof block>(key: K, value: (typeof block)[K]) {
    onChange({ ...block, [key]: value } as ArticleBlock)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    const err = validateArticleImageFile(file)
    if (err) { setError(err); return }
    setError(null)
    setUploading(true)
    try {
      const ext = (file!.name.split('.').pop() || 'jpg').toLowerCase()
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const path = `insights/body/${filename}`
      const { error: upErr } = await supabase.storage.from('creator-images').upload(path, file!, {
        upsert: false,
        contentType: file!.type,
      })
      if (upErr) {
        setError('Upload failed: ' + upErr.message)
        setUploading(false)
        return
      }
      const { data: urlData } = supabase.storage.from('creator-images').getPublicUrl(path)
      if (!urlData?.publicUrl || !isSafeArticleImageSrc(urlData.publicUrl)) {
        setError('Uploaded file has an invalid URL.')
        setUploading(false)
        return
      }
      onChange({ ...block, src: urlData.publicUrl })
    } catch (e: any) {
      setError('Upload failed: ' + (e?.message || 'unknown'))
    }
    setUploading(false)
  }

  const srcSafe = isSafeArticleImageSrc(block.src)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {srcSafe && (
        <div>
          <img
            src={block.src}
            alt={block.alt || ''}
            style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8, background: 'var(--card)' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      )}
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4, fontFamily: "'Figtree', sans-serif" }}>
          Image URL
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={block.src}
            onChange={e => set('src', e.target.value)}
            placeholder="https://…"
            style={{ ...inputInlineStyle, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} style={{ ...addBtnStyle, whiteSpace: 'nowrap' }}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          {srcSafe && (
            <button type="button" onClick={() => set('src', '')} style={{ ...iconBtnStyle, width: 36 }} title="Remove image">✕</button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={ARTICLE_IMAGE_MIME_ALLOWLIST.join(',')}
          style={{ display: 'none' }}
          onChange={handleFile}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: "'Figtree', sans-serif" }}>
          JPEG, PNG or WebP · max 5 MB. Uploads go to the creator-images bucket.
        </div>
        {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6, fontFamily: "'Figtree', sans-serif" }}>{error}</div>}
      </div>
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4, fontFamily: "'Figtree', sans-serif" }}>
          Alt text {block.decorative ? '(decorative — optional)' : '(required)'}
        </label>
        <input
          type="text"
          value={block.alt}
          onChange={e => set('alt', e.target.value)}
          placeholder="Describe the image for screen readers and search engines"
          style={inputInlineStyle}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontFamily: "'Figtree', sans-serif" }}>
          <input
            type="checkbox"
            checked={!!block.decorative}
            onChange={e => set('decorative' as any, (e.target.checked || undefined) as any)}
          />
          Mark as decorative (skip alt text)
        </label>
      </div>
      <div>
        <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4, fontFamily: "'Figtree', sans-serif" }}>
          Caption (optional)
        </label>
        <input
          type="text"
          value={block.caption || ''}
          onChange={e => set('caption', e.target.value)}
          placeholder="Optional caption shown under the image"
          style={inputInlineStyle}
        />
      </div>
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
      const { error } = await supabase.from('insights').update(updates).eq('id', id)
      if (error) { alert('Save failed: ' + error.message); return }
    } else {
      const { error } = await supabase.from('insights').insert([data])
      if (error) { alert('Save failed: ' + error.message); return }
    }
    handleBack()
  }

  if (!authed) return <LoginScreen onLogin={handleLogin} />

  // FIX1 — wrap the authenticated view in a Fragment with the shared
  // admin header on top so every authenticated Insights view carries
  // the "Admin Home" / "Return to site" links without disturbing
  // the editor or list layout below.
  if (view === 'edit') return (
    <>
      <AdminToolHeader toolName="Insights (Articles)" />
      <ArticleEditor article={editing} onSave={handleSave} onBack={handleBack} />
    </>
  )

  return (
    <>
      <AdminToolHeader toolName="Insights (Articles)" />
      <ArticleList onNew={handleNew} onEdit={handleEdit} />
    </>
  )
}
