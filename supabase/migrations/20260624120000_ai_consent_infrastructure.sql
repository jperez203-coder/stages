-- ============================================================================
-- Slice 0.1: AI consent infrastructure (agent platform)
-- ============================================================================
-- Adds the consent gates that every future AI feature must respect.
-- Documented in docs/DATA-COLLECTION.md § 4.
--
-- ── META-COMMITMENT (locked in DATA-COLLECTION.md § 4) ──────────────────
--
-- "Stages AI acts on your behalf within tools you connect. Every action
--  requires your permission. We never train on your data."
--
-- ── 4-LEVEL CONSENT FRAMEWORK ──────────────────────────────────────────
--
-- Level 1 — Workspace AI Enablement (THIS MIGRATION)
--   workspaces.ai_consent.agent_enabled — owner-only toggle, default false.
--   When false: NO AI agent features may be invoked in this workspace.
--   When true: AI agent features become available, gated downstream by
--   Levels 2-3 (per-integration + per-action consent).
--
-- Level 2 — Per-Integration Consent (DEFERRED, Slice 0.2)
--   When a user connects an external service (Google Docs, Slack, Instantly,
--   etc.) they grant Stages AI permission to read/write that service on
--   their behalf.
--
-- Level 3 — Per-Action Consent (DEFERRED, Slice 0.3)
--   LOW-RISK: pre-authorized after Level 2.
--   HIGH-RISK: require confirmation.
--   HIGH-VALUE / IRREVERSIBLE: require explicit re-auth.
--
-- Level 4 — Improvement Signals (THIS MIGRATION)
--   profiles.ai_consent.improvement_signals — user-level toggle, default false.
--   When true: anonymized usage signals (which features get used, which
--   suggestions get accepted) may be used to improve AI features for
--   everyone. Future-proofs cross-customer learning without committing
--   to any specific implementation.
--
-- ── WHY JSONB ──────────────────────────────────────────────────────────
--
-- Single JSONB column per table instead of a fan-out of boolean columns.
-- Future consent fields (e.g. integration-specific scopes added in Slice 0.2)
-- get added via JSONB key insertion — no schema migration churn. JSONB merge
-- (`||`) in the server-action UPDATE preserves any future keys.
--
-- Defaults are LOCKED:
--   workspaces.ai_consent = {"agent_enabled": false}
--   profiles.ai_consent   = {"improvement_signals": false}
-- These match privacy-by-default. Existing rows inherit the default on
-- backfill via the `not null default ...` column definition.
--
-- ── RLS BEHAVIOR (inherited, no new policies) ──────────────────────────
--
-- workspaces.ai_consent:
--   SELECT — workspace members (existing policy `workspaces_select`).
--   UPDATE — workspace owners only (existing policy `workspaces_update`).
--   Members can SEE the agent_enabled state in the settings UI without
--   being able to flip it. Owner-only UPDATE because workspace-level
--   enablement is an organizational decision, not an individual member's.
--
-- profiles.ai_consent:
--   SELECT — own profile + profiles of shared-workspace/pipeline users
--   (existing policy `profiles_select`). Matches the visibility regime of
--   display_name and company_name — strategy-confirmed not a privacy
--   regression.
--   UPDATE — own profile only (existing policy `profiles_update`).
--
-- ── AUDIT TABLE ────────────────────────────────────────────────────────
--
-- `activity_events` is pipeline-scoped (pipeline_id NOT NULL, no payload
-- column — see docs/DATA-COLLECTION.md § 1.10). Cannot host workspace-
-- or user-level consent events. Slice 0.1 introduces a sibling audit
-- table modeled on `seat_sync_log` (RLS-enabled, zero policies, service-
-- role only). Slice 0.4 will add a SELECT policy when the audit-UI
-- ships.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop table if exists public.ai_consent_audit;
-- │   alter table public.profiles drop column if exists ai_consent;
-- │   alter table public.workspaces drop column if exists ai_consent;
-- │
-- │   -- Data on the dropped columns is unrecoverable post-down. Until
-- │   -- the first AI feature ships, every value is the locked default,
-- │   -- so a revert is lossless in practice.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. ai_consent columns ─────────────────────────────────────────────────

alter table public.workspaces
  add column ai_consent jsonb not null default '{"agent_enabled": false}'::jsonb;

alter table public.profiles
  add column ai_consent jsonb not null default '{"improvement_signals": false}'::jsonb;


-- ─── 2. ai_consent_audit table ────────────────────────────────────────────

create table public.ai_consent_audit (
  id            uuid primary key default gen_random_uuid(),
  scope_type    text not null check (scope_type in ('workspace', 'user')),
  scope_id      uuid not null,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text not null,
  changed_field text not null,
  old_value     jsonb,
  new_value     jsonb not null,
  changed_at    timestamptz not null default now()
);

comment on table public.ai_consent_audit is
  'Append-only audit of every AI consent toggle change. Service-role only '
  'in Slice 0.1. Slice 0.4 will add a SELECT policy for workspace owners '
  'when the audit-UI ships. See docs/DATA-COLLECTION.md § 4.';

create index ai_consent_audit_scope_idx
  on public.ai_consent_audit (scope_type, scope_id, changed_at desc);

alter table public.ai_consent_audit enable row level security;

-- No policies. Matches the seat_sync_log + stripe_events + pending_emails
-- pattern: RLS enabled, zero policies → authenticated + anon get zero rows,
-- service-role bypasses. The server action that writes consent changes uses
-- the service-role admin client.


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
-- (a) Both consent columns exist with the locked defaults
--   select table_name, column_name, data_type, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and column_name = 'ai_consent'
--   order by table_name;
--   -- Expected: 2 rows, both jsonb, defaults '{"agent_enabled": false}' and
--   -- '{"improvement_signals": false}' respectively.
--
-- (b) Every existing workspace row got the default
--   select count(*) as total,
--          count(*) filter (where ai_consent = '{"agent_enabled": false}'::jsonb) as defaulted
--   from public.workspaces;
--   -- Expected: total = defaulted.
--
-- (c) Every existing profile row got the default
--   select count(*) as total,
--          count(*) filter (where ai_consent = '{"improvement_signals": false}'::jsonb) as defaulted
--   from public.profiles;
--   -- Expected: total = defaulted.
--
-- (d) Audit table exists, RLS enabled, zero policies (service-role only)
--   select c.relname as table_name,
--          c.relrowsecurity as rls_enabled,
--          (select count(*) from pg_policies p
--             where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relname = 'ai_consent_audit';
--   -- Expected: 1 row. rls_enabled=true. policy_count=0.
--
-- (e) Existing policies cover the new columns by inheritance
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('workspaces', 'profiles')
--   order by tablename, policyname;
--   -- Expected: existing SELECT/UPDATE policies present for both tables.
--   -- New ai_consent column inherits behavior (no new policies needed).
-- ============================================================================
