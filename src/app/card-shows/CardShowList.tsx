'use client'
// Client island for /card-shows/uk and /card-shows/us. Handles:
//   - text search (event name / city / venue)
//   - region + event-type + featured-only filters
//   - "Sort by nearest to my location" — geocodes a city/postcode via
//     Nominatim, computes distance to each event, re-sorts ascending.
//     All events stay visible; no filtering by radius.
//   - per-row Star toggle for logged-in users (read once at the list
//     level so we hydrate every row's initial state without N round trips).

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  EVENT_TYPE_LABEL,
  formatShowDate,
  distanceKm,
  type CardShow,
} from '@/data/cardShows'
import { supabase } from '@/lib/supabase'
import StarButton from './StarButton'

type EventType = CardShow['eventType']

interface UserLocation { latitude: number; longitude: number; label: string }

export default function CardShowList({
  shows,
  regions,
  country,
}: {
  shows: CardShow[]
  regions: string[]
  country: 'uk' | 'us' | 'ca'
}) {
  // Filters
  const [query, setQuery] = useState('')
  const [region, setRegion] = useState<string>('')
  const [type, setType] = useState<EventType | ''>('')
  const [onlyFeatured, setOnlyFeatured] = useState(false)

  // Distance sort
  const [locInput, setLocInput] = useState('')
  const [userLoc, setUserLoc] = useState<UserLocation | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geoError, setGeoError] = useState('')

  // Stars (single fetch on mount)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!live || !session) return
      const { data } = await supabase
        .from('card_show_stars')
        .select('show_id')
        .eq('user_id', session.user.id)
      if (!live || !data) return
      setStarredIds(new Set(data.map((r: any) => r.show_id)))
    })
    return () => { live = false }
  }, [])

  async function handleLocate(e: React.FormEvent) {
    e.preventDefault()
    const q = locInput.trim()
    if (!q) return
    setGeocoding(true)
    setGeoError('')
    try {
      // Nominatim: free, no API key, asks for a contact in User-Agent which
      // the browser sends automatically. Country bias the search so "Springfield"
      // stays in the right hemisphere.
      // Nominatim wants ISO 3166-1 alpha-2 — UK is "gb", US is "us", Canada is "ca".
      const cc = country === 'uk' ? 'gb' : country === 'ca' ? 'ca' : 'us'
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=${cc}`
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
      if (!res.ok) throw new Error('Lookup failed')
      const rows = await res.json()
      if (!Array.isArray(rows) || rows.length === 0) {
        setGeoError(`Couldn't find "${q}". Try a city name or postcode.`)
      } else {
        const r = rows[0]
        setUserLoc({
          latitude: parseFloat(r.lat),
          longitude: parseFloat(r.lon),
          label: r.display_name?.split(',')[0] || q,
        })
      }
    } catch (err: any) {
      setGeoError('Location lookup failed. Try again in a moment.')
    } finally {
      setGeocoding(false)
    }
  }

  function clearLocation() {
    setUserLoc(null)
    setLocInput('')
    setGeoError('')
  }

  // Filter then optionally re-sort by distance
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = shows.filter(s => {
      if (region && s.region !== region) return false
      if (type && s.eventType !== type) return false
      if (onlyFeatured && !s.featured) return false
      if (q) {
        const hay = `${s.name} ${s.city} ${s.region} ${s.venue || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    if (!userLoc) return filtered
    // Annotate with distance and sort ascending. Events without lat/lng
    // sink to the bottom (rare; all current entries have coords).
    return [...filtered]
      .map(s => {
        const km = (s.latitude != null && s.longitude != null)
          ? distanceKm(userLoc, { latitude: s.latitude, longitude: s.longitude })
          : null
        return { show: s, km }
      })
      .sort((a, b) => {
        if (a.km == null && b.km == null) return 0
        if (a.km == null) return 1
        if (b.km == null) return -1
        return a.km - b.km
      })
      .map(x => ({ ...x.show, _km: x.km } as CardShow & { _km: number | null }))
  }, [shows, query, region, type, onlyFeatured, userLoc])

  const types: EventType[] = ['pokemon', 'tcg', 'card-show', 'collectibles', 'mixed']

  return (
    <>
      {/* Distance row */}
      <form onSubmit={handleLocate} style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '12px 14px',
        marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.8 }}>
          📍 Sort by nearest to
        </span>
        <input
          value={locInput}
          onChange={e => setLocInput(e.target.value)}
          placeholder={
            country === 'uk' ? 'e.g. Manchester or SW1A 1AA'
            : country === 'ca' ? 'e.g. Toronto or M5V 2T6'
            : 'e.g. Atlanta GA or 90210'
          }
          style={{
            flex: 1, minWidth: 200,
            padding: '8px 12px', fontSize: 13, borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
        />
        <button type="submit" disabled={geocoding || !locInput.trim()} style={{
          padding: '8px 16px', borderRadius: 10, border: 'none',
          background: 'var(--primary)', color: '#fff',
          fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
          cursor: (geocoding || !locInput.trim()) ? 'not-allowed' : 'pointer',
          opacity: (geocoding || !locInput.trim()) ? 0.6 : 1,
        }}>
          {geocoding ? 'Locating…' : 'Find'}
        </button>
        {userLoc && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              Sorted by distance from <strong style={{ color: 'var(--text)' }}>{userLoc.label}</strong>
            </span>
            <button type="button" onClick={clearLocation} style={{
              padding: '6px 12px', borderRadius: 10, border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--text-muted)',
              fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
            }}>Clear</button>
          </>
        )}
        {geoError && (
          <span style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", flexBasis: '100%' }}>
            {geoError}
          </span>
        )}
      </form>

      {/* Filter bar */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '14px 16px', marginBottom: 18,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
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
        <select value={region} onChange={e => setRegion(e.target.value)} style={selectStyle}>
          <option value="">All regions</option>
          {regions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={type} onChange={e => setType(e.target.value as EventType | '')} style={selectStyle}>
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
      {visible.length === 0 ? (
        <div style={{
          background: 'var(--card)', border: '1px dashed var(--border)',
          borderRadius: 16, padding: '40px 20px', textAlign: 'center',
          color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.6,
        }}>
          No upcoming events match those filters. Try clearing the search or region.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visible.map((s: any) => (
            <ShowCard
              key={s.id}
              show={s}
              country={country}
              distanceKm={s._km ?? null}
              metric={country === 'uk' || country === 'ca'}
              starred={starredIds.has(s.id)}
              onToggleLocal={(nowStarred: boolean) => {
                setStarredIds(prev => {
                  const next = new Set(prev)
                  if (nowStarred) next.add(s.id)
                  else next.delete(s.id)
                  return next
                })
              }}
            />
          ))}
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

function ShowCard({
  show, country, distanceKm, metric, starred, onToggleLocal,
}: {
  show: CardShow
  country: 'uk' | 'us' | 'ca'
  distanceKm: number | null
  metric: boolean
  starred: boolean
  onToggleLocal: (nowStarred: boolean) => void
}) {
  // Metric (UK + Canada) shows km; US shows miles. That's what users expect.
  const distLabel = distanceKm == null
    ? null
    : (metric
      ? `${Math.round(distanceKm)} km away`
      : `${Math.round(distanceKm * 0.621371)} mi away`)

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
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: 0, color: 'var(--text)', letterSpacing: -0.2 }}>
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
          {distLabel && (
            <span style={{
              fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
              background: 'rgba(34,197,94,0.10)', color: '#15803d',
              padding: '3px 8px', borderRadius: 8,
              fontFamily: "'Figtree', sans-serif",
            }}>📍 {distLabel}</span>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
          <div onClick={() => onToggleLocal(!starred)}>
            <StarButton showId={show.id} initialStarred={starred} />
          </div>
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
