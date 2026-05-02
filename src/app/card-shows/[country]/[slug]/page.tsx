import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  getCardShowBySlug,
  formatShowDate,
  EVENT_TYPE_LABEL,
  COUNTRY_LABEL,
  type CardShow,
} from '@/data/cardShows'
import StarButton from '../../StarButton'

type Country = 'uk' | 'us'

function isValidCountry(c: string): c is Country {
  return c === 'uk' || c === 'us'
}

export async function generateMetadata(
  { params }: { params: Promise<{ country: string; slug: string }> },
): Promise<Metadata> {
  const { country, slug } = await params
  if (!isValidCountry(country)) return {}
  const show = getCardShowBySlug(country, slug)
  if (!show) return { robots: { index: false, follow: false } }

  const title = `${show.name} | Pokémon Card Show in ${show.city} | PokePrices`
  const description =
    `${show.name} takes place in ${show.city}, ${show.region}. View date, venue, organiser links and Pokémon card show details on PokePrices.`
  const canonical = `https://www.pokeprices.io/card-shows/${country}/${slug}`

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: 'PokePrices',
      type: 'website',
      images: show.imageUrl ? [{ url: show.imageUrl, alt: show.name }] : undefined,
    },
    twitter: {
      card: show.imageUrl ? 'summary_large_image' : 'summary',
      title, description,
      images: show.imageUrl ? [show.imageUrl] : undefined,
    },
  }
}

// Build Event JSON-LD only with fields that have real data — never fabricate.
function buildEventSchema(show: CardShow, country: Country) {
  const url = `https://www.pokeprices.io/card-shows/${country}/${show.slug}`
  const eventStatus = show.status === 'cancelled'
    ? 'https://schema.org/EventCancelled'
    : 'https://schema.org/EventScheduled'

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: show.name,
    description: show.description,
    startDate: show.startDate,
    eventStatus,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: show.websiteUrl || url,
    location: {
      '@type': 'Place',
      name: show.venue || show.city,
      address: {
        '@type': 'PostalAddress',
        addressLocality: show.city,
        addressRegion: show.region,
        addressCountry: country.toUpperCase(),
        ...(show.address ? { streetAddress: show.address } : {}),
        ...(show.postcode ? { postalCode: show.postcode } : {}),
      },
    },
  }

  if (show.endDate) schema.endDate = show.endDate
  if (show.organiserName) {
    schema.organizer = { '@type': 'Organization', name: show.organiserName, ...(show.websiteUrl ? { url: show.websiteUrl } : {}) }
  }
  if (show.imageUrl) schema.image = show.imageUrl
  if (show.ticketUrl) {
    schema.offers = {
      '@type': 'Offers',
      url: show.ticketUrl,
      availability: 'https://schema.org/InStock',
    }
  }
  return schema
}

