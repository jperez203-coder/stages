-- ============================================================================
-- Phase 4a (step 2 prep) — tasks.created_at
-- ============================================================================
-- Adds a created_at timestamp to tasks. Needed by the dashboard's My Tasks
-- card to sort no-deadline tasks (the third tier of the locked sort rule:
-- overdue → deadline asc → no-deadline by created_at desc).
--
-- No updated_at + touch trigger here. The dashboard only needs a single
-- "when was this task born" signal; true edit-history semantics are a v1.1
-- concern (along with audit logs, restore-from-trash, etc.).
--
-- DEFAULT now() so existing rows (effectively zero — legacy app stores
-- tasks in localStorage only, supabase tasks table has no production data
-- yet) get a sensible value without an explicit backfill. NOT NULL enforced
-- because every task should have one going forward; nullable would force
-- defensive null-checks at every read site.
--
-- ┌─ DOWN PLAN
-- │   alter table public.tasks drop column if exists created_at;
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================

alter table public.tasks
  add column if not exists created_at timestamptz not null default now();


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Column exists:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='tasks' and column_name='created_at';
--   Expected: 1 row, timestamptz, NO nullable, default now().
-- ============================================================================
