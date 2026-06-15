-- ============================================================================
-- NF-1: notifications — user-scoped inbox for chat-driven events
--
-- DISTINCT from existing `public.activity_events` (the prototype's
-- per-pipeline Activity feed). That table is 1-row-per-event with
-- denormalized actor_name + a 4-value type CHECK; this table is
-- N-rows-per-event (one per recipient) with workspace + recipient
-- columns and a read_at flag. Different concern, different shape;
-- intentionally a separate table.
--
-- V1 EVENT KINDS
--   * client_message — a client posts in a pipeline channel → all
--     agency members of that pipeline are recipients
--   * mention — a pipeline member @mentions another pipeline member
--     in a channel message → only the mentioned user is the recipient
--
-- Both fire off the AFTER INSERT trigger on channel_messages. The
-- unique guard (source_kind, source_id, recipient_id, kind) protects
-- against double-emits if the trigger ever re-runs or a future bulk
-- backfill happens.
--
-- WRITE PATH
-- Direct PostgREST inserts into channel_messages are replaced by a
-- new SECURITY DEFINER RPC `send_channel_message` that (1) authz-
-- checks the actor is a member of the channel, (2) parses `@token`
-- mentions from the body, (3) resolves tokens against the pipeline's
-- audience (workspace seats + pipeline members + clients), (4) writes
-- channel_messages with mentions populated. The AFTER INSERT trigger
-- then fans out notifications.
-- ============================================================================


-- ─── 1. Table + indexes + RLS enable ─────────────────────────────────────

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('client_message', 'mention')),
  source_kind text not null check (source_kind in ('channel_message')),
  source_id uuid not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_kind, source_id, recipient_id, kind)
);

-- Feed query — all events for the recipient, newest first.
create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

-- Unread feed — partial index, smaller + faster.
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, read_at, created_at desc)
  where read_at is null;

-- Red-dot-per-pipeline — partial index for the workspace switcher /
-- pipeline-list badge query.
create index notifications_recipient_pipeline_unread_idx
  on public.notifications (recipient_id, pipeline_id)
  where read_at is null;

-- Back-resolution to the source channel_message (e.g., "jump to message"
-- on click-through).
create index notifications_source_idx
  on public.notifications (source_kind, source_id);

alter table public.notifications enable row level security;


-- ─── 2. RLS policies ─────────────────────────────────────────────────────

-- SELECT — recipient sees only their own events.
create policy notifications_select on public.notifications
for select using (recipient_id = (select auth.uid()));

-- UPDATE — recipient can flip read_at on their own events. WITH CHECK
-- prevents reassigning recipient_id mid-update (defense in depth even
-- though the trigger is the only INSERT path).
create policy notifications_update on public.notifications
for update using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

-- NO INSERT/DELETE policies. Trigger inserts via SECURITY DEFINER;
-- deletes happen only via FK cascade.


-- ─── 3. send_channel_message RPC ─────────────────────────────────────────
-- Replaces direct PostgREST INSERT into channel_messages. Parses @
-- mentions server-side and resolves them against the pipeline's audience
-- (workspace seats + pipeline memberships + clients) before insert.
-- Returns the inserted row so the client can keep its optimistic-then-
-- reconcile path.

