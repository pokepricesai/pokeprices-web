// PP-TCG migration — shared types.
import 'server-only'

export type MigrationStatus = 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'stopped'
export type ItemStatus      = 'pending' | 'claimed' | 'activated' | 'verified' | 'failed' | 'skipped' | 'rolled_back'

export interface MigrationRunConfig {
  /** Verified items per calendar day; defaults to 5 (conservative canary). */
  daily_cap?:                number
  /** Items per cron tick; defaults to 5. Must fit `maxDuration` with worst-case restore. */
  batch_size?:               number
  /** Lease window held by a claimed item (seconds); defaults to 240 (4 min). */
  lease_duration_sec?:       number
  /** Content-poll ceiling per item; defaults to 10. */
  poll_max_attempts?:        number
  /** Content-poll interval ms; defaults to 2000. */
  poll_interval_ms?:         number
  /** Auto-pause after this many consecutive item failures; defaults to 3. */
  max_consecutive_failures?: number
  /** Alt threshold: auto-pause if (failures / last 100) × 100 > this; defaults to 20. */
  max_failure_pct_window?:   number
  /** Selection strategy for enrollment. See migrationEnroll.ts. */
  selection_strategy?:       'gsc_rank' | 'set_proximity_then_rank' | 'all_strict'
  /** Language scope for enrollment. 'en', 'jp', 'any' (default). */
  language?:                 'en' | 'jp' | 'any'
  /** Hard cap on how many run_items an enrollment pass will insert.
   *  Applied AFTER the active/enrolled exclusion filter so the cap
   *  always yields exactly N inserted (if enough strict candidates
   *  exist). Omit for the full catalogue. */
  enrollment_limit?:         number
}

export interface MigrationRun {
  id:            string
  name:          string
  status:        MigrationStatus
  started_at:    string | null
  stopped_at:    string | null
  pause_reason:  string | null
  config:        MigrationRunConfig
  created_at:    string
  updated_at:    string
}

export interface MigrationRunItem {
  id:                     string
  run_id:                 string
  pp_card_slug:           string
  gsc_rank:               number | null
  effective_eligibility:  'bulk_safe' | 'market_only'
  priority_tier:          string
  priority_rank:          number
  status:                 ItemStatus
  attempts:               number
  claim_count:            number
  worker_id:              string | null
  lease_expires_at:       string | null
  claimed_at:             string | null
  activated_at:           string | null
  verified_at:            string | null
  rolled_back_at:         string | null
  last_error:             string | null
  verification_evidence:  Record<string, unknown> | null
  updated_at:             string
}

export interface VerificationEvidence {
  cache_status:                string | null
  age_sec:                     number | null
  http_status:                 number
  poll_attempts:               number
  activation_duration_ms:      number
  verification_duration_ms:    number
  faq_tcggraph_present:        boolean
  marketplace_panel_present:   boolean
  grade_ladder_has_psa10:      boolean
  final_provider_active:       boolean
  final_url:                   string
}

export const DEFAULT_CONFIG: Required<Omit<MigrationRunConfig, 'enrollment_limit'>> & { enrollment_limit?: number } = {
  daily_cap:                5,
  batch_size:               5,
  lease_duration_sec:       240,
  poll_max_attempts:        10,
  poll_interval_ms:         2000,
  max_consecutive_failures: 3,
  max_failure_pct_window:   20,
  selection_strategy:       'gsc_rank',
  language:                 'any',
}
