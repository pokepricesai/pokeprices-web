// src/emails/components/TextLink.tsx
// Inline brand-blue underlined link. Used as a tertiary action.

import { Link } from '@react-email/components'
import type { ReactNode } from 'react'
import { COLORS } from '../designTokens'

type Props = {
  href:     string
  children: ReactNode
  /** When true, removes underline and uses muted colour. */
  muted?:   boolean
}

export default function TextLink({ href, children, muted = false }: Props) {
  return (
    <Link
      href={href}
      style={{
        color:           muted ? COLORS.textMuted : COLORS.primary,
        textDecoration:  muted ? 'none' : 'underline',
        fontWeight:      muted ? 500 : 600,
      }}
    >
      {children}
    </Link>
  )
}
