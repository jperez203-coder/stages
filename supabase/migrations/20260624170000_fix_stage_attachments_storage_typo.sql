-- ============================================================================
-- Slice S2 Phase 3: fix stage_attachments storage policy typo
-- ============================================================================
--
-- Closes the medium-severity finding in docs/STORAGE-AUDIT.md § 4.2 (also
-- tracked in WISHLIST.md → "Slice S2 Phase 3 — stage_attachments policy
-- typo fix").
--
-- ── THE BUG ────────────────────────────────────────────────────────────
--
-- Both stage_attachments_storage_select (originally defined at
-- 20260509120000_rls_policies.sql:1101) and
-- stage_attachments_storage_delete (originally at line 1130) use a bare
-- `name` reference inside an EXISTS subquery that joins public.stages:
--
--   exists (
--     select 1
--     from public.stage_attachments sa
--     join public.stages s on s.id = sa.stage_id
--     where sa.storage_path = name        -- ← bug
--       and (... membership / client_visible checks ...)
--   )
--
-- PostgreSQL resolves bare column references to the closest enclosing
-- scope's column. The EXISTS subquery brings public.stages into scope,
-- and public.stages has a column called `name` (the human-readable stage
-- label — "Discovery Call", "Design Round 1", etc.). public.stage_attachments
-- has no `name` column. So the bare `name` resolves to `s.name` — the
-- stage's prose label — not to `storage.objects.name`, the file path,
-- which was the intended target.
--
-- The query becomes:
--
--   where sa.storage_path = s.name
--
-- That compares a file path (a uuid-laden storage_path) against a stage's
-- prose name. It can never match. The EXISTS returns false for every
-- storage object in the stage_attachments bucket. SELECT and DELETE
-- policies deny all reads / deletes.
--
-- ── WHY pipeline_files IS UNAFFECTED ──────────────────────────────────
--
-- The mirror policies on the `pipeline_files` bucket use a bare `name`
-- reference too:
--
--   exists (
--     select 1 from public.pipeline_links pl
--     where pl.storage_path = name        -- ← correct here
--       and (...)
--   )
--
-- But public.pipeline_links has no `name` column. So the bare `name`
-- resolves correctly to `storage.objects.name` (the policy target's
-- column). Same shape, different table, different outcome — a latent
-- landmine that only fires when the joined metadata table happens to
-- share a column name with the policy's target table.
--
-- ── PRE-FIX REAL-WORLD IMPACT ─────────────────────────────────────────
--
-- Zero user-facing incidents. public.stage_attachments has 0 rows in
-- production, and the `stage_attachments` storage bucket has 0 objects.
-- The feature is wired in app code (src/components/canvas/TaskDetailPanel.tsx
-- line 1608 calls .upload(...)) but no user has ever successfully completed
-- the upload + view flow because the SELECT policy denies the post-upload
-- visibility check.
--
-- The typo makes the policy MORE restrictive than intended, not less —
-- not exploitable. First agency to upload a stage attachment in production
-- would lose visibility on it (file orphans, row exists but is unreadable
-- to anyone except service-role). This migration fixes the feature before
-- it ships to real users.
--
-- ── THE FIX ──────────────────────────────────────────────────────────
--
-- One-character qualification: change `name` to `storage.objects.name`
-- inside both EXISTS subqueries. Two policies affected. DROP + CREATE
-- pattern matching 20260624140100_with_check_mirror_update_policies.sql
-- (Slice S1 Phase 3 Fix 2) — easier to audit the full policy text via
-- pg_policies post-apply than ALTER POLICY would be.
--
-- INSERT policy (stage_attachments_storage_insert at line 1123) is NOT
-- affected — it uses storage.foldername(name) for pipeline_id extraction
-- and has no metadata-table join, so no ambiguity exists.
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
--
-- Restore the pre-fix (buggy) state byte-for-byte:
--
--   drop policy if exists stage_attachments_storage_select on storage.objects;
--   create policy stage_attachments_storage_select on storage.objects
--   for select using (
--     bucket_id = 'stage_attachments'
--     and exists (
--       select 1
--       from public.stage_attachments sa
--       join public.stages s on s.id = sa.stage_id
--       where sa.storage_path = name
--         and (
--           public.is_pipeline_agency_member(s.pipeline_id)
--           or (
--             public.is_pipeline_client(s.pipeline_id)
--             and sa.client_visible = true
--             and s.client_visible = true
--           )
--         )
--     )
--   );
--
--   drop policy if exists stage_attachments_storage_delete on storage.objects;
--   create policy stage_attachments_storage_delete on storage.objects
--   for delete using (
--     bucket_id = 'stage_attachments'
--     and exists (
--       select 1
--       from public.stage_attachments sa
--       join public.stages s on s.id = sa.stage_id
--       where sa.storage_path = name
--         and (
--           sa.added_by = (select auth.uid())
--           or public.can_edit_pipeline(s.pipeline_id)
--         )
--     )
--   );
--
-- Note: the DOWN re-introduces the bug. Only use for emergency rollback
-- if this Phase 3 fix caused an unanticipated regression.
-- ============================================================================


-- ─── stage_attachments_storage_select ──────────────────────────────────────

drop policy if exists stage_attachments_storage_select on storage.objects;

create policy stage_attachments_storage_select on storage.objects
for select using (
  bucket_id = 'stage_attachments'
  and exists (
    select 1
    from public.stage_attachments sa
    join public.stages s on s.id = sa.stage_id
    where sa.storage_path = storage.objects.name
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and sa.client_visible = true
          and s.client_visible = true
        )
      )
  )
);


