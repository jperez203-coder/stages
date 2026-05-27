-- Migration: pipeline_links.task_id — task-scoped file attachments.
--
-- Purpose
--   Lets a pipeline_links row be optionally attached to a specific
--   task. When task_id IS NULL the row is pipeline-scoped (existing
--   behavior — shown on the Files tab). When task_id IS NOT NULL the
--   row is task-scoped (shown in the task panel attachments section
--   AND still listed on the Files tab with a "from: <task>" badge).
--
--   Storage path convention is UNCHANGED (`{pipelineId}/{uuid}.{ext}`).
--   The task_id column is metadata-only — all existing storage RLS
--   policies continue to gate on pipeline_id via
--   `(storage.foldername(name))[1]`, so no storage policy needs to
--   change.
--
-- Effect on existing RLS
--   None. The current pipeline_links RLS policies all gate on
--   `pipeline_id` (via is_pipeline_agency_member / is_pipeline_client /
--   can_edit_pipeline / can_see_pipeline). They keep returning the same
--   row set regardless of task_id. Task-scoped rows inherit the same
--   visibility rules as the parent pipeline.
--
-- Cascade footprint
--   ON DELETE CASCADE — deleting a task removes its attachment rows
--   automatically. Mirrors the existing cascade from pipelines →
--   pipeline_links → CASCADE (so a deleted pipeline still drops every
--   row, task-scoped or not). Storage bytes for task-scoped attachments
--   become orphans when their task is deleted (same trade-off as the
--   pipeline-delete RPC; Supabase blocks direct storage.objects DELETE,
--   janitor task on the wishlist).
--
-- DOWN PLAN
--   alter table public.pipeline_links drop column if exists task_id;
--   drop index if exists pipeline_links_task_idx;
--   (Storage rows untouched.)
--
-- Already applied via Supabase SQL editor on 2026-05-26. This file
-- exists so a fresh DB rebuild from the migrations folder reproduces
-- the same schema. Idempotent (IF NOT EXISTS) so re-applying via the
-- editor is harmless.

alter table public.pipeline_links
  add column if not exists task_id uuid null
  references public.tasks(id) on delete cascade;

create index if not exists pipeline_links_task_idx
  on public.pipeline_links(task_id);

-- VERIFICATION QUERIES (run in the SQL editor; uncommented for paste):
--
--   -- 1. Column exists with the right type + nullability + FK + cascade
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--     where table_schema = 'public'
--       and table_name = 'pipeline_links'
--       and column_name = 'task_id';
--   -- expect: task_id | uuid | YES
--
--   select rc.delete_rule
--     from information_schema.referential_constraints rc
--     join information_schema.key_column_usage kcu
--       on kcu.constraint_name = rc.constraint_name
--     where kcu.table_schema = 'public'
--       and kcu.table_name = 'pipeline_links'
--       and kcu.column_name = 'task_id';
--   -- expect: CASCADE
--
--   -- 2. Index exists on task_id
--   select indexname from pg_indexes
--     where schemaname = 'public'
--       and tablename = 'pipeline_links'
--       and indexname = 'pipeline_links_task_idx';
--   -- expect: pipeline_links_task_idx
--
--   -- 3. Existing rows untouched
--   select count(*) from pipeline_links where task_id is not null;
--   -- expect: 0 immediately after the migration, then grows as task
--   --         attachments are added through the UI
