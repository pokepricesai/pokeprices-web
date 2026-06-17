// src/emails/components/Divider.tsx
// Thin horizontal rule using brand divider colour.

import { Hr } from '@react-email/components'
import { COLORS, SPACING } from '../designTokens'

type Props = {
  /** Vertical margin in px around the divider. Defaults to SPACING.lg. */
  margin?: number
  /** Override colour. Defaults to brand divider. */
  color?: string
}

export default function Divider({ margin = SPACING.lg, color = COLORS.divider }: Props) {
  return (
    <Hr style={{
      margin:       `${margin}px 0`,
      border:       'none',
      borderTop:    `1px solid ${color}`,
      width:        '100%',
    }} />
  )
}
