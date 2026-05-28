-- ============================================================================
-- Migration: pending_emails queue + first-pipeline enqueue trigger
-- Date:      2026-06-13
-- ----------------------------------------------------------------------------
-- PURPOSE
--   Backs the "first pipeline welcome email" feature. When an AGENCY owner
--   creates their FIRST pipeline ever, we enqueue a personal email to be sent
--   ~30 minutes later. Delivery is handled OUT of the database by a Vercel
--   Cron job hitting /api/cron/send-pending-emails, which reads due rows with
--   the service-role key and sends via Resend (src/lib/email.ts).
--
--   Deliberately NO pg_cron / pg_net / Edge Functions — the scheduler lives
--   in Vercel Cron + a Next.js API route. This table is just the queue.
--
-- WHAT THIS CREATES
--   1. public.pending_emails        — the send queue (append + mark-sent)
--   2. pending_emails_due_idx       — partial index over un-sent due rows
--   3. RLS enabled, NO policies     — only the service-role cron reads/writes
--   4. enqueue_first_pipeline_email() trigger fn (security definer)
--   5. on_first_owner_pipeline trigger on pipeline_memberships
--
-- WHY THE TRIGGER IS ON pipeline_memberships (not pipelines)
--   The pipelines table has no created_by column — ownership is modeled by a
--   pipeline_memberships row with role='owner', inserted by
--   create_pipeline_with_channels for the creator. Firing AFTER INSERT on
--   pipeline_memberships WHEN (NEW.role = 'owner') gives us the user_id
--   directly and is overload-agnostic (works for the 4-arg and 5-arg RPC, and
--   any future creation path). We do NOT modify the RPC.
--
-- IDEMPOTENCY / SAFETY
--   * "First pipeline" = exactly 1 owner membership for the user after insert.
--   * Belt-and-suspenders: only fire for users who are agency owner/admin in
--     SOME workspace (clients have no workspace_memberships row → never fire).
--   * Hard guard: never enqueue a second 'first_pipeline' row for the same
--     recipient, even if the count logic is ever fooled.
--   * security definer + search_path='' so the trigger can read profiles /
--     workspace_memberships regardless of the acting user's RLS. All object
--     names are schema-qualified because search_path is empty.
--
-- CASCADE FOOTPRINT
--   pending_emails references nothing and is referenced by nothing. Dropping
--   it (DOWN plan) affects no other table.
--
-- DOWN PLAN (manual, if ever needed)
--   drop trigger if exists on_first_owner_pipeline on public.pipeline_memberships;
--   drop function if exists public.enqueue_first_pipeline_email();
--   drop table if exists public.pending_emails;
--
-- APPLY: paste into Supabase SQL editor (this repo never runs db push).
-- ============================================================================

-- 1. Queue table -------------------------------------------------------------
create table public.pending_emails (
  id             uuid primary key default gen_random_uuid(),
  email_type     text not null,                 -- 'first_pipeline'
  recipient      text not null,                 -- email address
  recipient_name text null,                      -- display_name snapshot
  payload        jsonb null,                     -- extra data (e.g. pipeline_id)
  send_after     timestamptz not null,
  sent_at        timestamptz null,
  created_at     timestamptz not null default now()
);

-- 2. Partial index over un-sent, due-able rows — the cron's hot query is
--    "where sent_at is null and send_after <= now()". Partial on sent_at null
--    keeps the index tiny (sent rows drop out).
create index pending_emails_due_idx
  on public.pending_emails (send_after)
  where sent_at is null;

-- 3. RLS on, NO policies. The service-role cron bypasses RLS; everyone else
--    is blocked by the absence of any policy. This table holds email
--    addresses and must never be readable by ordinary authenticated users.
alter table public.pending_emails enable row level security;

-- 4. Enqueue trigger function ------------------------------------------------
create or replace function public.enqueue_first_pipeline_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_count integer;
  v_is_agency   boolean;
  v_email       text;
  v_name        text;
begin
  -- Trigger WHEN clause already restricts to role='owner', but guard anyway.
  if new.role <> 'owner' then
    return new;
  end if;

  -- (a) Is this the user's FIRST owner pipeline ever? The just-inserted row
  --     is counted, so "first" == exactly 1.
  select count(*) into v_owner_count
  from public.pipeline_memberships
  where user_id = new.user_id and role = 'owner';

  if v_owner_count <> 1 then
    return new;
  end if;

  -- (b) Only agency owners/admins get this email, never clients. Clients have
  --     no workspace_memberships row at all.
  select exists (
    select 1 from public.workspace_memberships
    where user_id = new.user_id and role in ('owner', 'admin')
  ) into v_is_agency;

  if not v_is_agency then
    return new;
  end if;

  -- (c) Snapshot recipient details.
  select email, display_name into v_email, v_name
  from public.profiles
  where id = new.user_id;

  if v_email is null then
    return new;  -- nothing to send to
  end if;

  -- (d) Idempotency: never enqueue a second first_pipeline email for the same
  --     recipient.
  if exists (
    select 1 from public.pending_emails
    where email_type = 'first_pipeline' and recipient = v_email
  ) then
    return new;
  end if;

  -- (e) Enqueue, due 30 minutes out.
  insert into public.pending_emails
    (email_type, recipient, recipient_name, payload, send_after)
  values (
    'first_pipeline',
    v_email,
    v_name,
    jsonb_build_object('pipeline_id', new.pipeline_id),
    now() + interval '30 minutes'
  );

  return new;
end;
$$;

-- 5. Trigger -----------------------------------------------------------------
drop trigger if exists on_first_owner_pipeline on public.pipeline_memberships;
create trigger on_first_owner_pipeline
after insert on public.pipeline_memberships
for each row
when (new.role = 'owner')
execute function public.enqueue_first_pipeline_email();

-- ============================================================================
-- VERIFICATION QUERIES (run after applying; not part of the migration)
-- ============================================================================
-- -- a. Table exists with the expected columns:
-- select column_name, data_type, is_nullable
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'pending_emails'
-- order by ordinal_position;
--
-- -- b. Partial index present:
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'pending_emails';
--
-- -- c. RLS enabled, zero policies:
-- select relrowsecurity from pg_class where relname = 'pending_emails';   -- t
-- select count(*) from pg_policies
-- where schemaname = 'public' and tablename = 'pending_emails';           -- 0
--
-- -- d. Trigger wired:
-- select tgname, tgenabled from pg_trigger
-- where tgrelid = 'public.pipeline_memberships'::regclass
--   and tgname = 'on_first_owner_pipeline';
--
-- -- e. Smoke test (in a transaction you ROLL BACK so it doesn't really enqueue):
-- --    begin;
-- --    -- create a workspace + workspace_membership(owner) + pipeline via the
-- --    -- normal RPC as a test agency user, then:
-- --    select email_type, recipient, send_after from public.pending_emails
-- --    where email_type = 'first_pipeline' order by created_at desc limit 5;
-- --    rollback;
-- ============================================================================
