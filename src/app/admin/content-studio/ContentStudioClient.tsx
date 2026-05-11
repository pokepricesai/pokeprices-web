'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  TEMPLATE_LABELS,
  TEMPLATES_IMPLEMENTED,
  WEEKLY_PACK_QUOTA,
  VISUAL_STYLES,
  PRICE_TIERS,
  TIME_WINDOWS,
  defaultOptionsFor,
  type SocialContentPost,
  type TemplateType,
  type CardBattleOptions,
  type MarketMoverOptions,
} from '@/lib/contentStudio'

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || 'pokeprices2024'
const SESSION_KEY = 'pp_content_studio_authed'

const GENERATE_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/content-studio-generate`
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// ── Login screen ────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (pw === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(SESSION_KEY, '1') } catch {}
      onLogin()
    } else { setErr(true); setPw('') }
  }

  return (
    <div style={{ maxWidth: 380, margin: '120px auto', padding: 24, background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)' }}>
      <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Content Studio</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 16px' }}>
        Admin password required.
      </p>
      <form onSubmit={handleSubmit}>
        <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(false) }} placeholder="Password"
          style={{ width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10, border: `1px solid ${err ? '#ef4444' : 'var(--border)'}`, background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }} />
        {err && <p style={{ fontSize: 12, color: '#ef4444', margin: '8px 0 0', fontFamily: "'Figtree', sans-serif" }}>Wrong password.</p>}
        <button type="submit" style={{ width: '100%', marginTop: 12, padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
          Enter
        </button>
      </form>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function callGenerate(template_type: TemplateType, options: any): Promise<SocialContentPost> {
  let res: Response
  try {
    res = await fetch(GENERATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY,
      },
      body: JSON.stringify({ template_type, options }),
    })
  } catch (e: any) {
    // Network-layer error — almost always CORS preflight failure or the
    // function not being reachable. Surface a hint.
    throw new Error(
      `Cannot reach edge function (${e?.message || 'network error'}). ` +
      `Check that content-studio-generate is deployed and verify_jwt is OFF.`
    )
  }
  let data: any = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    const detail = data?.error || data?.message || (await res.text().catch(() => '')) || `HTTP ${res.status}`
    throw new Error(detail)
  }
  if (!data?.post) throw new Error('Edge function returned no post')
  return data.post as SocialContentPost
}

function renderUrl(id: string): string {
  return `/api/content-studio/render?id=${encodeURIComponent(id)}`
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for older browsers
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

// ── Options panels ──────────────────────────────────────────────────────────

const fieldStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12,
  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5,
}
const selectStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
  fontSize: 13, outline: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400,
}

function CardBattlePanel({ opts, onChange }: { opts: CardBattleOptions; onChange: (o: CardBattleOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Price tier
        <select value={opts.price_tier} onChange={e => onChange({ ...opts, price_tier: e.target.value as any })} style={selectStyle}>
          {PRICE_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
    </div>
  )
}

function MarketMoverPanel({ opts, onChange }: { opts: MarketMoverOptions; onChange: (o: MarketMoverOptions) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      <label style={fieldStyle}>
        Window
        <select value={opts.time_window} onChange={e => onChange({ ...opts, time_window: e.target.value as any })} style={selectStyle}>
          {TIME_WINDOWS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Direction
        <select value={opts.direction} onChange={e => onChange({ ...opts, direction: e.target.value as any })} style={selectStyle}>
          <option value="up">Risers</option>
          <option value="down">Fallers</option>
        </select>
      </label>
      <label style={fieldStyle}>
        Price tier
        <select value={opts.price_tier} onChange={e => onChange({ ...opts, price_tier: e.target.value as any })} style={selectStyle}>
          {PRICE_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
      <label style={fieldStyle}>
        Visual style
        <select value={opts.visual_style} onChange={e => onChange({ ...opts, visual_style: e.target.value as any })} style={selectStyle}>
          {VISUAL_STYLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </label>
    </div>
  )
}

// ── Post card ───────────────────────────────────────────────────────────────

function PostCard({ post, onUpdate, onDelete, onRegenerate }: {
  post: SocialContentPost
  onUpdate: (p: SocialContentPost) => void
  onDelete: (id: string) => void
  onRegenerate: (post: SocialContentPost) => void
}) {
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<'twitter' | 'instagram' | null>(null)
  const [imgKey, setImgKey] = useState(0)

  async function setStatus(status: SocialContentPost['status']) {
    setBusy(true)
    const { data, error } = await supabase.from('social_content_posts')
      .update({ status }).eq('id', post.id).select('*').single()
    if (!error && data) onUpdate(data as SocialContentPost)
    setBusy(false)
  }

  async function handleCopy(which: 'twitter' | 'instagram') {
    const text = which === 'twitter' ? post.twitter_copy : post.instagram_caption
    if (!text) return
    await copyToClipboard(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1400)
  }

  const statusColor: Record<SocialContentPost['status'], string> = {
    draft: 'var(--text-muted)', approved: '#22c55e', rejected: '#ef4444', used: 'var(--primary)',
  }
  const statusBg: Record<SocialContentPost['status'], string> = {
    draft: 'var(--bg-light)', approved: 'rgba(34,197,94,0.10)',
    rejected: 'rgba(239,68,68,0.10)', used: 'rgba(26,95,173,0.10)',
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: "'Figtree', sans-serif", opacity: busy ? 0.6 : 1, transition: 'opacity 0.15s' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)' }}>
          {TEMPLATE_LABELS[post.template_type]}
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: statusBg[post.status], color: statusColor[post.status], textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {post.status}
        </span>
      </div>

      {/* Image preview */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', background: 'var(--bg-light)', borderRadius: 10, overflow: 'hidden' }}>
        <img key={imgKey} src={`${renderUrl(post.id)}&v=${imgKey}`} alt={post.title || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>

      {/* Title + hook */}
      {post.title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{post.title}</div>
      )}

      {/* Tweet */}
      {post.twitter_copy && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)' }}>Twitter / X</span>
            <button onClick={() => handleCopy('twitter')} style={{ fontSize: 10, fontWeight: 700, color: copied === 'twitter' ? '#22c55e' : 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {copied === 'twitter' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--bg-light)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
            {post.twitter_copy}
          </div>
        </div>
      )}

      {/* Instagram */}
      {post.instagram_caption && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)' }}>Instagram</span>
            <button onClick={() => handleCopy('instagram')} style={{ fontSize: 10, fontWeight: 700, color: copied === 'instagram' ? '#22c55e' : 'var(--primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
              {copied === 'instagram' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, background: 'var(--bg-light)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap', maxHeight: 110, overflowY: 'auto' }}>
            {post.instagram_caption}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        <a href={`${renderUrl(post.id)}&v=${imgKey}`} download={`${post.id}.png`}
          style={{ flex: 1, minWidth: 100, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, textAlign: 'center', textDecoration: 'none', cursor: 'pointer' }}>
          ⬇ PNG
        </a>
        <button onClick={() => { setImgKey(k => k + 1) }}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
        <button onClick={() => onRegenerate(post)} disabled={busy}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          ⟳ Regenerate
        </button>
        {post.status !== 'approved' && (
          <button onClick={() => setStatus('approved')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #22c55e', background: 'rgba(34,197,94,0.08)', color: '#16a34a', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ✓ Approve
          </button>
        )}
        {post.status !== 'rejected' && (
          <button onClick={() => setStatus('rejected')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #ef4444', background: 'rgba(239,68,68,0.06)', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            ✗ Reject
          </button>
        )}
        {post.status === 'approved' && (
          <button onClick={() => setStatus('used')} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)', color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
            Mark used
          </button>
        )}
        <button onClick={() => onDelete(post.id)} disabled={busy}
          title="Delete"
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          🗑
        </button>
      </div>
    </div>
  )
}

// ── Main client ─────────────────────────────────────────────────────────────

export default function ContentStudioClient() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [posts, setPosts] = useState<SocialContentPost[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved' | 'rejected' | 'used'>('all')
  const [lastError, setLastError] = useState<string | null>(null)

  // Global options per template type
  const [cardBattleOpts,  setCardBattleOpts]  = useState<CardBattleOptions>(defaultOptionsFor('card_battle') as CardBattleOptions)
  const [marketMoverOpts, setMarketMoverOpts] = useState<MarketMoverOptions>(defaultOptionsFor('market_mover') as MarketMoverOptions)

  useEffect(() => {
    try {
      setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    } catch { setAuthed(false) }
  }, [])

  const loadPosts = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('social_content_posts')
      .select('*').order('created_at', { ascending: false }).limit(200)
    setPosts((data || []) as SocialContentPost[])
    setLoading(false)
  }, [])

  useEffect(() => { if (authed) loadPosts() }, [authed, loadPosts])

  // Build the 9-task pack (Phase A only generates the 2 implemented templates).
  const weeklyTasks = (() => {
    const tasks: { template_type: TemplateType; options: any }[] = []
    for (let i = 0; i < WEEKLY_PACK_QUOTA.card_battle;  i++) tasks.push({ template_type: 'card_battle',  options: cardBattleOpts  })
    for (let i = 0; i < WEEKLY_PACK_QUOTA.market_mover; i++) tasks.push({ template_type: 'market_mover', options: marketMoverOpts })
    return tasks
  })()

  async function generateWeeklyPack() {
    setGenerating(true)
    setLastError(null)
    setProgress({ done: 0, total: weeklyTasks.length })
    const results: SocialContentPost[] = []
    const errors: string[] = []
    let done = 0
    await Promise.all(weeklyTasks.map(async t => {
      try {
        const post = await callGenerate(t.template_type, t.options)
        results.push(post)
      } catch (e: any) {
        errors.push(`${TEMPLATE_LABELS[t.template_type]}: ${e?.message || e}`)
      } finally {
        done += 1
        setProgress({ done, total: weeklyTasks.length })
      }
    }))
    setPosts(prev => [...results, ...prev])
    setGenerating(false)
    setProgress(null)
    if (errors.length > 0) {
      setLastError(`${errors.length} of ${weeklyTasks.length} generations failed. First error: ${errors[0]}`)
    }
  }

  async function generateOne(template_type: TemplateType) {
    if (!TEMPLATES_IMPLEMENTED.includes(template_type)) {
      alert(`${TEMPLATE_LABELS[template_type]} is coming in Phase B.`)
      return
    }
    setGenerating(true)
    setLastError(null)
    try {
      const opts = template_type === 'card_battle' ? cardBattleOpts : marketMoverOpts
      const post = await callGenerate(template_type, opts)
      setPosts(prev => [post, ...prev])
    } catch (e: any) {
      setLastError(`${TEMPLATE_LABELS[template_type]}: ${e?.message || e}`)
    } finally { setGenerating(false) }
  }

  async function regenerate(post: SocialContentPost) {
    setGenerating(true)
    try {
      const newPost = await callGenerate(post.template_type, post.generated_options || {})
      // Delete the old draft, keep approved/used.
      if (post.status === 'draft' || post.status === 'rejected') {
        await supabase.from('social_content_posts').delete().eq('id', post.id)
        setPosts(prev => [newPost, ...prev.filter(p => p.id !== post.id)])
      } else {
        setPosts(prev => [newPost, ...prev])
      }
    } catch (e: any) {
      alert(`Regeneration failed: ${e?.message || e}`)
    } finally { setGenerating(false) }
  }

  async function deletePost(id: string) {
    if (!confirm('Delete this post?')) return
    await supabase.from('social_content_posts').delete().eq('id', id)
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  function updatePost(p: SocialContentPost) {
    setPosts(prev => prev.map(x => x.id === p.id ? p : x))
  }

  if (authed === null) return null
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  const visiblePosts = filter === 'all' ? posts : posts.filter(p => p.status === filter)
  const counts = {
    all:      posts.length,
    draft:    posts.filter(p => p.status === 'draft').length,
    approved: posts.filter(p => p.status === 'approved').length,
    rejected: posts.filter(p => p.status === 'rejected').length,
    used:     posts.filter(p => p.status === 'used').length,
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px', fontFamily: "'Figtree', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 4px', color: 'var(--text)' }}>Weekly Content Studio</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
            Generate a balanced pack of 21 social posts per week. Card Battle + Market Mover are live; other templates land in Phase B.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={generateWeeklyPack} disabled={generating}
            style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.7 : 1 }}>
            {generating && progress
              ? `Generating ${progress.done}/${progress.total}…`
              : `⚡ Generate Weekly Pack (${weeklyTasks.length} posts)`}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {lastError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#b91c1c', lineHeight: 1.5, fontFamily: "'Figtree', sans-serif" }}>
            <strong>Generation error.</strong> {lastError}
          </div>
          <button onClick={() => setLastError(null)}
            style={{ background: 'transparent', border: 'none', color: '#b91c1c', fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
        </div>
      )}

      {/* Per-template option panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 18 }}>
        <OptionsCard title="Card Battle" count={WEEKLY_PACK_QUOTA.card_battle} onSingle={() => generateOne('card_battle')} disabled={generating}>
          <CardBattlePanel  opts={cardBattleOpts}  onChange={setCardBattleOpts} />
        </OptionsCard>
        <OptionsCard title="Market Mover" count={WEEKLY_PACK_QUOTA.market_mover} onSingle={() => generateOne('market_mover')} disabled={generating}>
          <MarketMoverPanel opts={marketMoverOpts} onChange={setMarketMoverOpts} />
        </OptionsCard>
        {/* Stubs for Phase B */}
        {(['grading_gap', 'pokemon_battle', 'budget_builder', 'collector_pulse', 'then_vs_now', 'guess_the_pokemon'] as TemplateType[]).map(t => (
          <OptionsCard key={t} title={TEMPLATE_LABELS[t]} count={WEEKLY_PACK_QUOTA[t]} disabled stub />
        ))}
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {(['all', 'draft', 'approved', 'used', 'rejected'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            style={{
              padding: '6px 12px', borderRadius: 18, border: '1px solid var(--border)',
              background: filter === s ? 'var(--primary)' : 'transparent',
              color: filter === s ? '#fff' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
            }}>
            {s} {counts[s] > 0 ? `(${counts[s]})` : ''}
          </button>
        ))}
      </div>

      {/* Posts grid */}
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</p>
      ) : visiblePosts.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 16, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎨</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No posts yet. Hit Generate Weekly Pack to spin up your first 9.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {visiblePosts.map(p => (
            <PostCard key={p.id} post={p}
              onUpdate={updatePost}
              onDelete={deletePost}
              onRegenerate={regenerate} />
          ))}
        </div>
      )}
    </div>
  )
}

function OptionsCard({ title, count, children, onSingle, disabled, stub }: {
  title: string; count: number; children?: React.ReactNode
  onSingle?: () => void; disabled?: boolean; stub?: boolean
}) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, opacity: stub ? 0.55 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{count} per pack</div>
        </div>
        {onSingle && (
          <button onClick={onSingle} disabled={disabled}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 11, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer' }}>
            + One
          </button>
        )}
        {stub && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, padding: '4px 8px', borderRadius: 12, background: 'var(--bg-light)' }}>
            Phase B
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
