// Static directory of UK / US Pokémon card shows + TCG fairs.
//
// Maintained by hand from a spreadsheet — see scripts/import-card-shows.mjs
// for converting CSV rows into the CardShow shape below. Kept as a static
// .ts file (rather than a DB table) because volume is low (dozens of events
// at a time), the page can be statically rendered, and the contributor
// (Luke) edits the source of truth in Excel anyway.

export interface CardShow {
  id: string
  name: string
  slug: string
  country: 'uk' | 'us'
  region: string
  city: string
  venue?: string
  address?: string
  postcode?: string
  startDate: string                 // ISO yyyy-mm-dd
  endDate?: string                  // ISO yyyy-mm-dd, omit for single-day
  recurring?: string                // e.g. "monthly", "first sunday of the month"
  eventType: 'pokemon' | 'tcg' | 'card-show' | 'collectibles' | 'mixed'
  description: string
  organiserName?: string
  websiteUrl?: string
  ticketUrl?: string
  instagramUrl?: string
  facebookUrl?: string
  imageUrl?: string
  featured?: boolean
  lastChecked: string               // ISO yyyy-mm-dd — when the entry was last verified
  status: 'upcoming' | 'cancelled' | 'past' | 'unknown'
}

// ── Seed entries ────────────────────────────────────────────────────────────
// A small set of placeholder events so the routes render with real-looking
// content. Replace these with the real spreadsheet output via the CSV
// importer. Kept short so the file diff is reviewable.

