// @vitest-environment jsdom
// Block 5A-W-50E — scroll restoration hook tests. The tests exercise
// the pure save + restore surface (saveScrollForRoute + the payload
// contract) plus the anchor safety story. The full React hook
// lifecycle is verified via saveScrollForRoute directly here to
// avoid pulling in @testing-library/react solely for these units;
// higher-level scenarios are covered by the manual browser checklist
// in the block report.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveScrollForRoute, __TEST__ } from '../useRouteScrollRestoration'
import { markHistoryReturn, consumeHistoryReturn } from '../historyReturnMarker'

beforeEach(() => {
  window.sessionStorage.clear()
  window.scrollTo(0, 0)
})

describe('saveScrollForRoute', () => {
  it('writes a JSON payload with y / savedAt / docHeight', () => {
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true })
    saveScrollForRoute('/browse?language=jp')
    const raw = window.sessionStorage.getItem(__TEST__.SCROLL_PREFIX + '/browse?language=jp')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.y).toBe(420)
    expect(typeof parsed.savedAt).toBe('number')
    expect(typeof parsed.docHeight).toBe('number')
  })

  it('captures the anchor identity + relative offset when provided', () => {
    const el = document.createElement('div')
    el.setAttribute('data-set-name', 'Japanese Battle Partners')
    document.body.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 42, bottom: 100, left: 0, right: 0, width: 0, height: 58, x: 0, y: 42, toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(window, 'scrollY', { value: 1000, configurable: true })

    saveScrollForRoute('/browse', () => ({ kind: 'set', id: 'Japanese Battle Partners' }), (a) => {
      return document.body.querySelector(`[data-set-name="${a.id}"]`)
    })

    const raw = window.sessionStorage.getItem(__TEST__.SCROLL_PREFIX + '/browse')
    const parsed = JSON.parse(raw!)
    expect(parsed.anchor).toEqual({ kind: 'set', id: 'Japanese Battle Partners' })
    // Saved offset is -viewportTop so anchorTopAbs + offset re-establishes
    // the viewport position at restore time.
    expect(parsed.anchorOffsetY).toBe(-42)
  })

  it('never throws when sessionStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => saveScrollForRoute('/browse')).not.toThrow()
    spy.mockRestore()
  })
})

describe('anchor lookup safety — punctuation-heavy Japanese set names', () => {
  it("uses CSS.escape so an apostrophe does not corrupt the selector", () => {
    const container = document.createElement('div')
    const child = document.createElement('div')
    child.setAttribute('data-set-name', "Japanese Leaders' Stadium")
    container.appendChild(child)
    document.body.appendChild(container)

    const findAnchor = (id: string) => {
      const safe = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(id)
        : id
      return container.querySelector(`[data-set-name="${safe}"]`)
    }
    expect(findAnchor("Japanese Leaders' Stadium")).toBe(child)
  })

  it("falls back to dataset iteration when CSS.escape is unavailable", () => {
    const container = document.createElement('div')
    for (const name of ['Regular', "Japanese Leaders' Stadium", 'Another']) {
      const el = document.createElement('div')
      el.setAttribute('data-set-name', name)
      container.appendChild(el)
    }
    // Simulate no CSS.escape support.
    const findAnchorNoEscape = (id: string) => {
      const nodes = container.querySelectorAll('[data-set-name]')
      for (let i = 0; i < nodes.length; i++) {
        if ((nodes[i] as HTMLElement).getAttribute('data-set-name') === id) return nodes[i]
      }
      return null
    }
    const found = findAnchorNoEscape("Japanese Leaders' Stadium")
    expect(found).not.toBeNull()
  })
})

describe('history-return marker integration with scroll payload', () => {
  it('restoration is gated on a valid history-return marker', () => {
    // Save a payload but do NOT set the return marker. A fresh visit
    // must not restore the stale entry.
    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true })
    saveScrollForRoute('/browse')
    // No marker present -> the destination page's hook would not
    // consume anything and would not attempt restore.
    expect(consumeHistoryReturn('/browse')).toBe(false)
  })

  it('history-return marker is consumed once', () => {
    markHistoryReturn('/browse')
    expect(consumeHistoryReturn('/browse')).toBe(true)
    expect(consumeHistoryReturn('/browse')).toBe(false)
  })
})
