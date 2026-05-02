// /card-shows — main directory landing page.
//
// Server component. Renders SEO-critical hero copy, country CTAs, and
// featured upcoming events server-side. No filters here — those live on
// the per-country listing pages.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  getUpcomingCardShows,
  getFeaturedCardShows,
  formatShowDate,
  EVENT_TYPE_LABEL,
  COUNTRY_LABEL,
  type CardShow,
} from '@/data/cardShows'

export const metadata: Metadata = {
  title: 'Pokémon Card Shows & TCG Events | PokePrices',
  description:
    'Find upcoming Pokémon card shows, TCG fairs and collector events across the UK, US and Canada. Updated event listings for Pokémon card fans and vendors.',
  alternates: { canonical: 'https://www.pokeprices.io/card-shows' },
  openGraph: {
    title: 'Pokémon Card Shows & TCG Events | PokePrices',
    description:
      'Find upcoming Pokémon card shows, TCG fairs and collector events across the UK, US and Canada.',
    url: 'https://www.pokeprices.io/card-shows',
    siteName: 'PokePrices',
    type: 'website',
  },
}

export default function CardShowsLandingPage() {
  const upcoming = getUpcomingCardShows()
  const featured = getFeaturedCardShows()
  const ukCount = upcoming.filter(s => s.country === 'uk').length
  const usCount = upcoming.filter(s => s.country === 'us').length
  const caCount = upcoming.filter(s => s.country === 'ca').length

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* Hero */}
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 8px', color: 'var(--text)', letterSpacing: -0.5, lineHeight: 1.15 }}>
          Pokémon Card Shows &amp; TCG Events
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          Find upcoming Pokémon card shows, TCG fairs, collector events and trading card conventions across the United Kingdom, United States and Canada.
        </p>
      </header>

      {/* Country CTAs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 36 }}>
        <CountryCta country="uk" count={ukCount} />
        <CountryCta country="us" count={usCount} />
        <CountryCta country="ca" count={caCount} />
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 6px', color: 'var(--text)' }}>
            Featured upcoming events
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 16px' }}>
            Hand-picked card shows and TCG fairs worth travelling for.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {featured.map(s => <FeaturedCard key={s.id} show={s} />)}
          </div>
        </section>
      )}

      {/* SEO intro / about */}
      <section style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '20px 24px',
        marginBottom: 28,
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 10px', color: 'var(--text)' }}>
          Why PokePrices tracks card shows
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: '0 0 10px', lineHeight: 1.7 }}>
          Card shows are the best way to handle a card before you buy it, talk to other collectors,
          drop slabs at a grading rep, and find sealed product that doesn&apos;t exist on most retail
          shelves. We list upcoming Pokémon and trading card events across the UK and US so you can
          plan a weekend without trawling Facebook groups.
        </p>
        <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.7 }}>
          Each event links straight to the organiser. We don&apos;t take ticket fees, we don&apos;t
          host shows, and we don&apos;t mark up vendors.
        </p>
      </section>

      {/* Internal links */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 10px', color: 'var(--text)' }}>
          While you&apos;re here
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <PillLink href="/browse">Browse cards &amp; sets</PillLink>
          <PillLink href="/pokemon">Pokémon directory</PillLink>
          <PillLink href="/insights">Market insights</PillLink>
          <PillLink href="/vendors">Vendor directory</PillLink>
        </div>
      </section>

      {/* Disclaimer */}
      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, textAlign: 'center', margin: '24px auto 0', maxWidth: 640 }}>
        Event details can change without notice. Always check the organiser&apos;s official page or social channels before travelling.
      </p>
    </div>
  )
}

function CountryCta({ country, count }: { country: 'uk' | 'us' | 'ca'; count: number }) {
  const flag = country === 'uk' ? '🇬🇧' : country === 'ca' ? '🇨🇦' : '🇺🇸'
  const title = country === 'uk' ? 'UK Card Shows' : country === 'ca' ? 'Canada Card Shows' : 'US Card Shows'
  return (
    <Link href={`/card-shows/${country}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '24px 26px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        transition: 'border-color 0.15s, transform 0.15s',
        cursor: 'pointer',
      }}>
        <div style={{ fontSize: 44, lineHeight: 1, flexShrink: 0 }}>{flag}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 4px', color: 'var(--text)', letterSpacing: -0.3 }}>
            {title}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            {count} upcoming event{count === 1 ? '' : 's'} · {COUNTRY_LABEL[country]}
          </p>
        </div>
        <span style={{ fontSize: 22, color: 'var(--primary)', fontWeight: 800, flexShrink: 0 }}>→</span>
      </div>
    </Link>
  )
}

function FeaturedCard({ show }: { show: CardShow }) {
  return (
    <Link href={`/card-shows/${show.country}/${show.slug}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '14px 16px',
        height: '100%',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
            background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
            padding: '3px 8px', borderRadius: 8,
            fontFamily: "'Figtree', sans-serif",
          }}>
            {EVENT_TYPE_LABEL[show.eventType]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700, whiteSpace: 'nowrap' }}>
            {show.country.toUpperCase()}
          </span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 4 }}>
          {show.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
          {show.city}{show.region ? ` · ${show.region}` : ''}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
          {formatShowDate(show)}
        </div>
      </div>
    </Link>
  )
}

function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      display: 'inline-block',
      padding: '7px 16px', borderRadius: 999,
      background: 'var(--card)', border: '1px solid var(--border)',
      color: 'var(--text)', fontSize: 13, fontWeight: 700,
      fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
    }}>{children}</Link>
  )
}
