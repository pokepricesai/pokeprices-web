import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  getCardShowBySlug,
  getCardShowsByCountry,
  formatShowDate,
  EVENT_TYPE_LABEL,
  COUNTRY_LABEL,
  CARD_SHOW_COUNTRIES,
  type CardShowCountry,
} from '@/data/cardShows'
import {
  getEventSeo,
  pickRelatedEvents,
  buildEventSchema,
  buildBreadcrumbSchema,
  isVenuePlaceholder,
  COUNTRY_TITLE_LABEL,
} from '@/lib/cardShowSeo'
import StarButton from '../../StarButton'
import EventCountdown from '../../EventCountdown'

type Country = CardShowCountry

function isValidCountry(c: string): c is Country {
  return (CARD_SHOW_COUNTRIES as readonly string[]).includes(c)
}

// Block 5A-W-54B — descriptive backlink text for the country pill.
// Reads "← All UK Pokémon Card Shows" rather than a generic
// "← Back to UK card shows" — better anchor text for both humans
// and search engines.
function backLinkText(country: Country): string {
  return `All ${COUNTRY_TITLE_LABEL[country]} Pokémon Card Shows`
}

export async function generateMetadata(
  { params }: { params: Promise<{ country: string; slug: string }> },
): Promise<Metadata> {
  const { country, slug } = await params
  if (!isValidCountry(country)) return {}
  const show = getCardShowBySlug(country, slug)
  if (!show) return { robots: { index: false, follow: false } }

  const seo = getEventSeo(show)
  return {
    title:       seo.title,
    description: seo.description,
    alternates:  { canonical: seo.canonical },
    openGraph: {
      title: seo.title, description: seo.description, url: seo.canonical,
      siteName: 'PokePrices', type: 'website',
      images: show.imageUrl ? [{ url: show.imageUrl, alt: show.name }] : undefined,
    },
    twitter: {
      card: show.imageUrl ? 'summary_large_image' : 'summary',
      title: seo.title, description: seo.description,
      images: show.imageUrl ? [show.imageUrl] : undefined,
    },
  }
}

// Block 5A-W-54B.1 — schema builders now live in cardShowSeo.ts so
// they can be unit-tested. The route just wires them up.

