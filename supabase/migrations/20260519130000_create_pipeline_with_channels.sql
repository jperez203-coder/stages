-- ============================================================================
-- Phase 4a (step 1) — create_pipeline_with_channels RPC
-- ============================================================================
-- Atomic pipeline creation. One transaction creates:
--   * pipelines row (with workspace_id, name, emoji)
--   * pipeline_memberships row for the creator (role='owner')
--   * 2 channels: 'general' (is_client=false) + 'client' (is_client=true)
--   * channel_memberships for the creator in both channels (required for
--     the creator to post in them — channel_messages_insert RLS gates on
--     channel_membership, not just pipeline membership)
--
-- Permission gate: caller must be workspace owner or admin (matches the
-- gate used for workspace_invites in Phase 3.4 step 6 — workspace-level
-- "manage who/what" actions all run through is_workspace_owner_or_admin).
--
-- Client channel naming: defaults to 'client' at creation. Future
-- enhancement (deferred from Phase 4a step 1 scope) will rename it to the
-- client's company name once a client_invite is accepted on the pipeline.
--
-- ┌─ DOWN PLAN (manual rollback recipe)
-- │
-- │   drop function if exists public.create_pipeline_with_channels(uuid, text, text);
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── create_pipeline_with_channels ─────────────────────────────────────────
-- Args:
--   workspace_id    — target workspace; caller must be owner/admin of it
--   pipeline_name   — required, trimmed, max 80 chars
--   pipeline_emoji  — optional; defaults to '📋' if null/empty
--
-- Returns JSON: { pipeline_id, name, emoji }
--
-- Failure modes (each with a distinct SQLSTATE the client can branch on):
--   * 42501 — not authenticated
--   * 42501 — caller is not workspace owner/admin
--   * 22023 — pipeline_name empty after trim
--   * 22023 — pipeline_name longer than 80 chars
--   * (any FK/CHECK violation from the inserts bubbles up unchanged)
create or replace function public.create_pipeline_with_channels(
  workspace_id    uuid,
  pipeline_name   text,
  pipeline_emoji  text default '📋'
)
returns json
language plpgsql security definer
set search_path = ''
as $$
declare
  actor           uuid := (select auth.uid());
  cleaned_name    text;
  cleaned_emoji   text;
  resolved_emoji  text;
  new_pipeline_id uuid;
  general_id      uuid;
  client_id       uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Permission gate. Same helper used by workspace_invites — workspace
  -- owners and admins manage workspace-level resources (teammates,
  -- pipelines). Plain workspace members can collaborate inside pipelines
  -- they're added to but can't spin up new ones.
  if not public.is_workspace_owner_or_admin(workspace_id) then
    raise exception 'You must be a workspace owner or admin to create pipelines'
      using errcode = '42501';
  end if;

  -- Name validation: trim + non-empty + length cap (matches workspaces).
  cleaned_name := trim(coalesce(pipeline_name, ''));
  if cleaned_name = '' then
    raise exception 'Pipeline name cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Pipeline name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- Emoji: defaults to '📋' (matches the column-level default in the
  -- initial schema). NULL or whitespace-only input collapses to the default.
  cleaned_emoji := nullif(trim(coalesce(pipeline_emoji, '')), '');
  resolved_emoji := coalesce(cleaned_emoji, '📋');

  -- 1. Pipeline row.
  insert into public.pipelines (workspace_id, name, emoji)
  values (workspace_id, cleaned_name, resolved_emoji)
  returning id into new_pipeline_id;

  -- 2. Creator owns the pipeline at the pipeline-membership level too.
  -- Without this row, the creator can still edit the pipeline (workspace
  -- owners/admins inherit via can_edit_pipeline → is_workspace_owner_or_admin),
  -- but having an explicit pipeline_memberships row makes "who owns this
  -- engagement" queryable and keeps the model consistent with pipelines
  -- created by workspace admins whose authority is workspace-level.
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (new_pipeline_id, actor, 'owner');

  -- 3. Internal "general" channel.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'general', false, actor)
  returning id into general_id;

  -- 4. Client channel — defaults to 'client'. Renamed to the client's
  -- company name when an invite is accepted (deferred enhancement). The
  -- channels.channels_one_client_per_pipeline unique partial index also
  -- protects against accidentally creating a second client channel later.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'client', true, actor)
  returning id into client_id;

  -- 5. Creator joins both channels. channel_messages_insert RLS requires
  -- is_channel_member, not just pipeline membership, so this is what makes
  -- the creator able to actually post.
  insert into public.channel_memberships (channel_id, user_id)
  values (general_id, actor), (client_id, actor);

  return json_build_object(
    'pipeline_id', new_pipeline_id,
    'name',        cleaned_name,
    'emoji',       resolved_emoji
  );
end;
$$;


-- ─── Grants ────────────────────────────────────────────────────────────────
-- Explicit revoke from PUBLIC + grant to authenticated. Same pattern as the
-- Phase 3.4 hygiene migration (20260514130000_revoke_public_rpc_grants).
revoke execute on function
  public.create_pipeline_with_channels(uuid, text, text)
  from public;

grant execute on function
  public.create_pipeline_with_channels(uuid, text, text)
  to authenticated;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Function exists + is security definer + grants are right:
--   select p.proname, p.prosecdef,
--          pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'create_pipeline_with_channels';
--   Expected: 1 row, prosecdef=true, args='workspace_id uuid, pipeline_name text, pipeline_emoji text DEFAULT ''📋'''.
--
-- 2. Grants:
--   select grantee, privilege_type
--   from information_schema.role_routine_grants
--   where routine_schema = 'public'
--     and routine_name = 'create_pipeline_with_channels'
--   order by grantee;
--   Expected: authenticated EXECUTE. No PUBLIC row.
--
-- 3. Functional smoke (impersonating a workspace owner):
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims to '{"sub":"<UUID>","role":"authenticated"}';
--   select public.create_pipeline_with_channels(
--     '<workspace-uuid>'::uuid, 'Smoke Test Pipeline', '🚀'
--   );
--   -- Verify the row + memberships + channels:
--   select id, name, emoji, workspace_id from public.pipelines
--     where name = 'Smoke Test Pipeline';
--   select role from public.pipeline_memberships
--     where pipeline_id = '<new-pipeline-id>';
--   select name, is_client from public.channels
--     where pipeline_id = '<new-pipeline-id>' order by is_client;
--   select count(*) from public.channel_memberships
--     where channel_id in (select id from public.channels
--                          where pipeline_id = '<new-pipeline-id>');
--   rollback;
--   Expected: pipeline row, 1 membership (role=owner), 2 channels
--   (general/false, client/true), 2 channel memberships.
--
-- 4. Permission gate (impersonating a non-owner/admin):
--   begin;
--   set local request.jwt.claims to '{"sub":"<non-admin-UUID>","role":"authenticated"}';
--   select public.create_pipeline_with_channels(
--     '<workspace-uuid>'::uuid, 'Should Fail', '📋'
--   );
--   rollback;
--   Expected: ERROR 42501 'You must be a workspace owner or admin to create pipelines'.
-- ============================================================================
