-- ============================================================================
-- BR-3: apply is_workspace_writable to write-path RLS policies on 5 tables
-- ============================================================================
-- Closes the direct-PostgREST write bypass identified in the BR-0 audit:
-- until this slice, write operations submitted via supabase.from(<table>)
-- .insert/.update/.delete() succeeded regardless of
-- workspace_billing.subscription_status. The BR-1 banner urged upgrade,
-- the BR-2b RPCs enforced the gate — but every client component that
-- bypasses the RPCs and hits the table directly was wide open.
--
-- This migration AND-s the existing USING / WITH CHECK predicates of
-- every write policy on these 5 tables with:
--
--   public.is_workspace_writable(<workspace_id from FK chain>)
--
-- Existing predicates preserved verbatim. The new check fires only
-- after the existing access logic decides the row is "in scope" — so
-- a workspace owner with a fully-paid sub still passes every check;
-- the same owner on a past_due / canceled / etc. workspace passes the
-- existing scope check but trips the new billing gate → 0 rows
-- returned for UPDATE/DELETE, RLS denial for INSERT.
--
-- SCOPE (5 TABLES, 13 POLICIES)
-- ──────────────────────────────
--   1. tasks            insert + update + delete  (2-hop: tasks → stages → pipelines)
--   2. stages           insert + update + delete  (1-hop: stages → pipelines)
--   3. pipeline_links   insert + update + delete  (1-hop)
--   4. checklist_items  insert + update + delete  (3-hop: items → tasks → stages → pipelines)
--   5. client_invites   delete only               (1-hop)
--                                                  INSERT goes via /api/client-invites/send
--                                                  which assertSubscriptionWritable already gates.
--
-- NOT IN SCOPE
-- ────────────
--   * public.pipeline_files — does not exist (BR-0 audit conflated with
--     the pipeline-files storage bucket). File uploads land in
--     pipeline_links (#3), already covered.
--   * stage_attachments — no direct PostgREST write call site in src/
--     today. If one appears later, fold into a BR-3 extension.
--   * storage.objects RLS for pipeline-files / stage-attachments
--     buckets — separate enforcement surface. Tracked as BR-4 in
--     WISHLIST.md (storage-bucket billing-gate slice).
--   * SELECT / read policies — billing state does not affect read
--     access. Owners on a past_due sub still see their data; they just
--     can't mutate it.
--
-- IMPLEMENTATION POSTURE
-- ──────────────────────
-- ALTER POLICY (not DROP/CREATE) to minimize downtime — the policy
-- stays bound to its table through the change. Existing role
-- assignments (authenticated, etc.) and permissive/restrictive
-- classifications are preserved automatically by ALTER POLICY.
--
-- Workspace_id resolution inline in each predicate via correlated
-- subquery against public.pipelines. The subquery returns NULL when
-- the FK target doesn't exist (defensively shouldn't happen given the
-- FK constraints, but if it does the helper's COALESCE wraps NULL →
-- false → RLS denial, which is the right failure mode).
--
-- POSITIONING: the new check is AND'd to the END of each existing
-- predicate. That places the cheap helper invocation after the
-- existing (and potentially expensive) scope expression. PG can
-- short-circuit AND, so callers passing the scope check pay the gate
-- cost; callers failing the scope check never invoke the gate. STABLE
-- on the helper lets PG cache the result during multi-row UPDATEs.
--
-- ┌─ ROLLBACK PROCEDURE
-- │
-- │  Per ALTER POLICY block, paste the corresponding ROLLBACK
-- │  statement at the bottom of this file. Each restores the exact
-- │  pre-BR-3 predicate from its source migration (cited inline).
-- │  Run rollback for ANY policy whose positive smoke test fails on
-- │  Jordan's grandfathered workspaces — do not partially roll back.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── tasks ─────────────────────────────────────────────────────────────────
-- Pre-BR-3 sources:
--   tasks_insert  : 20260509120000_rls_policies.sql:696-703
--   tasks_update  : 20260521120000_tighten_member_task_update_to_assignee.sql:50-86
--   tasks_delete  : 20260509120000_rls_policies.sql:748-755
-- Workspace_id resolution (2-hop):
--   tasks.stage_id → stages.pipeline_id → pipelines.workspace_id

