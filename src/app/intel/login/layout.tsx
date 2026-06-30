// src/app/intel/login/layout.tsx
// Block 5A-W-32 — the /intel/login page is a client component and
// could not declare its own metadata. /intel/* is already disallowed
// in robots.txt, but this metadata is belt-and-braces: if robots.txt
// is ever softened, the noindex directive still keeps the password
// prompt out of search results.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title:  'Intel — PokePrices',
  robots: { index: false, follow: false },
}

export default function IntelLoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
