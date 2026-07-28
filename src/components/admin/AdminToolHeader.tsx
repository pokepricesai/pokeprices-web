// src/components/admin/AdminToolHeader.tsx
// Block 5A-W-47C-FIX1 — small shared header used at the top of each
// UI admin tool so Luke can always get back to /admin (the central
// dashboard) and to the public site.
//
// Deliberately minimal: this is NOT a redesign. It renders one row
// with the tool name on the left and two text links on the right,
// using the existing PokePrices CSS variables. Every existing tool
// keeps its own layout and controls immediately below.
//
// Usage:
//   * On non-`/admin` tools: <AdminToolHeader toolName="Insights" />
//   * On `/admin` itself:    do NOT render this component (there is
//                            no "Admin Home" link to show from home).
//                            If it MUST be rendered on `/admin` (e.g.
//                            a nested surface) pass `showAdminHome={false}`.

import Link from 'next/link'

export type AdminToolHeaderProps = {
  /** Human display name for the tool. Rendered in a small pill on the left. */
  toolName: string
  /** Whether the "Admin Home" link is shown. Default true. Set to
   *  false on `/admin` itself so the header doesn't loop back to
   *  its own page. */
  showAdminHome?: boolean
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 16px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-light)',
  fontFamily: "'Figtree', sans-serif",
  flexWrap: 'wrap',
}
const toolPillStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  padding: '4px 10px',
  border: '1px solid var(--border)',
  borderRadius: 20,
  background: 'var(--card)',
}
const linkGroupStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
}
const linkStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text)',
  textDecoration: 'none',
  padding: '5px 12px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--card)',
}

export default function AdminToolHeader({ toolName, showAdminHome = true }: AdminToolHeaderProps) {
  return (
    <div style={headerStyle} data-admin-tool-header>
      <span style={toolPillStyle}>{toolName}</span>
      <div style={linkGroupStyle}>
        {showAdminHome && (
          <Link href="/admin" style={linkStyle}>Admin Home</Link>
        )}
        <Link href="/" style={linkStyle}>Return to site</Link>
      </div>
    </div>
  )
}
