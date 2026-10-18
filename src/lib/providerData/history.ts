import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isProviderFlagEnabled } from './flags';

// Historical price series resolver for the TCGGraph provider.
// Returns [] unless PP_USE_TCGGRAPH_HISTORY is set to 1.
//
// Series discipline:
//   • Each returned series carries explicit source metadata — a
//     caller can never confuse pooled grade 9 with PSA 9.
//   • Market series (per source + finish) are kept separate from
//     graded series (per grader + grade). A chart MUST render
//     them as distinct visual series.
//   • If old PriceCharting-derived history exists on card_trends
//     and the operator wants it on the chart, the renderer must
//     label the provider boundary explicitly. This resolver does
//     NOT merge or interleave the two sources.

export interface ProviderHistoryPoint {
  day: string;
  market: number | null;
  low: number | null;
}

export interface ProviderHistorySeries {
  kind: 'market' | 'graded';
  // Market-only descriptors
  source?: 'tcgplayer' | 'cardmarket' | 'cardkingdom' | 'manapool' | null;
  finish?: string | null;
  // Graded-only descriptors
  grader?: 'raw' | 'any' | 'psa' | 'bgs' | 'cgc' | 'sgc' | null;
  grade?: 'ungraded' | '7' | '8' | '9' | '9.5' | '10' | null;
  currency: string;
  points: ProviderHistoryPoint[];
}

export async function getProviderHistorySeries(
  sb: SupabaseClient,
  tcg_card_id: string,
  tcg_printing_key: string,
  opts: { ignoreFlag?: boolean } = {},
): Promise<ProviderHistorySeries[]> {
  if (!opts.ignoreFlag && !isProviderFlagEnabled('tcggraph_history')) return [];
  const { data, error } = await sb
    .from('pokemon_tcg_prices_history')
    .select('series_kind, source, finish, grader, grade, currency, day, market, low')
    .eq('provider', 'tcggraph')
    .eq('tcg_card_id', tcg_card_id)
    .or(`tcg_printing_key.eq.${tcg_printing_key},tcg_printing_key.is.null`)
    .order('day', { ascending: true });
  if (error || !data) return [];

  const byKey = new Map<string, ProviderHistorySeries>();
  for (const row of data) {
    const key = row.series_kind === 'market'
      ? `market|${row.source}|${row.finish}|${row.currency}`
      : `graded|${row.grader}|${row.grade}|${row.currency}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        kind: row.series_kind,
        source: row.series_kind === 'market' ? row.source : null,
        finish: row.series_kind === 'market' ? row.finish : null,
        grader: row.series_kind === 'graded' ? row.grader : null,
        grade:  row.series_kind === 'graded' ? row.grade : null,
        currency: row.currency,
        points: [],
      });
    }
    byKey.get(key)!.points.push({ day: row.day, market: row.market, low: row.low });
  }
  return Array.from(byKey.values());
}
