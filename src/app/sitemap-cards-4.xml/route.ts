// app/sitemap-cards-4.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { data: cards } = await supabase
    .from('cards')
    .select('card_url_slug, set_name, updated_at')
    .not('card_url_slug', 'is', null)
    .order('id', { ascending: true })
    .range(30000, 39999)

  const now = new Date().toISOString()

  const urls = (cards || [])
    .filter((c: any) => c.card_url_slug && c.set_name)
    .map((c: any) => '  <url>\n    <loc>' + BASE_URL + '/set/' + encodeURIComponent(c.set_name) + '/card/' + c.card_url_slug + '</loc>\n    <lastmod>' + (c.updated_at ? new Date(c.updated_at).toISOString() : now) + '</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>')
    .join('\n')

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>'

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
