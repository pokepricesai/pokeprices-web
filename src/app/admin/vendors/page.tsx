// Block 5A-W-50A — thin server wrapper for the vendor moderation UI.
// The client component owns auth + data-loading; this page exists so
// the /admin/vendors route resolves and metadata is set correctly.

import type { Metadata } from 'next'
import VendorsAdminClient from './VendorsAdminClient'

export const metadata: Metadata = {
  title:  'Vendor moderation — PokePrices admin',
  robots: { index: false, follow: false },
}

export default function VendorsAdminPage() {
  return <VendorsAdminClient />
}
