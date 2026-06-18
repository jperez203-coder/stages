-- ============================================================================
-- 2026-06-18: codify the GHL Client Onboarding v2 template swap
-- ============================================================================
-- 20260607120000 seeded the original v1 GHL onboarding template (6 stages,
-- 38 tasks, 13 client-visible). On 2026-06-17 Jordan rewrote that template
-- against a live pipeline he'd authored under williamwayne856+me (Option A
-- from the template-swap audit: surgical overwrite of the existing built-in
-- row, same template_id preserved). The manual swap landed in the live DB
-- as v2 content:
--   * 6 stages (same set of stage names; client_visible flags shifted)
--   * 34 tasks (was 38)
--   * 7 client-visible tasks (was 13)
-- This migration codifies that swap so any fresh DB rebuild (`supabase db
-- reset`, CI, new environments) reproduces the v2 content the live DB has.
--
-- IDEMPOTENCY
-- ───────────
-- delete-then-insert with identical content. Re-running on a v2-state DB
-- yields no observable change — stages + tasks get NEW internal ids but
-- identical content (positions, names, titles, descriptions,
-- client_visible flags). The instantiation RPC
-- (create_pipeline_with_channels) reads template_stages + template_tasks
-- by template + position + name; no external surface references the row
-- ids directly, so regenerated ids are inert.
--
-- ON A FRESH DB
-- ─────────────
-- Depends on 20260607120000 having created the GHL Client Onboarding
-- template row. Timestamp order is correct: 20260618130000 > 20260607120000,
-- so the seed runs first, this overwrite runs second. End state on a
-- fresh DB: v2 content. End state on the current live DB (already v2):
-- v2 content. Either way, same place.
--
-- TASK POSITION GAPS ARE CANONICAL
-- ────────────────────────────────
-- Some stages have non-contiguous task positions in v2:
--   * Kickoff & Intake:        1, 2, 3, 4, 5, 7    (skips 6)
--   * Compliance & Telephony:  1, 3, 4, 5, 6       (skips 2)
--   * Launch & Handoff:        2, 3, 5             (skips 1 and 4)
-- These are preserved verbatim from the live DB. The instantiation RPC
-- copies positions as-is and orders by `position`; gaps don't break
-- sort order or any consumer.
--
-- DOLLAR-QUOTING
-- ──────────────
-- Task titles + descriptions contain apostrophes, em-dashes, embedded
-- newlines, double quotes, and one emoji ('You''re live! 🥳'). All
-- non-NULL text values use $body$...$body$ delimiters instead of
-- single-quote escaping — doubling 30+ apostrophes across the VALUES
-- list is a recipe for one-character bugs. Stage names contain none of
-- those characters; single-quoted strings are fine.
--
-- NULL DESCRIPTIONS STAY NULL
-- ───────────────────────────
-- Stage descriptions are uniformly NULL (verified Jordan's 2026-06-18
-- extraction). Task descriptions are mixed (NULL on rows where the
-- title is self-explanatory; populated where the task needs guidance).
-- The first stage NULL gets a null::text cast so VALUES' implicit-type
-- inference doesn't choke; subsequent NULLs are typed by inference.
-- The first task row's description IS non-null, so task NULLs need no
-- cast.
--
-- ┌─ DOWN PLAN
-- │
-- │   Re-apply the original v1 content by running the
-- │   20260607120000_seed_builtin_starter_templates.sql migration's GHL
-- │   block against a deleted-stages template. The DOWN of THIS
-- │   migration isn't a single SQL statement — restore-from-snapshot is
-- │   the practical reversal path if a v1 rollback ever matters.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


with
  target_template as (
    select id
    from public.templates
    where workspace_id is null
      and name = 'GHL Client Onboarding'
  ),
  -- Wipe the existing stage rows for this template. CASCADE on
  -- template_tasks.template_stage_id (FK ON DELETE CASCADE) removes the
  -- child tasks for free. This CTE's side effect runs unconditionally
  -- (data-modifying CTEs always execute, per Postgres CTE rules) even
  -- though its RETURNING clause is not consumed downstream.
  deleted_stages as (
    delete from public.template_stages
    where template_id in (select id from target_template)
    returning id
  ),
  -- Insert the new stages. CROSS JOIN with target_template grafts the
  -- template_id onto every value-row. RETURNING id + name so the task
  -- INSERT below can join on stage name and assign tasks to the right
  -- new stage_id.
  new_stages as (
    insert into public.template_stages
      (template_id, position, name, description, client_visible)
    select tt.id, sv.position, sv.name, sv.description, sv.client_visible
    from target_template tt
    cross join (values
      (0, 'Kickoff & Intake',         null::text, true),
      (1, 'Account Build',            null,       true),
      (2, 'Compliance & Telephony',   null,       true),
      (3, 'Creative & Campaign Prep', null,       false),
      (4, 'Review & Approval',        null,       true),
      (5, 'Launch & Handoff',         null,       true)
    ) as sv(position, name, description, client_visible)
    returning id, name
  )
insert into public.template_tasks
  (template_stage_id, position, title, description, client_visible)
