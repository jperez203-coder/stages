-- ============================================================================
-- Phase 3.4 (4a) — Workspace slugs + last-active-workspace tracking
-- ============================================================================
-- Adds two pieces of data infrastructure for the AppShell + post-login
-- workspace selector work in Phase 3.4:
--
--   1. workspaces.slug (text, NOT NULL, unique case-insensitively) — used in
--      URLs (/w/[slug]/...) so links are human-readable, stable, and
--      shareable. Backfilled from existing workspace names in deterministic
--      (created_at, id) order so re-running on different databases produces
--      the same result. Auto-generated on INSERT via the
--      workspaces_auto_slug trigger when the app doesn't provide one.
--
--   2. profiles.last_active_workspace_id (uuid, nullable) — UX hint so
--      returning users can be auto-routed to the workspace they last used,
--      skipping the chooser when there's only one valid candidate.
--      Validated at READ time by the post-login router (a stale value
--      pointing at a workspace the user no longer has access to falls
--      back to the chooser); no DB-level enforcement, since this is a
--      hint not an authority.
--
-- Helpers added (kept narrowly scoped to slug generation):
--   * public.slugify(text) — deterministic ASCII-slug generator. Uses the
--     unaccent extension to transliterate accented characters.
--   * public.unique_workspace_slug(text, uuid) — collision suffixing
--     (base, base-2, base-3, …). The exclude_id param lets the function
--     ignore the row currently being inserted/updated to avoid self-collision.
--
-- Trigger added:
--   * workspaces_auto_slug_trigger (BEFORE INSERT) — populates slug from the
--     workspace name when not provided. Does NOT override explicit slugs;
--     those go through the CHECK constraint and unique index and fail
--     loudly on invalid format or collision (defensive design — don't
--     silently transform user input).
--
-- ┌─ DOWN PLAN (manual rollback if ever needed; Supabase migrations don't
-- │   auto-run a down step, so this is here as a recipe future-me can copy)
-- │
-- │   alter table public.profiles drop column if exists last_active_workspace_id;
-- │
-- │   drop trigger if exists workspaces_auto_slug_trigger on public.workspaces;
-- │   drop function if exists public.workspaces_auto_slug();
-- │   drop function if exists public.unique_workspace_slug(text, uuid);
-- │   drop function if exists public.slugify(text);
-- │
-- │   drop index if exists public.workspaces_slug_lower_idx;
-- │   alter table public.workspaces drop constraint if exists workspaces_slug_format;
-- │   alter table public.workspaces drop column if exists slug;
-- │
-- │   -- Do NOT drop the unaccent extension. Other code may rely on it.
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- Ensure unaccent is available for slugify. Supabase provides this in the
-- `extensions` schema by default; this is a no-op if already enabled.
create extension if not exists unaccent with schema extensions;


-- ─── slugify ────────────────────────────────────────────────────────────────
-- Deterministic ASCII-slug generator. Lowercase, hyphen-separated,
-- alphanumeric only. Same input → same output, every time. Examples:
--   "Acme Agency"      → "acme-agency"
--   "Café Paris"       → "cafe-paris"
--   "Smith & Co."      → "smith-co"
--   "   --weird--- "   → "weird"
--   ""                 → ""
-- Marked IMMUTABLE so the planner knows the output depends only on input
-- (allows it to be used in expression indexes / generated columns later).
create or replace function public.slugify(input text)
returns text language sql immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      lower(extensions.unaccent(coalesce(input, ''))),
      '[^a-z0-9]+', '-', 'g'
    ),
    '^-+|-+$', '', 'g'
  );
$$;


-- ─── unique_workspace_slug ─────────────────────────────────────────────────
-- Collision-suffix the base slug. Returns `base` if no other workspace row
-- has it, else `base-2`, `base-3`, etc. exclude_id lets the caller skip the
-- row being mutated (avoids self-collision during UPDATE or trigger insert).
-- Comparison is case-insensitive to match the workspaces_slug_lower_idx
-- uniqueness rule.
create or replace function public.unique_workspace_slug(base text, exclude_id uuid)
returns text language plpgsql
set search_path = ''
as $$
declare
  candidate text := base;
  suffix int := 2;
begin
  while exists (
    select 1 from public.workspaces
    where lower(slug) = lower(candidate)
      and (exclude_id is null or id != exclude_id)
  ) loop
    candidate := base || '-' || suffix;
    suffix := suffix + 1;
  end loop;
  return candidate;
