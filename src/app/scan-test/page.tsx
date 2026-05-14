// /scan-test — private camera test harness for evaluating recognition
// accuracy of the scan-card edge function. Not indexed, not linked from
// anywhere. Access by URL only.
import type { Metadata } from 'next'
import ScanTestClient from './ScanTestClient'

export const metadata: Metadata = {
  title: 'Scan Test',
  description: 'Internal scanner test harness.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
}

export default function ScanTestPage() {
  return <ScanTestClient />
}
