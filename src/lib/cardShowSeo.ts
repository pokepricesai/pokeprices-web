// src/lib/cardShowSeo.ts
//
// Block 5A-W-54B — pure SEO + copy helpers for the /card-shows surface.
// One place to change the title / meta / H1 / intro templates so the
// five country landing pages, the hub page and every event-detail page
// stay in sync.

import type { CardShow, CardShowCountry } from '@/data/cardShows'
import { COUNTRY_LABEL } from '@/data/cardShows'

const SITE = 'https://www.pokeprices.io'

// ── TBA / placeholder detection ─────────────────────
//
// Block 5A-W-54B.1 — event-detail entries occasionally carry a
// "Venue TBA" (or similar) placeholder in `city` when the organiser
// has not yet announced the venue. Structured data must NEVER leak
// these strings into location.name / addressLocality / streetAddress
// / postalCode, and SEO titles must not read like
// "Tap and Play Card Show — Venue TBA Pokémon Card Show".

const PLACEHOLDER_TOKENS = new Set([
  'tba',
  'tbc',
  'venue tba',
  'venue tbc',
  'to be announced',
  'to be confirmed',
])

/** Returns true when the string is a "TBA"-style placeholder rather
 *  than a real place/city/venue name. Case-insensitive, trims
 *  whitespace. Empty / null / undefined counts as placeholder. */
export function isVenuePlaceholder(value: string | null | undefined): boolean {
  if (!value) return true
  const v = value.trim().toLowerCase()
  if (!v) return true
  return PLACEHOLDER_TOKENS.has(v)
}

// ── Country display forms ─────────────────────────────

/** Compact label used in SEO titles + descriptions. Note: "USA" (not
 *  "US") on titles/descriptions per the block spec. */
export const COUNTRY_TITLE_LABEL: Record<CardShowCountry, string> = {
  uk: 'UK',
  us: 'USA',
  ca: 'Canada',
  au: 'Australia',
  nz: 'New Zealand',
}

/** Natural-language form used inside body copy — e.g. "in the UK",
 *  "across the USA", "in Canada". */
export const COUNTRY_LOCATIVE: Record<CardShowCountry, string> = {
  uk: 'the UK',
  us: 'the USA',
  ca: 'Canada',
  au: 'Australia',
  nz: 'New Zealand',
}

/** Preposition to use before the country name in phrases like "in {X}"
 *  vs "across {X}". Not all English placenames take "the". */
export const COUNTRY_TAKES_THE: Record<CardShowCountry, boolean> = {
  uk: true, us: true, ca: false, au: false, nz: false,
}

// ── Types ─────────────────────────────────────────────

export interface CountrySeo {
  title:       string
  description: string
  canonical:   string
  h1:          string
  intro:       string
  backLinkText: string
}

export interface HubSeo {
  title:       string
  description: string
  canonical:   string
  h1:          string
  intro:       string
}

export interface EventSeo {
  title:       string
  description: string
  canonical:   string
}

// ── Country landing SEO ───────────────────────────────

/**
 * Country-page SEO / copy.
 *
 * Template:
 *   Title  → `Pokémon Card Shows {LABEL} — All Upcoming Shows & Events ({year}) | PokePrices`
 *   H1     → `All Upcoming Pokémon Card Shows in {locative}`
 *   Meta   → `Find {N} upcoming Pokémon card shows across {locative} in {year}. …`
 *   Intro  → server-rendered short paragraph mentioning the live count.
 *   Back   → `All {LABEL} Pokémon Card Shows`
 *
 * `upcomingCount` must come from the live catalogue; year is passed
 * in so the helper stays pure.
 */
