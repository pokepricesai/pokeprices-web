// /card-shows — main directory landing page.
//
// Server component. Renders SEO-critical hero copy, five-country CTAs
// with live upcoming counts, and featured upcoming events server-side.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  getUpcomingCardShows,
  getFeaturedCardShows,
  formatShowDate,
  EVENT_TYPE_LABEL,
  CARD_SHOW_COUNTRIES,
  type CardShow,
  type CardShowCountry,
} from '@/data/cardShows'
import { getHubSeo, COUNTRY_TITLE_LABEL } from '@/lib/cardShowSeo'

// Block 5A-W-54B — metadata sourced from the shared SEO helper so
// the hub title stays in sync with the country pages.
export async function generateMetadata(): Promise<Metadata> {
  const seo = getHubSeo(new Date().getFullYear())
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonical },
    openGraph: {
      title: seo.title, description: seo.description, url: seo.canonical,
      siteName: 'PokePrices', type: 'website',
    },
  }
}

export default function CardShowsLandingPage() {
  const seo      = getHubSeo(new Date().getFullYear())
  const upcoming = getUpcomingCardShows()
  const featured = getFeaturedCardShows()

  // Live per-country upcoming counts.
  const countsByCountry: Record<CardShowCountry, number> = {
    uk: 0, us: 0, ca: 0, au: 0, nz: 0,
  }
  for (const s of upcoming) countsByCountry[s.country] += 1
  const totalUpcoming = upcoming.length

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* Hero */}
      <header style={{ marginBottom: 28 }}>
        <h1 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 32,
          margin: '0 0 8px', color: 'var(--text)',
          letterSpacing: -0.5, lineHeight: 1.15,
        }}>
          {seo.h1}
        </h1>
        <p style={{
          fontSize: 14, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: 0, lineHeight: 1.6, maxWidth: 720,
        }}>
          {seo.intro}{totalUpcoming > 0 ? ` ${totalUpcoming} upcoming shows in the calendar right now.` : ''}
        </p>
      </header>

      {/* Country CTAs — one card per supported country. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14, marginBottom: 36,
      }}>
        {CARD_SHOW_COUNTRIES.map(c => (
          <CountryCta key={c} country={c} count={countsByCountry[c]} />
        ))}
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 22,
            margin: '0 0 6px', color: 'var(--text)',
          }}>
            Featured upcoming events
          </h2>
          <p style={{
            fontSize: 12, color: 'var(--text-muted)',
            fontFamily: "'Figtree', sans-serif", margin: '0 0 16px',
          }}>
            Hand-picked card shows and TCG fairs worth travelling for.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}>
            {featured.map(s => <FeaturedCard key={s.id} show={s} />)}
          </div>
        </section>
      )}

      {/* SEO intro / about */}
      <section style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '20px 24px', marginBottom: 28,
      }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 18,
          margin: '0 0 10px', color: 'var(--text)',
        }}>
          Why PokePrices tracks card shows
        </h2>
        <p style={{
          fontSize: 14, color: 'var(--text)',
          fontFamily: "'Figtree', sans-serif",
          margin: '0 0 10px', lineHeight: 1.7,
        }}>
          Card shows are the best way to handle a card before you buy it, talk to other collectors,
          drop slabs at a grading rep, and find sealed product that doesn&apos;t exist on most retail
          shelves. We list upcoming Pokémon and trading card events across the UK, USA, Canada,
          Australia and New Zealand so you can plan a weekend without trawling Facebook groups.
        </p>
        <p style={{
          fontSize: 14, color: 'var(--text)',
          fontFamily: "'Figtree', sans-serif",
          margin: 0, lineHeight: 1.7,
        }}>
          Each event links straight to the organiser. We don&apos;t take ticket fees, we don&apos;t
          host shows, and we don&apos;t mark up vendors.
        </p>
      </section>

      {/* Descriptive internal links to every country landing. */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 18,
          margin: '0 0 10px', color: 'var(--text)',
        }}>
          Browse by country
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {CARD_SHOW_COUNTRIES.map(c => (
            <Link key={c} href={`/card-shows/${c}`} style={pillLinkStyle}>
              All {COUNTRY_TITLE_LABEL[c]} Pokémon Card Shows
            </Link>
          ))}
        </div>
      </section>

      {/* Adjacent site sections. */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 18,
          margin: '0 0 10px', color: 'var(--text)',
        }}>
          While you&apos;re here
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/browse"   style={pillLinkStyle}>Browse cards &amp; sets</Link>
          <Link href="/pokemon"  style={pillLinkStyle}>Pokémon directory</Link>
          <Link href="/insights" style={pillLinkStyle}>Market insights</Link>
          <Link href="/vendors"  style={pillLinkStyle}>Vendor directory</Link>
        </div>
      </section>

      {/* Disclaimer */}
      <p style={{
        fontSize: 12, color: 'var(--text-muted)',
        fontFamily: "'Figtree', sans-serif", lineHeight: 1.6,
        textAlign: 'center', margin: '24px auto 0', maxWidth: 640,
      }}>
        Event details can change without notice. Always check the organiser&apos;s official page or social channels before travelling.
      </p>
    </div>
  )
}