alter policy tasks_insert on public.tasks
  with check (
    exists (
      select 1 from public.stages s
      where s.id = tasks.stage_id
        and public.can_edit_pipeline(s.pipeline_id)
    )
    and public.is_workspace_writable(
      (select p.workspace_id
       from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       where s.id = tasks.stage_id)
    )
  );

alter policy tasks_update on public.tasks
  using (
    exists (
      select 1 from public.stages s
      where s.id = tasks.stage_id
        and (
          public.can_edit_pipeline(s.pipeline_id)
          or (
            public.is_pipeline_client(s.pipeline_id)
            and tasks.client_visible = true
            and s.client_visible = true
          )
          or (
            public.can_check_pipeline_task(s.pipeline_id)
            and tasks.assignee_id = (select auth.uid())
          )
        )
    )
    and public.is_workspace_writable(
      (select p.workspace_id
       from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       where s.id = tasks.stage_id)
    )
  )
  with check (
    exists (
      select 1 from public.stages s
      where s.id = tasks.stage_id
        and (
          public.can_edit_pipeline(s.pipeline_id)
          or (
            public.is_pipeline_client(s.pipeline_id)
            and tasks.client_visible = true
            and s.client_visible = true
          )
          or (
            public.can_check_pipeline_task(s.pipeline_id)
            and tasks.assignee_id = (select auth.uid())
          )
        )
    )
    and public.is_workspace_writable(
      (select p.workspace_id
       from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       where s.id = tasks.stage_id)
    )
  );

alter policy tasks_delete on public.tasks
  using (
    exists (
      select 1 from public.stages s
      where s.id = tasks.stage_id
        and public.can_edit_pipeline(s.pipeline_id)
    )
    and public.is_workspace_writable(
      (select p.workspace_id
       from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       where s.id = tasks.stage_id)
    )
  );


-- ─── stages ────────────────────────────────────────────────────────────────
-- Pre-BR-3 source: 20260509120000_rls_policies.sql:663-671
-- Workspace_id resolution (1-hop):
--   stages.pipeline_id → pipelines.workspace_id

alter policy stages_insert on public.stages
  with check (
    public.can_edit_pipeline(pipeline_id)
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = stages.pipeline_id)
    )
  );

alter policy stages_update on public.stages
  using (
    public.can_edit_pipeline(pipeline_id)
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = stages.pipeline_id)
    )
  )
  with check (
    public.can_edit_pipeline(pipeline_id)
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = stages.pipeline_id)
    )
  );

alter policy stages_delete on public.stages
  using (
    public.can_edit_pipeline(pipeline_id)
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = stages.pipeline_id)
    )
  );


-- ─── pipeline_links ────────────────────────────────────────────────────────
-- Pre-BR-3 sources:
--   pipeline_links_insert : 20260603120000_client_url_insert_relaxation.sql:157-165
--   pipeline_links_update : 20260624140100_with_check_mirror_update_policies.sql:145-152
--   pipeline_links_delete : 20260509120000_rls_policies.sql:881-884
-- Workspace_id resolution (1-hop):
--   pipeline_links.pipeline_id → pipelines.workspace_id

alter policy pipeline_links_insert on public.pipeline_links
  with check (
    (
      public.can_edit_pipeline(pipeline_id)
      or (
        public.is_pipeline_client(pipeline_id)
        and added_by = (select auth.uid())
        and client_visible = true
      )
    )
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = pipeline_links.pipeline_id)
    )
  );

alter policy pipeline_links_update on public.pipeline_links
  using (
    (added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id))
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = pipeline_links.pipeline_id)
    )
  )
  with check (
    (added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id))
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = pipeline_links.pipeline_id)
    )
  );

alter policy pipeline_links_delete on public.pipeline_links
  using (
    (added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id))
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = pipeline_links.pipeline_id)
    )
  );


-- ─── checklist_items ───────────────────────────────────────────────────────
-- Pre-BR-3 source: 20260519120000_phase_4a_data_model.sql:260-315
-- Workspace_id resolution (3-hop):
--   checklist_items.task_id → tasks.stage_id → stages.pipeline_id → pipelines.workspace_id

alter policy checklist_items_insert on public.checklist_items
  with check (
    exists (
      select 1 from public.tasks t
      join public.stages s on s.id = t.stage_id
      where t.id = checklist_items.task_id
        and public.can_edit_pipeline(s.pipeline_id)
    )
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       join public.tasks t on t.stage_id = s.id
       where t.id = checklist_items.task_id)
    )
  );

