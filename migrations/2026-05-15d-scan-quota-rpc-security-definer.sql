-- scan_quota_remaining returns aggregated counts only, so it is safe to
-- mark SECURITY DEFINER. Without this, the client-side call (anon /
-- authenticated role) hits the scan_logs RLS policy which only grants
-- access to service_role, so the function always reported 0 used /
-- 100 remaining regardless of actual usage.
--
-- The edge function's quota check uses the service role and was always
-- correct — it's only the front-end "X scans left" badge that was wrong.
-- After this migration the badge reflects reality and matches the
-- server-side enforcement.

CREATE OR REPLACE FUNCTION scan_quota_remaining(
  p_user_id   uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL
)
RETURNS TABLE (
  scans_used      integer,
  scans_remaining integer,
  monthly_limit   integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH used AS (
    SELECT COUNT(*)::int AS n
    FROM scan_logs
    WHERE created_at >= date_trunc('month', NOW())
      AND (
        (p_user_id   IS NOT NULL AND user_id   = p_user_id)
        OR (p_device_id IS NOT NULL AND device_id = p_device_id)
      )
  )
  SELECT
    used.n                              AS scans_used,
    GREATEST(0, 100 - used.n)::int      AS scans_remaining,
    100::int                            AS monthly_limit
  FROM used;
$$;

GRANT EXECUTE ON FUNCTION scan_quota_remaining(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION scan_quota_remaining(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION scan_quota_remaining(uuid, text) TO service_role;
