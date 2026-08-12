-- ============================================================================
-- Admin metrics: page_views
--
-- Backs the founder-only /admin/metrics funnel page. The only funnel step
-- that has zero existing signal anywhere in the schema is "visited the
-- signup page" — everything else (signups, pipelines, invites, plan
-- selection, cancellations) is derived from tables that already exist.
--
-- Deliberately minimal: no session/visitor dedup, no bot filtering, no IP
-- logging (privacy — an aggregate count doesn't need it). One row per page
-- load. Chosen over a third-party analytics tool so visit data never
-- leaves Stages' own infra. Written to and read from exclusively via the
-- service-role client (see src/lib/supabase-admin.ts) — no anon/authenticated
-- access at all, so no INSERT/SELECT policies are defined.
-- ============================================================================

create table public.page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  referrer text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index page_views_path_created_idx
  on public.page_views (path, created_at desc);

alter table public.page_views enable row level security;

-- No policies — service-role only (both the tracking route's INSERT and
-- the admin metrics page's SELECT go through getSupabaseAdmin(), which
-- bypasses RLS entirely). Enabling RLS with zero policies still denies
-- every anon/authenticated request, which is exactly the posture we want:
-- this table is invisible to the app's normal request paths.