end;
$$;


-- ─── workspaces.slug column ─────────────────────────────────────────────────
-- Add as nullable first so backfill can populate every row before NOT NULL
-- is enforced.
alter table public.workspaces add column slug text;


-- ─── Backfill existing rows ────────────────────────────────────────────────
-- Deterministic ordering by (created_at, id) so older workspaces win the
-- unhyphenated slug if names collide. Same slugify + unique_workspace_slug
-- helpers the trigger uses, so the backfill matches the post-trigger state
-- exactly. If a workspace name slugifies to empty (all special chars or
-- whitespace), fall back to "workspace-{first-8-of-uuid}" so we never
-- produce empty slugs.
do $$
declare
  row_record record;
  base_slug text;
begin
  for row_record in
    select id, name from public.workspaces
    where slug is null
    order by created_at, id
  loop
    base_slug := public.slugify(row_record.name);
    if base_slug is null or base_slug = '' then
      base_slug := 'workspace-' || substr(row_record.id::text, 1, 8);
    end if;
    update public.workspaces
      set slug = public.unique_workspace_slug(base_slug, row_record.id)
      where id = row_record.id;
  end loop;
end $$;


-- ─── slug constraints ──────────────────────────────────────────────────────
-- NOT NULL (now safe — every row has a value).
alter table public.workspaces alter column slug set not null;

-- CHECK: lowercase, alphanumeric, hyphen-separated, no leading/trailing
-- hyphens, no consecutive hyphens, length >= 1. Matches what slugify
-- produces. Direct DB writes that try to bypass the trigger get rejected
-- here — defensive against future maintenance bugs.
alter table public.workspaces
  add constraint workspaces_slug_format
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- Unique case-insensitively. Functional index on lower(slug). Even though
-- the CHECK already enforces lowercase, the lower() form is belt-and-
-- suspenders against future direct-DB writes that might bypass the trigger.
create unique index workspaces_slug_lower_idx
  on public.workspaces (lower(slug));


-- ─── auto-slug trigger ─────────────────────────────────────────────────────
-- Generates a slug from the workspace name on INSERT if the app didn't
-- provide one. Does NOT override an explicitly-provided slug — those go
-- through the CHECK + unique index and fail loudly on invalid format or
-- collision. Don't silently transform user input.
create or replace function public.workspaces_auto_slug()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  base_slug text;
begin
  if new.slug is null or new.slug = '' then
    base_slug := public.slugify(new.name);
    if base_slug is null or base_slug = '' then
      base_slug := 'workspace-' || substr(new.id::text, 1, 8);
    end if;
    new.slug := public.unique_workspace_slug(base_slug, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_auto_slug_trigger on public.workspaces;
create trigger workspaces_auto_slug_trigger
before insert on public.workspaces
for each row execute function public.workspaces_auto_slug();


-- ─── profiles.last_active_workspace_id ─────────────────────────────────────
-- Nullable, no default. App writes this when the user lands in a workspace
-- (post-login auto-route, chooser commit, in-app switcher click). The
-- post-login router reads it to skip the chooser when the value points at
-- a workspace the user still has access to. Validated at read time, not at
-- the DB level — see migration header for the design rationale.
--
-- ON DELETE SET NULL: if a workspace is deleted, all profiles pointing at
-- it lose the hint cleanly (next sign-in falls back to the chooser).
alter table public.profiles
  add column last_active_workspace_id uuid
  references public.workspaces(id) on delete set null;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- Confirm the column structure:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('workspaces', 'profiles')
--   order by table_name, ordinal_position;
--
-- Confirm slugify works as expected:
--   select
--     public.slugify('Acme Agency')     as expect_acme_agency,
--     public.slugify('Café Paris')      as expect_cafe_paris,
--     public.slugify('Smith & Co.')     as expect_smith_co,
--     public.slugify('   --weird--- ')  as expect_weird,
--     public.slugify('')                as expect_empty;
--
-- Confirm the trigger auto-generates slugs (only run if you want to
-- inspect — the workspaces table may be empty until step 5 builds the
-- create-workspace flow):
--   begin;
--   insert into public.workspaces (name) values ('Test Workspace');
--   select id, name, slug from public.workspaces order by created_at desc limit 1;
--   rollback;
-- ============================================================================