alter policy checklist_items_update on public.checklist_items
  using (
    exists (
      select 1 from public.tasks t
      join public.stages s on s.id = t.stage_id
      where t.id = checklist_items.task_id
        and (
          public.can_edit_pipeline(s.pipeline_id)
          or (
            public.is_pipeline_client(s.pipeline_id)
            and checklist_items.client_visible = true
            and t.client_visible = true
            and s.client_visible = true
          )
        )
    )
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       join public.tasks t on t.stage_id = s.id
       where t.id = checklist_items.task_id)
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      join public.stages s on s.id = t.stage_id
      where t.id = checklist_items.task_id
        and (
          public.can_edit_pipeline(s.pipeline_id)
          or (
            public.is_pipeline_client(s.pipeline_id)
            and checklist_items.client_visible = true
            and t.client_visible = true
            and s.client_visible = true
          )
        )
    )
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       join public.tasks t on t.stage_id = s.id
       where t.id = checklist_items.task_id)
    )
  );

alter policy checklist_items_delete on public.checklist_items
  using (
    exists (
      select 1 from public.tasks t
      join public.stages s on s.id = t.stage_id
      where t.id = checklist_items.task_id
        and public.can_edit_pipeline(s.pipeline_id)
    )
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       join public.stages s on s.pipeline_id = p.id
       join public.tasks t on t.stage_id = s.id
       where t.id = checklist_items.task_id)
    )
  );


-- ─── client_invites (DELETE only — INSERT is API-gated) ────────────────────
-- Pre-BR-3 source: 20260509120000_rls_policies.sql:1070-1071
-- Workspace_id resolution (1-hop):
--   client_invites.pipeline_id → pipelines.workspace_id
-- INSERT goes through /api/client-invites/send which already invokes
-- assertSubscriptionWritable; no policy change needed for that path.

alter policy client_invites_delete on public.client_invites
  using (
    public.can_edit_pipeline(pipeline_id)
    and public.is_workspace_writable(
      (select p.workspace_id from public.pipelines p
       where p.id = client_invites.pipeline_id)
    )
  );


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Every BR-3 policy now mentions 'is_workspace_writable' in its
--     USING and/or WITH CHECK expression. Any row showing false in the
--     relevant column means the ALTER didn't land for that policy —
--     surface and reapply that section.
--   select
--     polname,
--     case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
--                 when 'w' then 'UPDATE' when 'd' then 'DELETE'
--                 when '*' then 'ALL' end as cmd,
--     (polqual is null)
--       or position('is_workspace_writable' in pg_get_expr(polqual, polrelid)) > 0 as using_has_gate,
--     (polwithcheck is null)
--       or position('is_workspace_writable' in pg_get_expr(polwithcheck, polrelid)) > 0 as with_check_has_gate
--   from pg_policy
--   where polrelid in (
--     'public.tasks'::regclass,
--     'public.stages'::regclass,
--     'public.pipeline_links'::regclass,
--     'public.checklist_items'::regclass,
--     'public.client_invites'::regclass
--   )
--   and polname in (
--     'tasks_insert', 'tasks_update', 'tasks_delete',
--     'stages_insert', 'stages_update', 'stages_delete',
--     'pipeline_links_insert', 'pipeline_links_update', 'pipeline_links_delete',
--     'checklist_items_insert', 'checklist_items_update', 'checklist_items_delete',
--     'client_invites_delete'
--   )
--   order by polname;
--   -- Expected: 13 rows. For each:
--   --   INSERT policies: using_has_gate = true (vacuously, polqual IS NULL),
--   --                    with_check_has_gate = true
--   --   UPDATE policies: both columns true
--   --   DELETE policies: using_has_gate = true,
--   --                    with_check_has_gate = true (vacuously)
--
-- (b) Spot-check a single policy's full expression for a sanity read.
--   select pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as with_check_expr
--   from pg_policy
--   where polrelid = 'public.stages'::regclass
--     and polname = 'stages_update';
--   -- Expected: both expressions contain "can_edit_pipeline" AND
--   -- "is_workspace_writable" joined by AND.
-- ============================================================================


