# Phase 3.3 — RLS Verification Test Plan

Partial verification of the RLS policies via the Supabase SQL editor. The full real-browser test happens after Phase 3.4 (auth flows). This catches major policy bugs before more layers go on top.

**How to use this doc:** work top-to-bottom in the Supabase SQL editor. Each test has a setup, a query, and an expected result. Mark each ☐ as you go.

---

## Phase 1: Create test users (Dashboard)

In the Supabase Dashboard:

1. Navigate to **Authentication → Users**.
2. Click **Add user → Create new user** (or "Add user" depending on dashboard version).
3. For each of the five users below, create with:
   - Email: as listed
   - Password: anything memorable (e.g. `Stages-Test-2026!`)
   - **✅ Auto Confirm User** checked (skips email verification)

| Email | Will be | Why |
| --- | --- | --- |
| `agencya@test.com` | Owner of Workspace A | The "good" agency |
| `agencyb@test.com` | Owner of Workspace B | The "other" agency for cross-agency isolation tests |
| `client@test.com` | Client on Pipeline A1 | The client visibility-scope tests |
| `member@test.com` | Member on Pipeline A1 (`role='member'`) | Member submission gate test |
| `admin@test.com` | Admin on Pipeline A1 (`role='admin'`, `can_submit=false`) | Admin-without-can_submit test |

After creating all five, run this query to confirm and capture their UUIDs:

```sql
select id, email
from auth.users
where email like '%@test.com'
order by email;
```

You'll need these UUIDs in the next phase. Keep this query result handy.

**Sanity check the profile-auto-create trigger:**

```sql
select count(*) as profile_count
from public.profiles
where email like '%@test.com';
```

Expected: `5`. If less, the `handle_new_user` trigger didn't fire — investigate before continuing.

☐ **All 5 users created and visible in `auth.users`**
☐ **All 5 corresponding `profiles` rows exist (trigger fired correctly)**

---

## Phase 2: Set up test data (one big SQL block)

Run this block in the SQL editor as superuser (the default — RLS is bypassed). **Replace the five UUIDs at the top** with the real IDs from Phase 1.

