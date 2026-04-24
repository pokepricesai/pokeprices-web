// app/layout.tsx
import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import SiteStructuredData from '@/components/SiteStructuredData'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.pokeprices.io'),
  title: {
    default: 'PokePrices — Pokémon Card Prices & PSA 10 Values (2026)',
  },
  description: 'How much is your Pokémon card worth? Live raw and PSA 10 values for 40,000+ cards. Price trends, grading spreads and PSA population data. Free, no login.',
  authors: [{ name: 'PokePrices' }],
  creator: 'PokePrices',
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: 'https://www.pokeprices.io',
    siteName: 'PokePrices',
    title: 'PokePrices — Pokémon Card Prices & PSA 10 Values (2026)',
    description: 'Live raw and PSA 10 values for 40,000+ Pokémon cards. Price trends, grading spreads, PSA population data. Free, no login.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PokePrices — Pokémon Card Price Guide',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PokePrices — Pokémon Card Prices & PSA 10 Values (2026)',
    description: 'Live raw and PSA 10 values for 40,000+ Pokémon cards. Price trends, grading spreads, PSA population data. Free, no login.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-32x32.png',
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800;900&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen flex flex-col" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-91WBNN7V11"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-91WBNN7V11');
          `}
        </Script>
        <SiteStructuredData />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}