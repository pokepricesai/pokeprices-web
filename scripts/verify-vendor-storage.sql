-- scripts/verify-vendor-storage.sql
-- ============================================================================
-- READ-ONLY pre-deployment inspection of the storage bucket the new
-- vendor logo-upload route depends on.
--
-- Run this in the Supabase SQL Editor BEFORE applying the Block 1B
-- migrations. The new route will fail with a 500 / "Storage bucket
-- vendor-logos is not configured" if the bucket is missing.
--
-- What we want to confirm:
--   * Bucket name             : vendor-logos
--   * Bucket exists           : yes
--   * public                  : true (so getPublicUrl() works)
--   * file_size_limit         : 2 MB or NULL (route enforces 2 MB anyway)
--   * allowed_mime_types      : NULL or includes png/jpeg/webp
--   * storage.objects policies: anon must NOT have INSERT / UPDATE / DELETE
--     access; service-role bypasses RLS.
--
-- Do NOT run any CREATE / ALTER / DELETE statements here. This file is
-- inspection only. Bucket creation / policy edits must be done explicitly
-- in the Supabase dashboard.
-- ============================================================================

-- 1. Bucket configuration ---------------------------------------------------
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  owner,
  created_at,
  updated_at
FROM storage.buckets
WHERE name = 'vendor-logos';


-- 2. Storage policies for the bucket ----------------------------------------
-- The vendor-logos bucket should have NO anon write policies. If any
-- INSERT / UPDATE / DELETE policy on storage.objects targets the
-- vendor-logos bucket and applies to anon, surface it for human review.
SELECT
  policyname,
  cmd        AS command,
  roles,
  permissive,
  qual       AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;


-- 3. Existing object count under pending/ -----------------------------------
-- Useful for spotting orphans accumulated by failed commits. Returns 0
-- on a fresh project.
SELECT COUNT(*) AS pending_object_count
FROM storage.objects
WHERE bucket_id = 'vendor-logos'
  AND name LIKE 'pending/%';