create or replace function public.send_channel_message(
  p_channel_id uuid,
  p_text text,
  p_is_internal boolean default false
)
returns public.channel_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  resolved_pipeline_id uuid;
  resolved_workspace_id uuid;
  trimmed text := btrim(coalesce(p_text, ''));
  tokens text[];
  tok text;
  resolved_mentions uuid[] := array[]::uuid[];
  candidate uuid;
  inserted public.channel_messages;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if length(trimmed) < 1 then
    raise exception 'Message body cannot be empty' using errcode = '22023';
  end if;

  -- Resolve channel → pipeline → workspace.
  select c.pipeline_id, p.workspace_id
    into resolved_pipeline_id, resolved_workspace_id
  from public.channels c
  join public.pipelines p on p.id = c.pipeline_id
  where c.id = p_channel_id;

  if resolved_pipeline_id is null then
    raise exception 'Channel not found' using errcode = '22023';
  end if;

  -- Authz: actor must be a member of this channel. Mirrors the
  -- channel_messages_insert RLS gate so behavior is identical to the
  -- pre-RPC direct-insert path.
  if not exists (
    select 1 from public.channel_memberships
    where channel_id = p_channel_id and user_id = actor
  ) then
    raise exception 'Not authorized to send messages in this channel'
      using errcode = '42501';
  end if;

  -- Client-channel internal-flag block: clients posting in is_client
  -- channels cannot set is_internal=true. Same gate the existing RLS
  -- WITH CHECK enforced; preserved here so behavior is symmetric.
  if p_is_internal and public.is_pipeline_client(resolved_pipeline_id) then
    raise exception 'Clients cannot post internal messages'
      using errcode = '42501';
  end if;

  -- Parse @token mentions from the body. \S+ matches everything until
  -- the next whitespace; trailing punctuation like commas/periods will
  -- be part of the token and simply fail to resolve (silent skip, per
  -- the NF-1 spec's "typos are just text" rule).
  select array_agg(distinct lower(m[1]))
    into tokens
  from regexp_matches(trimmed, '@(\S+)', 'g') m
  where m[1] is not null and length(m[1]) > 0;

  -- For each token, look up a single user from the pipeline's audience.
  -- Match against (a) email-local-part, (b) display_name with spaces
  -- removed. First match wins. Self-mentions resolve here but are
  -- filtered out by the trigger so they never produce a notification.
  if tokens is not null then
    foreach tok in array tokens loop
      candidate := null;

      -- Audience = workspace seats UNION pipeline memberships (all roles,
      -- including clients). DISTINCT user_ids only.
      select pr.id into candidate
      from public.profiles pr
      where pr.id in (
        select wm.user_id
        from public.workspace_memberships wm
        where wm.workspace_id = resolved_workspace_id
        union
        select pm.user_id
        from public.pipeline_memberships pm
        where pm.pipeline_id = resolved_pipeline_id
      )
        and (
          lower(split_part(coalesce(pr.email, ''), '@', 1)) = tok
          or lower(regexp_replace(coalesce(pr.display_name, ''), '\s+', '', 'g')) = tok
        )
      limit 1;

      if candidate is not null
         and not (candidate = any(resolved_mentions)) then
        resolved_mentions := resolved_mentions || candidate;
      end if;
    end loop;
  end if;

  -- INSERT. SECURITY DEFINER bypasses channel_messages RLS (the authz
  -- check above is the new floor). Trigger fans out notifications.
  insert into public.channel_messages (
    channel_id, author_id, text, is_internal, mentions
  )
  values (
    p_channel_id, actor, trimmed, p_is_internal, resolved_mentions
  )
  returning * into inserted;

  return inserted;
end;
$$;

grant execute on function public.send_channel_message(uuid, text, boolean) to authenticated;

comment on function public.send_channel_message(uuid, text, boolean) is
  'NF-1: SECURITY DEFINER write path for channel_messages. Parses @token mentions, resolves against the pipeline audience (workspace seats + pipeline memberships including clients), writes mentions uuid[]. Replaces direct PostgREST INSERT so mention resolution + RLS authz live in one place.';


-- ─── 4. notify_on_channel_message trigger ────────────────────────────────
-- AFTER INSERT FOR EACH ROW. Fan-out matches the NF-1 spec:
--   * actor is a CLIENT → kind='client_message' row per agency member
--   * actor is an AGENCY member with NEW.mentions populated →
--     kind='mention' row per mentioned user who is on this pipeline,
--     excluding self
-- The unique guard on (source_kind, source_id, recipient_id, kind) makes
-- this idempotent under retry.

create or replace function public.notify_on_channel_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_pipeline_id uuid;
  resolved_workspace_id uuid;
  actor_is_client boolean;
begin
  if NEW.author_id is null then
    return NEW;
  end if;

  -- Resolve channel → pipeline → workspace.
  select c.pipeline_id, p.workspace_id
    into resolved_pipeline_id, resolved_workspace_id
  from public.channels c
  join public.pipelines p on p.id = c.pipeline_id
  where c.id = NEW.channel_id;

  if resolved_pipeline_id is null then
    return NEW;
  end if;

  actor_is_client := exists (
    select 1 from public.pipeline_memberships pm
    where pm.pipeline_id = resolved_pipeline_id
      and pm.user_id = NEW.author_id
      and pm.role = 'client'
  );

  if actor_is_client then
    -- client_message → every agency member of the pipeline (workspace
    -- owner/admin/member UNION pipeline owner/admin/member), excluding
    -- the actor.
    insert into public.notifications (
      workspace_id, pipeline_id, recipient_id, actor_id,
      kind, source_kind, source_id
    )
    select
      resolved_workspace_id,
      resolved_pipeline_id,
      audience.user_id,
      NEW.author_id,
      'client_message',
      'channel_message',
      NEW.id
    from (
      select wm.user_id
      from public.workspace_memberships wm
      where wm.workspace_id = resolved_workspace_id
        and wm.role in ('owner', 'admin', 'member')
      union
      select pm.user_id
      from public.pipeline_memberships pm
      where pm.pipeline_id = resolved_pipeline_id
        and pm.role in ('owner', 'admin', 'member')
    ) audience
    where audience.user_id != NEW.author_id
    on conflict (source_kind, source_id, recipient_id, kind) do nothing;
  else
    -- mention path. Only fires if NEW.mentions has anything to deliver.
    if NEW.mentions is not null and array_length(NEW.mentions, 1) is not null then
      insert into public.notifications (
        workspace_id, pipeline_id, recipient_id, actor_id,
        kind, source_kind, source_id
      )
      select
        resolved_workspace_id,
        resolved_pipeline_id,
        mentioned.user_id,
        NEW.author_id,
        'mention',
        'channel_message',
        NEW.id
      from (
        select distinct unnest(NEW.mentions) as user_id
      ) mentioned
      where mentioned.user_id != NEW.author_id
        -- Recipient must actually be on this pipeline. Audience match
        -- mirrors the resolution pool used by send_channel_message.
        and mentioned.user_id in (
          select wm.user_id
          from public.workspace_memberships wm
          where wm.workspace_id = resolved_workspace_id
          union
          select pm.user_id
          from public.pipeline_memberships pm
          where pm.pipeline_id = resolved_pipeline_id
        )
      on conflict (source_kind, source_id, recipient_id, kind) do nothing;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists channel_messages_notify on public.channel_messages;

create trigger channel_messages_notify
  after insert on public.channel_messages
  for each row
  execute function public.notify_on_channel_message();

comment on function public.notify_on_channel_message() is
  'NF-1: AFTER INSERT on channel_messages. Fans out notifications rows: client_message to every agency member (when actor is a client), mention to each mentioned pipeline member (when actor is agency-side). Idempotent via the (source_kind, source_id, recipient_id, kind) unique guard.';


-- ─── 5. mark_notification_read RPC ───────────────────────────────────────

create or replace function public.mark_notification_read(
  p_event_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  evt_recipient uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select n.recipient_id into evt_recipient
  from public.notifications n
  where n.id = p_event_id;

  if evt_recipient is null then
    raise exception 'Notification not found' using errcode = 'P0002';
  end if;

  if evt_recipient != actor then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.notifications n
  set read_at = now()
  where n.id = p_event_id
    and n.read_at is null;

  return true;
end;
$$;

grant execute on function public.mark_notification_read(uuid) to authenticated;


-- ─── 6. mark_all_notifications_read RPC ──────────────────────────────────

create or replace function public.mark_all_notifications_read(
  p_workspace_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  affected integer;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.notifications n
  set read_at = now()
  where n.recipient_id = actor
    and n.workspace_id = p_workspace_id
    and n.read_at is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

grant execute on function public.mark_all_notifications_read(uuid) to authenticated;


-- ─── 7. Verification (run after apply) ───────────────────────────────────
-- A. Table + RLS enabled.
--    select tablename, rowsecurity from pg_tables
--    where schemaname='public' and tablename='notifications';
--
-- B. Indexes present (4 expected).
--    select indexname from pg_indexes
--    where schemaname='public' and tablename='notifications';
--
-- C. Trigger bound.
--    select tgname from pg_trigger
--    where tgrelid='public.channel_messages'::regclass
--      and tgname='channel_messages_notify';
--
-- D. RPCs are SECURITY DEFINER + search_path=''.
--    select proname, prosecdef, proconfig from pg_proc
--    where proname in (
--      'send_channel_message',
--      'notify_on_channel_message',
--      'mark_notification_read',
--      'mark_all_notifications_read'
--    );
