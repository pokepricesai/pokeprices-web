// src/emails/components/FooterLink.tsx
// Standalone footer link with brand-muted styling.

import { Link } from '@react-email/components'
import type { ReactNode } from 'react'
import { COLORS } from '../designTokens'

type Props = { href: string; children: ReactNode }

export default function FooterLink({ href, children }: Props) {
  return (
    <Link
      href={href}
      style={{
        color:           COLORS.primary,
        textDecoration:  'underline',
        fontSize:        12,
        fontWeight:      600,
      }}
    >
      {children}
    </Link>
  )
}