```sql
-- ─── REPLACE THESE WITH THE REAL UUIDs FROM auth.users ───────────────────
do $$
declare
  agency_a_uid    uuid := 'PASTE_HERE';  -- agencya@test.com
  agency_b_uid    uuid := 'PASTE_HERE';  -- agencyb@test.com
  client_uid      uuid := 'PASTE_HERE';  -- client@test.com
  member_uid      uuid := 'PASTE_HERE';  -- member@test.com
  admin_uid       uuid := 'PASTE_HERE';  -- admin@test.com

  -- Fixed UUIDs for test resources so verification queries can reference them.
  workspace_a     uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  workspace_b     uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  pipeline_a1     uuid := '11111111-1111-1111-1111-111111111111';
  pipeline_b1     uuid := '22222222-2222-2222-2222-222222222222';
  stage_a1_vis    uuid := '33333333-1111-1111-1111-111111111111';
  stage_a1_hidden uuid := '33333333-2222-2222-2222-222222222222';
  task_vis        uuid := '44444444-1111-1111-1111-111111111111';
  task_hidden     uuid := '44444444-2222-2222-2222-222222222222';
  task_in_hidden  uuid := '44444444-3333-3333-3333-333333333333';
  note_vis        uuid := '55555555-1111-1111-1111-111111111111';
  note_hidden     uuid := '55555555-2222-2222-2222-222222222222';
  att_vis         uuid := '66666666-1111-1111-1111-111111111111';
  att_hidden      uuid := '66666666-2222-2222-2222-222222222222';
  client_channel  uuid := '77777777-1111-1111-1111-111111111111';
  msg_public      uuid := '88888888-1111-1111-1111-111111111111';
  msg_internal    uuid := '88888888-2222-2222-2222-222222222222';
begin
  -- ─── Workspaces ─────────────────────────────────────────────────────
  insert into public.workspaces (id, name) values
    (workspace_a, 'Test Workspace A'),
    (workspace_b, 'Test Workspace B');

  -- ─── Workspace memberships ──────────────────────────────────────────
  insert into public.workspace_memberships (workspace_id, user_id, role) values
    (workspace_a, agency_a_uid, 'owner'),
    (workspace_b, agency_b_uid, 'owner');

  -- ─── Pipelines ──────────────────────────────────────────────────────
  insert into public.pipelines (id, workspace_id, name, company, emoji, template) values
    (pipeline_a1, workspace_a, 'Pipeline A1', 'Acme Co', '📋', 'blank'),
    (pipeline_b1, workspace_b, 'Pipeline B1', 'Other Co', '📋', 'blank');

  -- ─── Stages on Pipeline A1 ──────────────────────────────────────────
  insert into public.stages
    (id, pipeline_id, position, name, color, client_visible) values
    (stage_a1_vis,    pipeline_a1, 1, 'Visible Stage', '#3BA5EE', true),
    (stage_a1_hidden, pipeline_a1, 2, 'Hidden Stage',  '#8B5CF6', false);
  update public.pipelines set current_stage_id = stage_a1_vis where id = pipeline_a1;

  -- ─── Tasks ──────────────────────────────────────────────────────────
  -- task_vis:        client_visible AND parent stage visible → client SHOULD see
  -- task_hidden:     NOT client_visible, parent visible       → client should NOT see
  -- task_in_hidden:  client_visible BUT parent hidden         → client should NOT see (parent gate)
  insert into public.tasks (id, stage_id, position, text, client_visible) values
    (task_vis,       stage_a1_vis,    1, 'Visible task on visible stage', true),
    (task_hidden,    stage_a1_vis,    2, 'Hidden task on visible stage',  false),
    (task_in_hidden, stage_a1_hidden, 1, 'Visible task on hidden stage',  true);

  -- ─── Stage notes ────────────────────────────────────────────────────
  insert into public.stage_notes
    (id, stage_id, author_id, text, client_visible) values
    (note_vis,    stage_a1_vis, agency_a_uid, 'Visible note', true),
    (note_hidden, stage_a1_vis, agency_a_uid, 'Hidden note',  false);

  -- ─── Stage attachments ──────────────────────────────────────────────
  insert into public.stage_attachments
    (id, stage_id, kind, label, storage_path, file_name, file_size, added_by, client_visible) values
    (att_vis,    stage_a1_vis, 'image', 'Visible img',
     pipeline_a1 || '/' || stage_a1_vis || '/' || att_vis || '.png',
     'visible.png', 1024, agency_a_uid, true),
    (att_hidden, stage_a1_vis, 'image', 'Hidden img',
     pipeline_a1 || '/' || stage_a1_vis || '/' || att_hidden || '.png',
     'hidden.png',  2048, agency_a_uid, false);

  -- ─── Channels + members + messages ──────────────────────────────────
  insert into public.channels
    (id, pipeline_id, name, is_client, created_by) values
    (client_channel, pipeline_a1, 'acme-client', true, agency_a_uid);

  insert into public.channel_memberships (channel_id, user_id) values
    (client_channel, agency_a_uid),
    (client_channel, client_uid);

  insert into public.channel_messages
    (id, channel_id, author_id, text, is_internal) values
    (msg_public,   client_channel, agency_a_uid, 'Hello client!',         false),
    (msg_internal, client_channel, agency_a_uid, 'INTERNAL: discuss pricing', true);

  -- ─── Pipeline memberships for member + admin on A1 ──────────────────
  -- Note: agency_a is workspace owner, inherits owner access on A1 — no row needed.
  insert into public.pipeline_memberships
    (pipeline_id, user_id, role, can_submit, can_check_tasks) values
    (pipeline_a1, member_uid, 'member', false, false),
    (pipeline_a1, admin_uid,  'admin',  false, false),
    (pipeline_a1, client_uid, 'client', false, false);

  raise notice 'Setup complete. Test data inserted with fixed UUIDs (see comments at top of this block).';
end $$;
```

