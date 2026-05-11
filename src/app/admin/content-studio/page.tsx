// app/admin/content-studio/page.tsx
import ContentStudioClient from './ContentStudioClient'

export const metadata = {
  title: 'Content Studio | PokePrices',
  robots: { index: false, follow: false },
}

export default function ContentStudioPage() {
  return <ContentStudioClient />
}