select s.id, tv.position, tv.title, tv.description, tv.client_visible
from new_stages s
join (values

  -- ─── Kickoff & Intake (6 tasks, positions 1,2,3,4,5,7 — gap at 6) ────
  ('Kickoff & Intake', 1,
   $body$Invite client to this portal$body$,
   $body$Click on the "People" side tab and insert clients email. They get an invite and only see the task you have toggle as "Visible to client"
All client seats are free forever.$body$,
   false),
  ('Kickoff & Intake', 2,
   $body$Schedule onboarding call$body$,
   $body$Book the kickoff 7+ days out — A2P takes 5-7 days, so this buffer means you show up ready, not scrambling. In GHL form have the final step be the schedule calendar (This creates less friction for your client)$body$,
   false),
  ('Kickoff & Intake', 3,
   $body$Welcome!$body$,
   $body$Welcome aboard! Over the next 1-2 weeks we'll build and launch your system. This week we collect your details, asset and finally review it all with you before going live. We'll keep you posted at every step. Additionally this is your client portal any questions you have leave it in the chat.$body$,
   true),
  ('Kickoff & Intake', 4,
   $body$Complete Intake form$body$,
   $body$Please complete your intake form. Click the link below under "Attachments" to get started.$body$,
   true),
  ('Kickoff & Intake', 5,
   $body$Upload brand assets & images$body$,
   $body$Below under "Attachments" Upload your logo, brand colors, and any photos you'd like used (team, work, products).$body$,
   true),
  ('Kickoff & Intake', 7,
   $body$Confirm Intake form A2P / EIN info received$body$,
   $body$Verify EIN and business details are complete and valid before submitting any A2P errors here cause rejections and delays. Below is a cheat sheet video that helped me get approved for all registration.$body$,
   false),

  -- ─── Account Build (9 tasks, positions 1-9 contiguous) ───────────────
  ('Account Build', 1,
   $body$Create/ Load GHL sub-account$body$,
   $body$Create a new sub-account for the client using all the info gathered from the intake form.

Apply a pre-built snapshot to the sub-account to quickly set up funnels, automations, calendars, and more.$body$,
   false),
  ('Account Build', 2,
   $body$Add client & staff member access$body$,
   $body$Once the sub-account is created, add the client and any relevant staff members so they can access the system.

Assign proper permissions based on their role.
Admin: Full access
User: Restricted access based on responsibilities$body$,
   false),
  ('Account Build', 3,
   $body$Google & Social Integrations$body$,
   $body$Connect all essential integrations so the CRM can properly track leads, manage conversations, and run automations.$body$,
   true),
  ('Account Build', 4,
   $body$Configure triggers, custom values & fields$body$,
   NULL,
   false),
  ('Account Build', 5,
   $body$Connect domain, email & calendar integrations$body$,
   NULL,
   false),
  ('Account Build', 6,
   $body$Authenticate sending domain (SPF / DKIM / DMARC)$body$,
   NULL,
   false),
  ('Account Build', 7,
   $body$Set up calendars & booking flows$body$,
   NULL,
   false),
  ('Account Build', 8,
   $body$Website Integration$body$,
   $body$Embed GoHighLevel tools into the client's website to capture leads and automate follow-ups.

Tools to Integrate:
- Forms & Surveys
- Calendar Widget
- Chat Widget
- Tracking Scripts (Analytics, Hotjar, etc.) - not part of GHL integrations$body$,
   false),
  ('Account Build', 9,
   $body$Send updates$body$,
   $body$Send update of the status, this could be an image or video of:
- Funnels being setup
- Sub account snapshot ready
- Creative/ ads
- A2P Registration$body$,
   false),

  -- ─── Compliance & Telephony (5 tasks, positions 1,3,4,5,6 — gap at 2)
  ('Compliance & Telephony', 1,
   $body$Submit A2P 10DLC brand registration$body$,
   $body$Below is the same step by step video from "kickoff & intake" stage.$body$,
   false),
  ('Compliance & Telephony', 3,
   $body$Progress update — Build underway$body$,
   $body$This is the half way mark.$body$,
   true),
  ('Compliance & Telephony', 4,
   $body$Provision phone number(s)$body$,
   $body$Set up a dedicated phone number for calling and texting.

- Go to Settings > Phone Numbers in the sub-account
- Click "+ Add Number"
- Choose a local area code (preferably matching the business location)
- Purchase and assign the number to the main user (business owner or receptionist)$body$,
   false),
  ('Compliance & Telephony', 5,
   $body$Configure SMS & Call settings$body$,
   NULL,
   false),
  ('Compliance & Telephony', 6,
   $body$Verify deliverability / test messaging$body$,
   NULL,
   false),

  -- ─── Creative & Campaign Prep (6 tasks, positions 1-6 contiguous) ────
  ('Creative & Campaign Prep', 1,
   $body$Meta account invite$body$,
   $body$Have the client send you an invite to their meta ads account.
Client MUST give you full permission in order to grab essential details.

- If possible have this done on your initial call with client.$body$,
   false),
  ('Creative & Campaign Prep', 2,
   $body$Write ad copy, headlines & primary text$body$,
   NULL,
   false),
  ('Creative & Campaign Prep', 3,
   $body$Design ad creatives / source visuals$body$,
   $body$From the images/ Videos your client has provided.$body$,
   false),
  ('Creative & Campaign Prep', 4,
   $body$Build landing pages$body$,
   $body$To save time, create a base landing page in your original snapshot (the one you load up) where you can re-use it for each new client. This way you just upload the images/ videos to landing page.$body$,
   false),
  ('Creative & Campaign Prep', 5,
   $body$Set up tracking, pixels & conversion events$body$,
   NULL,
   false),
  ('Creative & Campaign Prep', 6,
   $body$Configure campaign structure & targeting$body$,
   NULL,
   false),

  -- ─── Review & Approval (5 tasks, positions 1-5 contiguous) ───────────
  ('Review & Approval', 1,
   $body$Review Campaigns$body$,
   $body$Verify landing page copywriting, visuals are all in tack and ready to publish. If everything is in tack please mark this task as done.$body$,
   false),
  ('Review & Approval', 2,
   $body$QA pass: test forms, workflows, booking, automations & tracking$body$,
   $body$Submit a test form, fire each workflow, send a test SMS + email, book a test appointment, confirm the snapshot's automations actually work in this account.

Snapshots break on import constantly, and catching it before the client does is the difference between a flawless first impression and a "hey this form isn't working" message.$body$,
   false),
  ('Review & Approval', 3,
   $body$Kickoff call$body$,
   $body$If you haven't schedule your call yet, feel free to do so with the link below under "Attachments"

In here we'll walk you through:
- Dashboard overview
- Conversations tab
- Calendar bookings
- Pipeline and Opportunities
- How to respond to leads
- Mobile app usage
- Reporting basics$body$,
   true),
  ('Review & Approval', 4,
   $body$Client confirms billing / ad spend setup$body$,
   NULL,
   false),
  ('Review & Approval', 5,
   $body$Share training resources / how-to videos$body$,
   $body$If you have any videos share with client. Upload them under the "Files" tab, so you client has everything in one place.$body$,
   false),

  -- ─── Launch & Handoff (3 tasks, positions 2,3,5 — gaps at 1 and 4) ───
  ('Launch & Handoff', 2,
   $body$Set up reporting cadence / dashboard access$body$,
   NULL,
   false),
  ('Launch & Handoff', 3,
   $body$Push campaigns live$body$,
   $body$Congrats!! this is the last step of the entire setup. Each time you go trough this onboarding flow, things get easier and easier.$body$,
   false),
  ('Launch & Handoff', 5,
   $body$You're live! 🥳$body$,
   $body$Now the fun begins: Closing deals!

This is your client portal, any file or question you might have going forward can be done right trough here.$body$,
   true)

) as tv(stage_name, position, title, description, client_visible)
  on tv.stage_name = s.name;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Sanity-check totals — should match Jordan's 2026-06-18 extraction.
