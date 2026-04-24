import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/intel', '/dealer', '/portfolio', '/api'],
    },
    sitemap: 'https://www.pokeprices.io/sitemap.xml',
  }
}
