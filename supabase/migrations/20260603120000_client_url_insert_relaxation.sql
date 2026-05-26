-- ============================================================================
-- Phase 4b-3-e: relax client INSERT to allow kind='url' (links)
-- ============================================================================
-- Followup to 20260601120000 + 20260602120000. The original 4b-3-d
-- scope locked clients to kind='file' only ("client uploads are inert
-- bytes; client-added URLs are arbitrary strings the agency may be
-- tempted to click — phishing/redirect risk; scope discipline"). The
-- founder decision on 2026-05-25 reverses that: clients also need to
-- share LINKS (figma boards, drive folders, loom recordings, etc.) as
-- part of the asset-collection use case. The risk asymmetry is
-- accepted for v1; the social-engineering surface is judged
-- manageable because agencies already train clients on which links
-- they'll receive.
--
-- ── WHAT THIS MIGRATION CHANGES ────────────────────────────────────
--
-- Two surgical edits, both in the client branch of the existing
-- protections:
--
--   1. pipeline_links_insert policy — DROP the `and kind = 'file'`
--      clause from the client OR-branch.
--   2. enforce_client_pipeline_link_insert_scope() trigger — DROP the
--      `if new.kind is distinct from 'file' then raise ...` block.
--
-- After this migration, the client OR-branch on pipeline_links_insert
-- reads:
--   is_pipeline_client(pipeline_id)
--   AND added_by = auth.uid()
--   AND client_visible = true
-- and the trigger body for clients reads:
--   if client_visible is distinct from true → raise
--   if added_by is distinct from auth.uid() → raise
--
-- ── WHAT THIS MIGRATION INTENTIONALLY DOES NOT CHANGE ──────────────
--
--   * Defense in depth on the OTHER two client constraints
--     (client_visible=true, added_by=self) — STILL enforced in BOTH
--     the policy WITH CHECK AND the trigger. Removing either layer
--     for either rule is out of scope.
--   * Storage policies (pipeline_files_storage_insert/select/delete)
--     — unchanged. URL rows have storage_path = null so they never
--     touch storage.objects; nothing to relax there.
--   * pipeline_links_kind_payload CHECK — unchanged. Still enforces:
--       kind='url'  → url IS NOT NULL AND storage_path IS NULL
--       kind='file' → storage_path IS NOT NULL AND url IS NULL
--     This is the table-level guarantee that url and file rows are
--     well-formed, independent of who inserted them.
--   * pipeline_links_storage_path_matches_pipeline CHECK (from
--     20260602120000) — unchanged. The CHECK is
--     `storage_path IS NULL OR storage_path LIKE pipeline_id::text || '/%'`.
--     For URL rows (storage_path IS NULL), the IS NULL branch fires
--     and the constraint passes trivially. CONFIRMED.
--   * pipeline_links_update / pipeline_links_delete policies —
--     unchanged. Clients still can't UPDATE (no label edits, no
--     visibility toggle); they CAN delete-their-own via the existing
--     added_by = auth.uid() branch.
--
-- ── RISK ANALYSIS ──────────────────────────────────────────────────
--
-- New threat surface: a malicious client could POST `pipeline_links`
-- rows with arbitrary URLs in `url`. Possible misuse:
--   * Phishing links disguised as friendly labels ("invoice 2026.pdf"
--     → http://phish.example/login)
--   * URLs to malware / drive-by-download landing pages
--   * Tracking pixels / link-shorteners that fingerprint the agency
--
-- All of these would also work in chat messages (which clients can
-- already post text to). The agency's mitigation is human review —
-- "an agency receives a link from a client, looks at it before
-- clicking" — same posture as for incoming email.
--
-- Not mitigated by this migration:
--   * URL validation (we accept any string)
--   * Domain allowlists (none today)
--   * Click-through warnings on the agency side
-- If any become a real customer pain point, they're separate v1.1
-- features. The founder's call is that this is acceptable for v1.
--
-- ── PRIVACY REGRESSION NOTES ───────────────────────────────────────
--
-- The other two client constraints (client_visible=true, added_by=
-- self) STILL apply to URL inserts. So a client can't:
--   * Insert a hidden-from-self URL row (covert channel) — blocked
--     by policy + trigger.
--   * Spoof added_by to look like an agency upload — blocked by
--     policy + trigger.
--   * Insert a URL row in a pipeline they're not a client of —
--     blocked by is_pipeline_client(pipeline_id).
--
-- Privacy tests 1-7 from 4b-3-d remain valid. New tests 8-10 (added
-- to scripts/test-client-upload-rls.mjs alongside this migration)
-- verify the URL-kind branch:
--   * Test 8: Casey CAN insert kind='url' to Pipeline A; agency sees.
--   * Test 9: Casey CANNOT insert kind='url' to Pipeline B (still
--     blocked by is_pipeline_client).
--   * Test 10: Casey CANNOT insert kind='url' with client_visible=false
--     (still blocked by policy + trigger).
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Re-add the kind='file' lock to both layers.
-- │
-- │   drop policy if exists pipeline_links_insert on public.pipeline_links;
-- │   create policy pipeline_links_insert on public.pipeline_links
-- │   for insert with check (
-- │     public.can_edit_pipeline(pipeline_id)
-- │     or (
-- │       public.is_pipeline_client(pipeline_id)
-- │       and kind = 'file'
-- │       and added_by = (select auth.uid())
-- │       and client_visible = true
-- │     )
-- │   );
-- │
-- │   create or replace function public.enforce_client_pipeline_link_insert_scope()
-- │   returns trigger language plpgsql security definer
-- │   set search_path = ''
-- │   as $body$
-- │   begin
-- │     if public.is_pipeline_client(new.pipeline_id) then
-- │       if new.client_visible is distinct from true then
-- │         raise exception 'Clients must upload with client_visible = true.';
-- │       end if;
-- │       if new.kind is distinct from 'file' then
-- │         raise exception 'Clients can only upload files (kind = file), not links.';
-- │       end if;
-- │       if new.added_by is distinct from (select auth.uid()) then
-- │         raise exception 'Clients cannot impersonate another uploader.';
-- │       end if;
-- │     end if;
-- │     return new;
-- │   end;
-- │   $body$;
-- │
-- │   -- Any URL-kind rows clients inserted during the relaxed window
-- │   -- would survive the revert (the kind='url' rows aren't
-- │   -- automatically purged by reverting the policy). If you want
-- │   -- them gone:
-- │   --   delete from public.pipeline_links pl
-- │   --   where pl.kind = 'url'
-- │   --     and exists (
-- │   --       select 1 from public.pipeline_memberships pm
-- │   --       where pm.user_id = pl.added_by
-- │   --         and pm.pipeline_id = pl.pipeline_id
-- │   --         and pm.role = 'client'
-- │   --     );
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Relax pipeline_links_insert policy: drop kind='file' clause ────────
-- Client branch goes from 4 conjuncts to 3. Agency branch unchanged.

drop policy if exists pipeline_links_insert on public.pipeline_links;

create policy pipeline_links_insert on public.pipeline_links
for insert with check (
  public.can_edit_pipeline(pipeline_id)
  or (
    public.is_pipeline_client(pipeline_id)
    and added_by = (select auth.uid())
    and client_visible = true
  )
);


-- ─── 2. Relax trigger: drop the kind check ─────────────────────────────────
-- CREATE OR REPLACE replaces the function body in place; the existing
-- BEFORE INSERT trigger on pipeline_links keeps firing the (now updated)
-- function. No trigger recreate needed.
--
-- Defense-in-depth on client_visible=true AND added_by=auth.uid() is
-- preserved — those checks still appear in BOTH the policy WITH CHECK
-- above AND the trigger body below. Only the kind check is removed.

create or replace function public.enforce_client_pipeline_link_insert_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  -- Only applies to client viewers; agency inserts pass through.
  if public.is_pipeline_client(new.pipeline_id) then
    if new.client_visible is distinct from true then
      raise exception 'Clients must upload with client_visible = true.';
    end if;
    if new.added_by is distinct from (select auth.uid()) then
      raise exception 'Clients cannot impersonate another uploader.';
    end if;
  end if;
  return new;
end;
$$;


-- ============================================================================
-- 3. VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- ─── (a) pipeline_links_insert WITH CHECK no longer mentions 'file' on the
--     client branch ─────────────────────────────────────────────────────────
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check_expr
--   from pg_policy
--   where polrelid = 'public.pipeline_links'::regclass
--     and polname = 'pipeline_links_insert';
--   -- Expected: 1 row. with_check_expr should mention
--   --   'can_edit_pipeline', 'is_pipeline_client', 'added_by',
--   --   'client_visible' — but NOT 'kind' anywhere.
--
-- ─── (b) trigger function no longer references 'kind' ──────────────────────
--   select pg_get_functiondef(oid) as fn_def
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'enforce_client_pipeline_link_insert_scope';
--   -- Expected: function body contains 'client_visible' and 'added_by'
--   -- checks. Does NOT contain the string 'kind' or 'Clients can only
--   -- upload files'.
--
-- ─── (c) Other constraints unchanged ───────────────────────────────────────
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.pipeline_links'::regclass
--   order by conname;
--   -- Expected: pipeline_links_kind_check, pipeline_links_kind_payload,
--   -- pipeline_links_pkey, pipeline_links_pipeline_id_fkey,
--   -- pipeline_links_added_by_fkey, pipeline_links_storage_path_matches_pipeline
--   -- (the binding constraint from 20260602120000 — still in place,
--   -- still allows storage_path IS NULL for url rows).
-- ============================================================================
