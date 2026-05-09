# Phase 3.3 — RLS Verification Test Results

**Run on:** 2026-05-09
**Migrations applied:** `20260508120000_initial_schema`, `20260509120000_rls_policies`, `20260509130000_fix_pipeline_visibility` (the last added mid-run after Test 16 surfaced a real bug)
**Verification method:** Manual SQL Editor impersonation per `RLS_TEST.md` Method B (`set local role authenticated; set local request.jwt.claims to '{"sub":"…","role":"authenticated"}';` inside `begin; … rollback;`)

Every one of the 21 tests below is documented with its exact query, the exact observed output (taken from the Supabase Dashboard SQL Editor result panel), and a pass/fail verdict. This is the per-test record, not a summary.

---

## Test users

Created via Authentication → Add User (Auto Confirm User checked):

| Email | UUID | Role on Workspace A / Pipeline A1 |
| --- | --- | --- |
| `agencya@test.com` | `1ff5e4c0-676f-4755-8fba-5bef9e179640` | Workspace A owner |
| `agencyb@test.com` | `0644af76-4dc4-4820-8e90-49581cb9f262` | Workspace B owner (control) |
| `client@test.com` | `0aa6a6fb-0950-4447-8599-4cb6be236025` | Pipeline A1 client |
| `member@test.com` | `093295d0-3054-48b4-9f8b-5f32d86910da` | Pipeline A1 member, can_submit=false, can_check_tasks=false |
| `admin@test.com` | `32d9971f-6b65-456f-a374-51637b72d0b5` | Pipeline A1 admin, can_submit=false, can_check_tasks=false |

Profile auto-create trigger sanity check returned `profile_count = 5` after user creation — the `handle_new_user` trigger fired correctly for all 5.

## Test data (seeded with fixed UUIDs)

Seed DO block from `RLS_TEST.md` Phase 2 ran successfully. Counts:

| Table | Count |
| --- | --- |
| workspaces | 2 |
| pipelines | 2 |
| stages | 2 |
| tasks | 3 |
| stage_notes | 2 |
| stage_attachments | 2 |
| channel_messages | 2 |
| pipeline_memberships | 3 |

All match the expected counts in `RLS_TEST.md`.

---

## Cross-agency isolation (Tests 1–4)

### Test 1 — Agency A sees their own workspace

**Verifies:** A workspace owner can read their own workspace row.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "1ff5e4c0-676f-4755-8fba-5bef9e179640", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Output (1 row):**

| id | name |
| --- | --- |
| `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa` | `Test Workspace A` |

**Verdict:** ✅ PASS

(Re-verified post-fix on 2026-05-09 after the `pipelines_select` / `workspaces_select` patch — same output.)

---

### Test 2 — Agency B does NOT see Agency A's workspace

**Verifies:** Cross-agency isolation — Agency B sees only their own workspace.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0644af76-4dc4-4820-8e90-49581cb9f262", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Output (1 row):**

| id | name |
| --- | --- |
| `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb` | `Test Workspace B` |

Workspace A absent.

**Verdict:** ✅ PASS

---

### Test 3 — Agency B cannot probe Agency A's workspace by direct UUID

**Verifies:** Even with the workspace_id known, RLS still hides it.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0644af76-4dc4-4820-8e90-49581cb9f262", "role": "authenticated"}';

select * from public.workspaces
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

rollback;
```

**Output:** 0 rows.

**Verdict:** ✅ PASS

---

### Test 4 — Agency B cannot see Agency A's pipelines

**Verifies:** Pipelines under another agency's workspace are invisible.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0644af76-4dc4-4820-8e90-49581cb9f262", "role": "authenticated"}';

select id, name from public.pipelines
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

rollback;
```

**Output:** 0 rows.

**Verdict:** ✅ PASS

---

## Client visibility scope (Tests 5–11)

### Test 5 — Client does NOT see any workspaces

**Verifies:** Clients have no `workspace_memberships` row, so `workspaces_select` filters them out entirely. They reach pipelines only via magic-link.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Output:** 0 rows.

**Verdict:** ✅ PASS

---

### Test 6 — Client sees only Pipeline A1

**Verifies:** A client sees the pipeline they're invited to, nothing else.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, name from public.pipelines;

