'use client'
// Client island for /card-shows/uk and /card-shows/us. Receives the
// pre-filtered "upcoming in country" list from the server page and
// handles the search / region / event-type / featured filter UI.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  EVENT_TYPE_LABEL,
  formatShowDate,
  type CardShow,
} from '@/data/cardShows'

type EventType = CardShow['eventType']

export default function CardShowList({
  shows,
  regions,
  country,
}: {
  shows: CardShow[]
  regions: string[]
  country: 'uk' | 'us'
}) {
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<string>('')
  const [type, setType] = useState<EventType | ''>('')
  const [onlyFeatured, setOnlyFeatured] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return shows.filter(s => {
      if (region && s.region !== region) return false
      if (type && s.eventType !== type) return false
      if (onlyFeatured && !s.featured) return false
      if (q) {
        const hay = `${s.name} ${s.city} ${s.region} ${s.venue || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [shows, query, region, type, onlyFeatured])

  const types: EventType[] = ['pokemon', 'tcg', 'card-show', 'collectibles', 'mixed']

  return (
    <>
      {/* Filter bar */}
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '14px 16px',
        marginBottom: 18,
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search event name, city or venue…"
          style={{
            flex: 1, minWidth: 220,
            padding: '10px 14px', fontSize: 14, borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
        />
        <select
          value={region}
          onChange={e => setRegion(e.target.value)}
          style={selectStyle}
        >
          <option value="">All regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={type}
          onChange={e => setType(e.target.value as EventType | '')}
          style={selectStyle}
        >
          <option value="">All event types</option>
          {types.map(t => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
        </select>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif", cursor: 'pointer', userSelect: 'none',
          padding: '8px 12px',
        }}>
          <input type="checkbox" checked={onlyFeatured} onChange={e => setOnlyFeatured(e.target.checked)} />
          Featured only
        </label>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div style={{
          background: 'var(--card)', border: '1px dashed var(--border)',
          borderRadius: 16, padding: '40px 20px', textAlign: 'center',
          color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.6,
        }}>
          No upcoming events match those filters. Try clearing the search or region.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(s => <ShowCard key={s.id} show={s} country={country} />)}
        </div>
      )}

      <p style={{
        fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        textAlign: 'center', margin: '28px auto 0', maxWidth: 640, lineHeight: 1.6,
      }}>
        Event details can change. Always check the organiser&apos;s official page before travelling.
      </p>
    </>
  )
}

function ShowCard({ show, country }: { show: CardShow; country: 'uk' | 'us' }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px',
      display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap',
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
    }}>
      {/* Date badge */}
      <div style={{
        flexShrink: 0, minWidth: 92,
        background: 'rgba(26,95,173,0.08)',
        border: '1px solid rgba(26,95,173,0.18)',
        borderRadius: 10, padding: '8px 12px',
        textAlign: 'center', alignSelf: 'flex-start',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
          color: 'var(--primary)', fontFamily: "'Figtree', sans-serif",
        }}>
          {new Date(show.startDate).toLocaleDateString('en-GB', { month: 'short' })}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 900, color: 'var(--text)',
          fontFamily: "'Outfit', sans-serif", lineHeight: 1, marginTop: 2,
        }}>
          {new Date(show.startDate).getDate()}
        </div>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
          fontWeight: 700, marginTop: 4,
        }}>
          {new Date(show.startDate).getFullYear()}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <Link href={`/card-shows/${country}/${show.slug}`} style={{ textDecoration: 'none' }}>
            <h2 style={{
              fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0,
              color: 'var(--text)', letterSpacing: -0.2,
            }}>
              {show.name}
            </h2>
          </Link>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
            background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
            padding: '3px 8px', borderRadius: 8,
            fontFamily: "'Figtree', sans-serif",
          }}>
            {EVENT_TYPE_LABEL[show.eventType]}
          </span>
          {show.featured && (
            <span style={{
              fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
              background: 'rgba(245,158,11,0.14)', color: '#b45309',
              padding: '3px 8px', borderRadius: 8,
              fontFamily: "'Figtree', sans-serif",
            }}>★ Featured</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
          {show.city}{show.region ? ` · ${show.region}` : ''}{show.venue ? ` · ${show.venue}` : ''}
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif",
          lineHeight: 1.6, marginBottom: 10,
        }}>
          {show.description}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link href={`/card-shows/${country}/${show.slug}`} style={{
            display: 'inline-block',
            padding: '7px 16px', borderRadius: 10,
            background: 'var(--primary)', color: '#fff',
            fontSize: 12, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
          }}>
            View event
          </Link>
          {show.ticketUrl && (
            <a href={show.ticketUrl} target="_blank" rel="noopener noreferrer" style={outlineButton}>
              Tickets ↗
            </a>
          )}
          {show.websiteUrl && (
            <a href={show.websiteUrl} target="_blank" rel="noopener noreferrer" style={outlineButton}>
              Official site ↗
            </a>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700, marginTop: 8 }}>
          {formatShowDate(show)}
        </div>
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '10px 12px', fontSize: 13, borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--bg-light)',
  color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
  cursor: 'pointer',
}

const outlineButton: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 14px', borderRadius: 10,
  background: 'transparent', color: 'var(--primary)',
  border: '1px solid var(--primary)',
  fontSize: 12, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
}