export default async function CardShowDetailPage(
  { params }: { params: Promise<{ country: string; slug: string }> },
) {
  const { country, slug } = await params
  if (!isValidCountry(country)) notFound()
  const show = getCardShowBySlug(country, slug)
  if (!show) notFound()

  const schema = buildEventSchema(show, country)
  const cancelled = show.status === 'cancelled'

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />

      {/* Back link */}
      <Link href={`/card-shows/${country}`} style={{
        display: 'inline-block', fontSize: 13, fontWeight: 700,
        color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
        textDecoration: 'none', marginBottom: 18,
      }}>
        ← Back to {country === 'uk' ? 'UK' : 'US'} card shows
      </Link>

      {cancelled && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 18,
          color: '#b91c1c', fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 700,
        }}>
          ⚠ This event has been cancelled.
        </div>
      )}

      {/* Header */}
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5,
            background: 'rgba(26,95,173,0.10)', color: 'var(--primary)',
            padding: '4px 10px', borderRadius: 8,
            fontFamily: "'Figtree', sans-serif",
          }}>
            {EVENT_TYPE_LABEL[show.eventType]}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5,
            background: 'var(--bg-light)', color: 'var(--text-muted)',
            padding: '4px 10px', borderRadius: 8,
            fontFamily: "'Figtree', sans-serif",
          }}>
            {COUNTRY_LABEL[show.country]}
          </span>
          {show.featured && (
            <span style={{
              fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5,
              background: 'rgba(245,158,11,0.14)', color: '#b45309',
              padding: '4px 10px', borderRadius: 8,
              fontFamily: "'Figtree', sans-serif",
            }}>★ Featured</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 6px', color: 'var(--text)', letterSpacing: -0.4, lineHeight: 1.15 }}>
              {show.name}
            </h1>
            <p style={{ fontSize: 16, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", margin: 0, fontWeight: 800 }}>
              {formatShowDate(show)}
            </p>
          </div>
          <StarButton showId={show.id} size="lg" />
        </div>
      </header>

      {/* Detail rows */}
      <section style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '18px 22px', marginBottom: 20,
      }}>
        <DetailRow label="City" value={show.city} />
        <DetailRow label="Region / state" value={show.region} />
        {show.venue   && <DetailRow label="Venue"   value={show.venue} />}
        {show.address && <DetailRow label="Address" value={show.address + (show.postcode ? `, ${show.postcode}` : '')} />}
        {show.recurring && <DetailRow label="Recurring" value={show.recurring} />}
        {show.organiserName && <DetailRow label="Organiser" value={show.organiserName} />}
      </section>

      {/* Description */}
      <section style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>
          About this event
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.7 }}>
          {show.description}
        </p>
      </section>

      {/* Action links */}
      <section style={{ marginBottom: 28, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {show.websiteUrl && (
          <a href={show.websiteUrl} target="_blank" rel="noopener noreferrer" style={primaryButton}>
            Official website ↗
          </a>
        )}
        {show.ticketUrl && (
          <a href={show.ticketUrl} target="_blank" rel="noopener noreferrer" style={primaryButton}>
            Tickets ↗
          </a>
        )}
        {show.instagramUrl && (
          <a href={show.instagramUrl} target="_blank" rel="noopener noreferrer" style={outlineButton}>
            Instagram ↗
          </a>
        )}
        {show.facebookUrl && (
          <a href={show.facebookUrl} target="_blank" rel="noopener noreferrer" style={outlineButton}>
            Facebook ↗
          </a>
        )}
      </section>

      {/* Planning to attend? */}
      <section style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '20px 22px', marginBottom: 20,
      }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 6px', color: 'var(--text)' }}>
          Planning to attend?
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 14px', lineHeight: 1.6 }}>
          Get sharper before you walk in — know what cards are worth, which sets are running hot, and what to look for at the tables.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <PillLink href="/browse">Search Pokémon card prices</PillLink>
          <PillLink href="/browse">Browse sets</PillLink>
          <PillLink href="/pokemon">Explore Pokémon pages</PillLink>
          <PillLink href="/insights">Market insights</PillLink>
        </div>
      </section>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, textAlign: 'center', margin: '24px auto 0', maxWidth: 640 }}>
        PokePrices does not organise this event. Event details are provided for collector convenience and should be verified with the organiser. Last checked: {show.lastChecked}.
      </p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      gap: 14, padding: '8px 0', borderBottom: '1px solid var(--border-light, var(--border))',
      fontFamily: "'Figtree', sans-serif",
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, textAlign: 'right' }}>
        {value}
      </span>
    </div>
  )
}

function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      display: 'inline-block',
      padding: '7px 16px', borderRadius: 999,
      background: 'var(--bg-light)', border: '1px solid var(--border)',
      color: 'var(--text)', fontSize: 13, fontWeight: 700,
      fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
    }}>{children}</Link>
  )
}

const primaryButton: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 18px', borderRadius: 10,
  background: 'var(--primary)', color: '#fff',
  fontSize: 13, fontWeight: 800,
  fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
}

const outlineButton: React.CSSProperties = {
  display: 'inline-block',
  padding: '10px 18px', borderRadius: 10,
  background: 'transparent', color: 'var(--primary)',
  border: '1px solid var(--primary)',
  fontSize: 13, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
}
