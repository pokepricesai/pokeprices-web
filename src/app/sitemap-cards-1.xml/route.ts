// app/sitemap-cards-1.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: cards, error } = await supabase
    .from('cards')
    .select('card_url_slug, set_name')
    .not('card_url_slug', 'is', null)
    .not('set_name', 'is', null)
    .order('id', { ascending: true })
    .range(0, 9999)
    .limit(10000)
  
  if (error) {
    console.error('sitemap-cards-1 error:', error)
    return new NextResponse('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
      headers: { 'Content-Type': 'application/xml' },
    })
  }

  const now = new Date().toISOString()
  const rows = cards || []

  const urls = rows
    .filter((c: any) => c.card_url_slug && c.set_name)
    .map((c: any) => `  <url>\n    <loc>https://www.pokeprices.io/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>`)
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
