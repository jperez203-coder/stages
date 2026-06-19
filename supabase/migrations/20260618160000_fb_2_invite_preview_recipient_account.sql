-- ============================================================================
-- FB-2: extend get_workspace_invite_preview with recipient_has_account
-- ============================================================================
-- Closes the noisy-CTA UX bug: today /accept-invite/[token] shows BOTH
-- "Sign in to accept" and "Create an account" buttons for every invite,
-- regardless of whether the invited email already has a Stages account.
-- A new invitee clicks "Sign in" first, hits invalid-credentials, has to
-- backtrack and switch to "Create an account." Wasted clicks.
--
-- Fix: return a single boolean that lets the page decide which CTA to
-- promote. The page renders ONE primary blue CTA + a secondary text-link
-- affordance to the alternate path:
--
--   recipient_has_account = true   → primary: Sign in to accept
--                                    secondary: "Need an account? Create one"
--   recipient_has_account = false  → primary: Create an account
--                                    secondary: "Already have an account? Sign in"
--
-- BOTH primary CTAs continue to carry the ?invite=<token> param from FB-1.
--
-- SECURITY
-- ────────
-- The boolean is scoped to ONE email derived from ONE invite token. The
-- caller never supplies the email — it comes from the invite row, which
-- only an owner of the token can resolve. No email-enumeration surface
-- introduced: the caller can't probe arbitrary emails by ID, and even
-- with the token, the only thing they learn is whether the SPECIFIC
-- invited email exists. That's information they implicitly already had
-- (they were sent the invite at that email).
--
-- Case-insensitive match: `lower(email)` on both sides of the comparison,
-- matching the accept_workspace_invite RPC's own email-match check
-- (20260513120000:328). Without this, a recipient whose auth.users.email
-- differs in case from inv.email (e.g. Gmail's all-lowercase normalization
-- vs. the inviter typing "JordanPerez1270@gmail.com") would see the
-- wrong CTA. The accept-RPC's case-insensitive gate is the security floor
-- regardless.
--
-- BACKWARD COMPATIBLE
-- ───────────────────
-- All existing returned fields preserved in the same positions; the new
-- field lands at the end of the json_build_object call. Clients reading
-- the prior fields don't break. The field is omitted by callers who don't
-- need it (e.g. SignUpPanel's preview consumer at line 78-82 reads only
-- status + email + workspace_name).
--
-- CREATE OR REPLACE — no DROP. The RPC is called from prod code paths;
-- DROP-then-CREATE would briefly 404 those calls.
--
-- ┌─ DOWN PLAN
-- │
-- │   CREATE OR REPLACE the function with the pre-FB-2 body from
-- │   supabase/migrations/20260513120000_workspace_invites.sql:146-212.
-- │   No data needs to revert; the new field is purely additive.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

create or replace function public.get_workspace_invite_preview(invite_token uuid)
returns json language plpgsql security definer stable
set search_path = ''
as $$
declare
  inv                    public.workspace_invites%rowtype;
  ws_name                text;
  ws_slug                text;
  inviter_display        text;
  inviter_email          text;
  inviter_active         boolean := false;
  resolved_status        text;
  recipient_has_account  boolean := false;  -- FB-2
begin
  select * into inv from public.workspace_invites where token = invite_token;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  -- Derive status. Order matters: 'accepted' wins over 'expired' (a
  -- successfully-used invite is a finalized state, not a stale one).
  if inv.accepted_at is not null then
    resolved_status := 'accepted';
  elsif inv.expires_at <= now() then
    resolved_status := 'expired';
  else
    resolved_status := 'pending';
  end if;

  -- Look up workspace (FK + ON DELETE CASCADE means this should always
  -- find a row, but defensive in case of a concurrent delete).
  select name, slug into ws_name, ws_slug
  from public.workspaces where id = inv.workspace_id;
  if ws_name is null then
    return json_build_object('status', 'not_found');
  end if;

  -- Inviter info. invited_by may be NULL if the inviter's auth.users row
  -- was deleted (ON DELETE SET NULL). Active-member check is independent
  -- of whether the row still exists.
  if inv.invited_by is not null then
    select coalesce(p.display_name, u.email, 'Unknown'), u.email
      into inviter_display, inviter_email
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = inv.invited_by;

    inviter_active := exists (
      select 1 from public.workspace_memberships
      where workspace_id = inv.workspace_id
        and user_id = inv.invited_by
    );
  end if;

  -- FB-2: does an auth.users row exist for the invited email?
  -- Case-insensitive match (matches accept_workspace_invite's gate at
  -- 20260513120000:328). SECURITY DEFINER means we can read auth.users
  -- from the public schema without further grants. The single-row probe
  -- is bounded to ONE email derived from the invite row — no enumeration
  -- surface introduced.
  select exists (
    select 1 from auth.users
    where lower(email) = lower(inv.email)
  ) into recipient_has_account;

  return json_build_object(
    'status', resolved_status,
    'workspace_name', ws_name,
    'workspace_slug', ws_slug,
    'email', inv.email,
    'role', inv.role,
    'inviter_display_name', inviter_display,
    'inviter_email', inviter_email,
    'inviter_is_active_member', inviter_active,
    'expires_at', inv.expires_at,
    'accepted_at', inv.accepted_at,
    'recipient_has_account', recipient_has_account  -- FB-2
  );
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Function carries the FB-2 field. Text-match looks for the literal
--     'recipient_has_account' key in the function body; if it drops to
--     false the migration regressed.
--   select
--     position('recipient_has_account' in pg_get_functiondef(oid)) > 0 as fb2_field_present
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'get_workspace_invite_preview';
--   -- Expected: fb2_field_present = true.
--
-- (b) Signature unchanged (callers must keep working). Re-applying FB-2
--     should leave the signature byte-identical.
--   select pg_get_function_arguments(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'get_workspace_invite_preview';
--   -- Expected: invite_token uuid
--
-- (c) Smoke test against a live invite. Substitute <token>.
--   select public.get_workspace_invite_preview('<token>'::uuid);
--   -- Expected: JSON object containing recipient_has_account as a boolean.
--   -- For Jordan's main email jordanperez1270@gmail.com -> should be true.
--   -- For a fresh test address never signed up -> should be false.
-- ============================================================================
