-- ============================================================================
-- Phase 4a (step 2 polish) — add pipeline_company param to create RPC
-- ============================================================================
-- Extends create_pipeline_with_channels with an optional pipeline_company
-- parameter so the /w/[slug]/p/new form can capture the client name at
-- pipeline creation time. The pipelines.company column has existed since
-- initial_schema (text, nullable); this just adds the writer path.
--
-- Company is OPTIONAL — empty/whitespace input collapses to NULL via
-- trim + nullif, matching how the emoji param treats empty input. Same
-- 80-char cap as pipeline_name for consistency.
--
-- Signature change requires DROP + CREATE (PG won't accept a parameter
-- addition via CREATE OR REPLACE alone). Re-issuing the grants after to
-- preserve the authenticated EXECUTE permission.
--
-- ┌─ DOWN PLAN
-- │   drop function if exists public.create_pipeline_with_channels(uuid, text, text, text);
-- │   -- then restore the 20260519130000 version of the function (without
-- │   -- the pipeline_company parameter).
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- Drop the existing 3-param signature (uuid, text, text) before creating
-- the new 4-param one. PG's CREATE OR REPLACE can't change parameter lists.
drop function if exists public.create_pipeline_with_channels(uuid, text, text);


create or replace function public.create_pipeline_with_channels(
  workspace_id     uuid,
  pipeline_name    text,
  pipeline_emoji   text default '📋',
  pipeline_company text default null
)
returns json
language plpgsql security definer
set search_path = ''
as $$
declare
  actor            uuid := (select auth.uid());
  cleaned_name     text;
  cleaned_emoji    text;
  resolved_emoji   text;
  cleaned_company  text;
  new_pipeline_id  uuid;
  general_id       uuid;
  client_id        uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.is_workspace_owner_or_admin(workspace_id) then
    raise exception 'You must be a workspace owner or admin to create pipelines'
      using errcode = '42501';
  end if;

  -- Name validation: trim + non-empty + length cap.
  cleaned_name := trim(coalesce(pipeline_name, ''));
  if cleaned_name = '' then
    raise exception 'Pipeline name cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Pipeline name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- Emoji: NULL/whitespace collapses to default '📋'.
  cleaned_emoji := nullif(trim(coalesce(pipeline_emoji, '')), '');
  resolved_emoji := coalesce(cleaned_emoji, '📋');

  -- Company (NEW): optional, trimmed, NULL when blank, same 80-char cap.
  cleaned_company := nullif(trim(coalesce(pipeline_company, '')), '');
  if cleaned_company is not null and length(cleaned_company) > 80 then
    raise exception 'Company name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- 1. Pipeline row (now writes company).
  insert into public.pipelines (workspace_id, name, emoji, company)
  values (workspace_id, cleaned_name, resolved_emoji, cleaned_company)
  returning id into new_pipeline_id;

  -- 2. Creator owns the pipeline at the pipeline-membership level too.
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (new_pipeline_id, actor, 'owner');

  -- 3. Internal "general" channel.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'general', false, actor)
  returning id into general_id;

  -- 4. Client channel — defaults to 'client', renamed on accept later.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'client', true, actor)
  returning id into client_id;

  -- 5. Creator joins both channels (required by channel_messages_insert RLS).
  insert into public.channel_memberships (channel_id, user_id)
  values (general_id, actor), (client_id, actor);

  return json_build_object(
    'pipeline_id', new_pipeline_id,
    'name',        cleaned_name,
    'emoji',       resolved_emoji,
    'company',     cleaned_company
  );
end;
$$;


-- Re-issue grants (DROP wiped them). Same pattern as the original
-- 20260519130000 migration — explicit revoke from PUBLIC + grant to
-- authenticated. Note: the anon/authenticated/postgres/service_role
-- grants get re-added by Supabase default privileges anyway; see the
-- "Tighten RPC grants" follow-up task from 2026-05-19 for the broader
-- hygiene pass.
revoke execute on function
  public.create_pipeline_with_channels(uuid, text, text, text)
  from public;

grant execute on function
  public.create_pipeline_with_channels(uuid, text, text, text)
  to authenticated;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. New 4-param signature exists, old one gone:
--   select pg_get_function_identity_arguments(oid)
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'create_pipeline_with_channels';
--   Expected: 1 row, args = 'workspace_id uuid, pipeline_name text,
--   pipeline_emoji text DEFAULT ''📋'', pipeline_company text DEFAULT NULL::text'.
--
-- 2. Functional smoke (company provided):
--   select public.create_pipeline_with_channels(
--     '<ws-uuid>'::uuid, 'Smoke', '🎯', 'Acme Inc');
--   select name, emoji, company from public.pipelines order by created_at desc limit 1;
--   Expected: name='Smoke', emoji='🎯', company='Acme Inc'.
--
-- 3. Functional smoke (company omitted → NULL):
--   select public.create_pipeline_with_channels(
--     '<ws-uuid>'::uuid, 'No Company', '🚀');
--   Expected: returned json has 'company' = null.
--
-- 4. Functional smoke (company empty string → NULL):
--   select public.create_pipeline_with_channels(
--     '<ws-uuid>'::uuid, 'Blank Company', '📋', '   ');
--   Expected: returned json has 'company' = null.
--
-- 5. Length cap:
--   select public.create_pipeline_with_channels(
--     '<ws-uuid>'::uuid, 'Long', '📋', repeat('x', 81));
--   Expected: ERROR 22023 'Company name cannot exceed 80 characters'.
-- ============================================================================