--   select
--     (select count(*) from public.template_stages ts
--      join public.templates t on t.id = ts.template_id
--      where t.workspace_id is null
--        and t.name = 'GHL Client Onboarding')                    as stages,
--     (select count(*) from public.template_tasks tt
--      join public.template_stages ts on ts.id = tt.template_stage_id
--      join public.templates t        on t.id = ts.template_id
--      where t.workspace_id is null
--        and t.name = 'GHL Client Onboarding')                    as tasks,
--     (select count(*) from public.template_tasks tt
--      join public.template_stages ts on ts.id = tt.template_stage_id
--      join public.templates t        on t.id = ts.template_id
--      where t.workspace_id is null
--        and t.name = 'GHL Client Onboarding'
--        and tt.client_visible = true)                            as client_visible_tasks;
--   -- Expected: stages=6, tasks=34, client_visible_tasks=7.
--
-- (b) Per-stage task counts.
--   select ts.position, ts.name, ts.client_visible,
--          (select count(*) from public.template_tasks tt
--           where tt.template_stage_id = ts.id) as task_count,
--          (select count(*) from public.template_tasks tt
--           where tt.template_stage_id = ts.id
--             and tt.client_visible = true) as visible_count
--   from public.template_stages ts
--   join public.templates t on t.id = ts.template_id
--   where t.workspace_id is null
--     and t.name = 'GHL Client Onboarding'
--   order by ts.position;
--   -- Expected per stage (stage_client_visible / total tasks / visible tasks):
--   --   0  Kickoff & Intake          true  / 6 / 3
--   --   1  Account Build             true  / 9 / 1
--   --   2  Compliance & Telephony    true  / 5 / 1
--   --   3  Creative & Campaign Prep  false / 6 / 0
--   --   4  Review & Approval         true  / 5 / 1
--   --   5  Launch & Handoff          true  / 3 / 1
--   --                                total 34 / 7
--
-- (c) Idempotency: re-applying this migration on a v2-state DB regenerates
--     6 new stage rows + 34 new task rows with new internal ids but identical
--     content; the prior v2 rows (and their tasks) are CASCADE-deleted.
--     Visible state is unchanged. Verify by re-running and confirming the
--     count queries above still pass.
-- ============================================================================
