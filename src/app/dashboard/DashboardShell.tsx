'use client'
// Block 5A-W-47F — persistent-shell wrapper for the customer
// dashboard. Mounted from src/app/dashboard/layout.tsx so it wraps
// every /dashboard route once.
//
//   * Desktop: sticky sidebar on the left, content on the right.
//   * Mobile: sidebar collapses into a slide-in drawer, opened by a
//     "Dashboard menu" button that sits at the top of the content
//     column.
//
// The auth check per route is unchanged — each page's server
// component still calls requireAuthUser(). The shell is a client
// wrapper; when the requireAuthUser redirect fires, the shell never
// renders because the redirect throws upstream.
//
// The one exception is /dashboard/login itself, which must render
// without the shell so anonymous visitors see a bare login page.
// That is handled here with a pathname gate.

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import DashboardSidebar from './DashboardSidebar'

const SIDEBAR_WIDTH = 240   // desktop sidebar column width
const NAVBAR_HEIGHT = 60    // public Navbar height — matches Navbar.tsx
const MOBILE_MAX     = 900  // widths <= this get the collapsed drawer

// Static class names so the media-query stylesheet below can target
// them without needing CSS modules or a new dependency.
const CLS = {
  shell:      'pp-dash-shell',
  sidebar:    'pp-dash-sidebar',
  content:    'pp-dash-content',
  menuButton: 'pp-dash-menu-button',
  drawer:     'pp-dash-drawer',
  backdrop:   'pp-dash-backdrop',
} as const

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null)

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const openDrawer  = useCallback(() => setDrawerOpen(true), [])

  // ── Escape closes the drawer ──
  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeDrawer()
        // Return focus to the button that opened the drawer so
        // keyboard flow doesn't fall off a cliff.
        setTimeout(() => menuButtonRef.current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])

  // ── Body scroll lock while the drawer is open ──
  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [drawerOpen])

  // ── Move focus to the close control when the drawer opens ──
  useEffect(() => {
    if (drawerOpen) {
      setTimeout(() => drawerCloseRef.current?.focus(), 0)
    }
  }, [drawerOpen])

  // ── /dashboard/login has no sidebar (bare login page) ──
  if (pathname === '/dashboard/login') {
    return <>{children}</>
  }

  return (
    <>
      {/* Media-query stylesheet — tiny, colocated, no new dep. */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            .${CLS.shell} {
              display: flex;
              align-items: flex-start;
              gap: 0;
              width: 100%;
            }
            .${CLS.sidebar} {
              position: sticky;
              top: ${NAVBAR_HEIGHT}px;
              width: ${SIDEBAR_WIDTH}px;
              flex-shrink: 0;
              height: calc(100vh - ${NAVBAR_HEIGHT}px);
              background: var(--card);
              border-right: 1px solid var(--border);
              overflow: hidden;
            }
            .${CLS.content} {
              flex: 1;
              min-width: 0;
              width: 100%;
            }
            .${CLS.menuButton} { display: none; }
            /* The drawer + backdrop are conditionally unmounted when
               closed (see JSX below) — they only enter the DOM while
               drawerOpen === true, which removes them from tab order,
               the accessibility tree, and the DOM entirely. The rules
               below style them for the open state on mobile, and gate
               them off on desktop just in case the drawer is left
               open across a viewport resize. */
            .${CLS.backdrop} { display: none; }
            .${CLS.drawer}   { display: none; }

            @media (max-width: ${MOBILE_MAX}px) {
              .${CLS.sidebar} { display: none; }
              .${CLS.menuButton} {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                margin: 12px 16px 0;
                padding: 8px 14px;
                font-family: 'Figtree', sans-serif;
                font-size: 12px;
                font-weight: 800;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: var(--text);
                background: var(--card);
                border: 1px solid var(--border);
                border-radius: 8px;
                cursor: pointer;
              }
              .${CLS.backdrop} {
                display: block;
                position: fixed; inset: 0;
                background: rgba(15, 48, 96, 0.45);
                z-index: 120;
              }
              .${CLS.drawer} {
                display: flex;
                flex-direction: column;
                position: fixed;
                top: 0; left: 0; bottom: 0;
                width: 280px; max-width: 88vw;
                background: var(--card);
                border-right: 1px solid var(--border);
                box-shadow: 0 20px 40px rgba(0,0,0,0.18);
                z-index: 130;
              }
            }
          `,
        }}
      />

      <div className={CLS.shell}>
        {/* ── Desktop: persistent sidebar column ── */}
        <aside className={CLS.sidebar} aria-label="Dashboard sidebar">
          <DashboardSidebar />
        </aside>

        {/* ── Content column (desktop + mobile) ── */}
        <div className={CLS.content}>
          {/* Mobile: menu opener button */}
          <button
            ref={menuButtonRef}
            type="button"
            className={CLS.menuButton}
            onClick={openDrawer}
            aria-expanded={drawerOpen}
            aria-controls="pp-dashboard-drawer"
          >
            <span aria-hidden="true">☰</span>
            Dashboard menu
          </button>

          {children}
        </div>
      </div>

      {/* ── Mobile drawer + backdrop ──
          Conditionally unmounted while closed so the drawer's links
          and close button are removed from the DOM, the accessibility
          tree, and the tab order — not just hidden with `display:
          none`. This is the a11y-preferred pattern per the W47F fix
          brief. */}
      {drawerOpen && (
        <>
          <div
            className={CLS.backdrop}
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <div
            id="pp-dashboard-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard menu"
            className={CLS.drawer}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{
                fontFamily: "'Figtree', sans-serif",
                fontSize: 11, fontWeight: 800,
                letterSpacing: 1.5, textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}>
                Menu
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close dashboard menu"
                style={{
                  padding: '4px 10px',
                  fontSize: 20, lineHeight: 1,
                  color: 'var(--text)',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <DashboardSidebar onNavigate={closeDrawer} />
            </div>
          </div>
        </>
      )}
    </>
  )
}
