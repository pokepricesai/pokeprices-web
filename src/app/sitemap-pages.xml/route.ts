// app/sitemap-pages.xml/route.ts
import { NextResponse } from 'next/server'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const now = new Date().toISOString()

  const pages = [
    { url: BASE_URL, priority: '1.0', changefreq: 'daily' },
    { url: `${BASE_URL}/browse`, priority: '0.9', changefreq: 'daily' },
    { url: `${BASE_URL}/dealer`, priority: '0.7', changefreq: 'monthly' },
    { url: `${BASE_URL}/vendors`, priority: '0.7', changefreq: 'weekly' },
    { url: `${BASE_URL}/terms`, priority: '0.3', changefreq: 'monthly' },
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
