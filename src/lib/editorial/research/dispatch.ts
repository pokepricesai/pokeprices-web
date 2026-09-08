// src/lib/editorial/research/dispatch.ts
//
// EIC Block 6 — chooses which research recipe to run for a project.
//
// The choice is deterministic and defensive: if the title / angle
// does not unambiguously match a bespoke recipe, fall back to the
// generic pack rather than guessing.

import 'server-only'
import type { EditorialContext } from '../context'
import type { OpportunityRadar } from '../opportunityRadar'
import type { EvidencePack, PackProjectRef, ResearchRecipeId } from './types'
import { runPopulationScarcityRecipe } from './populationScarcity'
import { runMonthlyMarketReportRecipe } from './monthlyMarketReport'
import { runGenericFallbackRecipe } from './genericFallback'
import { runExternalResearchRecipe } from './externalResearch'

export type DispatchOptions = {
  today?:   string
  context?: EditorialContext
  radar?:   OpportunityRadar
  /** Force a specific recipe. Overrides inference. */
  recipe?:  ResearchRecipeId
  /** External Research Fix — prior pack (if any) so recipes can
   *  preserve manual sources / notes / research questions across
   *  rebuilds. */
  previous?: EvidencePack | null
}

export function chooseRecipe(project: PackProjectRef): ResearchRecipeId {
  const title = project.title.toLowerCase()
  const angle = (project.angle ?? '').toLowerCase()
  const type  = project.articleType.toLowerCase()
  const combined = `${title} ${angle}`

  if (project.articleType === 'monthly_market_report') return 'monthly_market_report'
  if (/\bmarket report\b/.test(combined) && /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(combined)) {
    return 'monthly_market_report'
  }

  if (project.articleType === 'data_study' && /\bpopulat/.test(combined)) return 'population_scarcity'
  if (/(psa\s*10.*population|low.*population|scarcity)/.test(combined))     return 'population_scarcity'

  // External Research Fix — release/news/evergreen articles use the
  // external_research recipe. Broad on purpose: better to route into
  // the external pipeline (which is publishable from web sources)
  // than dead-end at generic_fallback.
  if (isExternalArticleType(type))                 return 'external_research'
  if (/\b(everything we know|coming soon|announced|announcement|revealed|reveal|preview|leak|leaked|rumou?r|upcoming|release date|preorder|pre-order|drop date|drops)\b/.test(combined)) {
    return 'external_research'
  }

  return 'generic_fallback'
}

function isExternalArticleType(type: string): boolean {
  return (
    type === 'upcoming_set' ||
    type === 'new_set' ||
    type === 'release_news' ||
    type === 'news' ||
    type === 'product_announcement' ||
    type === 'set_preview' ||
    type === 'evergreen_guide' ||
    type === 'external_research'
  )
}

export async function runResearchRecipe(
  project: PackProjectRef,
  options: DispatchOptions = {},
): Promise<EvidencePack> {
  const recipe = options.recipe ?? chooseRecipe(project)
  switch (recipe) {
    case 'population_scarcity':
      return runPopulationScarcityRecipe(project, { today: options.today })
    case 'monthly_market_report':
      return runMonthlyMarketReportRecipe(project, { today: options.today })
    case 'external_research':
      return runExternalResearchRecipe(project, {
        today:    options.today,
        context:  options.context,
        previous: options.previous,
      })
    case 'generic_fallback':
    default:
      return runGenericFallbackRecipe(project, {
        today: options.today,
        context: options.context,
        radar:   options.radar,
      })
  }
}
