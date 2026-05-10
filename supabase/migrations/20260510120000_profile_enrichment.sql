-- ============================================================================
-- Phase 3.4 — Profile enrichment from OAuth metadata
-- ============================================================================
-- Adds profile picture support and updates the new-user trigger to populate
-- display_name + avatar_url from OAuth provider metadata when available.
--
-- Why now (mid-Phase-3.4): Google sign-ups should land with a populated
-- avatar at zero work — a free conversion improvement. Better to capture
-- this on every new sign-up from this point forward than to backfill the
-- gap later. The avatar_url column was on WISHLIST as a post-MVP follow-up;
-- we're pulling items 1 and 2 forward into Phase 3.4. Item 3 (upload UI
-- for email+password users) remains deferred.
--
-- Changes:
--   1. profiles.avatar_url (text, nullable) — URL to the user's avatar
--      image. NULL for email+password sign-ups (no provider-supplied
--      avatar); UI is responsible for fallback rendering (initials,
--      default icon).
--   2. handle_new_user trigger — updated to also extract:
--        * display_name from raw_user_meta_data->>'full_name' (Supabase's
--          normalized field, populated for Google OAuth) OR
--          raw_user_meta_data->>'name' (raw Google field, defensive
--          fallback for any provider that skips Supabase's normalization).
--        * avatar_url from raw_user_meta_data->>'avatar_url' (Supabase's
--          normalized field) OR raw_user_meta_data->>'picture' (raw
--          Google field, defensive fallback).
--      For email+password signUp() calls, raw_user_meta_data is empty {};
--      both fields stay NULL.
--   3. One-time backfill — populate display_name and avatar_url for
--      existing profiles where the source data is in auth.users. Idempotent:
--      WHERE clause skips rows already populated, and coalesce preserves
--      existing values if re-run. Manual edits to display_name via the app
--      (when that UI ships) are preserved by the same mechanism.
--
-- Out of scope for this migration (deferred to a follow-up):
--   * Sync trigger that updates avatar_url when a user re-signs-in with
--     Google and Google's photo URL has changed. Add when (if) anyone
--     reports a stale-avatar issue.
--   * Storage bucket + upload UI for email+password users to set their own
--     avatar. Captured in WISHLIST → "Profile pictures → 3."
--
-- ┌─ DOWN PLAN (manual rollback recipe; Supabase doesn't auto-run a down)
-- │
-- │   alter table public.profiles drop column if exists avatar_url;
-- │
-- │   -- Restore the simpler handle_new_user from 20260509120000.
-- │   create or replace function public.handle_new_user()
-- │   returns trigger language plpgsql security definer
-- │   set search_path = ''
-- │   as $$
-- │   begin
-- │     insert into public.profiles (id, email)
-- │     values (new.id, new.email)
-- │     on conflict (id) do nothing;
-- │     return new;
-- │   end;
-- │   $$;
-- │   -- The on_auth_user_created trigger references handle_new_user by
-- │   -- name; replacing the function is enough. Trigger doesn't need
-- │   -- recreating.
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Add the column ──────────────────────────────────────────────────────
-- IF NOT EXISTS makes the migration safe to re-apply if it ever needs to be.
alter table public.profiles add column if not exists avatar_url text;


-- ─── 2. Replace handle_new_user to extract OAuth fields ────────────────────
-- Keeps the same function signature, ON CONFLICT behavior, and security
-- context (security definer) as the original at 20260509120000. Only the
-- inserted column list and value expressions change.
--
-- The two-key coalesce pattern defends against:
--   * Google: Supabase normalizes to full_name / avatar_url, but Google's
--     raw fields (name / picture) are also present in raw_user_meta_data.
--     We try the normalized key first, fall back to the raw key.
--   * Future providers (Microsoft, GitHub, Apple): may use either pattern,
--     or neither. NULL fallthrough is safe — display_name and avatar_url
--     are both nullable.
--   * Email+password signUp(): raw_user_meta_data is empty {}; both fields
--     stay NULL. UI handles the fallback (initials / default avatar icon).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ─── 3. One-time backfill from existing auth.users.raw_user_meta_data ─────
-- Idempotency:
--   * WHERE clause skips any row that's already fully populated (both
--     fields non-null OR no source data in raw_user_meta_data).
--   * coalesce(existing, source) preserves any existing value, so this
--     can be re-run without overwriting.
--   * Manual edits via the app (when settings UI ships) are preserved.
--
-- The `?` operator checks if a top-level JSON key exists. Combined with
-- the IS NULL check, we only update rows where there's actually something
-- to backfill (both pieces of the AND must be true within each branch).
update public.profiles p
set
  display_name = coalesce(
    p.display_name,
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name'
  ),
  avatar_url = coalesce(
    p.avatar_url,
    u.raw_user_meta_data->>'avatar_url',
    u.raw_user_meta_data->>'picture'
  )
from auth.users u
where p.id = u.id
  and (
    (
      p.display_name is null
      and (u.raw_user_meta_data ? 'full_name' or u.raw_user_meta_data ? 'name')
    )
    or
    (
      p.avatar_url is null
      and (u.raw_user_meta_data ? 'avatar_url' or u.raw_user_meta_data ? 'picture')
    )
  );


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Confirm the column was added and is nullable:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles'
--     and column_name = 'avatar_url';
--
-- 2. Confirm the backfill populated existing Google users:
--   select id, email, display_name, avatar_url
--   from public.profiles
--   where email like '%@printzly.com'
--      or email like '%@gmail.com'
--   order by email;
--
-- 3. Cross-reference the source raw_user_meta_data for any user whose
--    backfill came up unexpectedly NULL:
--   select email, raw_user_meta_data
--   from auth.users
--   where email like '%@printzly.com'
--      or email like '%@gmail.com'
--   order by email;
--
-- 4. Re-run the migration's UPDATE to confirm idempotency. The second run
--    should report "UPDATE 0" because every row that needed populating was
--    handled the first time:
--   /* run the same UPDATE statement from section 3 again */
-- ============================================================================
