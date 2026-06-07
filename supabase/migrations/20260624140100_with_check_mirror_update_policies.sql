-- ============================================================================
-- Slice S1 Phase 3 Fix 2: mirror USING into WITH CHECK on three UPDATE
-- policies
-- ============================================================================
--
-- Closes the medium-severity finding in docs/RLS-AUDIT.md § 4.1.
--
-- ── THE GAP ────────────────────────────────────────────────────────────
--
-- Three UPDATE policies have a proper USING clause but NULL WITH CHECK:
--
--   stage_notes_update         (20260509120000_rls_policies.sql:784)
--   stage_attachments_update   (20260509120000_rls_policies.sql:841)
--   pipeline_links_update      (20260509120000_rls_policies.sql:876)
--
-- USING gates which existing rows the caller can target (pre-update state).
-- WITH CHECK gates what the row looks like after the update (post-state).
-- With WITH CHECK = NULL, an authorized caller can take a row they're
-- allowed to touch and mutate ANY column to ANY value — including columns
-- that would have failed the USING gate. That converts UPDATE into an
-- "escape the controlled zone" primitive:
--
--   - Re-attributing ownership by changing added_by / author_id from
--     yourself to someone else (or vice-versa).
--   - Moving a row to a different stage / pipeline that the caller
--     wouldn't be allowed to target via the USING clause.
--   - Flipping client_visible without re-passing the membership check
--     against the post-update tuple.
--
-- ── THE FIX: USING mirrored into WITH CHECK ────────────────────────────
--
-- The standard pattern. Each policy's WITH CHECK is set to the same
-- predicate as its USING — same auth + membership invariants must hold
-- for the post-update row. This is how the schema's tighter policies
-- (e.g. tasks_update) already work.
--
-- Important per the Slice S1 Phase 1 / § 10 Q4 lock: this migration does
-- NOT freeze any column values. Specifically pipeline_links.kind can
-- still flip between 'url' and 'image' — a maintainer might legitimately
-- swap a link-style row for an image-upload-style row, and that's a data-
-- model decision, not a security gate. The WITH CHECK only enforces the
-- same auth check that USING already enforces, applied to the post-state.
--
-- ── WHY DROP + CREATE INSTEAD OF ALTER POLICY ──────────────────────────
--
-- ALTER POLICY can add a WITH CHECK to an existing policy, but the
-- DROP + CREATE form is what 20260603120000_client_url_insert_relaxation.sql
-- and other re-statement migrations in this repo use. Easier to audit the
-- full policy text post-apply via pg_policies, and the DROP gives a clear
-- before/after pivot for the verification queries.
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
--
-- For each policy: drop, then re-create in the original (USING-only,
-- NULL WITH CHECK) form. Restores the pre-Slice-S1 state byte-for-byte.
--
--   drop policy if exists stage_notes_update on public.stage_notes;
--   create policy stage_notes_update on public.stage_notes
--   for update using (
--     author_id = (select auth.uid())
--     or exists (
--       select 1 from public.stages s
--       where s.id = stage_notes.stage_id
--         and public.is_workspace_owner(
--           (select workspace_id from public.pipelines where id = s.pipeline_id)
--         )
--     )
--   );
--
--   drop policy if exists stage_attachments_update on public.stage_attachments;
--   create policy stage_attachments_update on public.stage_attachments
--   for update using (
--     added_by = (select auth.uid())
--     or exists (
--       select 1 from public.stages s
--       where s.id = stage_attachments.stage_id
--         and public.can_edit_pipeline(s.pipeline_id)
--     )
--   );
--
--   drop policy if exists pipeline_links_update on public.pipeline_links;
--   create policy pipeline_links_update on public.pipeline_links
--   for update using (
--     added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id)
--   );
-- ============================================================================


-- ─── stage_notes_update ────────────────────────────────────────────────────

drop policy if exists stage_notes_update on public.stage_notes;

create policy stage_notes_update on public.stage_notes
for update
using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and public.is_workspace_owner(
        (select workspace_id from public.pipelines where id = s.pipeline_id)
      )
  )
)
with check (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and public.is_workspace_owner(
        (select workspace_id from public.pipelines where id = s.pipeline_id)
      )
  )
);


-- ─── stage_attachments_update ──────────────────────────────────────────────

drop policy if exists stage_attachments_update on public.stage_attachments;

create policy stage_attachments_update on public.stage_attachments
for update
using (
  added_by = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
)
with check (
  added_by = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);


-- ─── pipeline_links_update ─────────────────────────────────────────────────

drop policy if exists pipeline_links_update on public.pipeline_links;

create policy pipeline_links_update on public.pipeline_links
for update
using (
  added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id)
)
with check (
  added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id)
);


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
--
-- (a) Confirm all three UPDATE policies now have BOTH qual (USING) and
--     with_check populated — not NULL.
--
--   select tablename, policyname, cmd,
--          qual is not null as using_present,
--          with_check is not null as with_check_present
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('stage_notes', 'stage_attachments', 'pipeline_links')
--     and cmd = 'UPDATE'
--   order by tablename;
--   -- Expected: 3 rows, all with using_present=true AND with_check_present=true.
--   --   Pre-migration: with_check_present=false on all three.
--
-- (b) Confirm the USING and WITH CHECK clauses are textually identical for
--     each policy (mirror invariant).
--
--   select tablename, policyname,
--          regexp_replace(qual,       '\s+', ' ', 'g') as using_norm,
--          regexp_replace(with_check, '\s+', ' ', 'g') as with_check_norm,
--          regexp_replace(qual,       '\s+', ' ', 'g')
--            = regexp_replace(with_check, '\s+', ' ', 'g')
--            as identical
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('stage_notes', 'stage_attachments', 'pipeline_links')
--     and cmd = 'UPDATE'
--   order by tablename;
--   -- Expected: 3 rows, all identical=true.
--   -- Note: pg_policies stores normalized policy text — there may be minor
--   -- formatting differences (added parens, expanded aliases) between the
--   -- source SQL and what pg_policies returns, but USING and WITH CHECK
--   -- should be byte-identical after the normalize.
--
-- (c) Optional behavior probe — confirm the protection works.
--     (Requires a test row; describe in prose rather than provide SQL.)
--
--   As an authorized editor of a pipeline (workspace owner OR pipeline
--   admin), pick a row from pipeline_links you can UPDATE. Try to change
--   added_by to a different user's user_id. Pre-migration this would
--   succeed (USING gates row visibility but WITH CHECK was NULL so the
--   new added_by passed). Post-migration this should fail with an RLS
--   denial — the post-update row no longer satisfies
--   added_by = auth.uid() OR can_edit_pipeline(pipeline_id), assuming the
--   tester wasn't already a pipeline editor and changed added_by to a
--   non-editor.
--
--   Same shape works for stage_notes (try changing author_id) and
--   stage_attachments (try changing added_by).
--
-- ============================================================================
