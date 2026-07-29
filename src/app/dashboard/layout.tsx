// src/app/dashboard/layout.tsx
// Block 5A-W-47F — the customer dashboard now uses a persistent
// left-hand sidebar. The layout wraps every /dashboard route with
// DashboardShell, which:
//   * renders the sidebar + content area on desktop;
//   * renders a "Dashboard menu" button + slide-in drawer on mobile;
//   * transparently unwraps itself on /dashboard/login so the login
//     page renders without a nav column.
// Per-page auth continues to be handled by requireAuthUser() in each
// server component; the shell never sees an unauthenticated view
// because that redirect fires upstream.

import type { Metadata } from 'next'
import DashboardShell from './DashboardShell'

export const metadata: Metadata = {
  title: 'Dashboard — PokePrices',
  robots: { index: false, follow: false },
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShell>{children}</DashboardShell>
}