-- ============================================================================
-- ROLLBACK PROCEDURE (commented — paste any subset if smoke fails)
-- ============================================================================
-- Run only the section(s) for the table whose smoke test failed. Each
-- ALTER POLICY below restores the EXACT pre-BR-3 predicate per the source
-- migration cited at the top of its BR-3 section above. Do NOT
-- partially roll back a single table (e.g., reverting tasks_update but
-- leaving tasks_insert with the new gate) — keep symmetry per table.
--
-- ── tasks (3) ──
-- alter policy tasks_insert on public.tasks
--   with check (
--     exists (select 1 from public.stages s
--             where s.id = tasks.stage_id
--               and public.can_edit_pipeline(s.pipeline_id))
--   );
-- alter policy tasks_update on public.tasks
--   using (
--     exists (select 1 from public.stages s
--             where s.id = tasks.stage_id
--               and (public.can_edit_pipeline(s.pipeline_id)
--                    or (public.is_pipeline_client(s.pipeline_id)
--                        and tasks.client_visible = true
--                        and s.client_visible = true)
--                    or (public.can_check_pipeline_task(s.pipeline_id)
--                        and tasks.assignee_id = (select auth.uid()))))
--   )
--   with check (
--     exists (select 1 from public.stages s
--             where s.id = tasks.stage_id
--               and (public.can_edit_pipeline(s.pipeline_id)
--                    or (public.is_pipeline_client(s.pipeline_id)
--                        and tasks.client_visible = true
--                        and s.client_visible = true)
--                    or (public.can_check_pipeline_task(s.pipeline_id)
--                        and tasks.assignee_id = (select auth.uid()))))
--   );
-- alter policy tasks_delete on public.tasks
--   using (
--     exists (select 1 from public.stages s
--             where s.id = tasks.stage_id
--               and public.can_edit_pipeline(s.pipeline_id))
--   );
--
-- ── stages (3) ──
-- alter policy stages_insert on public.stages
--   with check (public.can_edit_pipeline(pipeline_id));
-- alter policy stages_update on public.stages
--   using (public.can_edit_pipeline(pipeline_id))
--   with check (public.can_edit_pipeline(pipeline_id));
-- alter policy stages_delete on public.stages
--   using (public.can_edit_pipeline(pipeline_id));
--
-- ── pipeline_links (3) ──
-- alter policy pipeline_links_insert on public.pipeline_links
--   with check (
--     public.can_edit_pipeline(pipeline_id)
--     or (public.is_pipeline_client(pipeline_id)
--         and added_by = (select auth.uid())
--         and client_visible = true)
--   );
-- alter policy pipeline_links_update on public.pipeline_links
--   using (added_by = (select auth.uid())
--          or public.can_edit_pipeline(pipeline_id))
--   with check (added_by = (select auth.uid())
--               or public.can_edit_pipeline(pipeline_id));
-- alter policy pipeline_links_delete on public.pipeline_links
--   using (added_by = (select auth.uid())
--          or public.can_edit_pipeline(pipeline_id));
--
-- ── checklist_items (3) ──
-- alter policy checklist_items_insert on public.checklist_items
--   with check (
--     exists (select 1 from public.tasks t
--             join public.stages s on s.id = t.stage_id
--             where t.id = checklist_items.task_id
--               and public.can_edit_pipeline(s.pipeline_id))
--   );
-- alter policy checklist_items_update on public.checklist_items
--   using (
--     exists (select 1 from public.tasks t
--             join public.stages s on s.id = t.stage_id
--             where t.id = checklist_items.task_id
--               and (public.can_edit_pipeline(s.pipeline_id)
--                    or (public.is_pipeline_client(s.pipeline_id)
--                        and checklist_items.client_visible = true
--                        and t.client_visible = true
--                        and s.client_visible = true)))
--   )
--   with check (
--     exists (select 1 from public.tasks t
--             join public.stages s on s.id = t.stage_id
--             where t.id = checklist_items.task_id
--               and (public.can_edit_pipeline(s.pipeline_id)
--                    or (public.is_pipeline_client(s.pipeline_id)
--                        and checklist_items.client_visible = true
--                        and t.client_visible = true
--                        and s.client_visible = true)))
--   );
-- alter policy checklist_items_delete on public.checklist_items
--   using (
--     exists (select 1 from public.tasks t
--             join public.stages s on s.id = t.stage_id
--             where t.id = checklist_items.task_id
--               and public.can_edit_pipeline(s.pipeline_id))
--   );
--
-- ── client_invites (1) ──
-- alter policy client_invites_delete on public.client_invites
--   using (public.can_edit_pipeline(pipeline_id));
-- ============================================================================
