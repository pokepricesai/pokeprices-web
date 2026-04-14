// app/api/imgproxy/route.ts
// Proxies external card images so html2canvas can render them without CORS issues

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  // Only allow known image domains
  const allowed = ['pricecharting.com', 'tcgplayer.com', 'pokemontcg.io', 'limitlesstcg.com', 'cdn.', 'images.', 'githubusercontent.com', 'raw.github', 'pokeapi']
  const isAllowed = allowed.some(d => url.includes(d))
  if (!isAllowed) return new NextResponse('Domain not allowed', { status: 403 })

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'PokePrices/1.0' } })
    if (!res.ok) return new NextResponse('Failed to fetch image', { status: 502 })

    const blob = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') || 'image/jpeg'

    return new NextResponse(blob, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (e) {
    return new NextResponse('Error fetching image', { status: 500 })
  }
}