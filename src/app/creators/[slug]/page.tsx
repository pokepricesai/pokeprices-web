// app/creators/[slug]/page.tsx
'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import CreatorSchema from '@/components/CreatorSchema'

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

export default function CreatorProfilePage() {
  const params = useParams()
  const router = useRouter()
  const slug = params?.slug as string
  const [creator, setCreator] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    async function load() {
      const { data, error } = await supabase
        .from('creators')
        .select('*')
        .eq('slug', slug)
        .eq('status', 'approved')
        .single()
      if (error || !data) {
        router.push('/creators')
        return
      }
      setCreator(data)
      setLoading(false)
    }
    load()
  }, [slug])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
      Loading...
    </div>
  )

  if (!creator) return null

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 60px' }}>
      <BreadcrumbSchema items={[
        { name: 'Creators', url: '/creators' },
        { name: creator.name },
      ]} />
      <CreatorSchema creator={creator} />
      <Link href="/creators" style={{
        fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none',
        fontFamily: "'Figtree', sans-serif", display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 28,
      }}>← Back to creators</Link>

      {/* Profile header */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap' }}>
        <div style={{
          width: 100, height: 100, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
          background: 'linear-gradient(135deg, #1a5fad, #3b8fe8)',
          border: '3px solid var(--border)',
        }}>
          {creator.image_url ? (
            <img src={creator.image_url} alt={creator.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, opacity: 0.4 }}>👤</div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: 0 }}>{creator.name}</h1>
            {creator.featured && (
              <span style={{
                background: 'var(--accent)', color: '#000', fontSize: 10, fontWeight: 800,
                padding: '3px 10px', borderRadius: 10, letterSpacing: 1,
                fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase',
              }}>Featured</span>
            )}
          </div>
          {creator.country && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px', fontFamily: "'Figtree', sans-serif" }}>
              {creator.country}
            </p>
          )}
          {creator.specialisms?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {creator.specialisms.map((s: string) => (
                <span key={s} style={{
                  fontSize: 11, fontWeight: 700, color: 'var(--primary)',
                  background: 'rgba(26,95,173,0.08)', border: '1px solid rgba(26,95,173,0.15)',
                  padding: '3px 10px', borderRadius: 10, fontFamily: "'Figtree', sans-serif",
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {creator.description && (
        <div style={{
          background: 'var(--bg-light)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '20px 24px', marginBottom: 28,
        }}>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
            {creator.description}
          </p>
        </div>
      )}

      {/* Platform links */}
      {creator.platforms?.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', fontFamily: "'Figtree', sans-serif" }}>Find them on</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {creator.platforms.map((p: { name: string; url: string }, i: number) => {
              const color = PLATFORM_COLORS[p.name] || '#666'
              const icon = PLATFORM_ICONS[p.name] || '🔗'
              return (
                <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '14px 18px', textDecoration: 'none',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.transform = 'translateX(4px)'
                    el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLAnchorElement
                    el.style.transform = ''
                    el.style.boxShadow = ''
                  }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: `${color}15`, border: `1px solid ${color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, color,
                  }}>{icon}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{p.url}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 18, color: 'var(--text-muted)' }}>→</div>
                </a>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
