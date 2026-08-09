// Block 5A-W-54B.1 — Event structured-data accuracy pins.
//
// Rules from the block spec:
//   * location.name is emitted ONLY when show.venue is a genuine
//     known venue; falls back to nothing when unknown/TBA.
//   * PostalAddress must never carry "Venue TBA" / "TBA" / "To be
//     announced" in addressLocality / streetAddress / postalCode.
//   * SEO titles + meta must not leak "Venue TBA".
//   * Known-city / no-venue events still populate addressLocality
//     with the city.
//   * London Card Show schema is a known-good fixture — must
//     survive the refactor unchanged in shape.

import { describe, it, expect } from 'vitest'
import {
  buildEventSchema,
  buildBreadcrumbSchema,
  getEventSeo,
  isVenuePlaceholder,
} from '@/lib/cardShowSeo'
import type { CardShow } from '@/data/cardShows'

// ── Fixtures ───────────────────────────────────────

const londonCardShow: CardShow = {
  id: 'uk-london-card-show-sandown-2026-08',
  name: 'London Card Show',
  slug: 'london-card-show-esher-2026-08',
  country: 'uk',
  region: 'Surrey',
  city: 'Esher',
  venue: 'Sandown Park Racecourse',
  address: 'Esher',
  postcode: 'KT10 9AJ',
  startDate: '2026-08-14',
  endDate: '2026-08-16',
  eventType: 'card-show',
  description: 'Three-day London Card Show at Sandown Park Racecourse.',
  organiserName: 'London Card Show',
  websiteUrl: 'https://londoncardshow.co.uk',
  ticketUrl:  'https://londoncardshow.co.uk/buy-tickets/',
  lastChecked: '2026-08-09',
  status: 'upcoming',
}

const tapAndPlay: CardShow = {
  id: 'uk-tap-and-play-card-show-2026-10',
  name: 'Tap and Play Card Show',
  slug: 'tap-and-play-card-show-2026-10',
  country: 'uk',
  region: 'England',
  city: 'Venue TBA',
  startDate: '2026-10-04',
  eventType: 'card-show',
  description: 'Tap and Play Card Show.',
  organiserName: 'UK Card Shows',
  websiteUrl: 'https://www.ukcardshows.co.uk/',
  lastChecked: '2026-08-09',
  status: 'upcoming',
}

// City known, venue unknown — checks the "keep locality, drop
// location.name" behaviour requested by the block spec.
const knownCityUnknownVenue: CardShow = {
  id: 'uk-example',
  name: 'Example Show',
  slug: 'example-show-manchester-2026-09',
  country: 'uk',
  region: 'Greater Manchester',
  city: 'Manchester',
  startDate: '2026-09-05',
  eventType: 'card-show',
  description: 'Example.',
  websiteUrl: 'https://example.com/',
  lastChecked: '2026-08-09',
  status: 'upcoming',
}

// Both city AND venue explicitly set to placeholders. Defensive —
// catches a future data-entry mistake.
const bothPlaceholder: CardShow = {
  ...tapAndPlay,
  id: 'uk-both-placeholder',
  slug: 'both-placeholder',
  city: 'TBA',
  venue: 'To Be Announced',
}

// ── isVenuePlaceholder ────────────────────────────

describe('isVenuePlaceholder', () => {
  it('matches all documented placeholder tokens (case-insensitive)', () => {
    for (const s of [
      'TBA', 'tba', ' TBA ',
      'Venue TBA', 'venue tba',
      'To Be Announced', 'to be announced',
      'To be confirmed', 'TBC', 'tbc',
      '', '   ', null, undefined,
    ]) {
      expect(isVenuePlaceholder(s)).toBe(true)
    }
  })

  it('does not match real venue / city names', () => {
    for (const s of [
      'Sandown Park Racecourse',
      'Manchester',
      'Auckland',
      'Farfetch’d Convention Hall',
      'Olympia London',
      'The International Centre',
    ]) {
      expect(isVenuePlaceholder(s)).toBe(false)
    }
  })
})

// ── buildEventSchema — location.name rule ─────────

describe('buildEventSchema — location.name (54B.1 rule)', () => {
  it('emits location.name when show.venue is a genuine known venue', () => {
    const schema = buildEventSchema(londonCardShow)
    expect(schema.location).toBeDefined()
    expect(schema.location.name).toBe('Sandown Park Racecourse')
  })

  it('OMITS location.name when venue is unknown (city="Venue TBA")', () => {
    const schema = buildEventSchema(tapAndPlay)
    expect(schema.location).toBeDefined()
    expect(schema.location['@type']).toBe('Place')
    expect(schema.location).not.toHaveProperty('name')
  })

  it('OMITS location.name when venue is a "TBA"-shaped placeholder', () => {
    const schema = buildEventSchema({ ...knownCityUnknownVenue, venue: 'TBA' })
    expect(schema.location).not.toHaveProperty('name')
  })

  it('OMITS location.name when venue is absent even if city is known', () => {
    const schema = buildEventSchema(knownCityUnknownVenue)
    expect(schema.location).not.toHaveProperty('name')
    // …but keeps the city in the PostalAddress (see next block).
    expect(schema.location.address.addressLocality).toBe('Manchester')
  })

  it('never falls back to city / region / country for location.name', () => {
    for (const show of [tapAndPlay, knownCityUnknownVenue, bothPlaceholder]) {
      const schema = buildEventSchema(show)
      if (schema.location?.name) {
        // If a name IS present it must equal show.venue verbatim —
        // never the city, region, country label, or a placeholder.
        expect(schema.location.name).toBe(show.venue)
      }
    }
  })
})

