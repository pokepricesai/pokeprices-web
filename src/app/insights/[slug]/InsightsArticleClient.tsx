'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import ArticleSchema from '@/components/ArticleSchema'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

const THEME_COLOURS: Record<string, string> = {
  grading:    '#a78bfa',
  collecting: '#22c55e',
  market:     '#3b82f6',
  vintage:    '#f59e0b',
  modern:     '#ef4444',
  investing:  '#ec4899',
  community:  '#94a3b8',
  // legacy fallbacks
  movers:    '#ef4444',
  set_watch: '#3b82f6',
  sleepers:  '#22c55e',
  pulse:     '#f59e0b',
  collector: '#ec4899',
  history:   '#94a3b8',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatPrice(cents: number | null) {
  if (!cents) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null
  const w = 300, h = 60, pad = 4
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const isUp = data[data.length - 1] >= data[0]
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={isUp ? '#22c55e' : '#ef4444'} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  )
}

// ── Card tile (for legacy card_grid blocks) ───────────────────────────────────

function CardTile({ slug }: { slug: string }) {
  const [card, setCard] = useState<any>(null)
  const [price, setPrice] = useState<number | null>(null)

  useEffect(() => {
    async function load() {
      const bareSlug = slug.replace('pc-', '')
      const [{ data: cardData }, { data: priceData }] = await Promise.all([
        supabase.from('cards').select('card_name, set_name, card_number, image_url, card_url_slug').eq('card_slug', bareSlug).single(),
        supabase.from('daily_prices').select('raw_usd').eq('card_slug', slug).order('date', { ascending: false }).limit(1).single(),
      ])
      if (cardData) setCard(cardData)
      if (priceData) setPrice(priceData.raw_usd)
    }
    load()
  }, [slug])

  if (!card) return <div style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Loading…</div>

  return (
    <Link href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, transition: 'box-shadow 0.15s' }}
        onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.boxShadow = '0 3px 12px rgba(0,0,0,0.06)'}
        onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.boxShadow = ''}>
        {card.image_url && <img src={card.image_url} alt={card.card_name} style={{ width: 36, height: 50, objectFit: 'contain', flexShrink: 0 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.card_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{card.set_name} · #{card.card_number}</div>
        </div>
        {price && <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{formatPrice(price)}</div>}
      </div>
    </Link>
  )
}

// ── Chart block (legacy) ──────────────────────────────────────────────────────

function ChartBlock({ block }: { block: any }) {
  const [history, setHistory] = useState<number[]>([])
  const [card, setCard] = useState<any>(null)

  useEffect(() => {
    if (!block.card_slug) return
    const bareSlug = block.card_slug.replace('pc-', '')
    Promise.all([
      supabase.from('cards').select('card_name, set_name, card_url_slug').eq('card_slug', bareSlug).single(),
      supabase.from('daily_prices').select('raw_usd').eq('card_slug', block.card_slug).gt('raw_usd', 0).order('date', { ascending: true }).limit(90),
    ]).then(([{ data: c }, { data: h }]) => {
      if (c) setCard(c)
      if (h) setHistory(h.map((x: any) => x.raw_usd))
    })
  }, [block.card_slug])

  const latest = history[history.length - 1], earliest = history[0]
  const pct = earliest ? ((latest - earliest) / earliest * 100) : null

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px', margin: '8px 0 24px' }}>
      {block.title && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>{block.title}</div>}
      {block.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.5, marginBottom: 12 }}>{block.description}</div>}
      {history.length > 1 ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{formatPrice(latest)}</span>
            {pct !== null && <span style={{ fontSize: 13, fontWeight: 700, color: pct >= 0 ? '#22c55e' : '#ef4444', fontFamily: "'Figtree', sans-serif" }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</span>}
          </div>
          <Sparkline data={history} />
        </>
      ) : <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Loading chart…</div>}
      {card && <Link href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`} style={{ display: 'inline-block', marginTop: 12, fontSize: 12, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none', fontWeight: 600 }}>View full price history →</Link>}
    </div>
  )
}

// ── Body block renderer — handles both new admin format and legacy format ──────

function Block({ block }: { block: any }) {
  // ── New admin format (heading / paragraph) ──
  if (block.type === 'heading') {
    return (
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: '32px 0 12px', lineHeight: 1.3 }}>
        {block.text}
      </h2>
    )
  }

  if (block.type === 'paragraph' || block.type === 'text') {
    const text = block.text || block.content || ''
    return (
      <p style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: '0 0 20px' }}>
        {text}
      </p>
    )
  }

  // ── Legacy formats ──
  if (block.type === 'card_grid') {
    return (
      <div style={{ margin: '4px 0 24px' }}>
        {block.heading && <h3 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>{block.heading}</h3>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {(block.card_slugs || []).map((slug: string) => <CardTile key={slug} slug={slug} />)}
        </div>
      </div>
    )
  }

  if (block.type === 'chart') return <ChartBlock block={block} />

  return null
}

// ── Raw text renderer — for articles written as plain text with ## headings ───

function RenderBodyText({ text }: { text: string }) {
  const paragraphs = text.split('\n\n').filter(Boolean)
  return (
    <>
      {paragraphs.map((para, i) => {
        if (para.startsWith('## ')) {
          return <h2 key={i} style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, color: 'var(--text)', margin: '32px 0 12px', lineHeight: 1.3 }}>{para.replace(/^## /, '')}</h2>
        }
        return <p key={i} style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: '0 0 20px' }}>{para}</p>
      })}
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InsightsArticleClient({ article }: { article: any }) {
  const color    = THEME_COLOURS[article.theme] ?? '#94a3b8'
  const bodyJson = article.body_json

  // Determine how to render the body
  // New format: { blocks: [...] }
  // Legacy format: [...] (array directly)
  // Plain text fallback: if body_json has a single block with a long .text
  const blocks: any[] = Array.isArray(bodyJson)
    ? bodyJson
    : Array.isArray(bodyJson?.blocks)
    ? bodyJson.blocks
    : []

  // Check if it's actually plain text stored in a single text block
  const isPlainTextBody = blocks.length === 1 && blocks[0].type === 'paragraph' && (blocks[0].text || '').includes('\n\n')

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px' }}>
      <ArticleSchema article={article} />
      <BreadcrumbSchema items={[
        { name: 'Guides', url: '/insights' },
        { name: article.headline || article.title },
      ]} />

      <Link href="/insights" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 20, display: 'inline-block', fontFamily: "'Figtree', sans-serif" }}>
        ← Market Insights
      </Link>

      {/* Hero image */}
      {article.image_url && (
        <img src={article.image_url} alt={article.headline}
          style={{ width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 16, marginBottom: 28 }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
      )}

      {/* Header */}
      <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color, fontFamily: "'Figtree', sans-serif" }}>
            {article.theme_label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            {formatDate(article.published_at)}
          </span>
          {article.read_time_mins && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              · {article.read_time_mins} min read
            </span>
          )}
          {article.author && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              · By {article.author}
            </span>
          )}
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 14px', color: 'var(--text)', lineHeight: 1.2, letterSpacing: -0.5 }}>
          {article.headline}
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', margin: 0, lineHeight: 1.65, fontFamily: "'Figtree', sans-serif" }}>
          {article.intro}
        </p>
      </div>

      {/* Body */}
      <div>
        {isPlainTextBody
          ? <RenderBodyText text={blocks[0].text} />
          : blocks.map((block, i) => <Block key={i} block={block} />)
        }
      </div>

      {/* Footer */}
      <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Prices from real sold listings via PriceCharting. Updated daily.
        </span>
        <Link href="/insights" style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
          More articles →
        </Link>
      </div>
    </div>
  )
}
