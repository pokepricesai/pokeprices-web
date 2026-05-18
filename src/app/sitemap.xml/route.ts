// app/sitemap.xml/route.ts
// Custom route handler — replaces the Next.js MetadataRoute.Sitemap export.
// The MetadataRoute helper only emits <urlset> output, which is the wrong
// root element for a sitemap *index*. Sub-sitemap URLs wrapped in <url>
// elements get read by Google as ordinary page URLs of the site rather
// than as further sitemaps to crawl. Using <sitemapindex> + <sitemap>
// children per the sitemaps.org spec makes Google walk each sub-sitemap.
import { NextResponse } from 'next/server'

const BASE_URL = 'https://www.pokeprices.io'

const SUB_SITEMAPS = [
  'sitemap-pages.xml',
  'sitemap-sets.xml',
  'sitemap-pokemon.xml',
  'sitemap-cards-1.xml',
  'sitemap-cards-2.xml',
  'sitemap-cards-3.xml',
  'sitemap-cards-4.xml',
  'sitemap-insights.xml',
]

export async function GET() {
  const now = new Date().toISOString()
  const entries = SUB_SITEMAPS.map(name =>
    `  <sitemap>\n    <loc>${BASE_URL}/${name}</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`
  ).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