rollback;
```

**Output (1 row):**

| id | name |
| --- | --- |
| `11111111-1111-1111-1111-111111111111` | `Pipeline A1` |

**Verdict:** ✅ PASS

(Re-verified post-fix.)

---

### Test 7 — Client cannot probe Pipeline B1 by direct UUID

**Verifies:** Cross-agency leak check from a client perspective.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select * from public.pipelines
where id = '22222222-2222-2222-2222-222222222222';

rollback;
```

**Output:** 0 rows.

**Verdict:** ✅ PASS

---

### Test 8 — Client sees only the client_visible stage

**Verifies:** `stages_select` filters by `client_visible` for clients.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, name, client_visible from public.stages
where pipeline_id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Output (1 row):**

| id | name | client_visible |
| --- | --- | --- |
| `33333333-1111-1111-1111-111111111111` | `Visible Stage` | `true` |

Hidden Stage absent.

**Verdict:** ✅ PASS

(Re-verified post-fix.)

---

### Test 9 — Client sees only client_visible tasks on client_visible stages (parent gate)

**Verifies:** `tasks_select` enforces BOTH `task.client_visible` AND `parent stage.client_visible`. Pipeline A1 has three tasks: visible-on-visible, hidden-on-visible, visible-on-hidden. Only the first should be visible.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, text, client_visible from public.tasks;

rollback;
```

**Output (1 row):**

| id | text | client_visible |
| --- | --- | --- |
| `44444444-1111-1111-1111-111111111111` | `Visible task on visible stage` | `true` |

Hidden task and the visible-task-on-hidden-stage both absent.

**Verdict:** ✅ PASS — parent-gate enforcement working.

---

### Test 10 — Client sees only client_visible stage notes

**Verifies:** `stage_notes_select` filters by `note.client_visible` for clients.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, text, client_visible from public.stage_notes;

rollback;
```

**Output (1 row):**

| id | text | client_visible |
| --- | --- | --- |
| `55555555-1111-1111-1111-111111111111` | `Visible note` | `true` |

**Verdict:** ✅ PASS

---

### Test 11 — Client sees only client_visible stage attachments

**Verifies:** `stage_attachments_select` filters by `client_visible` for clients.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, label, client_visible from public.stage_attachments;

rollback;
```

**Output:** 1 row, label = `Visible img`, `client_visible = true`. (User confirmed "correct" — screenshot not retained, but the result panel showed the single visible row.)

**Verdict:** ✅ PASS

---

## Internal-message defense Layer 1 (Tests 12–14b)

### Test 12 — Client does NOT see internal messages

**Verifies:** `channel_messages_select` filters `is_internal = true` rows for non-agency viewers. **This is Layer 1 of the internal-message defense in depth — the only layer that protects against direct API access.**

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

select id, text, is_internal from public.channel_messages
where channel_id = '77777777-1111-1111-1111-111111111111';

rollback;
```

**Output (1 row):**

| id | text | is_internal |
| --- | --- | --- |
| `88888888-1111-1111-1111-111111111111` | `Hello client!` | `false` |

The internal `discuss pricing` message is correctly absent.

**Verdict:** ✅ PASS

---

### Test 13 — Agency A DOES see both messages on the same channel

**Verifies:** Same channel, agency viewer — both messages visible. Confirms the policy correctly distinguishes client vs agency viewers.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "1ff5e4c0-676f-4755-8fba-5bef9e179640", "role": "authenticated"}';

select id, text, is_internal from public.channel_messages
where channel_id = '77777777-1111-1111-1111-111111111111'
order by is_internal;

rollback;
```

**Output (2 rows):**

| id | text | is_internal |
| --- | --- | --- |
| `88888888-1111-1111-1111-111111111111` | `Hello client!` | `false` |
| `88888888-2222-2222-2222-222222222222` | `INTERNAL: discuss pricing` | `true` |

**Verdict:** ✅ PASS

---

### Test 14 — Client cannot INSERT a message with `is_internal = true`

**Verifies:** The `channel_messages_insert` WITH CHECK clause rejects writes that try to set `is_internal=true` from a non-agency author.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

insert into public.channel_messages (channel_id, author_id, text, is_internal)
values (
  '77777777-1111-1111-1111-111111111111',
  '0aa6a6fb-0950-4447-8599-4cb6be236025'::uuid,
  'sneaky internal',
  true
);

rollback;
```

