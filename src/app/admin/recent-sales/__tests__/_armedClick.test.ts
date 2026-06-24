// Block 5A-W-3 — two-click confirmation gate for the admin write-mode
// button. Pure state-machine tests.

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ARM_THRESHOLD_MS,
  initialArmedState,
  nextArmedState,
} from '../_armedClick'

describe('nextArmedState — confirmation gate', () => {
  it('arms (but does not run) on the first click from the initial state', () => {
    const d = nextArmedState(initialArmedState(), 1_000)
    expect(d.armed).toBe(true)
    expect(d.armedAt).toBe(1_000)
    expect(d.shouldRun).toBe(false)
  })

  it('runs and disarms on the second click within the threshold', () => {
    const armed = nextArmedState(initialArmedState(), 1_000)
    const d     = nextArmedState({ armed: armed.armed, armedAt: armed.armedAt }, 1_500)
    expect(d.shouldRun).toBe(true)
    expect(d.armed).toBe(false)
    expect(d.armedAt).toBeNull()
  })

  it('runs at the exact threshold boundary', () => {
    const armed = nextArmedState(initialArmedState(), 1_000)
    const d     = nextArmedState({ armed: armed.armed, armedAt: armed.armedAt }, 1_000 + DEFAULT_ARM_THRESHOLD_MS)
    expect(d.shouldRun).toBe(true)
  })

  it('re-arms (does not run) when the second click is past the threshold', () => {
    const armed = nextArmedState(initialArmedState(), 1_000)
    const d     = nextArmedState({ armed: armed.armed, armedAt: armed.armedAt }, 1_000 + DEFAULT_ARM_THRESHOLD_MS + 1)
    expect(d.shouldRun).toBe(false)
    expect(d.armed).toBe(true)
    expect(d.armedAt).toBe(1_000 + DEFAULT_ARM_THRESHOLD_MS + 1)
  })

  it('accepts a custom threshold', () => {
    const armed = nextArmedState(initialArmedState(), 0)
    // Threshold 500ms; click at 600ms should re-arm, not run.
    const d600  = nextArmedState({ armed: armed.armed, armedAt: armed.armedAt }, 600, 500)
    expect(d600.shouldRun).toBe(false)
    // Threshold 500ms; click at 400ms should run.
    const d400  = nextArmedState({ armed: armed.armed, armedAt: armed.armedAt }, 400, 500)
    expect(d400.shouldRun).toBe(true)
  })

  it('treats a "stuck" armed state with armedAt=null as a fresh first click', () => {
    const d = nextArmedState({ armed: true, armedAt: null }, 5_000)
    expect(d.shouldRun).toBe(false)
    expect(d.armed).toBe(true)
    expect(d.armedAt).toBe(5_000)
  })

  it('a single click never runs (default state never produces shouldRun=true on its own)', () => {
    expect(nextArmedState(initialArmedState(), 0).shouldRun).toBe(false)
    expect(nextArmedState(initialArmedState(), 1).shouldRun).toBe(false)
    expect(nextArmedState(initialArmedState(), 999_999).shouldRun).toBe(false)
  })
})
