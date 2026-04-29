-- 2026-04-29 — Vendor logos
-- Adds the `logo_url` column to the vendors table so each vendor can have a
-- logo displayed on the directory and detail pages.
--
-- Storage bucket setup (do this once in the Supabase dashboard, not SQL):
--   1. Storage → Create bucket → name: "vendor-logos"
--   2. Set "Public bucket": ON  (so getPublicUrl() returns a fetchable URL)
--   3. (Optional) Set max file size to 2 MB on the bucket settings.
--   4. RLS on storage.objects can stay restricted; we upload server-side
--      with the service-role key, so anon users never write to the bucket.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Optional: index for the case where you list vendors that have logos.
CREATE INDEX IF NOT EXISTS idx_vendors_has_logo
  ON vendors ((logo_url IS NOT NULL))
  WHERE logo_url IS NOT NULL;
