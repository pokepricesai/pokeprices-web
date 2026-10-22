// Tests for the run status transition table. These invariants are
// what prevent an operator from accidentally re-starting a stopped run
// or skipping the ready step.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { RUN_TRANSITIONS, canTransition } from '../stateMachine'
import type { MigrationStatus } from '../types'

const ALL: MigrationStatus[] = ['draft','ready','running','paused','stopped','completed']

describe('RUN_TRANSITIONS', () => {
  it('every status key is covered', () => {
    for (const s of ALL) expect(RUN_TRANSITIONS[s]).toBeDefined()
  })

  it('terminal states have no exits', () => {
    expect(RUN_TRANSITIONS.stopped).toEqual([])
    expect(RUN_TRANSITIONS.completed).toEqual([])
  })

  it('draft can only go to ready — no shortcut to running', () => {
    expect(canTransition('draft', 'ready')).toBe(true)
    expect(canTransition('draft', 'running')).toBe(false)
    expect(canTransition('draft', 'stopped')).toBe(false)
  })

  it('ready → running and ready → stopped', () => {
    expect(canTransition('ready', 'running')).toBe(true)
    expect(canTransition('ready', 'stopped')).toBe(true)
    expect(canTransition('ready', 'paused')).toBe(false)
    expect(canTransition('ready', 'draft')).toBe(false)  // no backtrack
  })

  it('running → paused and running → stopped only', () => {
    expect(canTransition('running', 'paused')).toBe(true)
    expect(canTransition('running', 'stopped')).toBe(true)
    expect(canTransition('running', 'completed')).toBe(false)  // completed is set by cron, not operator
    expect(canTransition('running', 'draft')).toBe(false)
  })

  it('paused can resume to running or stop', () => {
    expect(canTransition('paused', 'running')).toBe(true)
    expect(canTransition('paused', 'stopped')).toBe(true)
    expect(canTransition('paused', 'draft')).toBe(false)
    expect(canTransition('paused', 'ready')).toBe(false)
  })

  it('nothing exits stopped or completed', () => {
    for (const next of ALL) {
      expect(canTransition('stopped', next)).toBe(false)
      expect(canTransition('completed', next)).toBe(false)
    }
  })

  it('cannot self-transition (status = status)', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false)
  })
})
