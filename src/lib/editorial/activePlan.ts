// src/lib/editorial/activePlan.ts
//
// Block 5 final — single source of truth for the visible strategist
// plan. Pure module (no React, no browser deps) so it can be unit
// tested without dragging in the Editorial HQ client bundle.
//
// The visible plan is DERIVED from the assistant's chat history via
// computeActivePlan(). It is not stored anywhere. That guarantees the
// panel can never drift from what the assistant actually said,
// because it IS what the assistant said — merged by the rules below.
// Previously the plan was mutated in two different code paths
// (`runRecommend` flat-replaced, `runChat` merged), so a subtle state
// race could leave the panel showing "no primary" while the underlying
// merge intent was "keep primary". With this derivation, that class
// of bug is impossible.

import type { StrategistRecommendation, StrategistResponse } from './strategistPrompt'

export type ActivePlan = {
  summary:      string
  primary:      StrategistRecommendation[]
  alternatives: StrategistRecommendation[]
}

export type ChatTurn = {
  role:    'user' | 'assistant'
  content: string
  ts:      string
  parsed?: StrategistResponse
  usage?:  { input_tokens: number; output_tokens: number; cost_usd: number; latency_ms: number }
}

// Merge rules:
//   * If the strategist did not return a recommendations block at
//     all, keep the existing plan unchanged.
//   * If it returned one, take its arrays as authoritative for the
//     slots they cover but preserve the existing summary when the
//     new one is empty.
//   * If it returned an empty primary array but the existing plan
//     had primaries, keep the existing primaries. This is the
//     defensive fix for the "did not recommend any primary article"
//     regression from Block 5B.
export function mergeRecommendations(
  prev: undefined | ActivePlan,
  next: undefined | ActivePlan,
): ActivePlan | undefined {
  if (!next) return prev
  if (!prev) return next
  const nextPrimary  = Array.isArray(next.primary)      ? next.primary      : []
  const nextAlts     = Array.isArray(next.alternatives) ? next.alternatives : []
  const primary      = nextPrimary.length > 0 ? nextPrimary : prev.primary
  const alternatives = nextAlts.length    > 0 ? nextAlts    : prev.alternatives
  const summary      = next.summary?.trim()   || prev.summary
  return { summary, primary, alternatives }
}

export function computeActivePlan(history: ChatTurn[]): ActivePlan | undefined {
  let plan: ActivePlan | undefined = undefined
  for (const turn of history) {
    if (turn.role !== 'assistant') continue
    const recs = turn.parsed?.recommendations
    if (!recs) continue
    plan = mergeRecommendations(plan, {
      summary:      typeof recs.summary === 'string' ? recs.summary : '',
      primary:      Array.isArray(recs.primary) ? recs.primary : [],
      alternatives: Array.isArray(recs.alternatives) ? recs.alternatives : [],
    })
  }
  return plan
}
