-- ============================================================================
-- Phase 4b-3-a: pipeline_links — rename 'image' kind to 'file', add mime_type
-- ============================================================================
-- Prereq for the Files feature (4b-3-b agency UI + 4b-3-c portal tab).
-- Generalizes the upload discriminant from "image only" to "any file"
-- so PDFs / docs / videos / etc. can flow through the same table +
-- storage bucket. Adds mime_type so the UI can dispatch inline preview
-- vs download per content type.
--
-- BEFORE this migration:
--   kind text not null check (kind in ('url', 'image'))
--   pipeline_links_kind_payload check (
--     (kind = 'url'   and url is not null and storage_path is null) or
--     (kind = 'image' and storage_path is not null and url is null)
--   )
--   -- no mime_type column
--
-- AFTER this migration:
--   kind text not null check (kind in ('url', 'file'))
--   pipeline_links_kind_payload check (
--     (kind = 'url'  and url is not null and storage_path is null) or
--     (kind = 'file' and storage_path is not null and url is null)
--   )
--   mime_type text   (nullable; UI uses to decide image/pdf/etc.)
--
-- NO BACKFILL — the pipeline_links table has zero rows today (no code
-- consumer ever existed for it). Confirmed via grep across src/ and a
-- pre-flight count check. If you somehow have rows when applying,
-- migrate them first:
--   update public.pipeline_links set kind = 'file' where kind = 'image';
-- before dropping the old CHECK below. Otherwise the new CHECK will
-- reject the old rows mid-migration.
--
-- RLS interaction — UNCHANGED:
--   pipeline_links_select still gates on is_pipeline_agency_member OR
--   (is_pipeline_client AND client_visible). The kind column isn't
--   referenced in any policy. The new mime_type column also isn't
--   referenced; it's pure metadata for the UI. No policy edits needed.
--
-- STORAGE BUCKET — separate setup (not in this migration):
--   The pipeline_files bucket itself needs to be created either via
--   supabase/config.toml ([storage.buckets.pipeline_files] block) or
--   via the Supabase Dashboard. Storage RLS policies for that bucket
--   are ALREADY in place from the initial schema migration
--   (20260509120000_rls_policies.sql); they apply automatically once
--   the bucket exists.
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Reverse the kind values back to 'image'. NOTE: any rows with
-- │   -- kind='file' would have to be migrated to 'image' first; if
-- │   -- non-image files exist (PDFs, etc.) the revert is destructive
-- │   -- (no clean mapping back) — restore from a snapshot instead.
-- │   alter table public.pipeline_links drop constraint pipeline_links_kind_payload;
-- │   alter table public.pipeline_links drop constraint pipeline_links_kind_check;
-- │   alter table public.pipeline_links drop column mime_type;
-- │   alter table public.pipeline_links
-- │     add constraint pipeline_links_kind_check check (kind in ('url', 'image'));
-- │   alter table public.pipeline_links
-- │     add constraint pipeline_links_kind_payload check (
-- │       (kind = 'url'   and url is not null and storage_path is null) or
-- │       (kind = 'image' and storage_path is not null and url is null)
-- │     );
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Drop the existing CHECK constraints ────────────────────────────────
-- Order matters: drop the payload constraint (which references the kind
-- values) before changing the kind check. PostgreSQL would also accept
-- changing the kind check first since both constraints are independent
-- expressions, but doing payload first matches the natural read order.

alter table public.pipeline_links
  drop constraint pipeline_links_kind_payload;

alter table public.pipeline_links
  drop constraint pipeline_links_kind_check;


-- ─── 2. Add the mime_type column ───────────────────────────────────────────
-- Nullable. Used by the file-list UI to decide:
--   image/*           → inline thumbnail + lightbox preview
--   application/pdf   → inline <iframe>/<embed> preview
--   video/*           → inline <video controls>
--   everything else   → download-only link
-- For kind='url' rows the column stays null (no MIME associated with
-- arbitrary external URLs).

alter table public.pipeline_links
  add column mime_type text;


-- ─── 3. Recreate CHECK constraints with 'file' kind ────────────────────────
-- The kind discriminant goes 'image' → 'file'. The payload constraint
-- shape is preserved: exactly one of {url, storage_path} must be set,
-- gated by kind.

alter table public.pipeline_links
  add constraint pipeline_links_kind_check check (kind in ('url', 'file'));

alter table public.pipeline_links
  add constraint pipeline_links_kind_payload check (
    (kind = 'url'  and url is not null and storage_path is null) or
    (kind = 'file' and storage_path is not null and url is null)
  );


-- ============================================================================
-- Verification (run manually after applying)
-- ============================================================================
-- 1. CHECK constraints in place with the new shape:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.pipeline_links'::regclass
--     and contype = 'c'
--   order by conname;
--   Expected: 2 rows for pipeline_links_kind_check + pipeline_links_kind_payload.
--   Both should contain 'file' (not 'image').
--
-- 2. mime_type column exists, nullable, no default:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'pipeline_links'
--     and column_name = 'mime_type';
--   Expected: 1 row. data_type='text', is_nullable='YES', no default.
--
-- 3. Functional — kind='file' INSERT succeeds:
--   begin;
--   insert into public.pipeline_links
--     (pipeline_id, kind, label, storage_path, file_name, file_size,
--      mime_type, added_by, client_visible)
--   values (
--     'e21260d2-e358-44b6-b453-740dcf30a8bc'::uuid,
--     'file',
--     'Test upload',
--     'e21260d2-e358-44b6-b453-740dcf30a8bc/test.pdf',
--     'test.pdf',
--     12345,
--     'application/pdf',
--     '<your-uuid>'::uuid,
--     true
--   );
--   -- Expected: 1 row inserted.
--   rollback;
--
-- 4. Functional — kind='image' INSERT now REJECTS:
--   begin;
--   insert into public.pipeline_links
--     (pipeline_id, kind, label, storage_path, file_name, added_by)
--   values (
--     'e21260d2-e358-44b6-b453-740dcf30a8bc'::uuid,
--     'image',
--     'Should reject',
--     'foo/bar.png',
--     'bar.png',
--     '<your-uuid>'::uuid
--   );
--   -- Expected: ERROR — violates pipeline_links_kind_check.
--   rollback;
--
-- 5. Functional — kind='url' INSERT still works (no behavior change):
--   begin;
--   insert into public.pipeline_links
--     (pipeline_id, kind, label, url, added_by, client_visible)
--   values (
--     'e21260d2-e358-44b6-b453-740dcf30a8bc'::uuid,
--     'url',
--     'Figma board',
--     'https://www.figma.com/file/abc',
--     '<your-uuid>'::uuid,
--     true
--   );
--   -- Expected: 1 row inserted.
--   rollback;
--
-- 6. Functional — payload constraint catches mismatched fields:
--   -- kind='file' but no storage_path → REJECT
--   insert into public.pipeline_links (pipeline_id, kind, added_by)
--   values ('e21260d2-e358-44b6-b453-740dcf30a8bc', 'file', '<uuid>');
--   -- Expected: ERROR — pipeline_links_kind_payload violation.
--
--   -- kind='file' with both storage_path AND url → REJECT
--   insert into public.pipeline_links
--     (pipeline_id, kind, storage_path, url, added_by)
--   values ('e21260d2-e358-44b6-b453-740dcf30a8bc', 'file',
--           'pipeline-id/x.pdf', 'https://example.com', '<uuid>');
--   -- Expected: ERROR — pipeline_links_kind_payload violation.
-- ============================================================================