-- ─── stage_attachments_storage_delete ──────────────────────────────────────

drop policy if exists stage_attachments_storage_delete on storage.objects;

create policy stage_attachments_storage_delete on storage.objects
for delete using (
  bucket_id = 'stage_attachments'
  and exists (
    select 1
    from public.stage_attachments sa
    join public.stages s on s.id = sa.stage_id
    where sa.storage_path = storage.objects.name
      and (
        sa.added_by = (select auth.uid())
        or public.can_edit_pipeline(s.pipeline_id)
      )
  )
);


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
--
-- (a) Confirm both policies now reference `storage.objects.name` (the
--     qualified, correct form), and DO NOT contain the bare `= name` form.
--
--   select policyname,
--          qual ilike '%storage.objects.name%'         as has_qualified_ref,
--          qual ~ 'sa\.storage_path\s*=\s*name[^.\w]'  as has_bare_buggy_ref
--   from pg_policies
--   where schemaname = 'storage'
--     and tablename  = 'objects'
--     and policyname in (
--       'stage_attachments_storage_select',
--       'stage_attachments_storage_delete'
--     )
--   order by policyname;
--   -- Expected: 2 rows.
--   --   has_qualified_ref = true   for both
--   --   has_bare_buggy_ref = false for both
--   --
--   -- Note: pg_policies stores normalized text — the qualified
--   -- "storage.objects.name" may be returned as just "objects.name"
--   -- because the policy is ON storage.objects (which makes the schema
--   -- prefix redundant). The has_qualified_ref check matches either
--   -- form because pg_policies' normalizer is consistent within a row.
--
-- (b) Confirm INSERT policy is UNTOUCHED (this migration only touches
--     SELECT and DELETE).
--
--   select policyname, cmd
--   from pg_policies
--   where schemaname = 'storage'
--     and tablename  = 'objects'
--     and policyname = 'stage_attachments_storage_insert';
--   -- Expected: 1 row.
--   --   policyname='stage_attachments_storage_insert', cmd='INSERT'.
--
-- (c) Confirm the total count of Stages-defined storage policies remains
--     unchanged (6 — 3 per bucket).
--
--   select count(*) as stages_storage_policy_count
--   from pg_policies
--   where schemaname = 'storage'
--     and tablename  = 'objects'
--     and policyname like ANY (ARRAY[
--       'stage_attachments_storage_%',
--       'pipeline_files_storage_%'
--     ]);
--   -- Expected: 6.
--
-- (d) BEHAVIOR PROBE — exercised by re-running the test harness:
--
--     node scripts/test-rls-phase3.mjs
--
--   Pre-fix: S2.6 stage_attachments fix verification → SKIPPED — Waiting
--            on Slice S2 Phase 3 typo fix
--   Post-fix: S2.6 → PASS — Phase 3 fix is live — Jordan mint+fetch ok
--
--   Expected total: 13/13 PASS (T1.2 will continue to SKIP on Sarah-
--   membership unless the separate WISHLIST follow-on lands).
-- ============================================================================