**Verify setup:**

```sql
select 'workspaces'      as table_name, count(*) from public.workspaces
union all select 'pipelines',          count(*) from public.pipelines
union all select 'stages',             count(*) from public.stages
union all select 'tasks',              count(*) from public.tasks
union all select 'stage_notes',        count(*) from public.stage_notes
union all select 'stage_attachments',  count(*) from public.stage_attachments
union all select 'channel_messages',   count(*) from public.channel_messages
union all select 'pipeline_memberships', count(*) from public.pipeline_memberships;
```

Expected (assuming a fresh project):
- workspaces 2, pipelines 2, stages 2, tasks 3, stage_notes 2, stage_attachments 2, channel_messages 2, pipeline_memberships 3.

☐ **Setup block ran without error**
☐ **Counts match expected**

---

## Phase 3: How to impersonate users in the SQL editor

There are two ways. Use whichever your dashboard supports.

### Method A — Dashboard "Run as user" dropdown (newer Supabase UIs)

In the SQL editor, look at the top-right of the query pane for a **role/user selector**. Switch from `postgres` → `authenticated` and paste a user UUID. Every query you run after that executes as if from that user's session, with RLS applied.

### Method B — Manual SQL (works in any Supabase version)

Wrap each test in a transaction so the `set local` is scoped properly and any side-effects roll back:

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<USER_UUID>", "role": "authenticated"}';

-- ... your test queries here ...

rollback;
```

For mutating tests (UPDATE / INSERT / DELETE), `rollback` ensures nothing persists — clean slate between tests. If you want a mutation to actually commit, use `commit` instead of `rollback`.

**The doc below uses Method B** because it's universal. If your dashboard has the dropdown, you can skip the `begin/set local/rollback` boilerplate.

---

## Phase 4: Verification checklist

Each test below shows the impersonation setup, the test query, and the expected result. Substitute the UUIDs you captured in Phase 1 wherever you see `<AGENCY_A_UID>`, `<CLIENT_UID>`, etc. Resource UUIDs (`workspace_a`, `pipeline_a1`, …) use the fixed values from Phase 2.

### ─── Cross-agency isolation (Tests 1–4) ─────────────────────────────────

#### Test 1 — Agency A sees their own workspace

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_A_UID>", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Expected:** 1 row, `Test Workspace A`.
☐ **Pass**

#### Test 2 — Agency B does NOT see Agency A's workspace

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_B_UID>", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Expected:** 1 row, `Test Workspace B` only. Workspace A absent.
☐ **Pass**

#### Test 3 — Agency B cannot query Agency A's workspace by direct ID

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_B_UID>", "role": "authenticated"}';

select * from public.workspaces
where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

rollback;
```

**Expected:** 0 rows.
☐ **Pass**

#### Test 4 — Agency B cannot see Agency A's pipelines

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_B_UID>", "role": "authenticated"}';

select id, name from public.pipelines
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

rollback;
```

**Expected:** 0 rows.
☐ **Pass**

### ─── Client visibility scope (Tests 5–11) ───────────────────────────────

#### Test 5 — Client does NOT see any workspaces at all

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, name from public.workspaces;

rollback;
```

**Expected:** 0 rows. (Clients have no `workspace_memberships` row.)
☐ **Pass**

#### Test 6 — Client sees only Pipeline A1

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, name from public.pipelines;

rollback;
```

**Expected:** 1 row, `Pipeline A1`.
☐ **Pass**

#### Test 7 — Client cannot see Pipeline B1 (cross-agency leak check)

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select * from public.pipelines
where id = '22222222-2222-2222-2222-222222222222';

rollback;
```

**Expected:** 0 rows.
☐ **Pass**

#### Test 8 — Client sees only the client_visible stage on Pipeline A1

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, name, client_visible from public.stages
where pipeline_id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Expected:** 1 row, `Visible Stage`, `client_visible = true`. Hidden Stage absent.
☐ **Pass**