**Output:** `Failed to run sql query: ERROR: 42501: new row violates row-level security policy for table "channel_messages"`

**Verdict:** ✅ PASS — RLS WITH CHECK rejected the disguised internal message.

---

### Test 14b — Client CAN INSERT a public message (sanity check)

**Verifies:** The same policy still permits legitimate non-internal client posts. Catches over-restrictive cases.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0aa6a6fb-0950-4447-8599-4cb6be236025", "role": "authenticated"}';

insert into public.channel_messages (channel_id, author_id, text, is_internal)
values (
  '77777777-1111-1111-1111-111111111111',
  '0aa6a6fb-0950-4447-8599-4cb6be236025'::uuid,
  'hello from client (test)',
  false
);

rollback;
```

**Output:** `Success. No rows returned` (the SQL editor's standard response for a successful DML; the ROLLBACK ensured no persistence).

**Verdict:** ✅ PASS — policy is not over-restrictive.

---

## Submission gate (Tests 15–17)

### Test 15 — Member cannot submit (silent UPDATE 0)

**Verifies:** Members fail `can_edit_pipeline`, so the UPDATE policy USING clause hides the row from their UPDATE → zero rows updated, no error.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "093295d0-3054-48b4-9f8b-5f32d86910da", "role": "authenticated"}';

with updated as (
  update public.pipelines
  set submitted_at = now(), submitted_by = '093295d0-3054-48b4-9f8b-5f32d86910da'::uuid
  where id = '11111111-1111-1111-1111-111111111111'
  returning id
)
select count(*) as rows_updated from updated;

rollback;
```

**Output (1 row):**

| rows_updated |
| --- |
| `0` |

**Verdict:** ✅ PASS

(Re-verified post-fix. Before the fix, this also returned 0 rows but for the wrong reason — RLS hid the pipeline at SELECT before `can_edit_pipeline` could even be evaluated. After the fix the member CAN see the pipeline, and the UPDATE policy USING clause is what blocks the write — the correct mechanism.)

---

### Test 16 — Admin without `can_submit` cannot submit (trigger raises) ⚠️ Bug found and fixed mid-run

**Verifies:** Admin passes `can_edit_pipeline` (so the UPDATE policy admits them), but the `protect_pipeline_submission` trigger fires AFTER and raises because `can_submit_pipeline` returns false.

#### Initial run (FAILED — surfaced a real bug):

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "32d9971f-6b65-456f-a374-51637b72d0b5", "role": "authenticated"}';

update public.pipelines
set submitted_at = now(), submitted_by = '32d9971f-6b65-456f-a374-51637b72d0b5'::uuid
where id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Output:** `Success. No rows returned` (i.e. UPDATE 0). Expected the trigger to raise; instead the UPDATE silently affected zero rows. **Trigger never fired.**

#### Diagnostic chain:

```sql
-- D1: does can_submit_pipeline correctly return false for the admin?
select public.can_submit_pipeline('11111111-1111-1111-1111-111111111111'::uuid) as admin_can_submit;
-- Result: admin_can_submit = false ✓ (trigger logic itself is sound)

-- D2: does the admin's pipeline_memberships row exist with role='admin'?
select role, can_submit, can_check_tasks
from public.pipeline_memberships
where pipeline_id = '11111111-1111-1111-1111-111111111111'
  and user_id = '32d9971f-6b65-456f-a374-51637b72d0b5';
-- Result: role='admin', can_submit=false, can_check_tasks=false ✓

-- D3: what do can_edit_pipeline / is_pipeline_agency_member / auth.uid() return?
select
  public.can_edit_pipeline('11111111-1111-1111-1111-111111111111'::uuid) as admin_can_edit,
  public.is_pipeline_agency_member('11111111-1111-1111-1111-111111111111'::uuid) as admin_is_agency_member,
  (select auth.uid()) as resolved_uid;
-- Result: admin_can_edit=true, admin_is_agency_member=true, resolved_uid=32d9...d0b5 ✓
-- Helpers said TRUE but UPDATE still hit 0 rows, so RLS was hiding the row at SELECT.

-- D4: can the admin/member SELECT the pipeline?
select count(*) from public.pipelines
where id = '11111111-1111-1111-1111-111111111111';
-- Result: 0 rows for both admin and member.
```

#### Root cause:

`pipelines_select` policy (from `20260509120000_rls_policies.sql`) read:

