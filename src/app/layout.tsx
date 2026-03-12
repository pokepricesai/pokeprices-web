import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  metadataBase: new URL('https://pokeprices.io'),
  title: {
    default: 'PokePrices — Know What Your Cards Are Really Worth',
    template: '%s | PokePrices',
  },
  description: 'Real Pokemon card prices for 40,000+ cards across 156 sets. Daily updates, PSA population data, trend analysis and grading advice. Free, no login required.',
  keywords: ['pokemon card prices', 'pokemon tcg price guide', 'PSA population', 'pokemon card values', 'pokemon grading', 'pokemon card market'],
  authors: [{ name: 'PokePrices' }],
  creator: 'PokePrices',
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: 'https://pokeprices.io',
    siteName: 'PokePrices',
    title: 'PokePrices — Know What Your Cards Are Really Worth',
    description: 'Real Pokemon card prices for 40,000+ cards. Daily updates, PSA population data, grading advice. Free.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'PokePrices — Pokemon Card Price Guide',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PokePrices — Know What Your Cards Are Really Worth',
    description: 'Real Pokemon card prices for 40,000+ cards. Daily updates, PSA population data, grading advice. Free.',
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
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet" />
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
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