#### Test 9 — Client sees only client_visible tasks on client_visible stages

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, text, client_visible from public.tasks;

rollback;
```

**Expected:** 1 row, `Visible task on visible stage`. The hidden task and the "visible task on hidden stage" must both be absent (parent-gate enforcement).
☐ **Pass**

#### Test 10 — Client sees only client_visible stage notes

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, text, client_visible from public.stage_notes;

rollback;
```

**Expected:** 1 row, `Visible note`.
☐ **Pass**

#### Test 11 — Client sees only client_visible stage attachments

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, label, client_visible from public.stage_attachments;

rollback;
```

**Expected:** 1 row, `Visible img`.
☐ **Pass**

### ─── Internal-message defense Layer 1 (Tests 12–14) ─────────────────────

#### Test 12 — Client does NOT see internal messages

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

select id, text, is_internal from public.channel_messages
where channel_id = '77777777-1111-1111-1111-111111111111';

rollback;
```

**Expected:** 1 row, `Hello client!` (`is_internal = false`). The internal message must be absent.
☐ **Pass**

#### Test 13 — Agency A DOES see both messages on the same channel

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_A_UID>", "role": "authenticated"}';

select id, text, is_internal from public.channel_messages
where channel_id = '77777777-1111-1111-1111-111111111111'
order by is_internal;

rollback;
```

**Expected:** 2 rows. The `INTERNAL: discuss pricing` message is visible to the agency.
☐ **Pass**

#### Test 14 — Client cannot INSERT a message with `is_internal = true`

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

insert into public.channel_messages (channel_id, author_id, text, is_internal)
values (
  '77777777-1111-1111-1111-111111111111',
  '<CLIENT_UID>'::uuid,
  'sneaky internal',
  true
);

rollback;
```

**Expected:** Error `new row violates row-level security policy for table "channel_messages"`. RLS WITH CHECK rejected the insert.
☐ **Pass**

#### Test 14b — Client CAN INSERT a public message (sanity check the policy isn't over-restrictive)

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<CLIENT_UID>", "role": "authenticated"}';

insert into public.channel_messages (channel_id, author_id, text, is_internal)
values (
  '77777777-1111-1111-1111-111111111111',
  '<CLIENT_UID>'::uuid,
  'hello from client (test)',
  false
);

rollback;
```

**Expected:** `INSERT 0 1` (one row inserted). Then rolled back, so it doesn't actually persist.
☐ **Pass**

### ─── Submission gate (Tests 15–17) ──────────────────────────────────────

#### Test 15 — Member cannot submit (RLS denies UPDATE silently)

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<MEMBER_UID>", "role": "authenticated"}';

update public.pipelines
set submitted_at = now(), submitted_by = '<MEMBER_UID>'::uuid
where id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Expected:** `UPDATE 0` (zero rows updated). Members fail `can_edit_pipeline`, so the row is invisible to UPDATE — no error, just nothing happens.
☐ **Pass**

#### Test 16 — Admin without can_submit cannot submit (trigger raises)

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_UID>", "role": "authenticated"}';

update public.pipelines
set submitted_at = now(), submitted_by = '<ADMIN_UID>'::uuid
where id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Expected:** Error `Only the workspace owner, pipeline owner, or admin with can_submit may submit a pipeline.`. (Admin passes `can_edit_pipeline` and the UPDATE proceeds, but `protect_pipeline_submission` trigger fires and raises.)
☐ **Pass**

#### Test 17 — Workspace owner CAN submit

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_A_UID>", "role": "authenticated"}';

update public.pipelines
set submitted_at = now(), submitted_by = '<AGENCY_A_UID>'::uuid
where id = '11111111-1111-1111-1111-111111111111';

rollback;
```

**Expected:** `UPDATE 1`. No error. Then rolled back.
☐ **Pass**

### ─── Storage policy (Test 18) ───────────────────────────────────────────

