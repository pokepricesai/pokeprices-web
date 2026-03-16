// app/sitemap-pokemon.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: species, error } = await supabase
    .from('pokemon_species')
    .select('name')
    .order('id')
    .limit(1099)

  if (error) console.error('sitemap-pokemon error:', error)

  const now = new Date().toISOString()
  const urls = (species || []).map((s: any) =>
    `  <url>\n    <loc>${BASE_URL}/pokemon/${s.name.toLowerCase()}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  ).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`

  return new NextResponse(xml, { headers: { 'Content-Type': 'application/xml' } })
}