export default async function CardShowDetailPage(
  { params }: { params: Promise<{ country: string; slug: string }> },
) {
  const { country, slug } = await params
  if (!isValidCountry(country)) notFound()
  const show = getCardShowBySlug(country, slug)
  if (!show) notFound()

  const eventSchema = buildEventSchema(show)
  const crumbSchema = buildBreadcrumbSchema(show)
  const cancelled   = show.status === 'cancelled'

  // Related events — up to 5 upcoming shows in the same country.
  const related = pickRelatedEvents(show, getCardShowsByCountry(country), 5)

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(eventSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbSchema) }} />

      {/* Breadcrumb / back link */}
      <nav aria-label="Breadcrumb" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        fontSize: 13, fontFamily: "'Figtree', sans-serif", color: 'var(--text-muted)',
        marginBottom: 18,
      }}>
        <Link href="/card-shows" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          Card shows
        </Link>
        <span style={{ opacity: 0.5 }}>›</span>
        <Link href={`/card-shows/${country}`} style={{ color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700 }}>
          ← {backLinkText(country)}
        </Link>
      </nav>

      {cancelled && (
        <div style={{
          background: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.25)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 18,
          color: '#b91c1c', fontFamily: "'Figtree', sans-serif",
          fontSize: 13, fontWeight: 700,
        }}>
          ⚠ This event has been cancelled.
        </div>
      )}

      {/* Header — event type / featured badges, name, date, countdown, save */}
      <header style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{
              fontFamily: "'Outfit', sans-serif", fontSize: 32,
              margin: '0 0 8px', color: 'var(--text)',
              letterSpacing: -0.4, lineHeight: 1.15,
            }}>
              {show.name}
            </h1>
            <div style={{
              fontSize: 17, color: 'var(--primary)',
              fontFamily: "'Figtree', sans-serif",
              margin: '0 0 4px', fontWeight: 800,
            }}>
              {formatShowDate(show)}
            </div>
            {/* Block 5A-W-54B.1 — never render "Venue TBA" as visible
                text. When the venue is genuinely unknown surface a
                friendly "Venue to be announced" line instead so the
                user isn't left wondering. */}
            {(!isVenuePlaceholder(show.venue) || !isVenuePlaceholder(show.city)) && (
              <div style={{
                fontSize: 14, color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif",
                margin: '0 0 12px',
              }}>
                {!isVenuePlaceholder(show.venue)
                  ? <><strong>{show.venue}</strong>{!isVenuePlaceholder(show.city) ? ` · ${show.city}` : ''}</>
                  : show.city}
                {show.region ? `, ${show.region}` : ''}
              </div>
            )}
            {isVenuePlaceholder(show.venue) && isVenuePlaceholder(show.city) && (
              <div style={{
                fontSize: 13, color: 'var(--text-muted)',
                fontFamily: "'Figtree', sans-serif",
                margin: '0 0 12px', fontStyle: 'italic',
              }}>
                Venue to be announced by the organiser{show.region ? ` · ${show.region}` : ''}
              </div>
            )}
            <EventCountdown startDate={show.startDate} endDate={show.endDate} size="lg" />
          </div>
          <StarButton showId={show.id} size="lg" />
        </div>

        {/* Action buttons — visible up top, no scrolling required. */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          {show.ticketUrl && (
            <a href={show.ticketUrl} target="_blank" rel="noopener noreferrer" style={primaryButton}>
              Get Tickets ↗
            </a>
          )}
          {show.websiteUrl && (
            <a href={show.websiteUrl} target="_blank" rel="noopener noreferrer" style={outlineButton}>
              Official Website ↗
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
        </div>
      </header>

      {/* Event details grid */}
      <section style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '18px 22px', marginBottom: 22,
      }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 17,
          margin: '0 0 12px', color: 'var(--text)',
        }}>
          Event details
        </h2>
        <DetailRow label="Date" value={formatShowDate(show)} />
        {!isVenuePlaceholder(show.city) && <DetailRow label="City" value={show.city!} />}
        {show.region && <DetailRow label="Region / state" value={show.region} />}
        {show.venue   && <DetailRow label="Venue"   value={show.venue} />}
        {show.address && <DetailRow label="Address" value={show.address + (show.postcode ? `, ${show.postcode}` : '')} />}
        {show.recurring && <DetailRow label="Recurring" value={show.recurring} />}
        {show.organiserName && <DetailRow label="Organiser" value={show.organiserName} />}
      </section>

      {/* Description */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 20,
          margin: '0 0 10px', color: 'var(--text)',
        }}>
          About {show.name}
        </h2>
        <p style={{
          fontSize: 14, color: 'var(--text)',
          fontFamily: "'Figtree', sans-serif",
          margin: 0, lineHeight: 1.75,
        }}>
          {show.description}
        </p>
      </section>

      {/* Planning to attend */}
      <section style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '20px 22px', marginBottom: 22,
      }}>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif", fontSize: 18,
          margin: '0 0 6px', color: 'var(--text)',
        }}>
          Planning to attend?
        </h2>
        <p style={{
          fontSize: 13, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          margin: '0 0 14px', lineHeight: 1.6,
        }}>
          Get sharper before you walk in — know what cards are worth, which sets are running hot, and what to look for at the tables.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/browse"   style={pillLinkStyle}>Search Pokémon card prices</Link>
          <Link href="/browse"   style={pillLinkStyle}>Browse sets</Link>
          <Link href="/pokemon"  style={pillLinkStyle}>Explore Pokémon</Link>
          <Link href="/insights" style={pillLinkStyle}>Market insights</Link>
        </div>
      </section>

      {/* Related — other upcoming events in the same country. Excludes
          this event by id. Only renders when at least one exists. */}
      {related.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <h2 style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 20,
            margin: '0 0 12px', color: 'var(--text)',
          }}>
            Other upcoming Pokémon card shows in {COUNTRY_LABEL[show.country]}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {related.map(r => (
              <Link key={r.id} href={`/card-shows/${r.country}/${r.slug}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 12, padding: '12px 16px',
                  display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 800, color: 'var(--text)',
                      fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2,
                    }}>{r.name}</div>
                    <div style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      fontFamily: "'Figtree', sans-serif",
                    }}>
                      {!isVenuePlaceholder(r.city) ? r.city : r.region}{r.region && !isVenuePlaceholder(r.city) ? ` · ${r.region}` : ''}
                    </div>
                  </div>
                  <div style={{
                    fontSize: 13, fontWeight: 700, color: 'var(--primary)',
                    fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap',
                  }}>
                    {formatShowDate(r)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Link href={`/card-shows/${show.country}`} style={pillLinkStyle}>
              {backLinkText(country)} →
            </Link>
          </div>
        </section>
      )}

      <p style={{
        fontSize: 12, color: 'var(--text-muted)',
        fontFamily: "'Figtree', sans-serif", lineHeight: 1.6,
        textAlign: 'center', margin: '24px auto 0', maxWidth: 640,
      }}>
        PokePrices does not organise this event. Event details are provided for collector convenience and should be verified with the organiser. Last checked: {show.lastChecked}.
      </p>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      gap: 14, padding: '8px 0',
      borderBottom: '1px solid var(--border-light, var(--border))',
      fontFamily: "'Figtree', sans-serif",
    }}>
      <span style={{
        fontSize: 12, color: 'var(--text-muted)', fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1, flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 14, color: 'var(--text)', fontWeight: 600, textAlign: 'right',
      }}>
        {value}
      </span>
    </div>
  )
}

const pillLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '7px 16px', borderRadius: 999,
  background: 'var(--bg-light)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 13, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
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
