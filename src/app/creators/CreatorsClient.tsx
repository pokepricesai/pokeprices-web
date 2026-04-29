'use client'
import { useState } from 'react'
import Link from 'next/link'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

const PLATFORM_ICONS: Record<string, string> = {
  YouTube: '▶',
  'X/Twitter': '𝕏',
  TikTok: '♪',
  Instagram: '◎',
  Reddit: '👾',
  Twitch: '◈',
  Podcast: '🎙',
}

const PLATFORM_COLORS: Record<string, string> = {
  YouTube: '#ff0000',
  'X/Twitter': '#000000',
  TikTok: '#69c9d0',
  Instagram: '#e1306c',
  Reddit: '#ff4500',
  Twitch: '#9146ff',
  Podcast: '#8b5cf6',
}

const ALL_SPECIALISMS = [
  'Vintage', 'Modern', 'Grading', 'Investing', 'Pack Opening',
  'Collecting', 'Competitive', 'Japanese Cards', 'Sealed Product',
]

const ALL_PLATFORMS = ['YouTube', 'X/Twitter', 'TikTok', 'Instagram', 'Reddit', 'Twitch', 'Podcast']

interface Platform { name: string; url: string }
interface Creator {
  id: number
  name: string
  slug: string
  description: string
  image_url: string
  country: string
  specialisms: string[]
  platforms: Platform[]
  featured: boolean
}

function PlatformBadge({ platform }: { platform: Platform }) {
  const icon = PLATFORM_ICONS[platform.name] || '🔗'
  const color = PLATFORM_COLORS[platform.name] || '#666'
  return (
    <a
      href={platform.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: `${color}15`, border: `1px solid ${color}40`,
        color, textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = `${color}30` }}
      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = `${color}15` }}
    >
      <span>{icon}</span>
      <span>{platform.name}</span>
    </a>
  )
}

