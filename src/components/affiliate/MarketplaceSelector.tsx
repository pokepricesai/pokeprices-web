'use client'

// src/components/affiliate/MarketplaceSelector.tsx
// Block 2D — compact eBay marketplace selector.
//
// Render rules:
//   * Hidden when fewer than two marketplaces are configured.
//   * Hidden until useMarketplace() reports ready (avoids flash of
//     wrong flag).
//   * No campaign IDs in the visible UI.

import { useState, useRef, useEffect } from 'react'
import { useMarketplace } from '@/lib/marketplaceClient'
import type { MarketplaceCode } from '@/lib/marketplaces'

type Size = 'sm' | 'md'

export default function MarketplaceSelector({
  size = 'sm',
  ariaLabel = 'eBay marketplace',
}: { size?: Size; ariaLabel?: string }) {
  const mp = useMarketplace()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!mp.isReady) return null
  if (mp.selectableMarketplaces.length < 2) return null

  const active = mp.selectableMarketplaces.find(d => d.code === mp.marketplace)
                ?? mp.selectableMarketplaces[0]

  const padding = size === 'sm' ? '4px 8px' : '6px 12px'
  const fontSize = size === 'sm' ? 11 : 13
  const flagSize = size === 'sm' ? 12 : 14

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding, borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'var(--text)',
          fontSize, fontWeight: 700,
          fontFamily: "'Figtree', sans-serif",
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: flagSize }} aria-hidden="true">{active.flag}</span>
        <span>{active.code}</span>
        <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <ul
          role="listbox"
          tabIndex={-1}
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            margin: 0, padding: 4,
            listStyle: 'none',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            minWidth: 160,
            zIndex: 80,
          }}
        >
          {mp.selectableMarketplaces.map(def => {
            const isActive = def.code === active.code
            return (
              <li key={def.code}>
                <button
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    mp.setMarketplace(def.code as MarketplaceCode)
                    setOpen(false)
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 10px',
                    background: isActive ? 'var(--bg-light)' : 'transparent',
                    border: 'none',
                    color: 'var(--text)',
                    fontSize: 13, fontWeight: 600,
                    fontFamily: "'Figtree', sans-serif",
                    cursor: 'pointer', textAlign: 'left',
                    borderRadius: 6,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-light)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isActive ? 'var(--bg-light)' : 'transparent' }}
                >
                  <span style={{ fontSize: 16 }} aria-hidden="true">{def.flag}</span>
                  <span style={{ flex: 1 }}>{def.label}</span>
                  {isActive && <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--primary)' }}>✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