// ── buildEventSchema — PostalAddress rule ────────

describe('buildEventSchema — PostalAddress placeholder filtering', () => {
  it('"Venue TBA" city is stripped from addressLocality', () => {
    const schema = buildEventSchema(tapAndPlay)
    expect(schema.location.address).not.toHaveProperty('addressLocality')
    // …but real region and country still present.
    expect(schema.location.address.addressRegion).toBe('England')
    expect(schema.location.address.addressCountry).toBe('GB')
  })

  it('known city without known venue still emits addressLocality', () => {
    const schema = buildEventSchema(knownCityUnknownVenue)
    expect(schema.location.address.addressLocality).toBe('Manchester')
    expect(schema.location.address.addressRegion).toBe('Greater Manchester')
  })

  it('placeholder strings never appear anywhere in the schema', () => {
    for (const show of [tapAndPlay, bothPlaceholder]) {
      const s = JSON.stringify(buildEventSchema(show))
      expect(s.toLowerCase()).not.toContain('venue tba')
      expect(s.toLowerCase()).not.toContain('to be announced')
      // Guard against a bare "TBA" leaking into any address field.
      // A bare "TBA" only appears when we mistakenly used a
      // placeholder as a real value — this catches that.
      expect(s).not.toMatch(/"addressLocality":"tba"/i)
      expect(s).not.toMatch(/"streetAddress":"tba"/i)
      expect(s).not.toMatch(/"postalCode":"tba"/i)
      expect(s).not.toMatch(/"name":"tba"/i)
    }
  })
})

// ── Tap and Play metadata does not contain placeholders

describe('Tap and Play metadata (title + description) never leaks "Venue TBA"', () => {
  it('title falls back to country label — "Tap and Play Card Show — UK Pokémon Card Show (October 2026) | PokePrices"', () => {
    const seo = getEventSeo(tapAndPlay)
    expect(seo.title).toBe(
      'Tap and Play Card Show — UK Pokémon Card Show (October 2026) | PokePrices',
    )
    expect(seo.title).not.toContain('Venue TBA')
    expect(seo.title).not.toContain('TBA')
  })

  it('description does not contain the placeholder string', () => {
    const seo = getEventSeo(tapAndPlay)
    expect(seo.description).not.toContain('Venue TBA')
    expect(seo.description).not.toContain('TBA')
    // …but still reads sensibly.
    expect(seo.description).toContain('Tap and Play Card Show takes place')
    expect(seo.description).toContain('4 October 2026')
    expect(seo.description).toContain('in England')
  })
})

// ── London Card Show shape regression pin ────────

describe('London Card Show schema — known-good fixture', () => {
  const schema = buildEventSchema(londonCardShow)

  it('shape carries every expected top-level field', () => {
    expect(schema['@context']).toBe('https://schema.org')
    expect(schema['@type']).toBe('Event')
    expect(schema.name).toBe('London Card Show')
    expect(schema.startDate).toBe('2026-08-14')
    expect(schema.endDate).toBe('2026-08-16')
    expect(schema.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(schema.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode')
    expect(schema.url).toBe('https://www.pokeprices.io/card-shows/uk/london-card-show-esher-2026-08')
  })

  it('location + PostalAddress carry every real field', () => {
    expect(schema.location).toEqual({
      '@type': 'Place',
      name: 'Sandown Park Racecourse',
      address: {
        '@type': 'PostalAddress',
        addressCountry: 'GB',
        addressLocality: 'Esher',
        addressRegion:   'Surrey',
        streetAddress:   'Esher',
        postalCode:      'KT10 9AJ',
      },
    })
  })

  it('organizer + offers + no invented fields', () => {
    expect(schema.organizer).toEqual({
      '@type': 'Organization',
      name: 'London Card Show',
      url:  'https://londoncardshow.co.uk',
    })
    expect(schema.offers).toEqual({
      '@type': 'Offer',
      url: 'https://londoncardshow.co.uk/buy-tickets/',
    })
    // Never invents these fields.
    expect(schema.offers).not.toHaveProperty('price')
    expect(schema.offers).not.toHaveProperty('priceCurrency')
    expect(schema.offers).not.toHaveProperty('availability')
  })
})

// ── BreadcrumbList sanity ────────────────────────

describe('buildBreadcrumbSchema — 3-step breadcrumb', () => {
  it('emits Card Shows → {Country} → {Event}', () => {
    const c = buildBreadcrumbSchema(londonCardShow)
    expect(c['@type']).toBe('BreadcrumbList')
    expect(c.itemListElement).toHaveLength(3)
    expect(c.itemListElement[0]).toMatchObject({ position: 1, name: 'Card Shows' })
    expect(c.itemListElement[1]).toMatchObject({ position: 2, name: 'UK Card Shows' })
    expect(c.itemListElement[2]).toMatchObject({ position: 3, name: 'London Card Show' })
    expect(c.itemListElement[2].url).toBe(
      'https://www.pokeprices.io/card-shows/uk/london-card-show-esher-2026-08',
    )
  })
})
