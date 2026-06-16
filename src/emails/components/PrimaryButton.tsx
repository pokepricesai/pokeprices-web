// src/emails/components/PrimaryButton.tsx

import { Button } from '@react-email/components'
import type { ReactNode } from 'react'

const style: React.CSSProperties = {
  display:         'inline-block',
  padding:         '12px 18px',
  borderRadius:    10,
  backgroundColor: '#1a5fad',
  color:           '#ffffff',
  fontWeight:      700,
  textDecoration:  'none',
  fontSize:        14,
}

export default function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return <Button href={href} style={style}>{children}</Button>
}