```sql
create policy pipelines_select on public.pipelines
for select using (
  public.is_workspace_member(workspace_id) or public.is_pipeline_client(id)
);
```

Pipeline-level agency members (anyone added directly via `pipeline_memberships` with role `owner`/`admin`/`member` but no `workspace_memberships` row) failed both clauses. PostgreSQL RLS requires SELECT visibility for an UPDATE to find a row, so their UPDATEs silently zero-rowed without ever reaching the trigger. Same shape error in `workspaces_select`.

#### Fix:

Migration `20260509130000_fix_pipeline_visibility.sql` recreates both SELECT policies to include `is_pipeline_agency_member` (for pipelines) and an inline EXISTS join to `pipeline_memberships` excluding clients (for workspaces). Applied with `npx supabase db push`; `migration list --linked` confirmed Local and Remote both list the new migration.

#### Re-run after fix:

Same SQL as the initial run.

**Output:** `Failed to run sql query: ERROR: P0001: Only the workspace owner, pipeline owner, or admin with can_submit may submit a pipeline. CONTEXT: PL/pgSQL function public.protect_pipeline_submission() line 6 at RAISE`

**Verdict:** ✅ PASS — the trigger now fires and raises the expected error.

---

### Test 17 — Workspace owner CAN submit

**Verifies:** Positive case for the submission gate. Workspace owner passes `can_submit_pipeline`, the trigger lets the UPDATE through.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "1ff5e4c0-676f-4755-8fba-5bef9e179640", "role": "authenticated"}';

with updated as (
  update public.pipelines
  set submitted_at = now(), submitted_by = '1ff5e4c0-676f-4755-8fba-5bef9e179640'::uuid
  where id = '11111111-1111-1111-1111-111111111111'
  returning id, submitted_at is not null as submitted
)
select count(*) as rows_updated, bool_and(submitted) as all_submitted from updated;

rollback;
```

**Output (1 row):**

| rows_updated | all_submitted |
| --- | --- |
| `1` | `true` |

No error. Then rolled back so the change didn't persist.

**Verdict:** ✅ PASS

---

## Storage policy (Test 18)

### Test 18 — Cross-agency storage probe + bucket privacy

**Verifies:** Cross-agency `storage.objects` query returns nothing (policy denies even if files existed), and both buckets are private.

#### Cross-agency object enumeration (Agency B probing Pipeline A1's path):

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "0644af76-4dc4-4820-8e90-49581cb9f262", "role": "authenticated"}';

select count(*) as cross_agency_visible_objects from storage.objects
where bucket_id = 'stage_attachments'
  and name like '11111111-1111-1111-1111-111111111111/%';

rollback;
```

**Output (1 row):**

| cross_agency_visible_objects |
| --- |
| `0` |

#### Bucket privacy:

```sql
select id, name, public from storage.buckets
where id in ('stage_attachments', 'pipeline_files');
```

**Output (2 rows):**

| id | name | public |
| --- | --- | --- |
| `stage_attachments` | `stage_attachments` | `false` |
| `pipeline_files` | `pipeline_files` | `false` |

**Verdict:** ✅ PASS — buckets private, cross-agency probe returns zero. The full HTTP signed-URL probe lives in the post-3.4 two-browser test.

---

## Admin scope trigger (Tests 19–20)

### Test 19 — Admin CAN flip `can_check_tasks` on a member row (positive case)

**Verifies:** The `enforce_admin_can_check_tasks_scope` trigger admits the single allowed admin mutation.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "32d9971f-6b65-456f-a374-51637b72d0b5", "role": "authenticated"}';

with updated as (
  update public.pipeline_memberships
  set can_check_tasks = true
  where pipeline_id = '11111111-1111-1111-1111-111111111111'
    and user_id = '093295d0-3054-48b4-9f8b-5f32d86910da'
  returning user_id
)
select count(*) as rows_updated from updated;

rollback;
```

**Output (1 row):**

| rows_updated |
| --- |
| `1` |

No error.

**Verdict:** ✅ PASS

---

### Test 20 — Admin CANNOT flip `can_submit` on a member (or any other column)

**Verifies:** The trigger raises when the admin tries to mutate any column other than `can_check_tasks`.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "32d9971f-6b65-456f-a374-51637b72d0b5", "role": "authenticated"}';

update public.pipeline_memberships
set can_submit = true
where pipeline_id = '11111111-1111-1111-1111-111111111111'
  and user_id = '093295d0-3054-48b4-9f8b-5f32d86910da';

rollback;
```