The two-browser test does the *real* HTTP probe against a signed URL — that requires the auth flow from 3.4. In the SQL editor we can verify the storage RLS policy itself by querying `storage.objects` from each user's perspective. Since we haven't actually uploaded a file (storage is a separate API), there are no objects to test against — but we can confirm the policy denies via a different probe:

```sql
-- As Agency B, try to enumerate any storage objects belonging to Agency A's pipeline
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_B_UID>", "role": "authenticated"}';

select count(*) from storage.objects
where bucket_id = 'stage_attachments'
  and name like '11111111-1111-1111-1111-111111111111/%';

rollback;
```

**Expected:** `0`. (Even if files existed, B's user couldn't see them. With no files yet, this test confirms the bucket exists and the policy doesn't accidentally grant access.)

```sql
-- Confirm both buckets exist and are private
select id, name, public from storage.buckets
where id in ('stage_attachments', 'pipeline_files');
```

**Expected:** 2 rows, both with `public = false`.

☐ **Pass — bucket query returns 0 rows for cross-agency probe**
☐ **Pass — both buckets are private**

### ─── Bonus: admin scope trigger (Tests 19–20) ───────────────────────────

#### Test 19 — Admin CAN flip `can_check_tasks` on a member row

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_UID>", "role": "authenticated"}';

update public.pipeline_memberships
set can_check_tasks = true
where pipeline_id = '11111111-1111-1111-1111-111111111111'
  and user_id = '<MEMBER_UID>'::uuid;

rollback;
```

**Expected:** `UPDATE 1`. No error.
☐ **Pass**

#### Test 20 — Admin CANNOT flip `can_submit` on a member (or anything else)

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<ADMIN_UID>", "role": "authenticated"}';

update public.pipeline_memberships
set can_submit = true
where pipeline_id = '11111111-1111-1111-1111-111111111111'
  and user_id = '<MEMBER_UID>'::uuid;

rollback;
```

**Expected:** Error `Admins can only flip can_check_tasks on member rows; no other field changes allowed.`.
☐ **Pass**

### ─── Bonus: last-owner protection (Test 21) ─────────────────────────────

#### Test 21 — Workspace owner cannot delete themselves if they're the last owner

```sql
begin;
set local role authenticated;
set local request.jwt.claims to '{"sub": "<AGENCY_A_UID>", "role": "authenticated"}';

delete from public.workspace_memberships
where workspace_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  and user_id = '<AGENCY_A_UID>'::uuid;

rollback;
```

**Expected:** Error `Cannot remove the last owner from a workspace. Transfer ownership first.`.
☐ **Pass**

---

## Phase 5: Cleanup (optional)

Once all tests pass, delete the test data so the project is fresh for real auth-flow testing in 3.4:

```sql
delete from public.workspaces where id in (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
);
-- Cascades remove pipelines, stages, tasks, notes, attachments, channels, messages, memberships.
```

To delete the test users entirely (auth.users + cascading profiles):

```sql
delete from auth.users where email like '%@test.com';
```

(Note: deleting auth.users requires the service role, which the dashboard SQL editor has by default.)

---

## Summary

| ☐ | Test | What it proves |
| --- | --- | --- |
| ☐ | 1–4 | Cross-agency isolation: A sees A, B sees only B |
| ☐ | 5–11 | Client visibility scope: only `client_visible` rows + parent-gate enforcement |
| ☐ | 12–14b | Internal-message defense Layer 1 (RLS): clients cannot SELECT or INSERT internal messages |
| ☐ | 15–17 | Submission gate: members blocked, admins-without-can_submit blocked, owners pass |
| ☐ | 18 | Storage: cross-agency probe returns nothing, buckets are private |
| ☐ | 19–20 | Admin can_check_tasks scope trigger: only that one column on member rows |
| ☐ | 21 | Workspace last-owner protection trigger |

**21 of 21 passing → comfortable to advance to Phase 3.4.**

If any fail: paste the failing test number + the actual output back, and I'll diagnose. Don't proceed to 3.4 with any failures.
