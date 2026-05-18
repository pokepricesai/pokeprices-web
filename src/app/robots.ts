import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Disallowed:
      // - /admin, /intel  — internal tooling
      // - /api            — JSON endpoints, never user-facing
      // - /scan-test      — internal diagnostic harness (also noindex meta)
      // - /dashboard      — auth-gated tools, soft-404 to login if crawled
      //
      // Previously also disallowed:
      // - /dealer    — REMOVED. It is a public trade-evaluator tool kept
      //                in sitemap-pages, so blocking it contradicted the
      //                sitemap and the page was never indexed.
      // - /portfolio — REMOVED. Stale rule; no such public path exists.
      //                The real portfolio is /dashboard/portfolio, now
      //                covered by /dashboard.
      disallow: ['/admin', '/intel', '/api', '/scan-test', '/dashboard'],
    },
    sitemap: 'https://www.pokeprices.io/sitemap.xml',
  }
}
