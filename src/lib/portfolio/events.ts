// src/lib/portfolio/events.ts
//
// Block 5A-W-50F / FIX1 — event writes are now trigger-owned. The
// client no longer inserts into portfolio_item_events; RLS on that
// table blocks any such attempt anyway.
//
// The classification helper below survives because it is useful for
// tests and (potentially) for UI hints that describe the pending
// mutation. It performs no I/O.

export type PortfolioEventType =
  | 'holding_added'
  | 'quantity_added'
  | 'quantity_removed'
  | 'holding_sold'
  | 'holding_removed'
  | 'manual_value_changed'
  | 'opening_balance'
  | 'correction'

/**
 * Convenience: classify a quantity change (before -> after) into the
 * corresponding event_type + quantity_delta. Returns null when the
 * change is a no-op.
 */
export function classifyQuantityChange(
  prevQuantity: number | null | undefined,
  nextQuantity: number,
): { event_type: PortfolioEventType; quantity_delta: number } | null {
  const prev = prevQuantity ?? 0
  if (prev === nextQuantity) return null
  if (prev === 0)              return { event_type: 'holding_added',    quantity_delta: nextQuantity }
  if (nextQuantity === 0)      return { event_type: 'holding_removed',  quantity_delta: -prev }
  if (nextQuantity > prev)     return { event_type: 'quantity_added',   quantity_delta: nextQuantity - prev }
  return                              { event_type: 'quantity_removed', quantity_delta: nextQuantity - prev }
}