const COUNTRY_FLAG: Record<CardShowCountry, string> = {
  uk: '🇬🇧', us: '🇺🇸', ca: '🇨🇦', au: '🇦🇺', nz: '🇳🇿',
}
const COUNTRY_FULL_NAME: Record<CardShowCountry, string> = {
  uk: 'United Kingdom',
  us: 'USA',
  ca: 'Canada',
  au: 'Australia',
  nz: 'New Zealand',
}

function CountryCta({ country, count }: { country: CardShowCountry; count: number }) {
  const flag  = COUNTRY_FLAG[country]
  const name  = COUNTRY_FULL_NAME[country]
  return (
    <Link href={`/card-shows/${country}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 18, padding: '18px 20px',
        display: 'flex', alignItems: 'center', gap: 14,
        transition: 'border-color 0.15s, transform 0.15s',
        cursor: 'pointer',
      }}>
        <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>{flag}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 17,
            fontWeight: 800, color: 'var(--text)',
            letterSpacing: -0.2, marginBottom: 2,
          }}>{name}</div>
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {count} upcoming show{count === 1 ? '' : 's'}
          </div>
        </div>
        <span style={{
          fontSize: 20, color: 'var(--primary)', fontWeight: 800, flexShrink: 0,
        }}>→</span>
      </div>
    </Link>
  )
}

function FeaturedCard({ show }: { show: CardShow }) {
  return (
    <Link href={`/card-shows/${show.country}/${show.slug}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '14px 16px',
        height: '100%', boxSizing: 'border-box',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', gap: 10, marginBottom: 8,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
            background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
            padding: '3px 8px', borderRadius: 8,
            fontFamily: "'Figtree', sans-serif",
          }}>
            {EVENT_TYPE_LABEL[show.eventType]}
          </span>
          <span style={{
            fontSize: 11, color: 'var(--text-muted)',
            fontFamily: "'Figtree', sans-serif", fontWeight: 700, whiteSpace: 'nowrap',
          }}>
            {COUNTRY_TITLE_LABEL[show.country]}
          </span>
        </div>
        <div style={{
          fontSize: 15, fontWeight: 800, color: 'var(--text)',
          fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 4,
        }}>
          {show.name}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif", marginBottom: 8,
        }}>
          {show.city}{show.region ? ` · ${show.region}` : ''}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: 'var(--primary)',
          fontFamily: "'Figtree', sans-serif",
        }}>
          {formatShowDate(show)}
        </div>
      </div>
    </Link>
  )
}

const pillLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '7px 16px', borderRadius: 999,
  background: 'var(--card)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 13, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
}
