# Phase 3.3 — RLS & Storage Policies (planning doc)

This is the plan for the SQL that lands in `0002_rls_policies.sql`. **No SQL is written yet.** Founder approval required before implementation.

The canonical source of truth for the security rules referenced below is the "Security model" section of [CLAUDE.md](../CLAUDE.md). This document maps those rules to specific Postgres policies, helper functions, storage buckets, and indexes.

---

## 1. Helper functions (built first, every policy uses them)

All declared `language sql security definer stable` so they bypass RLS to read membership tables and the planner can cache results across rows in a query.

| Function | Returns | Purpose |
| --- | --- | --- |
| `is_workspace_member(ws_id uuid)` | bool | Calling user has any `workspace_memberships` row in the workspace. |
| `is_workspace_owner(ws_id uuid)` | bool | Calling user has a `workspace_memberships` row with `role = 'owner'`. |
| `is_pipeline_agency_member(p_id uuid)` | bool | Calling user is owner/admin/member of the pipeline OR owner of its workspace. (Workspace owners inherit access to all pipelines in the workspace.) |
| `is_pipeline_client(p_id uuid)` | bool | Calling user has a `pipeline_memberships` row with `role = 'client'` on the pipeline. |
| `can_see_pipeline(p_id uuid)` | bool | `is_pipeline_agency_member(p_id) OR is_pipeline_client(p_id)`. The general "can read this pipeline at all" check. |
| `can_edit_pipeline(p_id uuid)` | bool | Calling user is owner or admin on the pipeline (or workspace owner). Used for write policies on stages, tasks, notes, files, channels. |
| `can_submit_pipeline(p_id uuid)` | bool | Workspace owner OR pipeline owner OR (pipeline admin AND `can_submit = true`). Used for the submission gate. |
| `can_check_pipeline_task(p_id uuid)` | bool | Workspace owner OR pipeline owner/admin OR (member AND `can_check_tasks = true`). Used for agency-side `tasks.done` updates. (Clients have a separate path — see tasks policy.) |
| `is_channel_member(ch_id uuid)` | bool | Calling user has a `channel_memberships` row in the channel. |

**Why `security definer`:** without it, an RLS policy that reads `pipeline_memberships` would itself be subject to RLS on `pipeline_memberships`, which reads `pipeline_memberships`, which… infinite recursion. Helpers run as the function owner (postgres role), bypassing RLS internally; they still validate via `auth.uid()`.

**Why `stable`:** lets Postgres cache the result for the duration of a query, so a `SELECT *` against a 1000-row `tasks` table doesn't run `is_pipeline_agency_member` 1000 times.

---

## 2. Per-table policies (plain English)

For each table I list the policies as they'll be expressed. Tables not enabling RLS = automatic full-deny by Supabase (the publishable key has no implicit access).

### profiles

| Op | Policy |
| --- | --- |
| SELECT | A user can read their own profile, plus profiles of users they share at least one workspace OR pipeline membership with. (So agency members see their teammates; clients see only their own profile.) |
| INSERT | None (handled by trigger on `auth.users` insert — see "Triggers" section). |
| UPDATE | A user can only update their own profile (`id = auth.uid()`). Limited to display fields (`display_name`); email is denormalized from `auth.users` and synced via trigger. |
| DELETE | None (cascades from `auth.users`). |

### workspaces

| Op | Policy |
| --- | --- |
| SELECT | `is_workspace_member(id)`. **Clients explicitly excluded** — they have no workspace membership, so they never see the workspace as a top-level row. (They reach the pipeline via the magic-link, which gives them a `pipeline_memberships` row only.) |
| INSERT | Any authenticated user can INSERT (they become its owner via a trigger that creates the `workspace_memberships` row with `role = 'owner'`). |
| UPDATE | `is_workspace_owner(id)` only. |
| DELETE | `is_workspace_owner(id)` only. Cascades to all pipelines. |

### workspace_memberships