**Output:** `Failed to run sql query: ERROR: P0001: Admins can only flip can_check_tasks on member rows; no other field changes allowed. CONTEXT: PL/pgSQL function public.enforce_admin_can_check_tasks_scope() line 35 at RAISE`

**Verdict:** ✅ PASS

---

## Last-owner protection (Test 21)

### Test 21 — Workspace owner cannot remove themselves if last owner

**Verifies:** The `prevent_last_workspace_owner_removal` BEFORE DELETE trigger aborts the DELETE rather than leaving a workspace with zero owners.

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "1ff5e4c0-676f-4755-8fba-5bef9e179640", "role": "authenticated"}';

delete from public.workspace_memberships
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and user_id = '1ff5e4c0-676f-4755-8fba-5bef9e179640';

rollback;
```

(The Supabase Dashboard popped its destructive-query confirmation; clicked "Run this query" — the `begin/rollback` wrapper means nothing would persist regardless.)

**Output:** `Failed to run sql query: ERROR: P0001: Cannot remove the last owner from a workspace. Transfer ownership first. CONTEXT: PL/pgSQL function public.prevent_last_workspace_owner_removal() line 8 at RAISE`

**Verdict:** ✅ PASS

---

## Final scoreboard

| # | Test | Verdict |
| --- | --- | --- |
| 1 | Agency A sees own workspace | ✅ |
| 2 | Agency B does not see Agency A's workspace | ✅ |
| 3 | Agency B cannot probe by direct UUID | ✅ |
| 4 | Agency B cannot see Agency A's pipelines | ✅ |
| 5 | Client does not see workspaces | ✅ |
| 6 | Client sees only their pipeline | ✅ |
| 7 | Client cannot probe other agency's pipeline | ✅ |
| 8 | Client sees only `client_visible` stage | ✅ |
| 9 | Client sees only `client_visible` task on `client_visible` stage (parent gate) | ✅ |
| 10 | Client sees only `client_visible` notes | ✅ |
| 11 | Client sees only `client_visible` attachments | ✅ |
| 12 | Client cannot SELECT internal messages (Layer 1 read) | ✅ |
| 13 | Agency sees both internal and public messages | ✅ |
| 14 | Client cannot INSERT internal message (Layer 1 write) | ✅ |
| 14b | Client can INSERT public message (policy not over-restrictive) | ✅ |
| 15 | Member cannot submit (silent UPDATE 0) | ✅ |
| 16 | Admin without `can_submit` cannot submit (trigger raises) | ✅ |
| 17 | Workspace owner can submit | ✅ |
| 18 | Storage cross-agency probe returns 0; both buckets private | ✅ |
| 19 | Admin can flip `can_check_tasks` on a member row | ✅ |
| 20 | Admin cannot flip any other field | ✅ |
| 21 | Last workspace owner cannot delete self | ✅ |

**21 of 21 passing.** One real RLS bug found mid-run (`pipelines_select` and `workspaces_select` missing pipeline-level agency members), patched in `20260509130000_fix_pipeline_visibility.sql`, regression-tested.

## What's still left for full RLS confidence

These are the verifications that don't fit the SQL-editor format and remain on the post-3.4 punch list:

1. **Two-browser test** — full real-browser walk through Agencies A + B + Client portal (per `CLAUDE.md → Security model → The two-browser test`). Non-optional gate before any production deploy.
2. **Signed-URL HTTP storage probe** — Browser B fetches the direct storage URL of an Agency A attachment and gets `403 Forbidden`. Must run after auth wiring (3.4) so a real session token exists.
3. **Application-layer Layers 2 and 3 of internal-message defense** — server-side `is_internal=false` enforcement and render-side filter — verified during 3.4 / 4 once the app actually wires `sendClientChannelMessage` / portal render.

These don't block advancing to 3.4 — they ARE the verification that runs alongside 3.4 and 4.

---

## Cleanup status

Test data still in place at the time of this writing (workspaces A & B, pipelines A1 & B1, etc.). Cleanup queries from `RLS_TEST.md` Phase 5 will run before 3.4 auth flow testing so the project starts fresh.
