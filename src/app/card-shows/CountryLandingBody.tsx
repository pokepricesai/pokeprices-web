// src/app/card-shows/CountryLandingBody.tsx
//
// Block 5A-W-54B — shared visible body for /card-shows/{country}. All
// five country routes render this component; the only per-route work
// is generateMetadata (per Next.js conventions). Server component.

import Link from 'next/link'
import {
  getCardShowsByCountry,
  getRegionsForCountry,
  formatShowDate,
  type CardShowCountry,
} from '@/data/cardShows'
import { getCountrySeo, COUNTRY_LOCATIVE } from '@/lib/cardShowSeo'
import CardShowList from './CardShowList'

export default function CountryLandingBody({ country }: { country: CardShowCountry }) {
  const shows   = getCardShowsByCountry(country)
  const regions = getRegionsForCountry(country)
  const year    = new Date().getFullYear()
  const seo     = getCountrySeo(country, year, shows.length)

  // ── Summary facts — derived from the live catalogue ──
  const cities = new Set<string>()
  for (const s of shows) if (s.city) cities.add(s.city)
  const nextShow = shows[0] ?? null
  // "Listings last checked" = the most-recent lastChecked timestamp on
  // any upcoming event for this country. Reflects when the calendar
  // was actively swept.
  const lastCheckedIso = shows.reduce<string | null>((acc, s) =>
    !acc || s.lastChecked > acc ? s.lastChecked : acc, null)
  const lastCheckedLabel = lastCheckedIso
    ? new Date(lastCheckedIso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
      <Link href="/card-shows" style={{
        display: 'inline-block', fontSize: 13, fontWeight: 700,
        color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        textDecoration: 'none', marginBottom: 16,
      }}>
        ← All card shows
      </Link>

      <header style={{ marginBottom: 18 }}>
        <h1 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 30, margin: '0 0 10px',
          color: 'var(--text)', letterSpacing: -0.4, lineHeight: 1.15,
        }}>
          {seo.h1}
        </h1>
        <p style={{
          fontSize: 14, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: 0, lineHeight: 1.6, maxWidth: 760,
        }}>
          {seo.intro}
        </p>
      </header>

      {/* Summary fact row — only when we have real data to show. */}
      {shows.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10, marginBottom: 18,
        }}>
          <SummaryFact label="Upcoming shows" value={String(shows.length)} />
          {cities.size > 0 && (
            <SummaryFact
              label={cities.size === 1 ? 'City represented' : 'Cities represented'}
              value={String(cities.size)}
            />
          )}
          {nextShow && (
            <SummaryFact
              label="Next show"
              value={nextShow.name}
              sub={`${formatShowDate(nextShow)} · ${nextShow.city}`}
              href={`/card-shows/${country}/${nextShow.slug}`}
            />
          )}
          {lastCheckedLabel && (
            <SummaryFact label="Listings checked" value={lastCheckedLabel} />
          )}
        </div>
      )}

      <CardShowList shows={shows} regions={regions} country={country} />
    </div>
  )
}

function SummaryFact({
  label, value, sub, href,
}: {
  label: string
  value: string
  sub?:  string
  href?: string
}) {
  const inner = (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 14px',
      fontFamily: "'Figtree', sans-serif",
      height: '100%', boxSizing: 'border-box',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
        textTransform: 'uppercase', color: 'var(--text-muted)',
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 15, fontWeight: 800, color: 'var(--text)',
        lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{value}</div>
      {sub && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</div>
      )}
    </div>
  )
  if (href) {
    return (
      <Link href={href} style={{ textDecoration: 'none' }}>{inner}</Link>
    )
  }
  return inner
}

// Suppress "unused import" for the COUNTRY_LOCATIVE map — imported for
// future customization by callers but currently only used inside the
// seo helper.
void COUNTRY_LOCATIVE