| Op | Policy |
| --- | --- |
| SELECT | `is_workspace_member(workspace_id)` — members see who else is in the workspace. |
| INSERT | `is_workspace_owner(workspace_id)`. |
| UPDATE | `is_workspace_owner(workspace_id)`. |
| DELETE | `is_workspace_owner(workspace_id)` OR `user_id = auth.uid()` (self-removal). Cannot remove the last owner — enforced by trigger. |

### pipelines

| Op | Policy |
| --- | --- |
| SELECT | `is_workspace_member(workspace_id) OR is_pipeline_client(id)`. Workspace members see all pipelines; clients see only the one(s) they're invited to. |
| INSERT | `is_workspace_owner(workspace_id)` (only owners create pipelines, matching the prototype). |
| UPDATE | `can_edit_pipeline(id)` — but `submitted_at` / `submitted_by` columns gated separately by trigger that requires `can_submit_pipeline(id)`. |
| DELETE | `is_workspace_owner(workspace_id)`. |

### pipeline_memberships

| Op | Policy |
| --- | --- |
| SELECT | `is_pipeline_agency_member(pipeline_id)` (agency members see all memberships) OR `user_id = auth.uid()` (any user sees their own membership row, so clients can see they're on the pipeline). |
| INSERT | `is_workspace_owner(...)` OR (`can_edit_pipeline(pipeline_id)` AND `role != 'owner'`) — owner adds anyone; admin can add member/admin/client but cannot create another owner. |
| UPDATE | `is_workspace_owner(...)` for any field. Pipeline admins can update `can_check_tasks` on rows where `role = 'member'` only. (Enforced via WITH CHECK clause + column-level constraints — likely simplest as: `USING (can_edit_pipeline(pipeline_id))` plus a trigger that rejects the update if the actor is admin and the change is not strictly `can_check_tasks` on a `role = 'member'` row.) |
| DELETE | `is_workspace_owner(...)` OR `user_id = auth.uid()` (self-leave). |

### stages

| Op | Policy |
| --- | --- |
| SELECT | `is_pipeline_agency_member(pipeline_id)` OR (`is_pipeline_client(pipeline_id)` AND `client_visible = true`). |
| INSERT | `can_edit_pipeline(pipeline_id)`. |
| UPDATE | `can_edit_pipeline(pipeline_id)`. |
| DELETE | `can_edit_pipeline(pipeline_id)`. |

### tasks

| Op | Policy |
| --- | --- |
| SELECT | `is_pipeline_agency_member(<via stage>)` OR (`is_pipeline_client(<via stage>)` AND task `client_visible = true` AND parent stage `client_visible = true`). |
| INSERT | `can_edit_pipeline(<via stage>)`. |
| UPDATE | `can_edit_pipeline(<via stage>)` (full update for agency). **Plus a separate UPDATE policy for clients**: USING (`is_pipeline_client(<via stage>)` AND task `client_visible = true` AND parent stage `client_visible = true`) WITH CHECK (only the `done` column changed — the rest must equal `OLD.*`; enforced by trigger or by column-level GRANT). |
| DELETE | `can_edit_pipeline(<via stage>)`. |

**Implementation note:** Postgres column-level `GRANT UPDATE (done) ON tasks TO authenticated` combined with the policy above is the cleanest enforcement — the database physically rejects writes to other columns from clients regardless of what their query says. Agency members get full UPDATE via a separate role grant.

### stage_notes

| Op | Policy |
| --- | --- |
| SELECT | Agency: `is_pipeline_agency_member(<via stage>)`. Client: `is_pipeline_client(<via stage>) AND client_visible = true`. |
| INSERT | `can_edit_pipeline(<via stage>)`. Clients cannot post stage notes. |
| UPDATE | Author (`author_id = auth.uid()`) OR `is_workspace_owner(...)`. |
| DELETE | Author (`author_id = auth.uid()`) OR `is_workspace_owner(...)`. |

### stage_attachments

| Op | Policy |
| --- | --- |
| SELECT | Agency: `is_pipeline_agency_member(<via stage>)`. Client: `is_pipeline_client(<via stage>) AND client_visible = true AND parent stage client_visible`. |
| INSERT | `can_edit_pipeline(<via stage>)`. Clients cannot upload. |
| UPDATE | Uploader (`added_by = auth.uid()`) OR `can_edit_pipeline(<via stage>)`. |
| DELETE | Uploader OR `can_edit_pipeline(<via stage>)`. |

### pipeline_links

| Op | Policy |
| --- | --- |
| SELECT | Agency: `is_pipeline_agency_member(pipeline_id)`. Client: `is_pipeline_client(pipeline_id) AND client_visible = true`. |
| INSERT | `can_edit_pipeline(pipeline_id)`. Clients cannot. |
| UPDATE | Adder OR `can_edit_pipeline(pipeline_id)`. |
| DELETE | Adder OR `can_edit_pipeline(pipeline_id)`. |

### channels

| Op | Policy |
| --- | --- |
| SELECT | `is_pipeline_agency_member(pipeline_id)` (agency sees all channels) OR `is_channel_member(id)` (clients see only their channels). |
| INSERT | `can_edit_pipeline(pipeline_id)`. |
| UPDATE | `can_edit_pipeline(pipeline_id)`. |
| DELETE | `can_edit_pipeline(pipeline_id)`. |

### channel_memberships

| Op | Policy |
| --- | --- |
| SELECT | `is_channel_member(channel_id)` OR `is_pipeline_agency_member(<via channel>)`. |
| INSERT | `can_edit_pipeline(<via channel>)`. |
| DELETE | `can_edit_pipeline(<via channel>)` OR `user_id = auth.uid()` (self-leave). |

### channel_messages — the most security-sensitive table

| Op | Policy |
| --- | --- |
| SELECT | `is_channel_member(channel_id)` AND (`is_internal = false` OR `is_pipeline_agency_member(<via channel>)`). **The second clause is the internal-message firewall.** Clients are channel members but not agency members — they fail the second clause for `is_internal = true` rows and never see them. |
| INSERT | `is_channel_member(channel_id)`. WITH CHECK clause: (`is_internal = false` OR `is_pipeline_agency_member(<via channel>)`). Clients can post but can never set `is_internal = true`. |
| UPDATE | None (messages are immutable in the prototype). |
| DELETE | None for MVP (matches prototype — no message deletion UI). |

### activity_events

| Op | Policy |
| --- | --- |
| SELECT | `is_pipeline_agency_member(pipeline_id)` only. Clients do not see activity events at all. (Could extend later for client-visible-stage events; over-engineering for MVP.) |
| INSERT | `can_see_pipeline(pipeline_id)` — needs to be permissive enough for client-triggered `stage_advanced` events. Actor identity validated via `actor_id = auth.uid()` in WITH CHECK. **Alternative pattern**: a Postgres trigger on `tasks` UPDATE that fires when `done` becomes true and the parent stage is fully complete; the trigger inserts the `activity_events` row as `security definer`, bypassing RLS. Cleaner, harder for app code to forget. Recommend going with the trigger approach. |
| UPDATE/DELETE | None (append-only audit log). |

### read_state

| Op | Policy |
| --- | --- |
| SELECT | `user_id = auth.uid()`. Each user sees only their own read marks. |
| INSERT | `user_id = auth.uid()`. |
| UPDATE | `user_id = auth.uid()`. |
| DELETE | `user_id = auth.uid()`. (Cascades on `auth.users` delete.) |

### user_templates

| Op | Policy |
| --- | --- |
| SELECT | `owner_id = auth.uid()`. |
| INSERT | `owner_id = auth.uid()`. |
| UPDATE | `owner_id = auth.uid()`. |
| DELETE | `owner_id = auth.uid()`. |

### team_invites

| Op | Policy |
| --- | --- |
| SELECT | `is_workspace_owner(<via pipeline>)` OR `can_edit_pipeline(pipeline_id)`. The invitee themselves does NOT need direct SELECT — they accept via a `security definer` function called by the magic-link landing page that takes the token and validates without RLS. |
| INSERT | `can_edit_pipeline(pipeline_id)`. |
| UPDATE | None directly. Acceptance flows through `security definer` function `accept_team_invite(token text)`. |
| DELETE | `can_edit_pipeline(pipeline_id)` (revoke). |

### client_invites

| Op | Policy |
| --- | --- |
| SELECT | `can_edit_pipeline(pipeline_id)`. |
| INSERT | `can_edit_pipeline(pipeline_id)`. |
| UPDATE | None directly. Acceptance via `security definer` function `accept_client_invite(token text)` that creates the `pipeline_memberships` row with `role = 'client'`. |
| DELETE | `can_edit_pipeline(pipeline_id)` (revoke). |

---

## 3. Triggers

Three triggers handle things RLS can't express cleanly:

| Trigger | Fires on | Does |
| --- | --- | --- |
| `handle_new_user` | `auth.users` INSERT | Creates the matching `profiles` row (id, email). |
| `sync_profile_email` | `auth.users` UPDATE of email | Updates `profiles.email` to match. |
| `prevent_last_workspace_owner_removal` | `workspace_memberships` DELETE | Raises an exception if the row being deleted is the last `role = 'owner'` row in the workspace. |
| `enforce_admin_membership_update_scope` | `pipeline_memberships` UPDATE | If actor is an admin (not owner), reject the update unless the only changed column is `can_check_tasks` AND the row's role is `'member'`. |
| `protect_pipeline_submission` | `pipelines` UPDATE | If `submitted_at` or `submitted_by` is changing, require `can_submit_pipeline(NEW.id)` to be true. |
| `auto_log_stage_advance` *(optional, recommended)* | `tasks` UPDATE | When a task's `done` becomes true and that completes the stage, INSERT the `activity_events` row (security definer, bypasses RLS). Avoids forcing the app to remember. |

---

## 4. Storage buckets and policies

Two **private** buckets (no public access). All access via signed URLs.

| Bucket | Path convention | Holds |
| --- | --- | --- |
| `stage-attachments` | `{pipeline_id}/{stage_id}/{attachment_id}.{ext}` | Files attached to a specific stage |
| `pipeline-files` | `{pipeline_id}/{link_id}.{ext}` | Pipeline-level Files & Links uploads |

Path encoding lets policies extract `pipeline_id` cheaply via `(storage.foldername(name))[1]`.

### stage-attachments policies

| Op | Policy |
| --- | --- |
| SELECT (`storage.objects`) | Bucket = `stage-attachments` AND a row exists in `public.stage_attachments` where `storage_path = name` AND (`is_pipeline_agency_member(<via stage_id from the row>)` OR (`is_pipeline_client(...)` AND `client_visible = true` AND parent stage `client_visible = true`)). |
| INSERT | Bucket = `stage-attachments` AND `can_edit_pipeline(<pipeline_id from path>)`. |
| UPDATE | Same as INSERT. |
| DELETE | Bucket = `stage-attachments` AND a row exists in `public.stage_attachments` where `storage_path = name` AND (`added_by = auth.uid()` OR `can_edit_pipeline(<via stage>)`). |

### pipeline-files policies

Same shape, joining against `public.pipeline_links` instead.

### Frontend conventions

- Always request signed URLs (`supabase.storage.from(bucket).createSignedUrl(path, expiresIn)`), never use public URLs.
- TTL: 60 minutes for previews; refresh on each render rather than caching forever.
- The two-browser test will probe direct URL access. If it 200s, signing/RLS is broken.

---

## 5. Index audit (RLS performance)

Existing indexes from `0001_initial_schema.sql` already cover the hot RLS lookups. Listed for reference + checked off below.

| Required by | Index | Status |
| --- | --- | --- |
| `is_workspace_member` membership lookup | `workspace_memberships` PK on `(workspace_id, user_id)` + `workspace_memberships_user_idx` on `(user_id)` | ✅ |
| `is_pipeline_agency_member` membership lookup | `pipeline_memberships` PK on `(pipeline_id, user_id)` + `pipeline_memberships_user_idx` on `(user_id)` | ✅ |
| `is_channel_member` lookup | `channel_memberships` PK on `(channel_id, user_id)` + `channel_memberships_user_idx` on `(user_id)` | ✅ |
| Pipeline-by-workspace scan (workspace member SELECT) | `pipelines_workspace_idx` on `(workspace_id)` | ✅ |
| Stages-by-pipeline scan | `stages_pipeline_pos_idx` on `(pipeline_id, position)` | ✅ |
| Tasks-by-stage scan | `tasks_stage_pos_idx` on `(stage_id, position)` | ✅ |
| Channel messages by channel + time | `channel_messages_channel_idx` on `(channel_id, created_at desc)` | ✅ |
| Mentioned-me search | `channel_messages_mentions_idx` (GIN) on `mentions` | ✅ |
| Activity events feed | `activity_events_pipeline_idx` on `(pipeline_id, created_at desc)` | ✅ |
| Stage notes feed | `stage_notes_stage_idx` on `(stage_id, created_at desc)` | ✅ |

**Possible future additions (not in 3.3, document for later):**
- Partial index `tasks(stage_id) WHERE client_visible = true` if client-side task lists become slow at scale.
- Partial index `channel_messages(channel_id, created_at desc) WHERE is_internal = false` if client-side chat loads become slow at scale.
- Materialized seat-count column on `workspaces` if Phase 6 billing pre-flight checks become slow with many memberships per workspace.

For MVP, none of these are needed. Existing indexes handle every query the policies generate.

---

## 6. Open questions before SQL is written

1. **Workspace-owner inheritance through pipelines.** I'm assuming `is_pipeline_agency_member` returns true for workspace owners even if they don't have an explicit `pipeline_memberships` row. This matches the prototype's "owner sees everything in their workspace" behavior. Confirm that's correct.
2. **Admin updating member's `can_check_tasks`.** I propose enforcing the "admin can only flip `can_check_tasks` on `role = 'member'` rows" rule via a trigger rather than RLS. Triggers are easier to audit than column-level policies. OK?
3. **Activity events insertion.** Two paths:
   - (a) App-side INSERT with `actor_id = auth.uid()` validation in WITH CHECK.
   - (b) Postgres trigger on `tasks` UPDATE that auto-inserts `stage_advanced` events as security definer.
   - I recommend (b) for `stage_advanced` (forgetting to log it has been a real bug source historically). For other event types (member_joined, pipeline_submitted, pipeline_created), they happen at well-defined moments — app-side INSERT is fine. Confirm direction.
4. **Storage bucket creation.** The migration will `INSERT INTO storage.buckets`. Confirm the bucket names — `stage-attachments` and `pipeline-files` — match what you want.
5. **Are profiles auto-created on signup**, or do we wait for the user's first app action? I propose a trigger on `auth.users` insert. Means a profile row exists from the moment they verify email. Cleaner than handling missing profile rows everywhere.

---

## 7. What lands in `0002_rls_policies.sql`

Once the plan is approved:

1. Helper functions (8) — defined as `security definer stable`.
2. Triggers (5–6) per the table above.
3. Per-table `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + per-policy `CREATE POLICY` statements. ~40-50 policies total.
4. Column-level GRANT for clients on `tasks(done)`.
5. Storage bucket creation + storage.objects policies.
6. Optional: a `select * from public.<table>` smoke check at the bottom that errors loudly if any policy is missing (a "dont-forget" assertion).

After it lands, run via `npx supabase db push`, then run the two-browser test. Block 3.4 on the test passing.
