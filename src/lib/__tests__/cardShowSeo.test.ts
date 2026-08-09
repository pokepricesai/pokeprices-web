// Block 5A-W-54B — regression pins for the shared card-show SEO helpers.

import { describe, it, expect } from 'vitest'
import {
  getCountrySeo,
  getHubSeo,
  getEventSeo,
  pickRelatedEvents,
  COUNTRY_TITLE_LABEL,
} from '@/lib/cardShowSeo'
import type { CardShow } from '@/data/cardShows'

// ── Country templates ──────────────────────────────

describe('getCountrySeo — 54B template', () => {
  it('emits the pinned UK title / H1 / meta with real count and year', () => {
    const seo = getCountrySeo('uk', 2026, 24)
    expect(seo.title).toBe(
      'Pokémon Card Shows UK — All Upcoming Shows & Events (2026) | PokePrices',
    )
    expect(seo.h1).toBe('All Upcoming Pokémon Card Shows in the UK')
    expect(seo.description).toBe(
      'Find 24 upcoming Pokémon card shows across the UK in 2026. Browse dates, cities, venues and ticket links for Pokémon, TCG and trading card events.',
    )
    expect(seo.canonical).toBe('https://www.pokeprices.io/card-shows/uk')
    expect(seo.backLinkText).toBe('All UK Pokémon Card Shows')
  })

  it('USA title uses "USA" not "US"', () => {
    const seo = getCountrySeo('us', 2026, 26)
    expect(seo.title).toBe(
      'Pokémon Card Shows USA — All Upcoming Shows & Events (2026) | PokePrices',
    )
    expect(seo.h1).toBe('All Upcoming Pokémon Card Shows in the USA')
    expect(seo.backLinkText).toBe('All USA Pokémon Card Shows')
    expect(seo.description).toContain('26 upcoming Pokémon card shows across the USA in 2026')
  })

  it('Canada uses natural "in Canada" locative (no "the")', () => {
    const seo = getCountrySeo('ca', 2026, 8)
    expect(seo.h1).toBe('All Upcoming Pokémon Card Shows in Canada')
    expect(seo.description).toContain('across Canada in 2026')
    expect(seo.backLinkText).toBe('All Canada Pokémon Card Shows')
  })

  it('Australia + New Zealand titles use full names', () => {
    const auSeo = getCountrySeo('au', 2026, 6)
    const nzSeo = getCountrySeo('nz', 2026, 2)
    expect(auSeo.title).toBe(
      'Pokémon Card Shows Australia — All Upcoming Shows & Events (2026) | PokePrices',
    )
    expect(nzSeo.title).toBe(
      'Pokémon Card Shows New Zealand — All Upcoming Shows & Events (2026) | PokePrices',
    )
    expect(nzSeo.h1).toBe('All Upcoming Pokémon Card Shows in New Zealand')
    expect(nzSeo.backLinkText).toBe('All New Zealand Pokémon Card Shows')
  })

  it('singular grammar when only 1 upcoming show', () => {
    const seo = getCountrySeo('nz', 2026, 1)
    expect(seo.description).toContain('1 upcoming Pokémon card show ')
    expect(seo.description).not.toContain('1 upcoming Pokémon card shows')
    expect(seo.intro).toContain('1 upcoming show')
  })

  it('graceful fallback when 0 upcoming', () => {
    const seo = getCountrySeo('au', 2026, 0)
    expect(seo.description).not.toContain('undefined')
    expect(seo.description).not.toContain('NaN')
    expect(seo.description).toContain('Pokémon card shows')
    expect(seo.intro).toContain('No shows are currently listed')
  })

  it('intro naturally names the country and mentions the live count', () => {
    const seo = getCountrySeo('uk', 2026, 24)
    expect(seo.intro).toContain('Pokémon card show in the UK')
    expect(seo.intro).toContain('24 upcoming shows')
    expect(seo.intro).toContain('official ticket links')
  })

  it('year rollover — the year appears in title AND description', () => {
    const seo = getCountrySeo('uk', 2027, 30)
    expect(seo.title).toContain('(2027)')
    expect(seo.description).toContain('in 2027')
  })

  it('does not include the "| PokePrices" tail in the H1 or intro', () => {
    const seo = getCountrySeo('uk', 2026, 24)
    expect(seo.h1).not.toContain('PokePrices')
    expect(seo.intro).not.toContain('| PokePrices')
  })
})

// ── Hub ─────────────────────────────────────────────

describe('getHubSeo — 54B template', () => {
  it('title enumerates five countries in the required order', () => {
    const seo = getHubSeo(2026)
    expect(seo.title).toBe(
      'Pokémon Card Shows Near Me — UK, USA, Canada, Australia & NZ | PokePrices',
    )
  })
  it('h1 targets the "card shows near me" intent', () => {
    expect(getHubSeo(2026).h1).toBe('Find Pokémon Card Shows Near You')
  })
  it('intro names all five countries', () => {
    const intro = getHubSeo(2026).intro
    for (const c of ['UK', 'USA', 'Canada', 'Australia', 'New Zealand']) {
      expect(intro).toContain(c)
    }
  })
  it('canonical is self-referencing', () => {
    expect(getHubSeo(2026).canonical).toBe('https://www.pokeprices.io/card-shows')
  })
})

