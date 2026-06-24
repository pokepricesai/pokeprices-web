// src/app/admin/recent-sales/_armedClick.ts
// Block 5A-W-3 — pure state machine backing the two-click confirmation
// on the admin write-mode button. Extracted so the gate can be unit-
// tested without spinning up a DOM environment.
//
// Semantics:
//   * First click: arm the button. shouldRun = false.
//   * Second click within thresholdMs: confirm. shouldRun = true; state resets.
//   * Second click after thresholdMs: treat as first click again. shouldRun = false.
//
// Combined with a setTimeout-based auto-disarm in the component, the
// admin must consciously click twice within the threshold to write
// alert_events — a stray double-click does not write.

export type ArmedState = { armed: boolean; armedAt: number | null }

export type ArmedDecision = ArmedState & { shouldRun: boolean }

export const DEFAULT_ARM_THRESHOLD_MS = 5_000

export function initialArmedState(): ArmedState {
  return { armed: false, armedAt: null }
}

export function nextArmedState(prev: ArmedState, now: number, thresholdMs: number = DEFAULT_ARM_THRESHOLD_MS): ArmedDecision {
  if (!prev.armed || prev.armedAt == null) {
    return { armed: true, armedAt: now, shouldRun: false }
  }
  const ageMs = now - prev.armedAt
  if (ageMs <= thresholdMs) {
    return { armed: false, armedAt: null, shouldRun: true }
  }
  // The arm window expired; treat this click as the first click again.
  return { armed: true, armedAt: now, shouldRun: false }
}
