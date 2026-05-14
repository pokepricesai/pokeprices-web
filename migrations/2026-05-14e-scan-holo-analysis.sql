-- Add holo_analysis column to scan_logs so each confirmed scan also captures
-- the client-side surface analysis (holo / reverse / non-holo verdict + raw
-- numbers). This lets us calibrate thresholds against confirmed cards later
-- without re-scanning anything.
ALTER TABLE scan_logs
  ADD COLUMN IF NOT EXISTS holo_analysis JSONB;
