// app/sitemap-card-shows.xml/route.ts
//
// Block 5A-W-54B — dedicated sitemap for individual card-show event
// detail pages. Upcoming, non-cancelled events are surfaced with
// `lastChecked` as `<lastmod>`. Country landing pages continue to
// live in sitemap-pages.xml.

import { NextResponse } from 'next/server'
import {
  getUpcomingCardShows,
  type CardShow,
} from '@/data/cardShows'

const BASE_URL = 'https://www.pokeprices.io'

function iso(dateOrDay: string): string {
  // Accepts `YYYY-MM-DD`; sitemap `lastmod` accepts both bare dates
  // and full ISO — bare date is the more conservative choice.
  return dateOrDay
}

function urlEntry(show: CardShow): string {
  const loc = `${BASE_URL}/card-shows/${show.country}/${show.slug}`
  const lastmod = iso(show.lastChecked || show.startDate)
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>0.5</priority>',
    '  </url>',
  ].join('\n')
}

export async function GET() {
  // Only include upcoming, non-cancelled events. Past + cancelled
  // pages continue to resolve — they just don't appear in the sitemap.
  const shows = getUpcomingCardShows().filter(s => s.status !== 'cancelled')
  const urls = shows.map(urlEntry).join('\n')

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>'

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
