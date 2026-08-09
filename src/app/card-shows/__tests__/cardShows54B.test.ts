// Block 5A-W-54B — source-contract tests for the /card-shows surface.
// The repo's vitest env is 'node' with no React Testing Library, so
// component-render tests aren't available; we pin the wired-up strings
// on the source files instead.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const HUB   = read('src/app/card-shows/page.tsx')
const UK    = read('src/app/card-shows/uk/page.tsx')
const US    = read('src/app/card-shows/us/page.tsx')
const CA    = read('src/app/card-shows/ca/page.tsx')
const AU    = read('src/app/card-shows/au/page.tsx')
const NZ    = read('src/app/card-shows/nz/page.tsx')
const BODY  = read('src/app/card-shows/CountryLandingBody.tsx')
const EVENT = read('src/app/card-shows/[country]/[slug]/page.tsx')
const LIST  = read('src/app/card-shows/CardShowList.tsx')
const SITEMAP = read('src/app/sitemap-card-shows.xml/route.ts')
const SITEMAP_INDEX = read('src/app/sitemap.xml/route.ts')

// ── Country pages are thin shells ───────────────────

describe('54B — country pages delegate to helpers', () => {
  for (const [name, src, code] of [
    ['UK', UK, 'uk'],
    ['US', US, 'us'],
    ['CA', CA, 'ca'],
    ['AU', AU, 'au'],
    ['NZ', NZ, 'nz'],
  ] as const) {
    it(`${name} — generateMetadata uses getCountrySeo with dynamic count + year`, () => {
      expect(src).toContain("getCardShowsByCountry('" + code + "')")
      expect(src).toContain("getCountrySeo('" + code + "', new Date().getFullYear(), shows.length)")
      expect(src).toMatch(/alternates:\s+\{\s*canonical:\s*seo\.canonical\s*\}/)
    })
    it(`${name} — renders <CountryLandingBody country="${code}" />`, () => {
      expect(src).toContain(`<CountryLandingBody country="${code}" />`)
    })
  }
})

describe('54B — CountryLandingBody renders the SEO-driven H1 + intro + fact row', () => {
  it('uses seo.h1 rather than a per-country hardcoded string', () => {
    expect(BODY).toMatch(/\{seo\.h1\}/)
    expect(BODY).toMatch(/\{seo\.intro\}/)
  })
  it('exposes the four summary facts (Upcoming shows / Cities / Next show / Listings checked)', () => {
    expect(BODY).toContain('Upcoming shows')
    expect(BODY).toContain('Cities represented')
    expect(BODY).toContain('Next show')
    expect(BODY).toContain('Listings checked')
  })
  it('renders CardShowList with the country prop threaded through', () => {
    expect(BODY).toContain('<CardShowList shows={shows} regions={regions} country={country} />')
  })
})

// ── Hub SEO ────────────────────────────────────────

describe('54B — Hub page', () => {
  it('uses getHubSeo() for the title / description / canonical / H1 / intro', () => {
    expect(HUB).toContain('getHubSeo(new Date().getFullYear())')
    expect(HUB).toMatch(/title:\s*seo\.title/)
    expect(HUB).toMatch(/description:\s*seo\.description/)
    expect(HUB).toMatch(/canonical:\s*seo\.canonical/)
    expect(HUB).toMatch(/\{seo\.h1\}/)
  })
  it('iterates CARD_SHOW_COUNTRIES for the country CTA grid', () => {
    expect(HUB).toContain('CARD_SHOW_COUNTRIES.map(c => (')
  })
  it('renders a descriptive-link row per country ("All {LABEL} Pokémon Card Shows")', () => {
    expect(HUB).toContain('All {COUNTRY_TITLE_LABEL[c]} Pokémon Card Shows')
  })
})

// ── Event-detail SEO + structured data ─────────────

describe('54B — event-detail page', () => {
  it('generateMetadata uses getEventSeo', () => {
    expect(EVENT).toContain('const seo = getEventSeo(show)')
    expect(EVENT).toMatch(/title:\s+seo\.title/)
  })

  it('emits Event + BreadcrumbList JSON-LD via imported helpers (54B.1 extraction)', () => {
    // Block 5A-W-54B.1 — schema builders moved into cardShowSeo.ts
    // so they can be unit-tested. Route just wires the calls.
    expect(EVENT).toContain('buildEventSchema')
    expect(EVENT).toContain('buildBreadcrumbSchema')
    expect(EVENT).toContain('JSON.stringify(eventSchema)')
    expect(EVENT).toContain('JSON.stringify(crumbSchema)')
  })

  it('backlink text is the descriptive "All {LABEL} Pokémon Card Shows"', () => {
    expect(EVENT).toContain('function backLinkText')
    expect(EVENT).toContain('`All ${COUNTRY_TITLE_LABEL[country]} Pokémon Card Shows`')
    // Anti-regression: the old generic backlink is gone.
    expect(EVENT).not.toContain("'← Back to '")
    expect(EVENT).not.toMatch(/← Back to \{country ===/)
  })

  it('surfaces the related-events section using pickRelatedEvents', () => {
    expect(EVENT).toContain('pickRelatedEvents(show, getCardShowsByCountry(country), 5)')
    expect(EVENT).toContain('Other upcoming Pokémon card shows in')
  })

  it('primary action button is "Get Tickets" (was "Tickets")', () => {
    expect(EVENT).toContain('Get Tickets ↗')
  })
})

// ── Sitemap ────────────────────────────────────────

describe('54B — event sitemap', () => {
  it('sitemap.xml index references the new sitemap-card-shows.xml shard', () => {
    expect(SITEMAP_INDEX).toContain("'sitemap-card-shows.xml'")
  })

  it('sitemap-card-shows.xml only emits upcoming, non-cancelled events', () => {
    expect(SITEMAP).toContain("getUpcomingCardShows()")
    expect(SITEMAP).toContain("filter(s => s.status !== 'cancelled')")
  })

  it('sitemap-card-shows.xml uses lastChecked as <lastmod>', () => {
    expect(SITEMAP).toContain('show.lastChecked || show.startDate')
    expect(SITEMAP).toContain('<lastmod>')
  })

  it('sitemap-card-shows.xml URL shape is /card-shows/{country}/{slug}', () => {
    expect(SITEMAP).toContain('`${BASE_URL}/card-shows/${show.country}/${show.slug}`')
  })

  it('sitemap root is a valid urlset (not a sitemapindex)', () => {
    expect(SITEMAP).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(SITEMAP).not.toContain('<sitemapindex')
  })
})

// ── List row scannability ──────────────────────────

describe('54B — CardShowList row', () => {
  it('description is line-clamped for scannability', () => {
    expect(LIST).toContain('WebkitLineClamp: 3')
  })
  it('every country including au / nz gets a metric distance display', () => {
    expect(LIST).toContain("country === 'uk' || country === 'ca' || country === 'au' || country === 'nz'")
  })
  it('AU + NZ get a helpful location-input placeholder', () => {
    expect(LIST).toContain("country === 'au' ? 'e.g. Sydney or 2000'")
    expect(LIST).toContain("country === 'nz' ? 'e.g. Auckland or 1010'")
  })
})