export function getCountrySeo(
  country: CardShowCountry,
  year: number,
  upcomingCount: number,
): CountrySeo {
  const label     = COUNTRY_TITLE_LABEL[country]
  const locative  = COUNTRY_LOCATIVE[country]
  const yearStr   = String(year)
  const countStr  = upcomingCount > 0
    ? `${upcomingCount} upcoming Pokémon card show${upcomingCount === 1 ? '' : 's'}`
    : `Pokémon card shows`
  const showsWord = upcomingCount === 1 ? 'show' : 'shows'

  const title = `Pokémon Card Shows ${label} — All Upcoming Shows & Events (${yearStr}) | PokePrices`
  const h1    = `All Upcoming Pokémon Card Shows in ${locative}`
  const intro = upcomingCount > 0
    ? `Looking for a Pokémon card show in ${locative}? PokePrices tracks upcoming Pokémon, TCG and trading card events across the country, with dates, venues and official ticket links. There are currently ${upcomingCount} upcoming ${showsWord} in our calendar.`
    : `PokePrices tracks upcoming Pokémon, TCG and trading card events across ${locative}. No shows are currently listed — check back as organisers publish ${yearStr} dates.`
  const description = upcomingCount > 0
    ? `Find ${countStr} across ${locative} in ${yearStr}. Browse dates, cities, venues and ticket links for Pokémon, TCG and trading card events.`
    : `Browse upcoming Pokémon card shows across ${locative} in ${yearStr}. Dates, cities, venues and ticket links for Pokémon, TCG and trading card events.`

  return {
    title,
    description,
    canonical:   `${SITE}/card-shows/${country}`,
    h1,
    intro,
    backLinkText: `All ${label} Pokémon Card Shows`,
  }
}

// ── Hub SEO ───────────────────────────────────────────

/** Hub-page SEO. The title enumerates five countries so
 *  "pokemon card shows near me" queries surface the hub for any
 *  supported market. */
export function getHubSeo(_year: number): HubSeo {
  const title =
    'Pokémon Card Shows Near Me — UK, USA, Canada, Australia & NZ | PokePrices'
  const description =
    'Find upcoming Pokémon card shows, TCG conventions and trading card events across the UK, USA, Canada, Australia and New Zealand. Dates, venues and official ticket links.'
  return {
    title,
    description,
    canonical: `${SITE}/card-shows`,
    h1:    'Find Pokémon Card Shows Near You',
    intro: 'Find upcoming Pokémon card shows, TCG conventions and trading card events across the UK, USA, Canada, Australia and New Zealand.',
  }
}

// ── Event-detail SEO ──────────────────────────────────

/** Choose the noun phrase for an individual event based on its
 *  eventType. Broad mixed-collector shows use "Trading Card Show" so
 *  the title doesn't over-claim Pokémon focus. */
function eventNounPhrase(show: CardShow): string {
  return show.eventType === 'mixed' || show.eventType === 'collectibles'
    ? 'Trading Card Show'
    : 'Pokémon Card Show'
}

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Individual event SEO. Uses only fields that actually exist on the
 * event — no invented venues, ticket prices or start times.
 *
 *   Title → `{Event} — {City} {NounPhrase} ({Month} {Year}) | PokePrices`
 *   Meta  → `{Event} takes place {formattedDate}[ at {venue}] in {city}. …`
 *   Canon → `${SITE}/card-shows/{country}/{slug}`
 */
export function getEventSeo(show: CardShow): EventSeo {
  const start = new Date(show.startDate)
  const month = MONTH_LABELS[start.getUTCMonth()]
  const year  = start.getUTCFullYear()
  const noun  = eventNounPhrase(show)
  // Block 5A-W-54B.1 — never let a "Venue TBA" (or any placeholder)
  // leak into the SEO title. Fall through to the country label.
  const cityForTitle = !isVenuePlaceholder(show.city)
    ? show.city!
    : COUNTRY_TITLE_LABEL[show.country]

  const title = `${show.name} — ${cityForTitle} ${noun} (${month} ${year}) | PokePrices`

  // Meta — describe without inventing venue where TBA. All venue /
  // city references gated through isVenuePlaceholder so a
  // hypothetical `venue: 'TBA'` can't leak either.
  const dateStr = formatDateLong(show)
  const venuePart = !isVenuePlaceholder(show.venue)
    ? ` at ${show.venue}`
    : ''
  // When city and region are the same string (e.g. Auckland Card
  // Show — city='Auckland', region='Auckland'), avoid an ugly
  // "in Auckland, Auckland" duplicate.
  const showsRegionDistinct = !!show.region && show.region !== show.city
  const cityPart = !isVenuePlaceholder(show.city)
    ? ` in ${show.city}${showsRegionDistinct ? `, ${show.region}` : ''}`
    : show.region ? ` in ${show.region}` : ''
  const description = `${show.name} takes place ${dateStr}${venuePart}${cityPart}. See venue details, tickets, organiser links and event information on PokePrices.`

  return {
    title,
    description,
    canonical: `${SITE}/card-shows/${show.country}/${show.slug}`,
  }
}