export const cardShows: CardShow[] = [
  {
    id: 'uk-london-card-show-2026-05',
    name: 'London Card Show',
    slug: 'london-card-show-london-2026-05',
    country: 'uk',
    region: 'Greater London',
    city: 'London',
    venue: 'Olympia London',
    address: 'Hammersmith Rd, London W14 8UX',
    postcode: 'W14 8UX',
    startDate: '2026-05-17',
    eventType: 'card-show',
    description: 'A monthly trading card meet-up with Pokémon, sports, and TCG vendors. Casual buying, selling, trading and grading drop-off.',
    organiserName: 'London Card Show',
    websiteUrl: 'https://www.londoncardshow.co.uk',
    instagramUrl: 'https://www.instagram.com/londoncardshow',
    featured: true,
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
  {
    id: 'uk-manchester-card-fair-2026-05',
    name: 'Manchester TCG Fair',
    slug: 'manchester-tcg-fair-manchester-2026-05',
    country: 'uk',
    region: 'Greater Manchester',
    city: 'Manchester',
    venue: 'Manchester Central',
    startDate: '2026-05-31',
    eventType: 'tcg',
    description: 'Pokémon, Magic and Yu-Gi-Oh vendors, with grading hand-ins for PSA and CGC available on the day.',
    websiteUrl: 'https://www.manchestercardshow.co.uk',
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
  {
    id: 'uk-birmingham-collectorscon-2026-06',
    name: "Birmingham Collectors' Con",
    slug: 'birmingham-collectors-con-birmingham-2026-06',
    country: 'uk',
    region: 'West Midlands',
    city: 'Birmingham',
    venue: 'NEC Birmingham',
    startDate: '2026-06-14',
    endDate: '2026-06-15',
    eventType: 'collectibles',
    description: 'Two-day collectibles event featuring Pokémon TCG, sports cards, sealed product and graded slabs.',
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
  {
    id: 'us-philadelphia-card-show-2026-05',
    name: 'Philly Show',
    slug: 'philly-show-philadelphia-2026-05',
    country: 'us',
    region: 'Pennsylvania',
    city: 'Philadelphia',
    venue: 'Greater Philadelphia Expo Center',
    address: '100 Station Ave, Oaks, PA 19456',
    startDate: '2026-05-09',
    endDate: '2026-05-10',
    eventType: 'card-show',
    description: "One of the East Coast's biggest trading card events. Hundreds of vendors, on-site grading drop-offs, and sealed Pokémon product.",
    organiserName: 'The Philly Show',
    websiteUrl: 'https://www.thephillyshow.com',
    featured: true,
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
  {
    id: 'us-national-sports-collectors-2026-07',
    name: 'National Sports Collectors Convention',
    slug: 'national-sports-collectors-convention-rosemont-2026-07',
    country: 'us',
    region: 'Illinois',
    city: 'Rosemont',
    venue: 'Donald E. Stephens Convention Center',
    startDate: '2026-07-29',
    endDate: '2026-08-02',
    eventType: 'mixed',
    description: 'The largest trading card and memorabilia show in the world. Pokémon vendors, breaks, autograph sessions and major grading hand-ins.',
    organiserName: 'NSCC',
    websiteUrl: 'https://nsccshow.com',
    featured: true,
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
  {
    id: 'us-dallas-card-show-2026-06',
    name: 'Dallas Card Show',
    slug: 'dallas-card-show-allen-2026-06',
    country: 'us',
    region: 'Texas',
    city: 'Allen',
    venue: 'Allen Event Center',
    startDate: '2026-06-21',
    endDate: '2026-06-22',
    eventType: 'card-show',
    description: 'Quarterly Texas trading card show with strong Pokémon vendor representation and on-site grading drop-offs.',
    websiteUrl: 'https://www.dallascardshow.com',
    lastChecked: '2026-05-02',
    status: 'upcoming',
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function isUpcoming(show: CardShow, today = new Date()): boolean {
  if (show.status !== 'upcoming') return false
  // Use endDate if available so multi-day events stay listed throughout.
  const end = show.endDate || show.startDate
  return new Date(end) >= new Date(today.toISOString().slice(0, 10))
}

function byStartDateAsc(a: CardShow, b: CardShow): number {
  return a.startDate.localeCompare(b.startDate)
}

export function getUpcomingCardShows(): CardShow[] {
  return cardShows.filter(s => isUpcoming(s)).sort(byStartDateAsc)
}

export function getCardShowsByCountry(country: 'uk' | 'us'): CardShow[] {
  return cardShows
    .filter(s => s.country === country && isUpcoming(s))
    .sort(byStartDateAsc)
}

export function getCardShowBySlug(country: 'uk' | 'us', slug: string): CardShow | null {
  return cardShows.find(s => s.country === country && s.slug === slug) ?? null
}

export function getFeaturedCardShows(): CardShow[] {
  return cardShows
    .filter(s => s.featured && isUpcoming(s))
    .sort(byStartDateAsc)
}

export function getCardShowsByCity(country: 'uk' | 'us', city: string): CardShow[] {
  const norm = city.trim().toLowerCase()
  return cardShows
    .filter(s => s.country === country && s.city.toLowerCase() === norm && isUpcoming(s))
    .sort(byStartDateAsc)
}

// Used by listing-page filters — distinct regions/event-types in country.
export function getRegionsForCountry(country: 'uk' | 'us'): string[] {
  const set = new Set<string>()
  for (const s of cardShows) {
    if (s.country === country && isUpcoming(s) && s.region) set.add(s.region)
  }
  return Array.from(set).sort()
}

// Pretty-print "17 May 2026" or "31 May – 1 Jun 2026" for date display.
export function formatShowDate(show: CardShow): string {
  const start = new Date(show.startDate)
  if (!show.endDate || show.endDate === show.startDate) {
    return start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const end = new Date(show.endDate)
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
  }
  return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export const EVENT_TYPE_LABEL: Record<CardShow['eventType'], string> = {
  pokemon:       'Pokémon',
  tcg:           'TCG',
  'card-show':   'Card Show',
  collectibles:  'Collectibles',
  mixed:         'Mixed',
}

export const COUNTRY_LABEL: Record<CardShow['country'], string> = {
  uk: 'United Kingdom',
  us: 'United States',
}
