/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Block 1C correction pass: web tsconfig is now zero-error, so the
    // build can enforce type correctness directly. The edge function
    // surface is intentionally excluded from tsconfig.json and is
    // checked separately via `npm run typecheck:edge:diagnostic`.
    ignoreBuildErrors: false,
  },

  // Stage 4C — SEO daily automation. The /api/cron/seo-daily route
  // dynamically imports @google-cloud/bigquery, google-auth-library
  // and @vercel/oidc for the Vercel-OIDC → WIF → SA-impersonation
  // auth flow. Next.js file tracing on Linux (Vercel) trips ENOENT
  // on optional/platform-specific bindings inside these packages —
  // deployment cb14e08 build failed with exactly that. Marking them
  // as serverExternalPackages tells Next.js to keep them as plain
  // node_modules require() at runtime instead of tracing/bundling
  // them, which is the Vercel-recommended pattern for Google Cloud
  // SDKs. Not needed for the CLI script (scripts/seo/ingest-bq-page-
  // daily.mjs), which is not part of the Next.js build.
  serverExternalPackages: [
    '@google-cloud/bigquery',
    'google-auth-library',
    '@vercel/oidc',
  ],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
    ],
  },
  // ── Baseline security headers (Block 1C) ───────────────────────────────
  // Conservative defaults that do not break any current behaviour. A real
  // Content-Security-Policy is intentionally deferred — see
  // docs/deployment-safety.md.
  async headers() {
    const baseline = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options',        value: 'SAMEORIGIN' },
      {
        key: 'Permissions-Policy',
        // camera + geolocation are kept on for the scanner and vendor
        // proximity lookup. Everything else is opted out.
        value: [
          'accelerometer=()',
          'autoplay=()',
          'browsing-topics=()',
          'camera=(self)',
          'display-capture=()',
          'encrypted-media=()',
          'fullscreen=(self)',
          'geolocation=(self)',
          'gyroscope=()',
          'magnetometer=()',
          'microphone=()',
          'midi=()',
          'payment=()',
          'picture-in-picture=(self)',
          'publickey-credentials-get=()',
          'screen-wake-lock=()',
          'sync-xhr=()',
          'usb=()',
          'xr-spatial-tracking=()',
        ].join(', '),
      },
    ]
    return [
      {
        // Apply to every route, including API routes and sitemap XML.
        source: '/:path*',
        headers: baseline,
      },
    ]
  },
}
module.exports = nextConfig