// ── Shared date formatter ────────────────────────────

function formatDateLong(show: CardShow): string {
  const start = new Date(show.startDate)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
  const startStr = start.toLocaleDateString('en-GB', opts)
  if (!show.endDate || show.endDate === show.startDate) return `on ${startStr}`
  const end = new Date(show.endDate)
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()
  if (sameMonth) {
    return `from ${start.getUTCDate()}–${end.getUTCDate()} ${end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`
  }
  const endStr = end.toLocaleDateString('en-GB', opts)
  return `from ${startStr} to ${endStr}`
}

// ── Event structured data (Event + BreadcrumbList) ──
//
// Block 5A-W-54B.1 — extracted from the [country]/[slug] route so
// the schema shape is unit-testable. Google's Event guidance:
//   * location is required
//   * location.name should be the actual venue name — NEVER a
//     placeholder like "Venue TBA"
//   * omit location.name if the venue is unknown; PostalAddress
//     alone still satisfies the Place → location constraint

/** ISO 3166-1 alpha-2 country code used in Event JSON-LD. */
export const EVENT_ISO_ADDRESS_COUNTRY: Record<CardShowCountry, string> = {
  uk: 'GB', us: 'US', ca: 'CA', au: 'AU', nz: 'NZ',
}

export function buildEventSchema(show: CardShow): Record<string, any> {
  const url = `${SITE}/card-shows/${show.country}/${show.slug}`
  const eventStatus = show.status === 'cancelled'
    ? 'https://schema.org/EventCancelled'
    : 'https://schema.org/EventScheduled'

  // PostalAddress — only include fields that carry real data.
  // Placeholder strings ("Venue TBA", "TBA", …) are stripped so they
  // can never enter addressLocality / streetAddress / postalCode.
  const address: Record<string, string> = {
    '@type': 'PostalAddress',
    addressCountry: EVENT_ISO_ADDRESS_COUNTRY[show.country],
  }
  if (!isVenuePlaceholder(show.city))     address.addressLocality = show.city!
  if (!isVenuePlaceholder(show.region))   address.addressRegion   = show.region!
  if (!isVenuePlaceholder(show.address))  address.streetAddress   = show.address!
  if (!isVenuePlaceholder(show.postcode)) address.postalCode      = show.postcode!

  // Place — location.name is emitted ONLY when a genuine venue is
  // known. Never falls back to city / region / country / "Venue TBA"
  // or any other placeholder per Google's Event guidance.
  const location: Record<string, any> = { '@type': 'Place', address }
  if (!isVenuePlaceholder(show.venue)) {
    location.name = show.venue!
  }

  const schema: Record<string, any> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: show.name,
    description: show.description,
    startDate: show.startDate,
    eventStatus,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url,
    location,
  }

  if (show.endDate) schema.endDate = show.endDate
  if (show.organiserName) {
    schema.organizer = {
      '@type': 'Organization',
      name: show.organiserName,
      ...(show.websiteUrl ? { url: show.websiteUrl } : {}),
    }
  }
  if (show.imageUrl) schema.image = show.imageUrl
  // offers.url only — never fabricate price / availability / dates.
  if (show.ticketUrl) {
    schema.offers = { '@type': 'Offer', url: show.ticketUrl }
  }
  return schema
}

export function buildBreadcrumbSchema(show: CardShow): Record<string, any> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Card Shows',                                       url: `${SITE}/card-shows` },
      { '@type': 'ListItem', position: 2, name: `${COUNTRY_TITLE_LABEL[show.country]} Card Shows`,  url: `${SITE}/card-shows/${show.country}` },
      { '@type': 'ListItem', position: 3, name: show.name,                                          url: `${SITE}/card-shows/${show.country}/${show.slug}` },
    ],
  }
}

// Suppress unused-warning for COUNTRY_LABEL — imported for schema
// consumers that may need the long-form label.
void COUNTRY_LABEL

// ── Related-events helper (event-detail page) ────────

/** Return N other upcoming events in the same country, starting on or
 *  after the current event's startDate but excluding the event itself.
 *  Pure — the caller must have already filtered for `isUpcoming`. */
export function pickRelatedEvents(
  currentShow: CardShow,
  countryShows: readonly CardShow[],
  n: number,
): CardShow[] {
  return countryShows
    .filter(s => s.id !== currentShow.id)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .slice(0, n)
}
