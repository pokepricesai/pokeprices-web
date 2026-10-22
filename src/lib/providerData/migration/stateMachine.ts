// PP-TCG migration — run status transition table.
// Pure, no I/O. Exported for both the admin server action and tests.
//
// A transition is allowed iff `canTransition(cur, next) === true`.
// `stopped` and `completed` are terminal: no exits.

import type { MigrationStatus } from './types'

export const RUN_TRANSITIONS: Record<MigrationStatus, readonly MigrationStatus[]> = {
  draft:     ['ready'],
  ready:     ['running', 'stopped'],
  running:   ['paused', 'stopped'],
  paused:    ['running', 'stopped'],
  stopped:   [],   // terminal
  completed: [],   // terminal
}

export function canTransition(cur: MigrationStatus, next: MigrationStatus): boolean {
  return RUN_TRANSITIONS[cur]?.includes(next) ?? false
}
