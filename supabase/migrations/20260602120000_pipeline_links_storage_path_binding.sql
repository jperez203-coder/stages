-- ============================================================================
-- Phase 4b-3-d HOTFIX: bind pipeline_links.storage_path to pipeline_id
-- ============================================================================
-- Closes the path-spoof gap identified by Test 7 of the privacy harness on
-- 2026-05-25. The prior migration (20260601120000_client_file_upload_rls.sql)
-- granted clients INSERT on pipeline_links + the pipeline_files bucket with
-- four locked client-branch constraints (kind='file', client_visible=true,
-- added_by=auth.uid(), is_pipeline_client(pipeline_id)). The harness verified
-- all four hold (Tests 2, 3, 4 all blocked at policy OR trigger).
--
-- What that migration did NOT validate: that storage_path is scoped to the
-- same pipeline_id the row claims. Test 7 demonstrated:
--   * Casey INSERTed a row with pipeline_id = Pipeline-A (she IS client)
--     and storage_path = "{Pipeline-B-id}/..." (a path she can't upload to).
--   * INSERT was ACCEPTED — no policy clause or trigger checked the
--     storage_path scope.
--   * The signed-URL fetch returned 404 in the test (no bytes exist at the
--     spoofed path), so no data was actually leaked. BUT:
--   * If real bytes existed at the spoofed path AND a client could
--     guess/learn the path, the pipeline_files_storage_select policy
--     would grant her the read — it joins pl.storage_path = name AND
--     evaluates is_pipeline_client(pl.pipeline_id) = true, which Casey
--     satisfies via her bogus metadata row.
--
-- Today the attack is blunted by path obscurity (buildStoragePath uses
-- {pipeline_id}/{random-UUIDv4}.{ext}; guessing is 2^122 — practically
-- infinite). That obscurity is not an acceptable sole defense for our
-- first client-write surface; a future feature exposing storage paths
-- (audit log, debug endpoint, cross-pipeline view, etc.) would unblock
-- the attack overnight.
--
-- This migration adds a CHECK constraint at the table level binding
-- storage_path to pipeline_id. It applies uniformly (agency + client) and
-- is independent of any policy or trigger — no future RLS change can
-- bypass it. Agency uploads via buildStoragePath() already conform, so
-- there is zero impact on existing agency code paths.
--
-- ── PRE-CHECK (built in, runs before the ALTER) ────────────────────────
--
-- An anonymous DO block runs FIRST and surveys every existing row. If any
-- row has a non-null storage_path that does NOT start with its own
-- pipeline_id, the migration aborts with a RAISE that lists the offending
-- IDs. This is essential because:
--   * Agency-JWT app-level reads only see rows in workspaces the caller
--     can access. A pre-flight from the app can't survey the whole table.
--   * A CHECK constraint added against a violating row fails with a
--     bare "check constraint violated" — no list of which row(s) broke.
-- The DO block's RAISE gives precise IDs so they can be fixed or
-- deleted before re-running.
--
-- On 2026-05-25, the agency-JWT verifier (scripts/verify-storage-path-
-- conformance.mjs) reported 0 violations out of 5 visible rows. The DO
-- block here is the authoritative version of that check.
--
-- ── WHAT THIS DOES NOT CHANGE ─────────────────────────────────────────
--
--   * URL-kind rows (storage_path IS NULL) — the CHECK clause allows
--     NULL via "storage_path is null or storage_path like ...". URL
--     rows unaffected.
--   * Existing policies + the BEFORE INSERT trigger from
--     20260601120000 — left in place, all four client-branch
--     constraints continue to hold.
--   * Agency upload code (lib/build-storage-path.ts) — already
--     generates paths in the {pipeline_id}/... convention.
--   * UPDATE semantics — the CHECK applies to UPDATEs as well, so a
--     row's storage_path can't be repointed at a different
--     pipeline_id post-INSERT either. Bonus defense.
--
-- ── DOWN PLAN
-- │
-- │   alter table public.pipeline_links
-- │     drop constraint pipeline_links_storage_path_matches_pipeline;
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. PRE-CHECK: survey for any violating rows BEFORE altering ───────────
-- Runs as the migration role (sees every row, RLS bypassed). If any non-
-- null storage_path doesn't start with its row's own pipeline_id, abort
-- with a list of offending IDs so they can be fixed/deleted manually.

do $$
declare
  violator_count int;
  violator_list  text;
begin
  select
    count(*),
    string_agg(
      format('id=%s pipeline_id=%s storage_path=%L',
             id, pipeline_id, storage_path),
      E'\n  '
    )
  into violator_count, violator_list
  from public.pipeline_links
  where storage_path is not null
    and storage_path not like (pipeline_id::text || '/%');

  if violator_count > 0 then
    raise exception
      E'Cannot add pipeline_links_storage_path_matches_pipeline: % row(s) violate.\n  %\nFix or delete these rows, then re-run the migration.',
      violator_count, violator_list;
  end if;

  raise notice 'pre-check OK: 0 violating rows';
end;
$$;


-- ─── 2. ADD the CHECK constraint ───────────────────────────────────────────
-- Applies to all INSERTs and UPDATEs. URL-kind rows (storage_path = null)
-- are exempt via the IS NULL branch.

alter table public.pipeline_links
  add constraint pipeline_links_storage_path_matches_pipeline
  check (
    storage_path is null
    or storage_path like (pipeline_id::text || '/%')
  );


-- ============================================================================
-- 3. VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- ─── (a) Confirm the constraint exists and is valid ────────────────────────
--   select conname, contype, convalidated, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.pipeline_links'::regclass
--     and conname = 'pipeline_links_storage_path_matches_pipeline';
--   -- Expected: 1 row. contype='c'. convalidated=true.
--   -- definition contains 'storage_path IS NULL' AND 'pipeline_id'.
--
-- ─── (b) Sanity: all existing rows are conforming ──────────────────────────
--   select count(*) as total,
--          count(*) filter (where storage_path is null) as url_kind,
--          count(*) filter (
--            where storage_path is not null
--              and storage_path like pipeline_id::text || '/%'
--          ) as conforming,
--          count(*) filter (
--            where storage_path is not null
--              and storage_path not like pipeline_id::text || '/%'
--          ) as violating
--   from public.pipeline_links;
--   -- Expected: violating = 0. (If non-zero, the ALTER above would have
--   -- failed; this is a regression check for the day after.)
-- ============================================================================
