-- ============================================================================
-- Phase 4c slice 2: seed built-in starter templates (CTE rewrite)
-- ============================================================================
-- Slice 1 (20260606120000) landed the schema + RLS. This slice populates
-- public.templates with two Stages-shipped starter templates so the
-- picker (slice 4) has built-ins to show on day one for every workspace.
--
-- ── ABOUT THIS REWRITE (2026-05-26) ─────────────────────────────────
--
-- The original draft of this migration used DO blocks with IF-EXISTS
-- guards. When applied via the Supabase Dashboard SQL editor, the DO
-- blocks reported "success, no rows returned" but inserted nothing —
-- root cause never fully diagnosed (likely a SQL-editor quirk around
-- transaction handling inside anonymous code blocks; plain INSERTs in
-- the same editor session worked fine).
--
-- Rewritten to use plain INSERT statements + CTEs (no DO blocks). The
-- founder seeded the live DB with this exact pattern by hand on
-- 2026-05-26 after the DO-block failure; this file matches that
-- seeding verbatim so:
--   * a fresh-DB rebuild via `supabase db reset` or CI reproduces it,
--   * the repo matches what's actually live in the founder's project.
--
-- Built-ins are rows with workspace_id IS NULL. The templates_insert
-- policy requires workspace_id IS NOT NULL, so app callers can't create
-- built-ins. This seed runs as the migration role (postgres, BYPASSRLS),
-- so the NULL-workspace inserts succeed here.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────
--
-- Each built-in's template INSERT has a `WHERE NOT EXISTS` guard
-- scoped to `workspace_id IS NULL AND name = '<built-in name>'`. If
-- the template already exists, the INSERT inserts zero rows, the
-- RETURNING clause produces zero rows, and the downstream CTEs (stage
-- inserts joined to the template, task inserts joined to the stages)
-- also insert zero rows. The whole chain becomes a no-op.
--
-- This works WITHOUT a DO block because we're using INSERT … SELECT
-- (with the WHERE NOT EXISTS in the SELECT), not INSERT … VALUES
-- (which can't be filtered conditionally).
--
-- Re-applying this migration on an already-seeded DB: zero rows
-- changed, no errors, safe.
--
-- ── LOCKED CONSTRAINT (still enforced by absence) ───────────────────
--
-- template_stages has NO color column. No row inserted here references
-- a stage color. Instantiated pipelines start all-grey via the
-- state-color computation in src/lib/current-stage.ts (LOCKED file,
-- never modify). "Blank Workspace" is the from-scratch replacement —
-- one grey stage on instantiate.
--
-- ── BUILT-INS SEEDED ────────────────────────────────────────────────
--
--   1. Blank Workspace        — 1 stage,  0 tasks
--   2. GHL Client Onboarding  — 6 stages, 38 tasks, 13 client_visible
--
-- Per-stage task counts on the GHL template:
--   Stage 0 (Kickoff & Intake)        7 tasks, 5 client_visible
--   Stage 1 (Account Build)           7 tasks, 0 client_visible
--   Stage 2 (Compliance & Telephony)  6 tasks, 0 client_visible
--   Stage 3 (Creative & Campaign Prep) 6 tasks, 1 client_visible
--   Stage 4 (Review & Approval)       6 tasks, 4 client_visible
--   Stage 5 (Launch & Handoff)        6 tasks, 3 client_visible
--                                    ───────────────────────────
--                                    38 tasks, 13 client_visible
--
-- Stage descriptions are NULL (names are self-describing for v1).
-- Task descriptions are NULL (only titles + visibility provided).
-- created_by NULL (no human creator — system-shipped).
-- source_pipeline_id NULL (no source — system-shipped).
--
-- ┌─ DOWN PLAN
-- │
-- │   delete from public.templates
-- │   where workspace_id is null
-- │     and name in ('Blank Workspace', 'GHL Client Onboarding');
-- │
-- │   -- template_stages + template_tasks CASCADE via the parent FK.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── BUILT-IN 1: Blank Workspace ──────────────────────────────────────────
-- One CTE: insert template (guarded), insert its single stage joined to
-- the new template via the RETURNING id. If the template already exists,
-- the WHERE NOT EXISTS clause makes the CTE produce zero rows, and the
-- stages INSERT (which SELECTs FROM the CTE) inserts zero rows too.

with new_template as (
  insert into public.templates (workspace_id, name, description, emoji)
  select
    null,
    'Blank Workspace',
    'Start with one stage and build it your way.',
    '✨'
  where not exists (
    select 1 from public.templates
    where workspace_id is null and name = 'Blank Workspace'
  )
  returning id
)
insert into public.template_stages (template_id, position, name)
select id, 0, 'Stage 1'
from new_template;


-- ─── BUILT-IN 2: GHL Client Onboarding ────────────────────────────────────
-- Three-stage CTE chain:
--   new_template — inserts the template row (guarded), returns id
--   new_stages   — inserts 6 stage rows via CROSS JOIN with a (position,
--                  name) VALUES list, returns id + name so tasks can
--                  join to the right stage by name
--   <final>      — inserts 38 task rows, joining a (stage_name, position,
--                  title, client_visible) VALUES list against new_stages
--                  on stage_name
--
-- If new_template's WHERE NOT EXISTS skips the insert, new_stages and the
-- final task insert also produce zero rows (each CTE selects FROM the
-- prior CTE, which is empty). Whole chain is no-op on re-apply.

with new_template as (
  insert into public.templates (workspace_id, name, description, emoji)
  select
    null,
    'GHL Client Onboarding',
    'Full post-sale delivery: kickoff through launch & handoff.',
    '🚀'
  where not exists (
    select 1 from public.templates
    where workspace_id is null and name = 'GHL Client Onboarding'
  )
  returning id
),
new_stages as (
  insert into public.template_stages (template_id, position, name)
  select t.id, sv.position, sv.name
  from new_template t
  cross join (values
    (0, 'Kickoff & Intake'),
    (1, 'Account Build'),
    (2, 'Compliance & Telephony'),
    (3, 'Creative & Campaign Prep'),
    (4, 'Review & Approval'),
    (5, 'Launch & Handoff')
  ) as sv(position, name)
  returning id, name
)
insert into public.template_tasks (template_stage_id, position, title, client_visible)
select s.id, tv.position, tv.title, tv.client_visible
from new_stages s
join (values
  -- Stage 0: Kickoff & Intake (7 tasks, 5 client_visible)
  ('Kickoff & Intake',          0, 'Schedule onboarding call',                                                 false),
  ('Kickoff & Intake',          1, 'Send welcome message + set expectations',                                  true ),
  ('Kickoff & Intake',          2, 'Send intake form: business details, EIN, working hours, contacts',         true ),
  ('Kickoff & Intake',          3, 'Client uploads logo, brand assets & images',                                true ),
  ('Kickoff & Intake',          4, 'Client provides ad inspiration / examples',                                 true ),
  ('Kickoff & Intake',          5, 'Confirm A2P / EIN info received',                                           false),
  ('Kickoff & Intake',          6, 'Send calendar invite + agenda for onboarding call',                        true ),

  -- Stage 1: Account Build (7 tasks, 0 client_visible)
  ('Account Build',             0, 'Create GHL sub-account',                                                    false),
  ('Account Build',             1, 'Load core automations & workflows',                                         false),
  ('Account Build',             2, 'Configure triggers, custom values & fields',                                false),
  ('Account Build',             3, 'Build pipelines / opportunity stages',                                      false),
  ('Account Build',             4, 'Connect domain, email & calendar integrations',                             false),
  ('Account Build',             5, 'Set up calendars & booking flows',                                          false),
  ('Account Build',             6, 'Import / configure contact lists',                                          false),

  -- Stage 2: Compliance & Telephony (6 tasks, 0 client_visible)
  ('Compliance & Telephony',    0, 'Submit A2P 10DLC brand registration',                                       false),
  ('Compliance & Telephony',    1, 'Submit campaign registration',                                              false),
  ('Compliance & Telephony',    2, 'Provision phone number(s)',                                                 false),
  ('Compliance & Telephony',    3, 'Configure SMS & call settings',                                             false),
  ('Compliance & Telephony',    4, 'Verify deliverability / test messaging',                                    false),
  ('Compliance & Telephony',    5, 'Document compliance status for client record',                              false),

  -- Stage 3: Creative & Campaign Prep (6 tasks, 1 client_visible)
  ('Creative & Campaign Prep',  0, 'Write ad copy, headlines & primary text',                                   false),
  ('Creative & Campaign Prep',  1, 'Design ad creatives / source visuals',                                      false),
  ('Creative & Campaign Prep',  2, 'Build landing page(s)',                                                     false),
  ('Creative & Campaign Prep',  3, 'Set up tracking, pixels & conversion events',                               false),
  ('Creative & Campaign Prep',  4, 'Configure campaign structure & targeting',                                  false),
  ('Creative & Campaign Prep',  5, 'Stage campaigns for client review',                                         true ),

  -- Stage 4: Review & Approval (6 tasks, 4 client_visible)
  ('Review & Approval',         0, 'Run onboarding call: walk client through full setup',                       true ),
  ('Review & Approval',         1, 'Client reviews ad copy & creatives',                                        true ),
  ('Review & Approval',         2, 'Client approves campaigns',                                                 true ),
  ('Review & Approval',         3, 'Client confirms billing / ad spend setup',                                  true ),
  ('Review & Approval',         4, 'Capture any final change requests',                                         false),
  ('Review & Approval',         5, 'Make approved revisions',                                                   false),

  -- Stage 5: Launch & Handoff (6 tasks, 3 client_visible)
  -- "you''re" — single quote doubled per SQL string-literal escape rules.
  -- Embedded double quotes don't need escaping inside a single-quoted literal.
  ('Launch & Handoff',          0, 'Push campaigns live',                                                       false),
  ('Launch & Handoff',          1, 'Confirm tracking & lead flow is working',                                   false),
  ('Launch & Handoff',          2, 'Send "you''re live" confirmation + what to expect',                         true ),
  ('Launch & Handoff',          3, 'Set up reporting cadence / dashboard access',                               true ),
  ('Launch & Handoff',          4, 'Schedule first check-in / optimization call',                               true ),
  ('Launch & Handoff',          5, 'Keep client to ongoing management pipeline',                                false)
) as tv(stage_name, position, title, client_visible)
  on tv.stage_name = s.name;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Two built-ins present with correct names + emoji.
--   select id, name, emoji, description, workspace_id, created_by
--   from public.templates
--   where workspace_id is null
--   order by name;
--   -- Expected: 2 rows. workspace_id NULL on both. created_by NULL.
--
-- (b) Blank Workspace: 1 stage, 0 tasks.
--   select ts.name, ts.position,
--          (select count(*) from public.template_tasks tt
--           where tt.template_stage_id = ts.id) as task_count
--   from public.template_stages ts
--   join public.templates t on t.id = ts.template_id
--   where t.workspace_id is null and t.name = 'Blank Workspace'
--   order by ts.position;
--   -- Expected: 1 row — name="Stage 1", position=0, task_count=0.
--
-- (c) GHL stages + per-stage task counts.
--   select ts.position, ts.name,
--          (select count(*) from public.template_tasks tt
--           where tt.template_stage_id = ts.id) as task_count,
--          (select count(*) from public.template_tasks tt
--           where tt.template_stage_id = ts.id
--             and tt.client_visible = true) as visible_count
--   from public.template_stages ts
--   join public.templates t on t.id = ts.template_id
--   where t.workspace_id is null and t.name = 'GHL Client Onboarding'
--   order by ts.position;
--   -- Expected per stage (total/visible):
--   --   0  Kickoff & Intake          7 / 5
--   --   1  Account Build             7 / 0
--   --   2  Compliance & Telephony    6 / 0
--   --   3  Creative & Campaign Prep  6 / 1
--   --   4  Review & Approval         6 / 4
--   --   5  Launch & Handoff          6 / 3
--   --                         total 38 / 13
--
-- (d) Total counts.
--   select
--     (select count(*) from public.templates       where workspace_id is null) as templates,
--     (select count(*) from public.template_stages ts
--      join public.templates t on t.id = ts.template_id
--      where t.workspace_id is null) as stages,
--     (select count(*) from public.template_tasks tt
--      join public.template_stages ts on ts.id = tt.template_stage_id
--      join public.templates t on t.id = ts.template_id
--      where t.workspace_id is null) as tasks;
--   -- Expected: templates=2, stages=7, tasks=38.
--
-- (e) Idempotency: re-applying this migration on the same DB inserts
--     zero rows. Each CTE chain's WHERE NOT EXISTS guard skips the
--     template insert; the chained stage + task inserts SELECT FROM the
--     empty CTE and also insert zero rows. Verify by re-running the
--     migration and confirming row counts are unchanged.
-- ============================================================================