function CreatorCard({ creator }: { creator: Creator }) {
  return (
    <Link href={`/creators/${creator.slug}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--card)', border: `1px solid ${creator.featured ? 'rgba(255,203,5,0.4)' : 'var(--border)'}`,
        borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
        transition: 'transform 0.15s, box-shadow 0.15s',
        boxShadow: creator.featured ? '0 0 20px rgba(255,203,5,0.1)' : 'none',
      }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.transform = 'translateY(-3px)'
          el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)'
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.transform = ''
          el.style.boxShadow = creator.featured ? '0 0 20px rgba(255,203,5,0.1)' : 'none'
        }}
      >
        {/* Image */}
        <div style={{ position: 'relative', height: 140, background: 'linear-gradient(135deg, #1a5fad, #3b8fe8)', overflow: 'hidden' }}>
          {creator.image_url ? (
            <img src={creator.image_url} alt={creator.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, opacity: 0.3 }}>
              👤
            </div>
          )}
          {creator.featured && (
            <div style={{
              position: 'absolute', top: 10, right: 10,
              background: 'var(--accent)', color: '#000', fontSize: 9, fontWeight: 800,
              padding: '3px 8px', borderRadius: 10, letterSpacing: 1,
              fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase',
            }}>Featured</div>
          )}
          {creator.country && (
            <div style={{
              position: 'absolute', bottom: 10, left: 10,
              background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11,
              padding: '2px 8px', borderRadius: 10, fontFamily: "'Figtree', sans-serif",
              backdropFilter: 'blur(4px)',
            }}>{creator.country}</div>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: '14px 16px' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
            {creator.name}
          </h3>
          {creator.description && (
            <p style={{
              margin: '0 0 10px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
              fontFamily: "'Figtree', sans-serif",
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{creator.description}</p>
          )}

          {/* Specialisms */}
          {creator.specialisms?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {creator.specialisms.slice(0, 3).map(s => (
                <span key={s} style={{
                  fontSize: 10, fontWeight: 700, color: 'var(--primary)',
                  background: 'rgba(26,95,173,0.08)', border: '1px solid rgba(26,95,173,0.15)',
                  padding: '2px 7px', borderRadius: 8, fontFamily: "'Figtree', sans-serif",
                }}>{s}</span>
              ))}
              {creator.specialisms.length > 3 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                  +{creator.specialisms.length - 3} more
                </span>
              )}
            </div>
          )}

          {/* Platforms */}
          {creator.platforms?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {creator.platforms.map((p, i) => <PlatformBadge key={i} platform={p} />)}
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function CreatorsClient({ creators }: { creators: Creator[] }) {
  const [search, setSearch] = useState('')
  const [activePlatform, setActivePlatform] = useState<string | null>(null)
  const [activeSpecialism, setActiveSpecialism] = useState<string | null>(null)

  const filtered = creators.filter(c => {
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description?.toLowerCase().includes(search.toLowerCase())
    const matchPlatform = !activePlatform ||
      c.platforms?.some(p => p.name === activePlatform)
    const matchSpecialism = !activeSpecialism ||
      c.specialisms?.includes(activeSpecialism)
    return matchSearch && matchPlatform && matchSpecialism
  })

  const featured = filtered.filter(c => c.featured)
  const regular = filtered.filter(c => !c.featured)

  return (
    <>
      <BreadcrumbSchema items={[{ name: 'Creators' }]} />
      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
        padding: '40px 24px 48px', textAlign: 'center',
      }}>
        <h1 style={{
          fontSize: 36, color: '#fff', margin: '0 0 8px',
          fontFamily: "'Outfit', sans-serif",
          textShadow: '0 2px 10px rgba(0,0,0,0.15)',
        }}>Creator Directory</h1>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, margin: '0 0 24px', fontFamily: "'Figtree', sans-serif" }}>
          Pokémon TCG content creators worth following — YouTube, TikTok, X and more
        </p>
        <div style={{ maxWidth: 480, margin: '0 auto 16px' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search creators..."
            style={{
              width: '100%', padding: '12px 18px', borderRadius: 12,
              border: 'none', background: 'rgba(255,255,255,0.15)',
              color: '#fff', fontSize: 14, fontFamily: "'Figtree', sans-serif",
              outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <Link href="/creators/submit" style={{
          display: 'inline-block', background: 'var(--accent)', color: '#000',
          padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 800,
          textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
        }}>
          + Submit Your Channel
        </Link>
      </section>

      {/* Filters */}
      <section style={{ padding: '20px 24px 0', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', alignSelf: 'center', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>Platform:</span>
          {ALL_PLATFORMS.map(p => (
            <button key={p} onClick={() => setActivePlatform(activePlatform === p ? null : p)} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Figtree', sans-serif", border: '1px solid var(--border)',
              background: activePlatform === p ? 'var(--primary)' : 'var(--card)',
              color: activePlatform === p ? '#fff' : 'var(--text)',
              transition: 'all 0.15s',
            }}>{p}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', alignSelf: 'center', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>Focus:</span>
          {ALL_SPECIALISMS.map(s => (
            <button key={s} onClick={() => setActiveSpecialism(activeSpecialism === s ? null : s)} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Figtree', sans-serif", border: '1px solid var(--border)',
              background: activeSpecialism === s ? 'var(--primary)' : 'var(--card)',
              color: activeSpecialism === s ? '#fff' : 'var(--text)',
              transition: 'all 0.15s',
            }}>{s}</button>
          ))}
        </div>
      </section>

      {/* Grid */}
      <section style={{ padding: '0 24px 48px', maxWidth: 1100, margin: '0 auto' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
            No creators found.{' '}
            <Link href="/creators/submit" style={{ color: 'var(--primary)' }}>Be the first to submit!</Link>
          </div>
        ) : (
          <>
            {featured.length > 0 && (
              <>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', margin: '0 0 12px', fontFamily: "'Figtree', sans-serif" }}>
                  Featured
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, marginBottom: 32 }}>
                  {featured.map(c => <CreatorCard key={c.id} creator={c} />)}
                </div>
              </>
            )}
            {regular.length > 0 && (
              <>
                {featured.length > 0 && (
                  <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase', margin: '0 0 12px', fontFamily: "'Figtree', sans-serif" }}>
                    All Creators ({regular.length})
                  </p>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                  {regular.map(c => <CreatorCard key={c.id} creator={c} />)}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}
