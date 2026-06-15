// src/app/auth/reset-password/page.tsx
// Public page (NOT under /dashboard) where the user lands after the
// password-recovery callback. The recovery callback already exchanged
// the code for a session, so the browser is now authenticated; we just
// need to let the user pick a new password.

import type { Metadata } from 'next'
import ResetPasswordClient from './ResetPasswordClient'

export const metadata: Metadata = {
  title: 'Reset your password — PokePrices',
  robots: { index: false, follow: false },
}

export default function ResetPasswordPage() {
  return <ResetPasswordClient />
}