// ── Event-detail ────────────────────────────────────

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

const collectorsShowcase: CardShow = {
  id: 'uk-collectors-showcase-olympia-2026-11',
  name: 'Collectors Showcase — Olympia',
  slug: 'collectors-showcase-olympia-london-2026-11',
  country: 'uk',
  region: 'Greater London',
  city: 'London',
  venue: 'Olympia London',
  startDate: '2026-11-21',
  endDate: '2026-11-22',
  eventType: 'mixed',
  description: 'Two-day Collectors Showcase.',
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

describe('getEventSeo — 54B template', () => {
  it('title uses "Pokémon Card Show" for a card-show event', () => {
    const seo = getEventSeo(londonCardShow)
    expect(seo.title).toBe(
      'London Card Show — Esher Pokémon Card Show (August 2026) | PokePrices',
    )
  })

  it('title uses "Trading Card Show" for a broad mixed event', () => {
    const seo = getEventSeo(collectorsShowcase)
    expect(seo.title).toBe(
      'Collectors Showcase — Olympia — London Trading Card Show (November 2026) | PokePrices',
    )
  })

  it('description states the date, venue and city cleanly', () => {
    const seo = getEventSeo(londonCardShow)
    expect(seo.description).toContain('London Card Show takes place')
    expect(seo.description).toContain('14–16 August 2026')
    expect(seo.description).toContain('Sandown Park Racecourse')
    expect(seo.description).toContain('Esher, Surrey')
  })

  it('never invents venue when city is "Venue TBA"', () => {
    const seo = getEventSeo(tapAndPlay)
    expect(seo.description).not.toContain('at ')
    expect(seo.description).not.toContain('Venue TBA')
    expect(seo.description).toContain('takes place on 4 October 2026')
    expect(seo.description).toContain('in England')
    // Title falls back to country label when the city is TBA.
    expect(seo.title).toContain('Tap and Play Card Show — UK Pokémon Card Show (October 2026)')
  })

  it('canonical URL is /card-shows/{country}/{slug}', () => {
    expect(getEventSeo(londonCardShow).canonical).toBe(
      'https://www.pokeprices.io/card-shows/uk/london-card-show-esher-2026-08',
    )
  })

  it('never invents ticket prices or start times in the meta', () => {
    const seo = getEventSeo(londonCardShow)
    // The regex bans a concrete price pattern (£10 / $10 / 10 GBP) and a
    // clock-time pattern (10 AM / 10:30 AM) — the word "price" alone is
    // allowed because it appears inside "PokePrices" and is not a
    // fabricated claim.
    expect(seo.description).not.toMatch(/[£$]\s?\d+/)
    expect(seo.description).not.toMatch(/\d+\s?(AM|PM|a\.m\.|p\.m\.)/i)
    expect(seo.description).not.toMatch(/\bopens?\s+(at|around)\b/i)
    expect(seo.description).not.toMatch(/\d+\s?(GBP|USD|CAD|AUD|NZD)\b/i)
  })
})

// ── pickRelatedEvents ───────────────────────────────

describe('pickRelatedEvents', () => {
  const shows: CardShow[] = [
    { ...londonCardShow, id: 'a', slug: 'a', startDate: '2026-09-01' },
    { ...londonCardShow, id: 'b', slug: 'b', startDate: '2026-10-01' },
    { ...londonCardShow, id: 'c', slug: 'c', startDate: '2026-11-01' },
  ]

  it('excludes the current event', () => {
    const out = pickRelatedEvents(shows[0], shows, 5)
    expect(out.map(s => s.id)).toEqual(['b', 'c'])
  })

  it('caps at n', () => {
    const out = pickRelatedEvents(shows[0], shows, 1)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('sorts ascending by startDate', () => {
    const shuffled = [shows[2], shows[0], shows[1]]
    const out = pickRelatedEvents(shows[0], shuffled, 5)
    expect(out.map(s => s.id)).toEqual(['b', 'c'])
  })
})

// ── Country label lookup ────────────────────────────

describe('COUNTRY_TITLE_LABEL', () => {
  it('uses "USA" for us', () => {
    expect(COUNTRY_TITLE_LABEL.us).toBe('USA')
  })
  it('uses "UK" for uk', () => {
    expect(COUNTRY_TITLE_LABEL.uk).toBe('UK')
  })
  it('every country label is non-empty', () => {
    for (const c of ['uk', 'us', 'ca', 'au', 'nz'] as const) {
      expect(COUNTRY_TITLE_LABEL[c].length).toBeGreaterThan(0)
    }
  })
})
