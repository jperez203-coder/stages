# Stages — migration progress log

A running log of what shipped in each session. Newest first.

---

## PLANNED — Pipeline templates (NOT YET BUILT) (2026-05-26)

**Status:** SCOPED, APPROVED, NOT BUILT. Picker mockup reviewed. Next chat picks up at slice 1.

Three capabilities: (A) agency saves a pipeline as a template, (B) two-step creation flow picks a template, (C) Stages ships built-in starter templates so day-one workspaces aren't empty.

### 🔒 LOCKED CONSTRAINT (must respect when building)

**Stage color = completion state per `src/lib/current-stage.ts`** (the file is LOCKED — never modify). Therefore:

- **Instantiated pipelines start ALL-GREY** — every stage is incomplete on creation, which renders grey per the state-color model. There is no other valid initial state.
- **Stage color is NEVER stored on `template_stages`** and NEVER copied to `stages.color` on instantiate. The instantiate RPC must not write anything that would short-circuit the state-color computation.
- The picker's stage pills MAY use a decorative position-index palette for visual variety in the modal — but that's UI-only sugar derived at render time, not a column on `template_stages` and not source-of-truth for any live pipeline.

This is a correction from my initial scope (I'd proposed preserving stage color on templates). The correct shape: template_stages has no color column; live stages start incomplete; current-stage.ts handles all visual color.

### Schema (3 new tables)

- **`templates`** — `id`, **nullable `workspace_id`** (NULL = built-in, NOT NULL = workspace-owned), `name`, `description` (optional prose for cards), `emoji`, `source_pipeline_id` (provenance, nullable), `created_by`, `created_at`. ON DELETE CASCADE from workspaces.
- **`template_stages`** — `id`, `template_id`, `position`, `name`, `description`, `client_visible`. **No color, no live state.** ON DELETE CASCADE from templates.
- **`template_tasks`** — `id`, `template_stage_id`, `position`, `title`/`text` (see unresolved item below), `description`/`note`, `client_visible`. **No `done`, no `deadline`, no `pos_x/pos_y`, no `assignee_id`, no `completed_*`.** ON DELETE CASCADE from template_stages.

### RLS (5 policies)

- **Saved templates: workspace-private.** SELECT requires `is_workspace_member(workspace_id)`. INSERT / UPDATE / DELETE require `is_workspace_owner_or_admin(workspace_id)` AND `workspace_id IS NOT NULL`.
- **Built-ins: read-only to everyone.** SELECT additionally allows `workspace_id IS NULL`. Write policies require `workspace_id IS NOT NULL`, so built-ins are uneditable/undeletable by any agency. Built-ins land via migration seed (running as migration role, RLS bypassed).
- `template_stages` and `template_tasks` policies join through to the parent template's visibility — same pattern as `channel_memberships` joining via `channels`.

### RPCs

- **NEW** `save_pipeline_as_template(source_pipeline_id, name, description?, emoji?)` — security definer, single transaction. Validates `can_edit_pipeline(source_pipeline_id)`, reads source's `workspace_id`, inserts template + template_stages + template_tasks. Strips all live state (done/deadline/pos/assignee/completed/timestamps).
- **EXTEND** `create_pipeline_with_channels(...workspace_id, name, emoji, company, template_id?)` — optional `template_id` at the end (default NULL → today's zero-stages behavior, preserves backward compat). When non-null, after the existing channel inserts, copy `template_stages` → `stages` (position, name, description, client_visible) and `template_tasks` → `tasks` (position, title, description, client_visible). Entire RPC stays in one transaction.

### "Blank Workspace" — eliminates from-scratch special case

One of the seeded built-ins. Has exactly one `template_stages` row ("Stage 1") and zero `template_tasks`. Every creation in the UI picks a template; there's no separate "Start from scratch" affordance. The RPC's NULL fallback stays for direct-PostgREST safety but the UI never sends NULL.

### UI (slice 4)

- **Existing route `/w/[slug]/p/new` becomes two-step**:
  - Step 1: today's form (name + emoji + company), button copy changes to "Next".
  - Step 2: **`TemplatePickerModal`** overlay — dark modal with backdrop, two sections ("Your templates" with bookmark icon, "Starter templates" with sparkle icon), single-pick selection, "Back" returns to step 1 with step-1 values preserved, "Create Pipeline" CTA enabled on selection.
- New **`TemplateCard`** component — emoji + name + description-or-auto-summary ("N stages · M tasks") + row of stage-name pills + "+N more" overflow. Reusable in case a future "manage templates" workspace settings surface wants the same card.
- Picker fetches templates with one query using PostgREST nested select: `templates` + `template_stages(...)` + `template_tasks(count)`. Sorted built-ins first (`workspace_id` ASC NULLS FIRST), then workspace-saved by recency.

### Built-in seeding mechanism

Migration with `INSERT INTO public.templates ... VALUES (null, ...)` + nested template_stages + template_tasks. Idempotent via `ON CONFLICT DO NOTHING` or a "skip if name already exists" guard. Founder provides GHL-agency content (Paid Ads Onboarding, Agency Project Workflow, Sales Pipeline, Blank Workspace per the mockup) — the migration is just a wrapper for the inserts.

### Slice order (each independently shippable + testable)

1. **Schema + RLS** — three tables, five policies. No UI, no data. Verifiable via SQL editor + the `scripts/test-client-upload-rls.mjs` harness pattern (write a parallel `test-templates-rls.mjs` that signs in as two agency accounts in different workspaces, confirms saved templates don't cross over, confirms built-ins are visible to both).
2. **Built-in seed migration** — depends on (1). Seeds Blank Workspace + the three GHL templates (or whatever founder provides). Verifiable: `SELECT count(*) FROM templates WHERE workspace_id IS NULL` returns expected count; both agency accounts see them; neither can DELETE.
3. **Save flow** — `save_pipeline_as_template` RPC + UI entry point. **Open design decision**: proposed a new overflow `...` menu on `PipelineHeader` (no overflow menu exists today, this would be its first item). Verifiable end-to-end: save a real pipeline, query template tables, confirm structure matches minus live data; other-workspace agency can't see the saved template.
4. **Picker UI + instantiate** — refactor `/w/[slug]/p/new` to two-step, add `TemplatePickerModal` + `TemplateCard`, extend `create_pipeline_with_channels` with `template_id`. Verifiable end-to-end: create from built-in → new pipeline has those stages/tasks (all grey, all incomplete); create from workspace-saved template → same; create from "Blank Workspace" → one empty stage; privacy: agency can't pass another workspace's template_id via direct RPC call.

### ⚠️ Unresolved before slice 1

**Verify the CURRENT column names on `public.tasks`.** The initial-schema migration (`20260508120000`) has `text` + `note`, but the TS type `TaskRaw` (in `src/app/w/(canvas)/[slug]/p/[pipeline-id]/page.tsx`) uses `title` + `description` — there was a rename migration I didn't trace. `template_tasks` columns MUST mirror whatever the live column names actually are. First action of slice 1 implementation: run `\d public.tasks` in the SQL editor (or read the latest tasks-touching migration), match the column names exactly. Same check for `public.stages` columns (`name`/`description` confirmed, but verify).

### Out of scope for v1 (intentionally deferred)

- Public / cross-workspace template library
- Template editing post-save (workaround: delete + re-save)
- Template version history
- Stage color preservation (explicitly disallowed by the locked constraint above)
- "Manage templates" workspace settings view (saved templates can be deleted via SQL or future UI; not blocking v1)

---

## Client portal — two-way complete (2026-05-26)

**Status:** SHIPPED. Portal now matches the agency surface for read + write: chat (read + post), canvas (view), files (view, preview, download, **upload, add link, delete-own**). Three commits across the file-write slices:

- **`89eafee`** — phase 4b-3-d: client file upload. Three RLS migrations land the defense-in-depth (policy WITH CHECK + BEFORE INSERT trigger + table-level CHECK binding `storage_path` to `pipeline_id`).
- **`21de234`** — phase 4b-3-e: client URL link adding. Relaxed the `kind='file'` lock; `client_visible=true` + `added_by=auth.uid()` enforcement preserved in both policy + trigger.
- **`4057521`** — UI reconciliation: `FileCard` Eye/Trash prop split (delete-own without granting visibility-toggle); `viewerProfile` threaded into `PortalFilesBody` for instant-name reconcile on freshly-uploaded rows; link cards get the existing favicon treatment via `FileCard`'s `kind='url'` dispatch.

All privacy verified by `scripts/test-client-upload-rls.mjs` (gitignored, real Casey + Agency JWTs via `signInWithPassword` + publishable key — no SQL-editor impersonation, no service-role bypass). **10/10 tests pass.** STOP-gates on tests 2/3/4 (cross-pipeline block, `client_visible` forge, `added_by` impersonation) and tests 9/10 (URL equivalents) all hold. Detailed per-slice entries below (4b-3-d, 4b-3-e).

---

## Dashboard cleanup (2026-05-26)

**Status:** SHIPPED across four commits.

- **`e841c9a`** — removed the "Team chat" empty-state strip. Workspace-team chat is deferred-not-built; the strip read as a broken promise on every dashboard load. Component kept on disk (`TeamChatStrip.tsx`); mount-site comment in `app/w/(workspace)/[slug]/page.tsx` documents the 3-step re-add recipe. Per-pipeline chat untouched.
- **`4d18f45`** — wired the previously-inert "Search by name or company…" header bar. New `HeaderSearch` component: client-side filter over the active workspace's pipelines (name + company), dropdown with arrow-key nav, ⌘K binding. No per-keystroke DB queries. Task / file / message search intentionally deferred.
- **`6dd0831`** — wired `member_joined` writer in `accept_client_invite` RPC. Mirrors the existing `auto_advance_stage` insert pattern. Brings the dashboard Activity feed from "queried but never written" to actually populating when a client accepts a portal invite. `pipeline_created` + `pipeline_submitted` writers deferred (Jordan-as-actor would be filtered for solo agencies).
- **`4941bfe`** — removed the "See all activity →" link (route never built, 404'd). Same posture as Team-strip removal: hide deferred surfaces instead of showing broken promises. Activity card's 5-most-recent feed unchanged.

---

## Performance wins (2026-05-26)

**Status:** Wins #1 + #2 SHIPPED. Win #3 deferred.

- **`6941891`** — **Win #1**: `loading.tsx` skeletons on all authed routes (workspace dashboard, canvas main + chat/files/clients tabs, portal). Shared `CanvasChromeSkeleton` for the canvas tabs. Purely additive; zero data/auth/RLS changes. Eliminates the "frozen on old page" feel during navigation.
- **`48c74ac`** — **Win #2**: hoisted the canvas gate + chrome + caller-profile + aggregate task counts into a shared `(canvas)/[slug]/p/[pipeline-id]/layout.tsx`. `React.cache`-wrapped helper (`src/lib/canvas-route-cache.ts`) so layout AND pages dedupe — defense-in-depth gate in BOTH layers (layout fires first; pages re-call for free via the cache). Tab switches now run only the tab-specific fetch, not the gate. `PipelineChromeShell` auto-derives `hideEditButton` via `usePathname`. **Prod-confirmed smooth.**
- **Win #3 deferred** — lazy-load `TaskDetailPanel` (1940 lines) + other modals via `next/dynamic`. Not needed; Wins #1 + #2 fixed the perceived-speed complaint.

---

## Client boundary cleanup — pure clients vs agency UI (2026-05-26)

**Status:** Tier A + B1 + C1 all SHIPPED.

- **`44fedef`** — **Tier A** (pure UI, no auth/routing change). AppShell derives `hasAnyAgencyContext` from `useUserContexts`. For pure clients (no agency contexts):
  - workspace switcher hidden (A1)
  - "← Back to portal" link rendered in its slot pointing to `/portal/<their pipelineId>` (A2)
  - "Create new workspace" dropdown item gated inside `HeaderWorkspaceSwitcher` as defense-in-depth (A3)
  - +Pipeline button gated explicitly
  
  Agency users' chrome is byte-for-byte identical when `hasAnyAgencyContext === true`.

- **`147ae34`** — **B1** (post-sign-in routing). `resolveDestination.urlForContext` branches on `ctx.type`: clients route to `/portal/<pipelineId>`, agency to `/w/<slug>` (unchanged). Exported + reused by the multi-context chooser (`WorkspaceSelector`) so the auto-route and chooser paths agree. Pure clients land directly on the portal instead of bouncing through `/w/<slug>` → `/` → legacy app.

- **`e3ed98a`** — **C1** (paywall integrity). Blocks pure clients from creating workspaces — clients gaining free agency functionality would undercut Solo/Team tiers. Three-case rule (locked):
  - `hasClient && !hasAgency` → **BLOCK** (pure client)
  - zero contexts → **ALLOW** (brand-new agency signup — must not break or onboarding breaks)
  - any agency context → **ALLOW** (adding more workspaces)
  
  Defense in depth: server-side page gate (`page.tsx` refactored to server component + extracted `CreateWorkspaceForm.tsx`) + RPC check inside `create_workspace_with_owner` (migration `20260605120000`). `blockedClientDestination` wrapper isolates the future "upgrade to paid agency" CTA swap (see Deferred entry below).

---

## Deferred / future work — parked notes (2026-05-26)

Not shipped this session; logged here so they don't get lost.

### Paid-agency upgrade CTA for blocked clients

C1 currently bounces a pure client trying to create a workspace back to their portal. Future swap once Stripe billing exists: redirect to an upsell page (`/upgrade/create-workspace` or similar) explaining the agency tier and offering checkout. **Single swap point**: the `blockedClientDestination` function in `src/app/onboarding/create-workspace/page.tsx`. Mirror swap in the RPC's error message (migration `20260605120000`).

### Name-on-invite — first / last name capture

Invite-accept flow doesn't capture a display name, so freshly-accepted users show as raw email in activity rows / uploader avatars / "Pending member" fallbacks. Fix: capture first + last name on `/accept-invite/[token]` and `/portal/accept/[token]`, write to `profiles.display_name` in the same transaction as the membership insert.

### Pre-launch hardening list

- **Automated RLS test suite.** Pattern already exists (`scripts/test-client-upload-rls.mjs`). Extend to cover every table's policies, not just `pipeline_links` + storage. Run in CI before deploys.
- **Auth bugs.** Forgot-password 404 (reset page missing). Magic-link redirects to prod `app.trystages.com` instead of current origin. Localhost doesn't consume `#access_token=` hashes from pasted URLs. All three documented in the header comment of `scripts/set-test-password.mjs`.
- **Agency-route guard sweep.** Every `/w/<slug>/*` route should require `workspace_memberships` OR an agency-role `pipeline_memberships` row. Most do via per-route gates (canvas tabs hoisted to layout in Win #2); sweep for any that miss.
- **Turbopack dev-cache crashes.** Recurring "ENOENT on build-manifest.json" after interrupted SST writes — current workaround is `turbopackFileSystemCacheForDev: false` in `next.config.ts`. Revisit when Next.js hardens the SST format (likely 16.3 / 16.4).
- **Prod redirect-loop / blank-render on stale session.** Reported intermittently; reproduce + fix before launch.

### Minor / cosmetic

- Hide the empty `HeaderSearch` bar on client `/settings/account` (currently renders but has no active workspace to search).
- **Orphan test data to purge before launch**:
  - Casey's "Acme client test" workspace (created during C1 bug investigation)
  - `brandnew-c1-test` test account (if it persists after C1 verification)
  - ~7 test files in the `pipeline_files` bucket from privacy-harness runs (privacy-safe — no joined `pipeline_links` rows — but bucket bloat). Janitor pass.

---

## Phase 4b-3-e — client portal: add LINK affordance (2026-05-25)

**Status:** SHIPPED. One relaxation migration applied via Supabase SQL editor; full 10-test privacy harness green (including three new URL-specific tests) BEFORE any UI code. UI then added to PortalFilesBody by re-importing the shared AddLinkModal and forking handleAddLink off the agency surface.

### Migration

```
supabase/migrations/20260603120000_client_url_insert_relaxation.sql
```

Surgical relaxation of two layers from the 4b-3-d defenses:

- **`pipeline_links_insert` policy** — dropped the `and kind = 'file'` clause from the client OR-branch. Client branch now: `is_pipeline_client(pipeline_id) AND added_by = auth.uid() AND client_visible = true`. Agency branch byte-for-byte unchanged.
- **`enforce_client_pipeline_link_insert_scope` trigger** — dropped the `kind != 'file'` raise. Trigger body now only enforces `client_visible = true` and `added_by = auth.uid()`. Defense-in-depth on those two rules is fully preserved (each appears in BOTH the policy WITH CHECK AND the trigger body).

Untouched: `pipeline_links_kind_payload` (table-level shape CHECK), `pipeline_links_storage_path_matches_pipeline` (URL rows have `storage_path = null`, hit the IS NULL branch of the CHECK trivially), `pipeline_links_update` (clients still can't edit), `pipeline_links_delete` (clients still delete-own only), storage policies (URL rows never touch storage).

### Privacy harness — 10/10 green

Tests 1–7 from 4b-3-d all stayed green (no collateral damage from the relaxation). Three new tests added:

- **Test 8** — Casey CAN insert kind='url' to Pipeline A; agency sees it. PASS (201, agency SELECT returns row).
- **Test 9** — Casey CANNOT insert kind='url' to Pipeline B. PASS (42501, `is_pipeline_client` still gates).
- **Test 10** — Casey CANNOT forge `client_visible=false` on a URL row. PASS (P0001 trigger exception — kind-agnostic enforcement intact).

All three new tests run as real Casey JWT via `scripts/test-client-upload-rls.mjs` (gitignored).

### Files (UI)

```
modified:  src/components/portal/v2/PortalFilesBody.tsx   (re-imported AddLinkModal + LinkIcon; added showAddLink state, handleAddLink callback, "Add link" header button, AddLinkModal mount; header comment updated to reflect 4b-3-e)
modified:  PROGRESS.md                                    (this entry; tech-debt note appended to the 4b-3-d entry below)
```

### Tech debt logged — `handleAddLink` fork (alongside `uploadFile` fork)

`PortalFilesBody.handleAddLink` is a FORK of `FilesBody.handleAddLink` (agency, `src/app/w/(canvas)/[slug]/p/[pipeline-id]/files/FilesBody.tsx`). Differences from agency:

1. `client_visible: true` hardcoded (agency uses `false` — the policy+trigger reject `false` from a client).
2. `added_by: viewerId` is also hardcoded (agency uses the same prop, but the semantic meaning shifts — client side enables delete-own).

`AddLinkModal` itself is SHARED (`src/components/files/AddLinkModal.tsx`) — only the save callback was forked. URL normalization (https:// prefix on bare domains) is inside the modal, so both surfaces get it.

**Refactor trigger** (extended from the 4b-3-d note): if either upload-helper OR add-link-helper acquires a non-trivial bug, extract `useAddLink(pipelineId, { forceClientVisible })` + `useFileUpload(pipelineId, { forceClientVisible })` as shared hooks and consolidate. Until then, duplication is the lesser risk vs. destabilizing prod-verified agency code.

### Out of scope (deferred)

- URL validation beyond the existing `normalizeUrl` (no domain allowlist, no phishing-pattern detection, no click-through warning on the agency side). Founder accepted the social-engineering risk as analogous to email/chat-message links. v1.1 if a customer asks.
- Soft-delete + audit-log for client-added URL rows (same v1.1 deferral as file deletes).

### Verified by

- `npx tsc --noEmit` — clean
- `npm run build` — green, all 15 routes
- 10/10 privacy harness — green

---

## Phase 4b-3-d — client portal file upload (2026-05-25)

**Status:** SHIPPED. Two migrations applied via Supabase SQL editor, full privacy harness (Tests 1–7) green against real Casey/Agency JWTs before any UI code. UI then forked from the agency upload helper into `PortalFilesBody` per "fork, don't refactor" directive.

### Migrations (applied in order)

```
supabase/migrations/20260601120000_client_file_upload_rls.sql
supabase/migrations/20260602120000_pipeline_links_storage_path_binding.sql
```

1. **`20260601120000`** — extended `pipeline_links_insert` and `pipeline_files_storage_insert` policies with a client OR-branch, plus a BEFORE INSERT trigger `enforce_client_pipeline_link_insert_scope` that re-enforces the same three rules (kind='file', client_visible=true, added_by=auth.uid()). Defense-in-depth: policy WITH CHECK is layer 1, trigger is layer 2. Matches the existing `enforce_client_task_update_scope` pattern. **Do not remove either layer in a future cleanup pass.**
2. **`20260602120000`** — hotfix CHECK constraint `pipeline_links_storage_path_matches_pipeline` binding `storage_path` to `pipeline_id` at the table level (`storage_path IS NULL OR storage_path LIKE pipeline_id::text || '/%'`). Closes the path-spoof gap Test 7 exposed: prior policies validated `pipeline_id`, `kind`, `client_visible`, `added_by` but not that `storage_path` was scoped to its own `pipeline_id`. The CHECK is independent of any policy/trigger so no future RLS change can bypass it.

### Privacy harness — all 7 tests green

Real JWTs via `signInWithPassword` (publishable key, never service-role), executed by `scripts/test-client-upload-rls.mjs` (gitignored). STOP-gates on Tests 2/3/4 all blocked; Test 7 PASS after the hotfix CHECK landed (rejects with `23514 / check_violation` naming the constraint). See conversation log for verbatim output.

### Files (this slice — UI)

```
modified:  src/components/files/FileCard.tsx                       (+~10 lines — added optional canToggleVisibility prop; eye gate split from canEdit/trash gate, defaults to canEdit to preserve agency behavior with zero call-site change)
modified:  src/components/portal/v2/PortalFilesBody.tsx            (forked from agency FilesBody.tsx upload helper — Upload button, hidden file input, drag-and-drop, optimistic-then-reconcile, delete-own, inline DeleteConfirm; ~520 lines total)
modified:  src/app/portal/[pipeline-id]/files/page.tsx             (passes initialFiles + viewerId + pipelineId to PortalFilesBody)
modified:  PROGRESS.md                                             (this entry)
```

### Eye/Trash gate split — the (3) clarification

Pre-this-slice, FileCard's `canEdit` boolean gated both the Eye (visibility toggle) AND the Trash buttons. To grant Casey delete-own without granting visibility-toggle, the props split into two: `canEdit` (Trash gate, unchanged semantics) and a new optional `canToggleVisibility?: boolean` (Eye gate). When omitted, falls back to `canEdit` — agency caller doesn't pass it and behaves identically. Portal passes `canToggleVisibility={false}` explicitly, so the Eye stays hidden even on Casey's own rows where `canEdit=true`.

UI mirror of RLS: `pipeline_links_update` policy still requires `can_edit_pipeline`, so a client clicking the Eye would no-op anyway. Hiding the affordance prevents the confusing "I clicked it but nothing happened" UX.

### Tech debt logged — upload helper duplication

`PortalFilesBody.uploadFile` is a FORK of `FilesBody.uploadFile` (agency surface, src/app/w/(canvas)/[slug]/p/[pipeline-id]/files/FilesBody.tsx). Three differences:

1. `client_visible: true` on both the optimistic row and the INSERT body (agency uses `false` — clients can't anyway per the trigger).
2. `added_by: viewerId` represents the client uploader (agency uses the same prop name but the semantic meaning shifts — client side is delete-own's key).
3. No `canEditPipeline` gate on Upload/drag-drop (the surface is client-only and clients always have the affordance here).

Drag-and-drop handlers (`handleDragEnter/Leave/Over/Drop` + `dragCounterRef`) and the inline `DeleteConfirm` sub-component are also duplicated.

**Refactor trigger**: if either upload path acquires a non-trivial bug, that's the moment to extract `useFileUpload(pipelineId, { forceClientVisible })` as a shared hook and consolidate. Until then, duplication is the lesser risk vs. destabilizing prod-verified agency upload. Per 2026-05-25 founder directive: "Ship client upload without touching the working agency path."

### Out of scope (deferred)

- Soft-delete + audit-log for client uploads — currently a client-uploaded-then-deleted file leaves no trace. If a customer asks for "show me what client X previously shared and removed," that's a v1.1 feature requiring a tombstone table + delete trigger.
- Realtime subscription for portal Files list — agency uploads still require a portal page reload for the client to see them. Matches the 4b-3-c read-only baseline.
- Per-task attachments — separate slice, also v1.1.
- Storage-bucket janitor for orphan bytes (accumulate one per agency or client metadata-delete, see headers in both Body files for the trade-off rationale).

### Verified by

- `npx tsc --noEmit` — clean
- `npm run build` — green, 15 routes
- Privacy harness 7/7 — green (script gitignored)

---

## Phase 4a — step 6: task detail side panel (2026-05-22)

**Status:** COMPLETE. Shipped in [`09b66db`](https://github.com/) — "step 6: task detail side panel + profiles RLS fix for pipeline-only member names". Live on prod, verified hands-on. Canvas surface is now feature-complete for the validation-MVP (5a → 5e → 6, all shipped).

**Goal:** the canvas's normal-mode task click — stubbed `console.log` since 5c — opens a real Notion-style side panel for the task. Read + edit deadline, assignee, description, checklist, client_visible; surface a +Add sibling task affordance and a delete-task confirm. EDIT mode's inline-rename behavior is preserved (edit-mode click still flips title to inline rename, unchanged).

### Files (this commit)

```
new file:  src/components/canvas/TaskDetailPanel.tsx                (~1940 lines — the entire panel)
modified:  src/components/canvas/PipelineCanvas.tsx                 (+262 lines — openTaskId state, mutation callbacks, panel mount)
modified:  src/app/w/(canvas)/[slug]/p/[pipeline-id]/page.tsx       (+39 lines — TaskRaw extended with description/deadline/client_visible/created_at; SELECT extended; pipelineName threaded)
new file:  supabase/migrations/20260524120000_profiles_select_workspace_owner_pipeline_members.sql  (the RLS fix — see below)
modified:  PROGRESS.md
```

### Open / close behavior

| Trigger | Result |
| --- | --- |
| Click task title in NORMAL mode | Opens panel (slide-in from right, ~220ms cubic-bezier, dim overlay on canvas behind) |
| Click task title in EDIT mode | UNCHANGED — flips to inline rename (the 5e behavior) |
| Click X / Esc / overlay | Closes panel; canvas already reflects pending edits (no flash) |
| Task gets deleted by callback | Panel closes defensively (`openTaskId` cleared) |

No round-trip on open. The panel reads task + stage straight from `PipelineCanvas`'s already-loaded `tasksState` / `stagesState`. The page fetch now selects the panel-only fields upfront (`description`, `deadline`, `client_visible`, `created_at`) — the canvas itself doesn't render them, but loading once means the panel renders synchronously from the same `TaskRaw` shape both surfaces share. Mutations from the panel are optimistic-with-revert callbacks that PipelineCanvas owns; closing the panel reveals a canvas already showing the edits.

### Fields shipped

| Field | Edit gate (mirrors RLS) | Notes |
| --- | --- | --- |
| Breadcrumb | — (read-only) | `<pipeline name> › <stage name>` at panel top; pipeline name threaded down from chrome |
| Title | `canEditPipeline || assignee === currentUserId` | Inline edit (click flips to input). Enter submits, Esc cancels. Same contract as the 5e inline-rename pattern. |
| Done checkbox | `canEditPipeline || assignee === currentUserId` | Reuses the 5c `toggleTaskDone` callback. |
| Description | `canEditPipeline || assignee === currentUserId` | Inline editor — click flips to textarea. Enter commits; Shift+Enter inserts newline; Esc cancels; blur commits. Trim-empty → `null` so an empty string never lands in DB. |
| Assignee picker | `canEditPipeline` only | Custom popover (built inline, not a shared component). Lists ASSIGNABLE members — `members.filter(m => m.role !== "client")` — clients can't be assigned. Renders via `resolveDisplayName(m)` (display_name → email-prefix → "Pending member"). Single-select. Unassign row at top. |
| Deadline | `canEditPipeline || assignee === currentUserId` | Reuses the existing `DatePickerPopover` from My Tasks. |
| Client-visible toggle | `canEditPipeline` only (members see read-only "Visible to client" line if `client_visible=true`) | Direct UPDATE; gated by RLS. |
| Checklist (add / toggle / delete) | `canEditPipeline` only | Backed by `checklist_items` table. Members don't get edit access on checklist — matches `checklist_items` RLS scope (the assignee-tighten policy covers `tasks`, not `checklist_items`). |
| Stage notes | — (read-only pointer) | A "Stage" section shows stage name + position with the italic line *"Stage notes are edited in pipeline edit mode."* It's a context pointer, NOT a stage-notes editor. |
| Attachments | — | STUBBED. Reserved layout + placeholder copy; the files step (4b) ships real upload UX. |
| +Add sibling task | `canEditPipeline` only | Reuses the existing canvas `addTask` callback (→ `create_task` RPC). |
| Delete task | `canEditPipeline` only | Confirm dialog matches the 5e delete-stage pattern — `panel-card` modal, red `#F43F5E` confirm. |

### Checklist delete-affordance bug — fixed mid-session

Pre-fix: the X button on a checklist row only appeared on **button-hover**, not row-hover. Mouse-arriving anywhere over the row but not directly over (the not-yet-visible) X would never reveal it — the user had to know its exact position. Fix: moved the show/hide to a CSS group-hover pattern at the row level (`.checklist-row:hover .checklist-delete { opacity: 1 }`). Now hovering anywhere on the row reveals the delete affordance. One-line CSS-state change, no behavior change to confirm flow.

### Backend underpinnings (already shipped — step 6 consumes them)

| Piece | Where it shipped | Role in step 6 |
| --- | --- | --- |
| 4 edit-pipeline RPCs (`create_stage`, `reorder_stages`, `reorder_tasks_in_stage`, `move_task`) | [`6fb4cb2`](https://github.com/) — "step 5e backend" | Reused by the panel's +Add sibling task (via the existing `create_task` path; stage-level RPCs don't fire from the panel itself, only from the canvas in edit mode) |
| `create_task` RPC + `tasks_update` policy + `set_task_completion_metadata` trigger | shipped pre-5c | Underlie the panel's title/description/deadline/assignee/done writes |
| `enforce_member_task_update_scope` trigger | [`7f056b1`](https://github.com/) — "step 6 backend: enforce_member_task_update_scope + sync 5c tighten policy" | Defense-in-depth: REJECTS member updates to forbidden columns (client_visible, assignee_id, stage_id, etc.) — the panel's UI gates mirror this, and the trigger is the server-side backstop. **NOT verified by an executed test yet — see open items.** |
| Profiles RLS fix (this commit) | `20260524120000_profiles_select_workspace_owner_pipeline_members.sql` | Lets workspace owners/admins read profiles of pipeline-only members in their workspace's pipelines (see below) |

All backend pieces confirmed live in prod.

### Profiles RLS fix — sub-fix in the same commit

The assignee picker (and silently, the header member popover) was rendering pipeline-only members as **"Pending member"** instead of their actual `display_name` for Jordan-as-workspace-owner views. The data path itself was correct (single `chrome.members` array, same fetch, same prop down to both surfaces) — the bug was server-side: the existing `profiles_select` policy had three branches (self / shared workspace_memberships / shared pipeline_memberships) and a workspace owner who does NOT have a pipeline_memberships row in a given pipeline could not satisfy any of them for a user who was invited **at the pipeline level only** (no workspace_memberships row of their own). The `.in("id", userIds)` query in `fetchCanvasChromeData` silently returned 0 rows for those ids — both `display_name` and `email` came through null on the `ChromeMember.user` object, and the panel + popover both fell to the final "Pending member" fallback.

Fix: new migration `20260524120000_profiles_select_workspace_owner_pipeline_members.sql` adds a 4th branch to `profiles_select`:

```sql
or exists (
  select 1
  from public.workspace_memberships my
  join public.pipelines p on p.workspace_id = my.workspace_id
  join public.pipeline_memberships pm on pm.pipeline_id = p.id
  where my.user_id = (select auth.uid())
    and my.role in ('owner', 'admin')
    and pm.user_id = public.profiles.id
)
```

Verified live + in repo, in sync. The same fix repairs both the picker AND the header member popover (same data path). Doesn't widen client visibility — clients have no `workspace_memberships` row so the new branch never fires for them.

**Forever-lesson for future RLS work:** when adding a new "X can see Y across A→B→C" capability, list every existing surface that fetches Y filtered by RLS — not just the surface you're building. The popover-vs-picker split here is a case where the bug was already silently in production via the header popover; the picker just made it visible because it lists members with explicit name + role rows side-by-side. The bug-find pattern (popover symptom invisible because pipeline-only members fall below the 3-avatar cluster fold) is a model for "don't trust 'looks fine over there' as evidence — verify the same data path on the surface you're not currently looking at."

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | ✓ clean |
| `npx next build` | ✓ green |
| Hands-on (Jordan, prod) | ✓ panel opens on normal-mode click, all field edits round-trip, +Add sibling lands in canvas, delete confirm fires, EDIT-mode click still does inline rename (unchanged), assignee picker now renders "Taylor Teammate" + "Alex Agency" with proper avatars (was "Pending member" pre-RLS-fix) |
| Profiles RLS verification SELECT (impersonating Jordan via `set local request.jwt.claims`) | ✓ returns Taylor + Alex + Jordan rows (3 rows). Pre-migration returned 1 row (Jordan only). |

### Open items logged during step 6 (DO NOT lose these)

These items surfaced during step-6 testing but are intentionally OUT of step-6 scope. Each is a real follow-up that must be addressed; recording here so a future session can find them.

1. **LAUNCH-BLOCKER — no executed test proves `enforce_member_task_update_scope` actually fires.** Code reviewed and looks correct by inspection, but SQL-editor impersonation (`set local request.jwt.claims`) was a no-op: RLS filtered the row BEFORE the trigger ran, so `Success, 0 rows` proves nothing. Need a real automated test where `auth.uid()` resolves correctly (pgTAP OR a transaction with proper authenticated context — `tests.authenticate_as(uuid)` if Supabase's pgTAP helpers are installed) asserting all three: (a) member updating a forbidden column on their own task is REJECTED with `SQLSTATE 42501` from the trigger; (b) member updating title/description/deadline/done on their own task SUCCEEDS; (c) owner updating any column SUCCEEDS. Must be in repo + runnable in CI. **Do not ship to real users without this passing.** Logged as a spawned background task.
2. **BUG (not step-6) — canvas page guard is stricter than RLS.** `src/app/w/(canvas)/[slug]/p/[pipeline-id]/page.tsx` (around lines 81–97) requires the caller to have a `workspace_memberships` row to access the canvas. A user who is a pipeline-only agency member (no workspace_memberships row, only `pipeline_memberships.role in ('admin','member')`) gets redirected away from their own pipeline despite RLS being willing to let them read it. Fix: extend the guard to also accept users with a `pipeline_memberships` row in the target pipeline.
3. **BUG (auth, three sub-points) — blocks logging into password-less test accounts locally.** (a) "Forgot password?" link on /auth/signin leads to a 404 — reset page missing or link href wrong. (b) Supabase magic link redirects to prod `app.trystages.com` instead of localhost during local dev — Site URL / redirect allowlist needs `http://localhost:3000` and `http://localhost:3000/**` added in Supabase Dashboard → Authentication → URL Configuration → Redirect URLs. (c) When the access_token hash IS placed on `localhost:3000/#access_token=...`, the local signin page does not consume it / establish a session — the hash-token handler may be missing on the signin route (likely `detectSessionInUrl` not reaching a browser client, or the email template pointing at `/auth/signin` instead of `/auth/callback`). Logged as a spawned background task.
4. **WISHLIST — per-task notes (`tasks.note` column) not surfaced in the panel.** Intentionally deferred per `WISHLIST.md` ("task notes are a single text field; build threaded UI only on real customer signal"). Column exists in DB + is in the `enforce_member_task_update_scope` rejected-columns list for members, but the panel does not fetch, render, or edit it. Check `WISHLIST.md` before adding it.
5. **Workspace ADMINs treated as second-class by `can_edit_pipeline` + the trigger.** Pre-existing gap also flagged in the 5d entry: workspace admins do NOT currently inherit `canEditPipeline` (the helper only checks workspace_owner OR pipeline owner/admin). Same gap means admins likely fall to the member branch in the new trigger. Confirm intended vs bug before launch.

### Validation-MVP build-order status

| Stage | Status |
| --- | --- |
| Canvas (5a → 5e) | ✓ DONE |
| Step 6 — task detail side panel | ✓ DONE (this commit) |
| **NEXT** — per-pipeline chat (4b channels + messages surface) | pending |
| Client portal "view as client" (4c) | pending |
| File sharing (pipeline files + stage attachments) | pending |

---

## Phase 4a — step 5e (UI): edit-pipeline mode (2026-05-22)

**Goal:** the canvas's "Edit pipeline" button — stubbed `console.log` in 5d — becomes a real edit mode. Toggle into edit mode, add / rename / reorder / delete stages, drag tasks between stages, drag-reorder tasks within a stage, inline-rename task titles. Per the locked spec, everything reuses `stageStateFromCounts` from `src/lib/current-stage.ts` so the canvas re-derives live as the user mutates structure (colors recompute, connectors reflow, anchor stage updates).

**Pairs with [5e backend](#phase-4a--step-5e-backend-edit-pipeline-rpcs-2026-05-22):** the 4 RPCs (`create_stage`, `reorder_stages`, `reorder_tasks_in_stage`, `move_task`) cover stage add / reorder / task move / task reorder. Stage rename + delete are direct `UPDATE` / `DELETE` under existing RLS (tasks cascade via `tasks_stage_id_fkey ON DELETE CASCADE`). Task rename is a direct `UPDATE`. So the UI surface is 4 RPC calls + 3 direct mutations = 7 mutation paths total.

### EditModeContext — the shared toggle

New `src/components/chrome/EditModeContext.tsx`. The toggle button lives in `PipelineHeader`; the visual treatment + drag affordances live in `PipelineCanvas`; both need to read the same `editMode` boolean. `PipelineChromeShell` is the natural shared parent — it wraps both — but `children` are passed pre-rendered from the server page, so prop-drilling isn't an option. A context provider mounted at the shell threads `editMode` through both sides.

```tsx
PipelineChromeShell
  └── EditModeProvider (editMode + canEditPipeline)
       ├── PipelineHeader → reads editMode + canEditPipeline → renders toggle
       └── {children} → PipelineCanvas → reads editMode → applies treatment
```

`editMode` is per-page-mount: navigating to `/clients` (sibling in the canvas route group) creates a fresh shell + provider so edit mode resets to false on navigation. Intentional — edit mode belongs to the canvas surface, not the user session. The `hideEditButton` prop on `PipelineChromeShell` (added in 5e) hides the toggle entirely on `/clients`.

### Header toggle treatment

| State | Label | Icon | BG | Border | FG |
| --- | --- | --- | --- | --- | --- |
| Idle (canEditPipeline only) | "Edit pipeline" | `Pencil` | `rgba(255,255,255,0.06)` | `#36363A` | `rgba(255,255,255,0.85)` |
| Active (editMode on) | "Done editing" | `Check` | `rgba(16,140,233,0.18)` | `#108CE9` | `#108CE9` |

`#108CE9` is `stages-blue` from the locked design tokens — same accent used on the canvas top-border, so the chrome + canvas signals agree.

### Canvas edit-mode signals

| Signal | Implementation |
| --- | --- |
| Thin blue top-border on canvas | `borderTop` toggles between `2px solid #108CE9` and `2px solid transparent` (transparent in normal mode keeps layout stable across toggle). |
| Zoom snap to 1.0 on entry | `useEffect` on `[editMode]` calls `transformRef.current.zoomToElement(anchorStageId, 1, 280, "easeOut")` (or `centerView(1, 280)` when there are no stages). Snap is on rising edge only; on exit we don't restore prior zoom (intentional — user just re-zooms if they want). |
| Zoom controls hidden | `{!editMode && <ZoomControls />}` — locked spec says hide, not disable; user can still Cmd/Ctrl-wheel if they really want, just no buttons. |

### Mutation callbacks (7 paths, all optimistic-with-revert)

| Callback | RPC / Direct | Optimism |
| --- | --- | --- |
| `addStage(name, afterStageId)` | `create_stage` RPC | Append result to local state; for insert-between, also shift sibling positions locally to mirror the RPC's server-side shift |
| `renameStage(stageId, name)` | direct UPDATE `stages.name` | Patch the row in local state; capture pre-rename name; revert on RPC error |
| `deleteStage(stageId)` | direct DELETE `stages` (tasks cascade) | Remove stage + all its tasks from local state in one update; capture both for revert if RPC fails |
| `reorderStages(orderedIds)` | `reorder_stages` RPC | Snapshot stagesState; rewrite all positions by array index; restore snapshot on error |
| `renameTask(taskId, title)` | direct UPDATE `tasks.title` | Patch task title in local state; revert on RPC error |
| `moveTask(taskId, targetStageId, targetPosition)` | `move_task` RPC | Snapshot tasksState; compute clamped position + apply shift identical to the RPC's logic (within-stage `[1,count]`, cross-stage `[1,count+1]`) so the optimistic view matches the server view; restore snapshot on error |
| `reorderTasksInStage(stageId, orderedIds)` | `reorder_tasks_in_stage` RPC | Snapshot tasksState; rewrite positions in target stage by array index; restore on error |

All revert handlers `console.error` the RPC error message — same pattern as the 5c `toggleTaskDone` callback. No toast surface yet; future enhancement when we add a global notification system (see 4b chat notifications).

### Live re-derivation (reuses 5c — does NOT re-implement)

Every mutation lands in `stagesState` or `tasksState` (or both, for `deleteStage`). The existing `useMemo` at `PipelineCanvas.tsx` re-runs on those state changes — `stageStateFromCounts` re-classifies each stage from its updated task counts; `pickAnchorStage` picks a new anchor; `layout.positions` + `bbox` recompute; connectors redraw from the new positions; per-stage colors update. No new derivation code — the 5c rule (per-stage independent state, multiple in-progress OK) carries straight through.

The one new piece is `stagesState` itself — pre-5e the `stages` prop was used directly (server-fetched, no mutations during the session). 5e introduces structural stage mutations, so `stagesState` mirrors the existing `tasksState` pattern: prop seeds initial state, all mutations land in `setStagesState`, no `useEffect` to re-sync from props (route remount handles cross-pipeline navigation).

### dnd-kit drag (three sortable layers, one DndContext)

Fresh dependencies: `@dnd-kit/{core, sortable, utilities}`. Architecture:

```
<DndContext sensors={[PointerSensor({distance: 8})]} collisionDetection={closestCenter} autoScroll={false}>
  <SortableContext items={stageIds} strategy={horizontalListSortingStrategy}>
    {stages.map(s =>
      <StageNode>
        useSortable({id: s.id, data: {type: 'stage'}, disabled: !editMode || !canEditPipeline})
        <SortableContext items={taskIdsInThisStage} strategy={verticalListSortingStrategy}>
          {tasks.map(t =>
            <TaskRow>
              useSortable({id: t.id, data: {type: 'task', stageId: s.id}, disabled: !editMode || !canEditPipeline})
            </TaskRow>
          )}
        </SortableContext>
      </StageNode>
    )}
  </SortableContext>
  <DragOverlay dropAnimation={null}>
    {activeStageDragId ? <StageDragGhost stage={...} /> : null}
  </DragOverlay>
</DndContext>
```

Three things to call out:

1. **8px activation distance** is THE critical config — without it, click vs drag is ambiguous. With it: a click on a stage name (or a task title in edit mode) within 8px opens inline rename; a drag past 8px starts dnd-kit's tracking. Same threshold means click-affordances work alongside whole-element drag handles on the same DOM nodes.
2. **`onDragEnd` discriminates by `active.data.type`.** `'stage'` → `reorder_stages` with `arrayMove` over the full ordered id list. `'task'` → either `reorder_tasks_in_stage` (same source/target stage) or `move_task` (cross-stage). Target position derives from the over item: a task's `position` if `over.data.type === 'task'`, else append-to-end (`count+1` cross-stage, `count` same-stage clamp).
3. **`autoScroll: false`** is required — the react-zoom-pan-pinch surface isn't a scroll container, so dnd-kit's edge-scroll detection would jitter at the canvas edges trying to scroll a non-scrollable parent.

### DragOverlay perf fix (the post-Jordan-test polish)

Jordan's hands-on first pass surfaced one stutter: dragging a stage horizontally to reorder felt laggy. Task drag was fine; stage drag wasn't. Diagnosis ruled out the obvious-looking suspects (the `useMemo` re-derive doesn't run mid-drag — the deps are stable until `dragEnd`; the SVG connectors render from `layout.positions` which doesn't update either). Real cause:

> The dragged `StageNode` subtree (badge + box + SVG with one path per task + per-stage `SortableContext` + N × `TaskRow`, each carrying its own `useSortable` subscription) re-rendered on every pointer-move frame as the wrapper's `transform` from `useSortable` updated. For a stage with 5–10 tasks that's 60–120 component renders/sec just to slide one stage.

Standard dnd-kit pattern for heavy items: `DragOverlay`. The source becomes an `opacity: 0` placeholder (layout slot preserved); a lightweight `StageDragGhost` (badge + box only — no SVG, no task list, no hooks beyond what `DragOverlay` injects) renders inside the overlay portal and follows the pointer via direct DOM transform mutations. React re-render cost during drag drops from "everything in the subtree, every frame" to "nothing — the overlay is one element repositioned by dnd-kit."

Two smaller tweaks went in alongside:
- `useSortable` `transition` overridden to `{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }` — the non-dragged stages snap into the new slot more decisively than dnd-kit's default 250ms ease.
- `dropAnimation={null}` on `DragOverlay` — we already snap the source to its new position via the post-`onDragEnd` optimistic state update, so the overlay's default "fly back to source rect" animation would just flash.

Task drag did NOT get an overlay — `TaskRow` is light enough that the per-frame re-render is imperceptible. Avoiding overlay-for-everything cuts the polish diff in half and skips an extra failure surface.

### Inline rename pattern (stages + tasks, identical contract)

Single component-local state machine:
- `isRenaming: boolean` + `pendingText: string` + `inputRef`
- `startRename()`: only fires if `editMode && canEditPipeline` (stages) or `editMode` (tasks); sets `pendingText` from current, sets `isRenaming = true`, focuses + selects the input on next tick.
- `submit()`: trims; bails if empty OR unchanged; otherwise calls parent mutation callback + sets `isRenaming = false`.
- `cancel()`: drops the pending text, sets `isRenaming = false`.
- Input handlers: `Enter` → submit, `Escape` → cancel, `onBlur` → submit (which itself bails on unchanged).
- `useEffect` on `[editMode]` — when edit mode globally toggles off mid-rename, force-exit `isRenaming` and reset `pendingText` (avoids carrying an in-flight edit across mode cycles).

`pendingText` is `string`, not `string | null` — keeps the input controlled even when collapsed. Re-seeding on `startRename` is cheap.

### Delete confirm dialog (single instance at canvas level)

`pendingDeleteId` state lives in `PipelineCanvas`. Stage's trash button calls `requestDeleteStage(stageId)` which just sets the id. The dialog component reads the live name + task count from current state on every render (so if a task moves IN during the confirmation pause, the count updates). Confirm button calls `confirmDeleteStage` which calls `deleteStage` (optimistic). Cancel + backdrop click + Escape (via dialog's native focus trap) all dismiss.

N-aware copy per the locked spec:
- N ≥ 1: `"This will delete '<name>' and its N tasks. This can't be undone."` (proper "task" / "tasks" pluralization)
- N = 0: `"Delete '<name>'? This can't be undone."`

Visual: matches the existing modal pattern from `NewWorkspaceModal` / `CreateChannelModal` — `panel-card` utility, `backdrop-filter: blur(4px)`, red `#F43F5E` confirm button.

### pan-disabled class + stopPropagation (the drag/pan coexistence story)

Two layers of competing pointer handling: react-zoom-pan-pinch's `panning.allowLeftClickPan: true` on the canvas, and dnd-kit's `PointerSensor` on stages + tasks. Both want pointerdown.

Fix: `pan-disabled` class on every `StageNode` wrapper + `TaskRow` card + edit-mode affordance (`AddStageEndButton`, `InsertStageHandle`). The react-zoom-pan-pinch `panning.excluded` list checks classnames via `node.matches(".X, .X *")` — so any descendant of a `.pan-disabled` element won't start a pan. Click + drag on empty canvas still pans; click + drag on a stage or task is dnd-kit's only.

Closes a subtle pre-5e bug too: in normal mode you could start a pan from a stage's background area (the dotted-grid would pan around as if you clicked the canvas backdrop). Now stages + tasks consistently NEVER pan.

Plus `onPointerDown={(e) => e.stopPropagation()}` on the interactive surfaces inside a draggable parent — checkbox button, rename input, delete button, AddTaskRow expand button + input. Without it, clicking the checkbox in edit mode would start tracking a task drag; if pointer moved > 8px before release, drag activated and click was suppressed. With it, the parent's drag listener never receives the pointerdown — checkbox click is reliable.

### Files (this commit)

```
new file:  src/components/chrome/EditModeContext.tsx                (provider + useEditMode hook)
new file:  src/components/canvas/EditPipelineAffordances.tsx        (AddStageEndButton + InsertStageHandle + DeleteStageConfirmDialog)

modified:  src/components/chrome/PipelineChromeShell.tsx            (wraps in EditModeProvider; + hideEditButton prop)
modified:  src/components/chrome/PipelineHeader.tsx                 (EditPipelineToggleButton — "Edit pipeline" ↔ "Done editing", pencil ↔ check, #108CE9 accent)
modified:  src/app/w/(canvas)/[slug]/p/[pipeline-id]/clients/page.tsx  (passes hideEditButton)
modified:  src/components/canvas/PipelineCanvas.tsx                 (stagesState mirror; 7 mutation callbacks; DndContext + DragOverlay + sensors + onDragEnd; blue top-border; zoom snap; widened panning.excluded)
modified:  src/components/canvas/StageNode.tsx                      (inline rename input; trash button; useSortable; per-stage SortableContext for tasks; StageDragGhost export)
modified:  src/components/canvas/TaskRow.tsx                        (inline rename input; useSortable; canEditPipeline + stageId props)

modified:  package.json + package-lock.json                         (@dnd-kit/core ^6.3.1, @dnd-kit/sortable ^10.0.0, @dnd-kit/utilities ^3.2.2)
modified:  PROGRESS.md
```

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | ✓ clean |
| `npx next build` | ✓ green, 23 routes (same as 5d, no new dynamic routes) |
| Dev server smoke (anon) | ✓ canvas + /clients both 307 → /auth/signin (unchanged from 5d) |
| Jordan hands-on (vs figma) | ✓ all of: toggle on/off, blue accent + top-border, zoom snap, add stage at end + insert-between, inline rename stage, delete + confirm + cascade, drag-reorder stages (smooth after the DragOverlay polish round), cross-stage task move, within-stage task reorder, inline rename task, normal-mode click stays the step-6 stub, /clients button hidden, permission gate (member sees nothing) |

### Pre-existing launch-prep lint deferrals — updated count

5d's PROGRESS.md noted 5 React 19 `react-hooks/purity` errors (`Date.now()` in render in `recently-done`, `settings/team`, etc.). 5e adds 2 new families to the same deferred sweep:

| File | Rule | Reason |
| --- | --- | --- |
| `StageNode.tsx` + `TaskRow.tsx` (5 lint reports total) | `react-hooks/refs` | `useSortable().setNodeRef` + `.attributes` + `.listeners` are dnd-kit's callback ref + handler bags. React 19's `react-hooks/refs` rule flags any object-property access from a hook return that LOOKS ref-shaped — false positive for any drag-and-drop library following the dnd-kit pattern. Suppressed inline with `eslint-disable-next-line` comments where the JSX position accepted them; the remaining reports (`sortable.isDragging` access in the wrapper's `style` object) deferred since suppressing them would require restructuring the style computation. |
| `StageNode.tsx` + `TaskRow.tsx` (2 lint reports) | `react-hooks/set-state-in-effect` | The "force-exit rename when editMode toggles off" `useEffect` calls `setIsRenaming(false)`. The lint rule wants us to derive instead — but `effectiveIsRenaming = isRenaming && editMode` would carry stale `isRenaming = true` across edit-mode cycles and surprise-resume the rename on re-entry. Intentional setState-in-effect. Same family as the 5d-era `Date.now()` purity errors. |

All deferred to the future React 19 purity sweep. `next build` continues to ignore lint errors as before; runtime works fine.

### Canvas is now feature-complete (5a → 5e all shipped)

| Step | Surface |
| --- | --- |
| 5a | Pan/zoom shell + dotted grid |
| 5b | Stage rendering + state colors + connectors |
| 5c | Task cards + completion + per-stage state model |
| 5d | Chrome (PipelineHeader + LeftRail + MembersPopover; route-groups split into `(workspace)` and `(canvas)`) |
| 5e | Edit pipeline mode (this commit) |

What the canvas does NOT yet have:
- **Task detail side panel (step 6)** — normal-mode click still console.logs.
- **Per-pipeline chat / activity / files (4b)** — rail icons coming-soon.
- **Client portal "view as client" (4c)** — rail icon coming-soon.
- Workspace ADMIN inheriting `canEditPipeline` — pre-existing gap flagged in 5d; not blocking.

Step 6 comes next.

### Lessons learned (apply forever)

1. **For drag-and-drop on heavy items, reach for `DragOverlay` from the start — not after the user reports stutter.** The cost of NOT using overlay scales with the subtree size of the dragged item. The dragged item's `useSortable` returns a fresh `transform` per pointer-move frame, the wrapper re-renders, React reconciles the entire subtree. For N children each running their own hook subscription (per-stage `useSortable` on tasks, here), the per-frame work is multiplicative. `DragOverlay` makes the per-frame work O(1) — one DOM transform, no React work. Default to overlay for any draggable that wraps more than ~5 children.
2. **When diagnosing drag jank, rule out the wrong suspects fast.** Jordan listed 4 candidates; only #2 (heavy subtree re-render) was real. Suspects #3 (re-derive every frame) and #4 (connectors redrawing) are obvious-sounding but get ruled out by reading the `useMemo` deps — if they don't change during a drag, neither runs mid-drag. The pattern: trace the dep graph from the visible jank to the actual hot code path; don't assume the most architecturally suspicious-looking thing is to blame.
3. **`onPointerDown stopPropagation` is mandatory on every interactive descendant of a dnd-kit draggable parent.** Without it, clicking the inner widget could start tracking a drag on the outer parent — visible as either "checkbox click ignored" or "drag started by accident." The `activationConstraint: { distance: 8 }` masks this most of the time (small accidental moves don't activate), but a deliberate click + small drift (~10px) still races. Stop propagation at the inner pointerdown to remove the race entirely.
4. **Drag-and-drop in a transformed parent (canvas + zoom-pan plane) works out-of-the-box at scale 1.0.** dnd-kit measures source rects via `getBoundingClientRect`, which already accounts for parent transforms. At any zoom other than 1.0 the drag offsets would drift (dnd-kit translates in screen pixels, the plane translates in plane pixels), which is why 5e snaps zoom to 1.0 on edit-mode entry. If a future feature needs editing at non-1.0 zoom, dnd-kit's `modifiers` API can scale the delta — but for 5e the snap is sufficient.

---

## Phase 4a — step 5e (backend): edit-pipeline RPCs (2026-05-22)

**Goal:** ship the entire write surface for the edit-pipeline UI shipping in 5e UI (next commit). Four security-definer RPCs cover stage add / reorder, task move (cross-stage + within-stage), and task reorder within a stage. Stage rename + delete are NOT new RPCs — direct UPDATE / DELETE on `stages` under existing RLS (cascading via the existing `tasks_stage_id_fkey ON DELETE CASCADE`).

**Important context for future maintainers:** the 4 RPCs were applied to the live DB in a prior session that ended before the migration file + this PROGRESS note made it into the repo. This commit syncs the repo back to the DB — the SQL in the migration file is verbatim from `pg_get_functiondef` against the live functions, not a fresh authoring. If you ever wonder "did this migration ever run against the live DB" — the answer is yes, weeks before its commit timestamp.

### The 4 RPCs

| RPC | Returns | Behavior |
| --- | --- | --- |
| `create_stage(pipeline_id, name, after_stage_id default null)` | `json {id, pipeline_id, name, position}` | Appends when `after_stage_id` is null; inserts between when set (subsequent positions shift +1). Validates name (trim, non-empty, ≤80 chars) and that `after_stage_id` belongs to the same pipeline. |
| `reorder_stages(pipeline_id, ordered_stage_ids uuid[])` | `void` | Atomic rewrite of all stage positions in one query (`unnest … with ordinality`). REJECTS partial arrays — the array must contain ALL stages in the pipeline. |
| `reorder_tasks_in_stage(stage_id, ordered_task_ids uuid[])` | `void` | Same pattern, scoped to one stage. Must contain ALL tasks in the stage. |
| `move_task(task_id, target_stage_id, target_position)` | `json {id, stage_id, position}` | Handles BOTH cross-stage and within-stage moves. Clamps `target_position` inclusive-end: within-stage `[1, count]`, cross-stage `[1, count+1]`. Rejects moves across pipelines (defense-in-depth — RLS would block but the explicit check gives a clearer error). |

Each RPC:
- `security definer`, `search_path = ''` — caller-schema isolation (the canonical pattern from prior RPCs)
- gates on `auth.uid()` not null + `can_edit_pipeline(pipeline_id)` — mirrors the RLS rule used by direct UPDATE/DELETE for stage rename + delete, so the entire 5e write surface (RPC and direct) goes through ONE permission check
- bumps `pipelines.last_edited_at = now()` on success — keeps the header subline ("Last edited 5m ago") fresh
- raises `SQLSTATE 42501` (insufficient_privilege) for auth/perms failures; `22023` (invalid_parameter_value) for input failures
- `revoke execute … from public`; `grant execute … to authenticated` — same grant pattern as `create_task` and `create_pipeline_with_channels`

### No unique constraint on (pipeline_id, position) — verified live

Ran `select conname from pg_constraint where conrelid='public.stages'::regclass and contype='u'` → 0 rows. Same for `tasks`. **The position-shift logic in `create_stage` (`update stages set position=position+1 where position > after_position`) and the two-step shift-and-move in `move_task` are safe as-is** — no mid-shift uniqueness violation risk, no two-pass shift needed.

**Forever-rule for future maintainers:** if you ever add a `UNIQUE(pipeline_id, position)` constraint (sensible to make data integrity stronger), you MUST either:
1. Make it `DEFERRABLE INITIALLY IMMEDIATE` AND add `set constraints all deferred` inside each of these RPCs, OR
2. Rewrite each RPC body to two-pass: shift conflicting rows to NEGATIVE temp values first, then assign final positions in a second update.

Both are mechanical changes; either works. The DOWN-plan in the migration file is `drop function` × 4 — re-running the migration would re-create the current (non-DEFERRABLE-aware) bodies, so re-do the constraint change AFTER any future migration that touches these RPCs.

### Locked 5e UI decisions (UI implementation lands in a separate commit)

These decisions are FINAL — the UI commit must mirror them exactly. Recorded here so the decisions outlive the chat that produced them.

| Decision | Choice |
| --- | --- |
| Edit mode model | Distinct mode toggled by header button (NOT inline always-editable affordances). `editMode: boolean` lives in a new `EditModeContext` mounted at `PipelineChromeShell` and consumed by `PipelineHeader` (toggle button) + `PipelineCanvas` (visual treatment + drag affordances). |
| Header toggle | "Edit pipeline" ↔ "Done editing" label, pencil ↔ check icon, `#108CE9` (`stages-blue`) accent when active. Hidden on `/clients` (edit belongs on canvas only). Gated on `canEditPipeline` (already wired). |
| Canvas edit-mode signal | Thin blue (`#108CE9`) top-border on the canvas wrapper. |
| Drag library | `@dnd-kit/{core, sortable, utilities}` (fresh install — not currently a dependency). `PointerSensor` with `activationConstraint: {distance: 8}` + pointer capture. |
| Pan/drag coexistence | dnd-kit owns drag on stages + tasks; `react-zoom-pan-pinch` owns pan on empty canvas. `panning.excluded` widened so pointerdown on any stage node or task card never starts a pan — applies in BOTH normal and edit mode (closes a subtle pre-5e bug where you could start a pan from a stage's background). |
| Zoom in edit mode | Snap to 1.0 on entry, hide zoom controls. Do NOT restore prior zoom on exit (user can re-zoom if needed). |
| Stage add | Persistent "+ add stage" button at right end (append; `create_stage` with `after_stage_id=null`) AND gap-hover "+" pill between adjacent stages (insert-between; `after_stage_id` = LEFT stage of the gap). |
| Insert-before-first-stage | NOT building. `create_stage` signature only supports `after_stage_id`. If a user wants a new first stage, they add at the end then drag it left. |
| Stage rename | Click stage name in edit mode → inline input → direct `UPDATE stages SET name = …` (gated by RLS). |
| Stage delete | Button on stage in edit mode → confirm dialog → direct `DELETE FROM stages WHERE id = …` (tasks cascade via FK). |
| Delete confirm copy | N ≥ 1: `"This will delete '{name}' and its {N} tasks. This can't be undone."` — N = 0: `"Delete '{name}'? This can't be undone."` |
| Task drag | Between stages → `move_task`; within stage → `reorder_tasks_in_stage` (or `move_task` with same source/target). |
| Task click in edit mode | Inline rename of `tasks.title` via direct UPDATE. |
| Task click in normal mode | UNCHANGED from 5c — `console.log` stub, awaiting step-6 task detail panel. |
| Rename submit semantics | Enter commits, Esc cancels, blur-with-changes commits, blur-no-change cancels. Matches the existing `AddTaskRow` UX. |
| Optimistic UX | Apply local state mutation immediately, revert on RPC error. Matches the existing `toggleTaskDone` pattern at `PipelineCanvas.tsx`. |
| Live re-derivation | REUSE `stageStateFromCounts` from `src/lib/current-stage.ts` — every structural mutation feeds the existing `useMemo` derivation; per-stage colors, connectors, and layout all recompute automatically. Do NOT write a second derivation. |

### Files (this commit)

```
new file:  supabase/migrations/20260522120000_edit_pipeline_rpcs.sql
modified:  PROGRESS.md
```

(UI implementation + file changes + verification land in the next commit, which Jordan reviews against figma before it commits.)

---

## Phase 4a — step 5d: pipeline canvas chrome (header + left rail) (2026-05-22)

**Goal:** replace the workspace AppShell (dashboard nav with workspace switcher + search + Pipeline button) with a pipeline-specific chrome — a shorter header (back arrow + emoji + name + subline + member cluster + Edit pipeline + profile menu) and a vertical left rail of section icons — for the canvas surface only. Other workspace routes (dashboard, my-tasks, settings, p/new) keep AppShell unchanged. Plus the deferred 5a coachmark scope fix.

### Built as two atomic steps

**Step 1 — route-groups refactor (move-only, no feature work):**

Split `/w/[slug]/*` into two Next.js route groups so each gets its own layout:

```
src/app/w/
├── (workspace)/[slug]/         ← <AppShell>
│   ├── layout.tsx
│   ├── page.tsx                (dashboard)
│   ├── my-tasks/...
│   ├── settings/...
│   └── p/new/page.tsx
└── (canvas)/[slug]/             ← <PipelineChromeShell>
    ├── layout.tsx               (pass-through — chrome data fetched per-page since layouts can't see deeper params)
    └── p/[pipeline-id]/
        ├── page.tsx             (canvas)
        └── clients/page.tsx     (server wrapper) + ClientsBody.tsx (client body)
```

URLs unchanged (route groups in `(parens)` are excluded from the URL path). All 7 routes serve at identical URLs to pre-split — verified via curl smoke. The atomic move shipped clean with zero behavior changes before any chrome work landed; verified `next build` green + dev smoke all routes → 307 → /auth/signin (matching the pre-split surface).

**Step 2 — chrome work (the actual feature):**

New component tree under `src/components/chrome/`:

- **`PipelineChromeShell`** — outer layout. Top: header (sticky 52px). Body row: rail (56px) on the left, page content (flex-1) on the right.
- **`PipelineHeader`** — back arrow + pipeline emoji + name + subline + member cluster + Edit pipeline + visual divider + profile menu.
- **`LeftRail`** — 7 stacked icons: cursor (active = canvas), chat (coming-soon, custom round-bubble-with-lines SVG), activity (coming-soon), files (coming-soon, folder icon), members (live, opens popover), + invite (live, owner/admin only, links to `/clients`), external (coming-soon, future "view as client").
- **`MembersPopover`** — title + count + divider + bordered avatar / name / role rows. Shared trigger from header avatar cluster click AND rail Members icon click.

### Server-side data fetch — `src/lib/canvas-chrome-data.ts`

Shared helper called by both `(canvas)` pages (canvas + /clients). Returns:

```ts
type CanvasChromeData = {
  pipeline: { id, name, emoji, company, last_edited_at };
  members: ChromeMember[];           // all roles, sorted owner→admin→member→client + joined_at asc
  visibleMembers: ChromeMember[];    // first 3 for the cluster preview
  overflowMembers: number;           // for the "+N" badge
  canEditPipeline: boolean;          // mirrors can_edit_pipeline SQL helper
};
```

**Bug caught + fixed:** first pass used PostgREST's nested-select form `profile:profiles!inner(...)` to join pipeline_memberships → profiles in one query. Returned 0 rows because there's **no direct FK between pipeline_memberships and profiles** — both reference `auth.users(id)` separately, and PostgREST can't infer that relationship. The `!inner` join filtered everything out, member cluster rendered empty across the entire chrome surface. Fixed by switching to the dashboard's two-query pattern: fetch pipeline_memberships, batched fetch profiles via `.in("id", userIds)`, in-memory join via Map keyed by user_id. Same pattern documented in `/w/[slug]/page.tsx`.

### `resolveMemberDisplay` — graceful name fallback

Real invited-but-not-yet-onboarded users have `profiles.display_name = null` even though `profiles.email IS NOT NULL` (schema-enforced). First-pass popover rendered "Unknown" for these — looked broken in a real product.

New helper in `MembersPopover.tsx`:

```ts
display_name (trimmed, non-empty)
  → email PREFIX (before '@', e.g. "jane.doe" from "jane.doe@example.com")
  → "Pending member" (defensive — schema-illegal case)
```

Matches `UserAvatar`'s existing initial chain (`display_name[0] → email[0] → "?"`) so the avatar and text resolve consistently: a member with email `jane.doe@…` renders avatar "J" + text "jane.doe", never "J" + "Unknown".

### Coachmark scope fix — closes 5a deferred item

Pre-5d, `CanvasCoachmark` attached its auto-dismiss listeners to `window`. Any pointerdown/wheel anywhere on the page (header click, rail click, popover, profile menu) dismissed the coachmark before the user got to read it.

Fix: `CanvasCoachmark` now takes a `canvasRef` prop; listeners attach to `canvasRef.current` (the canvas wrapper element). Header / rail / popover interactions no longer dismiss the hint — only actual canvas pan/zoom (or the X button) does. Closes the deferred 5a launch-prep item.

### `/clients` refactor (bonus: closes an auth-hardening gap)

Pre-5d the `/clients` route was a full `"use client"` page with no server-side auth gate (returned 200 to anon). 5d added a thin server `page.tsx` wrapper that fetches chrome data + auth-gates server-side + renders `<PipelineChromeShell><ClientsBody /></PipelineChromeShell>`. The body component (formerly the default export) was renamed to a named `ClientsBody` export; its internal hooks-heavy logic is unchanged.

Side effect: `/clients` now redirects anon traffic to `/auth/signin` server-side — closes one of the three launch-prep "client routes return 200 to anon" items.

### Permission gates (verified — match the SQL helper exactly)

The chrome's permission-gated UI matches `can_edit_pipeline(p_id)` from `20260509120000_rls_policies.sql`:

```
workspace_memberships.role = 'owner'
  OR  pipeline_memberships.role IN ('owner', 'admin')
```

Effective in 5d:

| User type | Edit pipeline button | + Invite rail icon |
| --- | --- | --- |
| Workspace owner | ✓ visible | ✓ visible |
| Pipeline owner/admin | ✓ visible | ✓ visible |
| Pipeline member | hidden | hidden |
| Pipeline client | hidden | hidden |

Note: workspace ADMIN role (`workspace_memberships.role = 'admin'`) doesn't currently inherit `canEditPipeline` — matches the SQL helper. If we ever want workspace admins to inherit pipeline-edit access, that's a SQL helper change + app-code mirror, not just a UI tweak. Flagged for future review; not blocking 5d.

The Edit pipeline button click itself is **stubbed in 5d** (`console.log` only). Edit mode ships in 5e.

### Locked chrome tokens + measurements (for future maintainers + 5e)

| Element | Value |
| --- | --- |
| Header height | 52px |
| Header bg | `#121212` |
| Left rail width | 56px |
| Left rail bg | `#121212` |
| Pipeline emoji box / back-arrow box | 32×32, 8px radius, `#212124` fill, `#36363A` border |
| HeaderProfileMenu avatar (canvas) | 32px (vs AppShell's 40px — narrower header) |
| HeaderProfileMenu avatar (dashboard, AppShell) | 40px (unchanged from pre-5d) |
| All avatars | 6px corners across all sizes (was conditional 10px / 50%) |
| MemberCluster avatar wrapper | 6px corners (was 50% — read circular) |
| MembersPopover width | 300px |
| MembersPopover avatars | 36px, `bordered` (2px colored stroke on photos) |
| Edge fade (left) | **removed** — done work behind doesn't need "more here" cue |
| Coachmark scope | `canvasRef.current` (was `window`) |

### Visual polish iterations during 5d

| Iteration | Change |
| --- | --- |
| 1 | Files rail icon: `Link` → `Folder` (Link icon was generic) |
| 2 | Active rail icon: purple (`#A78BFA` / `rgba(110,91,232,0.18)`) → grey (`white` / `rgba(255,255,255,0.08)`) — purple competed with the canvas's in-progress purple |
| 3 | Left edge fade dropped — done work behind doesn't need a "more content over there" cue |
| 4 | HeaderProfileMenu avatar: square (6px corners across all sizes, was conditional), thin 1px stroke, size prop added (32 on canvas, default 40 elsewhere) |
| 5 | HeaderProfileMenu dropdown positioning: explicit `top: 100%` — was clipped at top of viewport because `mt-2` in a `flex items-center` parent put the dropdown's auto-computed static position at the parent's vertical center (centered on a 40px wrapper, but the dropdown is 200px tall → ~72px off-screen) |
| 6 | Chat rail icon: `MessageSquare` → custom `ChatBubbleLinesIcon` (round bubble + 2 lines, distinct from the rectangular Folder icon below it) |
| 7 | MemberCluster wrapper: 50% → 6px corners (was making the inner rounded-square avatars read circular due to the dark `#121212` halo) |
| 8 | MembersPopover shrunk ~25% — was too imposing |
| 9 | MembersPopover row gap: 4 → 8 — rows felt stacked |
| 10 | Back arrow boxed: matches emoji-box treatment (32×32, 8px corners, `#212124` fill, `#36363A` border) |

### Files (this commit)

```
new file:  src/lib/canvas-chrome-data.ts                              (shared two-query helper)
new file:  src/components/chrome/PipelineChromeShell.tsx              (outer layout)
new file:  src/components/chrome/PipelineHeader.tsx                   (header content)
new file:  src/components/chrome/LeftRail.tsx                         (icon rail + custom ChatBubbleLinesIcon)
new file:  src/components/chrome/MembersPopover.tsx                   (popover + resolveMemberDisplay)

modified:  src/components/UserAvatar.tsx                              (+ bordered prop)
modified:  src/components/app/HeaderProfileMenu.tsx                   (+ size prop, square 6px corners, dropdown positioning fix)
modified:  src/components/canvas/CanvasCoachmark.tsx                  (+ canvasRef prop, listeners on ref.current not window)
modified:  src/components/canvas/EdgeFades.tsx                        (left fade removed)
modified:  src/components/canvas/PipelineCanvas.tsx                   (old minimal header removed; coachmark ref passed; dropped unused workspaceSlug/pipelineName props)

renamed:   src/app/w/[slug]/* → src/app/w/(workspace)/[slug]/*        (5 routes moved into workspace group)
renamed:   src/app/w/[slug]/p/[pipeline-id]/* → src/app/w/(canvas)/[slug]/p/[pipeline-id]/*  (2 routes moved into canvas group)
new file:  src/app/w/(canvas)/[slug]/layout.tsx                       (chrome layout placeholder; actual chrome lives in pages since layouts can't see [pipeline-id])
modified:  src/app/w/(canvas)/[slug]/p/[pipeline-id]/page.tsx          (fetches chrome + wraps in PipelineChromeShell)
new file:  src/app/w/(canvas)/[slug]/p/[pipeline-id]/clients/page.tsx (new server wrapper)
renamed:   src/app/w/(canvas)/[slug]/p/[pipeline-id]/clients/ClientsBody.tsx  (formerly page.tsx, default export → named ClientsBody)
```

### Verification

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | ✓ clean |
| `npx eslint` on Phase 2 files | ✓ clean (5 pre-existing `react-hooks/purity` errors deferred — see launch-prep below) |
| `npx next build` | ✓ green, all 23 routes registered |
| Dev server smoke (anon) | ✓ all 7 `/w/...` routes 307 → /auth/signin at unchanged URLs |
| Member cluster + popover | ✓ verified live by Jordan — cluster on nav, popover matches figma proportions |
| Edit pipeline gate | ✓ visible to owner, hidden to member/client (gate matches SQL helper exactly) |
| Coachmark scope | ✓ only canvas interaction dismisses; header/rail/popover clicks don't |

### Launch-prep deferrals (NOT addressed in 5d, flagged for later)

1. **5 React 19 `react-hooks/purity` errors** — `Date.now()` called during render in:
   - `src/app/w/(workspace)/[slug]/my-tasks/recently-done/page.tsx:70`
   - `src/app/w/(workspace)/[slug]/settings/team/page.tsx:577, 733` (+ 2 more)

   Pre-existing in pages 5d only relocated (didn't author). React 19's purity rule flags `Date.now()` because it changes between renders → unstable React output. Fix is straightforward: move calls into `useState(() => Date.now())` initializers OR compute server-side. Lint errors only — `next build` ignores them and builds clean. Defer to a dedicated React 19 purity sweep before launch.

2. **`/p/new` + `/settings/team` return 200 to anon** — client-component pages with no server-side auth gate. They render their shell then redirect client-side via `useSession`. Pre-existing; minor auth-hardening item for the launch-prep checklist. `/clients` closed this gap in 5d (now server-gated via the chrome wrapper).

3. **Workspace ADMIN role doesn't currently inherit `canEditPipeline`** — matches the SQL helper which only grants workspace owner OR pipeline owner/admin. If workspace admins should inherit pipeline-edit access, that's a SQL helper change + app code update. Not blocking; flagged for future review.

### Bugs caught + fixed during 5d verification (in order)

1. **PostgREST nested join `profile:profiles!inner` returned 0 members.** No FK between `pipeline_memberships` and `profiles` (both reference `auth.users(id)` separately). Fix: switched to the dashboard's two-query pattern (pipeline_memberships, then profiles via `.in("id", userIds)`, in-memory join). Member cluster + popover now populated.
2. **HeaderProfileMenu dropdown clipped at viewport top.** No explicit `top` on the absolutely-positioned dropdown → static-position fallback in a `flex items-center` parent computed to the parent's vertical center. With dropdown taller than wrapper, ~72px extended above the viewport. Fix: `top: "100%"` + 8px gap. Also affected the dashboard's AppShell, not just the canvas.
3. **MemberCluster avatars read circular.** Wrapper `borderRadius: 50%` made the dark `#121212` background show as a circular halo around the rounded-square inner avatars. Fix: wrapper `borderRadius: 6` so the wrapper matches the inner's square shape.
4. **MembersPopover too imposing.** First-pass styling at 360×20px padding + 22px title felt like a dialog. Shrunk all metrics ~25% to a compact-menu feel.
5. **Member rows stacked too tightly.** Container `gap: 4` + 6px row padding → avatars 16px apart. Bumped gap → 8 for 20px breath.
6. **"Unknown" name fallback looked broken.** Real invited-but-not-yet-onboarded users have `display_name = null`. Replaced `display_name || email || "Unknown"` with `resolveMemberDisplay()` chain (display_name → email-PREFIX → "Pending member") — matches UserAvatar's initial chain.
7. **Back arrow felt unframed next to the framed emoji box.** Added matching box treatment (`#212124` fill + `#36363A` border + 8px corners). Pair now reads as two consistent chip controls.

### Deferred for later sub-steps

- **Edit pipeline mode (5e)** — the button click currently logs and returns. 5e wires the actual editing: add/rename/reorder/delete stages, drag tasks between stages, drag-to-reorder tasks.
- **Per-pipeline chat (4b)** — rail's chat icon is coming-soon-stubbed.
- **Per-pipeline activity feed** — rail's activity icon is coming-soon-stubbed.
- **Per-pipeline files** — rail's folder icon is coming-soon-stubbed.
- **Client portal "view as client" (4c)** — rail's external-link icon is coming-soon-stubbed.
- **Pipeline-id-aware layout** — current `(canvas)/[slug]/layout.tsx` is a pass-through because Next.js layouts can't see deeper segment params (the layout sees `{slug}` but pipeline-id is below). Chrome data fetched in each page; could be revisited if a parallel routes / context pattern proves cleaner later.

### Lessons learned (apply forever)

1. **PostgREST `!inner` nested joins require an explicit FK between the joined tables.** When the schema joins via a shared reference (e.g. profiles + pipeline_memberships both → auth.users), there's no direct FK for PostgREST to walk and the inner join returns zero rows silently. Use a two-query in-memory join pattern instead — the dashboard's pre-existing `pipeline_memberships` + batched `profiles.in("id", userIds)` is the canonical example. Don't trust empty data from PostgREST nested selects; trace the FK chain explicitly when something returns zero rows you expected to populate.
2. **Layouts in Next.js App Router can't see deeper segment params.** A layout at `(canvas)/[slug]/layout.tsx` receives `{ slug }` only; the pipeline-id segment below it isn't in the layout's params. If chrome data needs to be SERVER-fetched with knowledge of a deeper segment, the fetch belongs in the PAGE (or in a server-component wrapper around a client body) — not in the layout. Route groups are still the right primitive for swapping chrome per-route; the chrome COMPONENT just needs to live one layer deeper than naive intuition suggests.
3. **Absolute-positioned dropdowns need explicit `top` in flex-items-center parents.** Without `top` set, the browser computes the "static position" — in a flex column it'd be the flow position, but in `flex items-center` it's the parent's vertical center. For dropdowns taller than the parent (common for a 200px menu off a 40px avatar), that puts the dropdown off-screen above the viewport. Always set `top: "100%"` explicitly on dropdown overlays.
4. **Avatar fallback chains should match across surfaces.** Initial char in the avatar + display name in adjacent text should derive from the same chain (display_name → email → final fallback). When they diverge — e.g. avatar uses email's first char but text reads "Unknown" — the UI reads inconsistent. Extract the chain into a shared helper or document it identically in both surfaces.

---

## Phase 4a — step 5c: canvas task cards + completion + per-stage state model (2026-05-22)

**Goal:** render each stage's tasks as checkable cards beneath the stage box, wire completion to a server UPDATE (with the existing `set_task_completion_metadata` trigger writing `completed_at`/`completed_by`), live-recolor the canvas as task completion shifts which stages are in progress, surface a `+ Add task` affordance per stage via the existing `create_task` RPC, and gate everything by the locked permission rule (workspace owner/admin → toggle any task; member → only their own assigned tasks). Got everything in 5c except the task detail side panel (step 6 — clicking a task body is stubbed) and the chrome (left rail + header = 5d).

The big architectural shift in 5c was unrelated to tasks themselves: we replaced the **positional** stage-state model from 5b (one "current" stage, others demoted to "passed"/"future") with an honest **per-stage** model. Multiple stages can be in-progress at once now — agencies running parallel workstreams (sales mid-flight on stage 3, delivery mid-flight on stage 5) finally see both correctly.

### State model change — positional → per-stage (LOCKED, supersedes 5b)

**The bug it fixed.** Under 5b's positional rule, "current" was the highest-position stage with ANY completed task. Every other stage with completed tasks (or stages before the current) rendered as "passed" — visually green. So a partial stage (1/3 done) showing while the actual current was still mid-flight could be classified as "passed" if a later stage had picked up a single completed task. Concretely: stage 3 at 1/3 displayed GREEN while stage 4 was correctly purple — gave the user the false signal that stage 3 was done when it wasn't.

**Real-world driver.** Agencies don't work strictly sequentially. Sales team is mid-pipeline on Lead Captured while the delivery team has started Discovery on the same client. Both stages are genuinely in progress. The positional model forced one to be "current" and demoted the other — visually wrong.

**New rule** (locked Phase 4a step 5c, 2026-05-22; see `src/lib/current-stage.ts`):

| state | when | color |
| --- | --- | --- |
| `not-started` | `total === 0` OR `completed === 0` | grey |
| `in-progress` | at least one done, NOT all done | purple |
| `done` | `completed >= total` AND `total > 0` | green |

State is a **pure function of one stage's task counts**. No position, no other stages, no pipeline-level "current" concept. **Multiple stages can be `in-progress` simultaneously**, and that's correct.

**Task coloring inside a stage** (this is what fixed the false-green):
- Completed task → its stage's color (green if stage `done`; purple if stage `in-progress`)
- Incomplete task → grey, always

**Important — color is display-only.** Same lock from earlier rounds. A task marked "incomplete" inside an in-progress stage doesn't auto-anything; the checkbox still tells the truth. Color answers "where in the workflow," checkbox answers "is this individual thing done."

### Anchor stage — for surfaces that need a SINGLE focal stage

Some surfaces still need ONE stage to focus on:
- Canvas auto-center target (on load + on pill click + on "fit" button)
- Canvas stage-indicator pill ("showing stage X of Y")
- Dashboard tile headline ("Current stage: Proposal Sent" text on each pipeline tile)

New helper `pickAnchorStage()` returns ONE focal stage by the locked rule:
1. **First in-progress** stage (leftmost purple) — most common case
2. Else **first not-started** (leftmost grey) — fresh pipeline with no progress yet, anchors on the "next thing to start"
3. Else **last stage** — all-done pipelines anchor on the final stage

**Crucially, the dashboard + canvas + pill all call the same `pickAnchorStage`.** No desync where the dashboard says "we're on Stage 3" but the canvas centers on Stage 5. Same picker, same answer.

**Parallel-stages case behavior change** (intentional + correct):
- Old positional rule: multiple in-progress stages → "current" was the rightmost-with-completed-task. Dashboard would label "Stage 5."
- New anchor rule: multiple in-progress → leftmost in-progress wins. Dashboard labels "Stage 3."
- Consistent across surfaces ("the work we're earliest in"). If a future product decision wants "latest in flight," it's a one-line change in `pickAnchorStage` — but for MVP, leftmost-first matches the natural reading direction.

### Helper API (deletions + additions)

**Deleted** (positional model artifacts):
- `deriveCurrentStage(stagesList, stageCounts, totals) → { currentStage, visual }`
- `stateForStage(stage, currentStage, visual) → "passed" | "current" | "future"`

**Added**:
- `stageStateFromCounts(counts) → "not-started" | "in-progress" | "done"` — pure per-stage classifier
- `pickAnchorStage(stagesList, stageStates) → S | null` — single focal-stage picker

**Type rename**: `StageState` value union `"passed" | "current" | "future"` → `"not-started" | "in-progress" | "done"`. Same identifier, new values; all consumers updated in one pass.

### Locked stage tokens (re-keyed — supersedes 5b's table)

Hex values unchanged from 5b. Only the keys moved from positional words to state words:

| State | Badge bg | Badge text/border | Box bg | Box text | Box subtitle | Box border | Wrapper opacity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| in-progress | `#6E5BE8` | white / `#6E5BE8` | `#6E5BE8` | white | `rgba(255,255,255,0.75)` | `#6E5BE8` | 1.0 |
| done | `#1F4535` | `#15B981` | `#1F4535` | `#15B981` | `rgba(21,185,129,0.7)` | `rgba(21,185,129,0.35)` | **0.7** |
| not-started | `#2C2C2F` | `#979393` / `#36363A` | `#2C2C2F` | `#E4E4E7` | `rgba(151,147,147,0.7)` | `#36363A` | 1.0 |

### Connector 3×3 table (replaces 5b's 4-row table)

Decided from the LEFT stage's state:

| Left | Right | Style | Color | Width |
| --- | --- | --- | --- | --- |
| done | (any) | solid | green `#15B981` | 2px |
| in-progress | done | solid | green `#15B981` | 2px |
| in-progress | in-progress | solid | **purple `#6E5BE8`** | 2px |
| in-progress | not-started | **dashed** | purple `#6E5BE8` | 2px |
| not-started | (any) | solid | grey `#36363A` | 1px |

The `in-progress → in-progress` case (solid purple) is new under this model — it's the "parallel active region" visual. Two adjacent purple stages connected by solid purple reads as "this whole stretch is active work."

### Task cards (5c feature work)

Per task, beneath the stage box:
- 8×8px state-colored dot on the left edge (matches the STAGE's color regardless of task done state — so the dot signals "which stage I'm in" while the card fill signals "am I done")
- Checkbox (16px). Click toggles `tasks.done` via direct UPDATE — the `set_task_completion_metadata` BEFORE UPDATE trigger writes `completed_at` + `completed_by`. INVERTED on completed in-progress (white fill + purple check; same-color checkbox would blend into the purple card bg); STANDARD on completed done stages (green fill + white check against the dark green card bg gives enough contrast).
- Title (13px, truncates at the card width, strikethrough when done, color matches the stage when done)
- Click on the title body (not checkbox) is stubbed for step 6 — `console.log` only. The task detail side panel is the 6 surface.
- Cards are 40px tall × 200px wide (200 = STAGE_NODE_WIDTH 220 minus TASK_STACK_PAD_LEFT 16 minus TASK_STACK_PAD_RIGHT 4)

**Live re-derive on completion.** Mutating `tasksState` triggers a `useMemo` recompute: stage counts update → `stageStateFromCounts` re-classifies each stage → per-stage colors flip → connector colors re-evaluate → anchor stage may shift → pill text + auto-center recompute. All in one render tick, no server round-trip. Same `current-stage.ts` helper used for the initial server-side derivation and the client-side re-derive.

**Optimistic + revert.** Toggle done locally first; UPDATE the row; if RLS rejects (member toggling a task not theirs), revert. UI snaps back to truthful.

### + Add task affordance

Card-styled affordance at the bottom of each stage's task stack. Owner/admin only (matches `canEditPipeline`); members don't see it. Collapsed = dashed-border "+ Add task" card; expanded = inline title input. Enter submits via `create_task` RPC (security-definer, re-enforces `can_edit_pipeline` server-side). New task appends to local state immediately; the parent's `useMemo` re-derives, stage's `X/Y task` subtitle updates live. Input clears + stays focused after submit for rapid multi-add.

### RLS tightening — `20260521120000_tighten_member_task_update_to_assignee` (applied manually)

**Applied to live Supabase via SQL editor — NOT a migration file in the repo.** Same pattern as the `canvas_hint_dismissed` column from 5a. The full SQL is in the chat transcript for 2026-05-22 and follows this shape:

```sql
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
for update using (
  exists (select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (public.is_pipeline_client(s.pipeline_id)
             and tasks.client_visible = true
             and s.client_visible = true)
        or (public.can_check_pipeline_task(s.pipeline_id)
             and tasks.assignee_id = (select auth.uid()))  -- NEW: assignee gate
      )))
with check ( /* identical USING clause mirrored */ );
```

**The gap it closes.** Before this migration, the member branch of `tasks_update` (`can_check_pipeline_task(pipeline_id)`) allowed any member with `can_check_tasks = true` to UPDATE ANY task in the pipeline server-side. The 5c UI gates each checkbox by `canEditPipeline || task.assignee_id === userId`, but a member could bypass the UI via direct UPDATE. The migration adds `tasks.assignee_id = (select auth.uid())` to the member branch on both USING and WITH CHECK clauses — RLS rejects any member UPDATE on a task not assigned to them.

**Side effect (intentional):** members can no longer reassign tasks via direct UPDATE (the WITH CHECK clause blocks an attempt to flip assignee_id to someone else mid-update). Reassignment is owner/admin-only — matches the spec.

**TODO before public launch:** check this manual SQL into a proper migration file in `supabase/migrations/`. Acceptable to defer until 4c (when the manual SQL backlog gets reconciled in one sweep) since the policy is already live + verified via the audit `pg_policy` query.

### Dashboard refactor (no behavior change)

The dashboard tile headline used `currentStage.name` from the old positional `deriveCurrentStage()`. Now uses `headlineStage.name` from `pickAnchorStage()`. Same picker the canvas uses → no desync.

**Dead data removed:** the `visual: "plain" | "in-progress" | "complete"` prop on PipelineCard was computed server-side but never read in render (the 3-state ring/dot variant was abandoned in step 2 polish). Dropped from the page.tsx view model + PipelineCard's prop type. -5 lines of dead code.

### Audience-vs-`client_visible` clarification (closing an open question)

The original audience model from early planning was a **three-state enum** on tasks (e.g. internal/shared/client-only). That model is NOT in the schema — there's no `audience` column or enum on `public.tasks`. The 4a phase audit explicitly confirmed: "zero custom enums in public schema (no speculative audience enum)."

**The gating column is `tasks.client_visible boolean`** (initial schema, never renamed). It's a 2-state flag, not a 3-state enum. The client-portal filter in 4c will gate on this column.

Locked terminology: when discussing "who sees what," refer to `client_visible`, not "audience." 5c doesn't apply this filter (agency-side surface — all agency users see all tasks regardless of `client_visible`); 4c is where the filter ships.

### Permission gating (canvas-side, mirrors RLS exactly)

| Surface | Owner/admin (`canEditPipeline === true`) | Member (`assignee_id === userId`) | Member (other tasks) |
| --- | --- | --- | --- |
| Task checkbox | interactive | interactive | disabled + reduced opacity |
| `+ Add task` affordance | visible | hidden | hidden |
| Title click → step 6 panel | interactive (stubbed for now) | interactive (stubbed) | interactive (stubbed) |

`canEditPipeline` mirrors the `can_edit_pipeline` SQL helper in app code: `workspace_memberships.role === 'owner'` OR `pipeline_memberships.role ∈ {'owner','admin'}`. Computed server-side, passed to the canvas as a boolean.

### Visual annotation polish (5 rounds against the figma)

Iterated against `Figma_pipeline_stage_view.png` over 5 rounds. Final locked values:

| Property | Initial | Final | Round |
| --- | --- | --- | --- |
| Task layout | plain rows | bordered cards | 1 |
| Stage badge alignment | centered above box | **left-aligned with box** | 5b polish |
| Task card width | 180 | **200** (inset 16 from stage box of 220) | 4 |
| Stage box width | 180 | **220** | 4 |
| Stage→tasks gap | 12 | 22 → 32 (2 nudges) | 3,5 |
| Inter-card gap | 6 | 10 → 14 (2 nudges) | 3,5 |
| Task card height | 32 | 40 | 5 |
| Badge→task connector start | left edge | **box center** (`BOX_WIDTH/2`) | 4 |
| Left-edge dot | n/a | 8px state-colored | 4 |
| Dot color rule | uniform muted | **matches stage state** (purple/green/grey) | 5 |
| Connector dimming | (uniform 0.12 white) | (same — uniform-dim, no state-aware path yet) | locked |

### Files

```
new file:  src/components/canvas/TaskRow.tsx              (single task card, state-driven color + dot)

modified:  src/lib/current-stage.ts                       (full rewrite: new state values, new helpers, old deleted)
modified:  src/app/w/[slug]/p/[pipeline-id]/page.tsx     (full task fields fetched, canEditPipeline derived, pipeline_memberships joined)
modified:  src/components/canvas/PipelineCanvas.tsx       (lifted tasksState, live re-derive, toggle + add handlers, anchor logic)
modified:  src/components/canvas/StageNode.tsx            (tasks render, connectors, +add, color keys remapped, width/gap/height tuned)
modified:  src/components/canvas/StageConnector.tsx       (3×3 table rewrite for new states)
modified:  src/components/dashboard/PipelineCard.tsx      (visual prop removed)
modified:  src/app/w/[slug]/page.tsx                      (uses pickAnchorStage + stageStateFromCounts; visual dropped)
```

### Verification (verified live by Jordan against the 7a seed)

- Stage 1 + 2 (3/3, 2/2) render `done` / green ✓
- Stage 3 (1/3) renders `in-progress` / **purple** (not green — the bug) ✓
- Stages 4 + 5 (0/2, 0/2) render `not-started` / grey ✓
- Connectors per new 3×3 table ✓
- Live re-derive: check task in stage 4 → stage 4 turns purple, stage 3 stays purple (parallel active region) ✓
- Complete stage 3 → stage 3 turns green, stage 4 stays purple ✓
- Anchor stage consistency: dashboard tile headline + canvas auto-center + pill all anchor on same stage ✓
- Task card visuals: state-colored left dot, inverted/standard checkbox depending on stage state, strikethrough + state color on done titles ✓
- + Add task: owner sees the dashed-card affordance, types title, presses Enter → task lands at bottom of stage's list, stage X/Y count updates immediately ✓
- Edge fades + pan + zoom from 5a/5b preserved ✓

### Bugs caught + fixed during 5c verification

1. **Positional model false-green.** Stage 3 at 1/3 displayed green while stage 4 was correctly purple. Root cause: positional `stateForStage` treated any stage with completed tasks as `passed` when a later stage had any completed task. **Fix:** per-stage `stageStateFromCounts` — each stage's state is a pure function of its own counts, independent of others. (The full model change is documented above.)
2. **Task cards initially too tight.** First-pass card height 32 + inter-card gap 6 read as a single stack rather than individual cards. **Fix:** card height 32→40, inter-card gap 6→14, stage→tasks gap 12→32 (the parent/child visual relationship requires the stage→first-task gap to be CLEARLY larger than inter-card gap).
3. **Badges centered above box instead of left-aligned.** Initial pass aligned badges centered horizontally above each stage box; figma showed them at the top-left corner. **Fix:** removed `margin: 0 auto`; updated connector x-math to anchor on `pos.x + BADGE_DIAMETER/2`.
4. **Connector origin too far left.** First-pass connectors started near the box's left edge → looked like a "branched rail" pattern instead of a centered drop. **Fix:** `startX = BOX_WIDTH/2` so curves drop from the box midline.
5. **Stale `setState` in effect (React 19 rule).** Initial PipelineCanvas had a defensive `useEffect(() => setTasksState(initialTasks), [initialTasks])` to re-sync on prop change. React 19's `react-hooks/set-state-in-effect` flagged it. **Fix:** removed the effect entirely — route remount creates a new component on pipeline-id change, so initial state is captured cleanly via `useState(initialTasks)` with no re-sync needed.

### Deferred for later

- **Coachmark auto-dismiss is window-scoped** (inherited from 5a). Scope to canvas-only when 5d's left rail + header land.
- **5d inherits:** the left rail (cursor/chat/activity/links/members icons), the canvas header (member cluster + Edit pipeline button), role-gated affordances. Replaces the current minimal "back arrow + pipeline name" placeholder.
- **5e inherits:** edit pipeline mode — add/rename/reorder/delete stages, drag tasks between stages, drag-to-reorder.
- **Step 6 inherits:** the task detail side panel (deadline, assignee, description, comments). Title body click is already wired to a stubbed `onTaskClick` callback in PipelineCanvas — step 6 swaps the stub for the panel open.
- **Connector-to-task state-awareness** — currently the SVG connector from stage box to each task card is uniform dimmed grey. Could make it state-aware (green to done tasks, purple to in-progress-stage tasks). Acceptable as polish later; uniform-dim is the locked default for 5c.
- **RLS migration into the repo** — apply the manual SQL as a proper migration file alongside the canvas_hint_dismissed sweep. Deferred to a manual-SQL reconciliation step in 4c.

### Lessons learned (apply forever)

1. **Positional state derivations are a trap when "current" can branch.** The original 5b rule embedded an implicit assumption — pipelines have ONE current stage. The real world has multiple parallel workstreams. When a derivation rule embeds an assumption about the data's shape, write the assumption down explicitly and revisit it the first time you see real usage data. We didn't have real users yet, but the figma reference + the parallel-team scenario in conversation made the assumption visible — and we still missed it until the model produced false-green.
2. **Pure functions of one thing's own data are robust against future model expansions.** `stageStateFromCounts(counts)` knows nothing about position, other stages, or the pipeline's overall state. If we later add per-stage flags (e.g. `stages.archived`), the classifier handles it by composition — wrap it with `archived → 'archived'` short-circuit, without touching the core. Functions that take a whole graph + return per-element results are harder to extend.
3. **Surface-consistent anchor pickers prevent desync.** Three surfaces (dashboard tile, canvas auto-center, canvas pill) needed "one focal stage." Three surfaces with separate logic would have drifted — A team would tweak the canvas picker without thinking about the dashboard. `pickAnchorStage()` is the canonical answer, called by all three. Future surfaces (search results, AI summaries, notifications) call the same function. No "which one is correct?" arguments.

---

## Phase 4a — step 5b: canvas stage rendering + state colors (2026-05-21)

**Goal:** replace 5a's 4 throwaway placeholder boxes with real stage rendering from the database. Stage badges + boxes + connectors, state-colored per the locked rule (current=purple, passed=green, future=grey), auto-centered on the in-progress stage. Still NOT in scope until later sub-steps: task boxes (5c), left rail + header chrome (5d), edit pipeline mode (5e).

### Shared helper — `src/lib/current-stage.ts` (extracted, not duplicated)

Phase 4a step 2's dashboard had the canonical current-stage derivation inline. 5b promotes that into a shared helper so both surfaces use the SAME code path — locked rule: "no second derivation written." Two functions exported:

- **`deriveCurrentStage(stagesList, stageCounts, totals)`** — returns `{ currentStage, visual }`. Three-branch rule: zero completed → position 1 ("plain"); all complete → last stage ("complete"); partial → highest-position stage with any completed task ("in-progress").
- **`stateForStage(stage, currentStage, visual)`** — returns `"passed" | "current" | "future"`. Positional rule (not per-stage task-completion). Visual override: when pipeline visual is `"complete"`, ALL stages render `"passed"` (done pipeline has zero purple).

The dashboard (`/w/[slug]/page.tsx`) was refactored to call `deriveCurrentStage()` — its inline 18-line block deleted, replaced with a single function call. Single source of truth confirmed.

### Per-stage state rule (locked — affects 5b/5c/5d/5e and Phase 4b)

**Positional, not task-completion-strict.** A stage's state is purely a function of its position relative to the derived current stage's position:
- `position < current.position` → `passed` (green, receded)
- `position === current.position` → `current` (purple, brightest)
- `position > current.position` → `future` (grey, dim)

**Important — color is display-only.** A stage marked "passed" because the user moved past it does NOT have its tasks auto-completed. When the user opens a passed-but-incomplete stage, individual task checkboxes still show truthful done/undone state. This is a journey signal, not a data mutation. Confirmed with Jordan during the 5b gate.

**Done-pipeline override.** When pipeline `visual === "complete"`, every stage renders `passed`/green — there's no `current` at all. Last stage is the auto-center anchor but is NOT highlighted purple. A done pipeline has zero purple.

### Visual hierarchy (locked — verified against figma)

After two polish passes during 5b verification:

- **Current (purple)** — full `#6E5BE8` saturation, box shadow (~16px purple glow), white text, opacity 1.0. Brightest element on canvas, unambiguous "you are here."
- **Passed (green)** — `#1F4535` bg + `#15B981` accents, BUT rendered at **opacity 0.7 on the StageNode wrapper** so the bright green tokens don't compete with purple's prominence. Connectors representing the completed path stay at full saturation (rendered as siblings outside the wrapper) — the line story should still read while the stage cards themselves recede. Initial implementation at full opacity flattened the hierarchy: green text + border read nearly as prominent as purple. Mute applied as a single-knob opacity drop on the wrapper.
- **Future (grey)** — `#2C2C2F` bg + `#979393` text, full opacity but the tokens are already-muted. Naturally dimmest.

**Locked hierarchy:** `current > passed > future`. The 0.7 opacity for passed is the tunable; anything 0.65–0.75 is in the right range.

### Locked stage tokens (DO NOT redefine ad-hoc; reuse in 5c task boxes + 5d chrome)

| State | Badge bg | Badge text/border | Box bg | Box text | Box subtitle | Box border | Wrapper opacity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| current | `#6E5BE8` | white / `#6E5BE8` | `#6E5BE8` | white | `rgba(255,255,255,0.75)` | `#6E5BE8` | 1.0 |
| passed | `#1F4535` | `#15B981` | `#1F4535` | `#15B981` | `rgba(21,185,129,0.7)` | `rgba(21,185,129,0.35)` | **0.7** |
| future | `#2C2C2F` | `#979393` / `#36363A` | `#2C2C2F` | `#E4E4E7` | `rgba(151,147,147,0.7)` | `#36363A` | 1.0 |

### Locked connector rules (DO NOT redefine in 5c+)

Horizontal line between adjacent badge centers, color/style driven by the left + right stage states:

| Left | Right | Style | Color | Width |
| --- | --- | --- | --- | --- |
| passed | passed | solid | `#15B981` | 2px |
| passed | current | solid | `#15B981` | 2px |
| current | future | **dashed** | `#6E5BE8` (purple) | 2px |
| future | future | solid | `#36363A` | 1px |

The dashed purple connector is "the active frontier" — the one connection from current → immediate-next. Stages beyond that get the flat thin grey treatment. No other combinations occur given the monotonic positional state derivation.

### Badge layout (locked — per figma annotation polish)

**Left-aligned to the box's left edge, not centered above it.** First pass centered the badge horizontally over each box; figma `Figma_pipeline_stage_view.png` showed the badge at the top-left corner. Two-line fix: removed `margin: "0 auto"` from the badge div, updated connector x-math in PipelineCanvas from `pos.x + STAGE_NODE_WIDTH/2` (centered) to `pos.x + BADGE_DIAMETER/2` (left-aligned). Connector length unchanged at 248px between adjacent badges; just anchored 74px further left.

### Layout math (5b stage row)

Stages laid out left-to-right at the geometric center of the 4000×4000 transform plane:

```
PLANE_CX = 2000, PLANE_CY = 2000
STAGE_NODE_WIDTH = 180, STAGE_NODE_HEIGHT = 110 (badge 32 + gap 14 + box 64)
STAGE_GAP = 100  →  badge centers ~280px apart
BBOX_PADDING = 40  →  buffer between cluster edge and edge-fade activation

For N stages:
  totalWidth = N * 180 + (N - 1) * 100
  startX = 2000 - totalWidth / 2
  yTop = 2000 - 110 / 2
  stage[i].position = (startX + i * 280, yTop)
```

For the 5-stage seed: layout starts at x=1350, ends at x=2650. All 5 stages span ~1300px horizontally. Auto-center on stage 3 puts the cluster center near viewport center; stages 4-5 extend off-screen right at typical viewport widths, exercising the right edge fade.

### Auto-center + pill

- **Auto-center:** `transformRef.zoomToElement(currentStageId)` in TransformWrapper's `onInit`. Falls back to `centerView()` if `currentStageId` is null (empty pipeline, no stages yet).
- **Stage indicator pill:** "showing stage X of Y" where X = current stage's position, Y = `stages.length`. Click recenters via same `zoomToElement` call.
- **Empty pipeline fallback:** when `stages.length === 0`, the canvas renders the grid + a small "no stages yet" dashed pill at plane center. Auto-center calls `centerView` instead of `zoomToElement`. Real "create your first stage" affordance is 5e.

### Edge fades from real stage bbox

5a's bbox was hardcoded from placeholder positions. 5b derives it from the laid-out stage cluster: leftmost stage's x − 40 padding through rightmost stage's right edge + 40 padding (and similar for y). Edge fades activate the moment the user pans past this padded boundary, not at the literal cluster edge — gives a "you haven't quite hit the wall" buffer.

### Files (this round)

```
new file:  src/lib/current-stage.ts                    (118 lines — shared derivation + per-stage state helper)
new file:  src/components/canvas/StageNode.tsx        (~180 lines — badge + box, state-colored, left-aligned per figma, opacity-muted on passed)
new file:  src/components/canvas/StageConnector.tsx   ( 99 lines — line between adjacent badges, rule-driven)
modified:  src/app/w/[slug]/p/[pipeline-id]/page.tsx  (110 → 175 lines — fetches stages + tasks, derives state, exports StageViewModel)
modified:  src/components/canvas/PipelineCanvas.tsx   (-130 / +85 — real stages instead of placeholders, layout math, bbox from cluster, badge left-anchor in connector math)
modified:  src/app/w/[slug]/page.tsx                  (-19 / +6 — dashboard uses shared helper, no duplicate derivation)
modified:  next.config.ts                              (+ turbopackFileSystemCacheForDev: false — see standalone Build-infra entry below)
modified:  PROGRESS.md                                 (this entry + the Build-infra entry below)
```

### Verification (verified by Jordan against the live seed)

- Stage 1 + 2: green/passed, "Stage N · X/Y tasks" with accurate counts ✓
- Stage 3: purple/current, brightest treatment, auto-centered on load ✓
- Stage 4 + 5: grey/future, "Stage N · 0/2 tasks" ✓
- Connectors: 1→2 solid green, 2→3 solid green, 3→4 dashed purple, 4→5 thin flat grey ✓
- Pill: "showing stage 3 of 5", click recenters on stage 3 ✓
- Auto-center lands on stage 3 ✓
- Edge fades activate when stage 4 / 5 pan off-screen right ✓
- Pan + zoom from 5a still work — no regressions ✓
- Visual hierarchy reads correctly: purple unambiguously brightest, green present-but-receded, grey dim ✓

### Bugs caught + fixed during 5b verification

1. **Green completed stages too prominent at full opacity.** First pass used `#15B981` text + border at full saturation on `#1F4535` backgrounds. Read nearly as bright as the purple current stage, flattening the locked "current is brightest" hierarchy. **Fix:** opacity `0.7` on the entire StageNode wrapper when `state === "passed"`. Single knob, easy to tune, preserves color relationships within the passed state. Connectors stay at full saturation (rendered as siblings outside the wrapper) — they tell the path story.
2. **Badge centered above box instead of left-aligned.** First pass used `margin: "0 auto"` to center the numbered badge above the stage box. Figma `Figma_pipeline_stage_view.png` shows the badge at the top-left corner. **Fix:** removed the auto margin; updated connector x-math in PipelineCanvas to anchor on `pos.x + BADGE_DIAMETER/2` (badge center is now half-a-badge-diameter from the stage's left edge) instead of `pos.x + STAGE_NODE_WIDTH/2` (badge center was at the stage's horizontal midpoint).

### Deferred / known follow-ups

- **`stages.completed` is a dead column.** Confirmed during the 5b gate that `stages.completed boolean` (from the initial schema, exists as a leftover from the prototype's per-stage completion flag) is NOT written by any code path in the migrated codebase. 5b's state derivation uses task-count completion only — `stages.completed` is the dead column. **Cleanup target: v1.1 schema sweep** — drop the column via migration once we're confident nothing reads it. NOT touched in 5b to keep the change scope tight; flagging here so a future maintainer scanning the schema sees this is intentional dead weight, not a feature that lost its writer.
- **Coachmark auto-dismiss is window-scoped** (inherited from 5a deferred list). Scope to canvas-only when the 5d left rail + header land.
- **5c inherits:** real task boxes inside each stage box, "X/Y task" subtitle reactive to task completion writes, checkbox affordance for toggling done. Locked color tokens from this entry's "Locked stage tokens" table apply (don't redefine purple/green/grey ad-hoc).
- **5d inherits:** left rail + canvas header (replacing the current minimal "back arrow + pipeline name" placeholder), member cluster, Edit pipeline button.
- **5e inherits:** edit mode — add/rename/reorder/delete stages.

### Lessons learned

1. **Extract derivations to a single helper before the second consumer ships.** The dashboard had the current-stage rule inline since step 2; the 5b canvas would have been the second consumer. Extracting the helper at the moment of second use (rather than upfront in step 2) felt slightly late but was the right time — a helper extracted before a second consumer exists is a guess about its shape; one extracted at the second use is informed by both consumers' needs. The 5b helper has cleaner ergonomics (positional `StageState` enum, defensive null handling) than what a pre-emptive extraction would have produced.
2. **Color tokens at full saturation are surface-dependent prominence cues.** `#15B981` reads "subtle / accent" on the dashboard's Done badge (against a dark surface, small element). The SAME `#15B981` text + border on a 180×64px stage box at full saturation reads "primary action" — competes with the actually-primary purple current stage. Lesson: when porting a token from one surface to another, audit whether its perceived prominence is still appropriate. The 0.7 opacity fix here was effectively "preserve the token, dampen the surface-specific intensity."

---

## Build infra — disable Turbopack persistent FS cache for dev (2026-05-21)

**Symptom.** `next dev` crashed on startup 3 times across Phase 4a step 5 sessions with the same signature: Rust-side panic on SST (Sorted String Table) file deserialization + ENOENT on `.next/dev/build-manifest.json`. Each time, recovery required `rm -rf .next` + restart, costing ~10 min of debugging + a cold rebuild. Symptom appeared after machine sleep mid-session, after a sibling process wiped `.next` while the dev server was running, and once with no obvious trigger.

**Root cause.** Next 16.1.0 enabled Turbopack's FileSystem Cache by default for `next dev` (see `node_modules/next/dist/docs/.../turbopackFileSystemCache.md`). The cache layer writes incremental compilation state to `.next/dev/cache/turbopack/*.sst` files between starts to skip rebuild work. When an SST write is interrupted (sleep, crash, process kill, concurrent wipe), the file's header can land in an unreadable state. Subsequent starts panic on read.

This is a documented sharp edge — the docs caveat the feature as "stable for development and experimental for production builds." Stable doesn't mean crash-proof against interrupted writes; it means "shipped on by default in 16.1." The SST format predates the hardening work that's still in progress in the Next/Turbopack repo.

**Fix.** Disable just the persistent FS cache layer; keep Turbopack itself enabled for compilation + HMR. Two-line addition to `next.config.ts`:

```ts
experimental: {
  turbopackFileSystemCacheForDev: false,
}
```

What this changes:
- Turbopack stays the dev compiler (no fallback to webpack, no HMR regression)
- Nothing is written to `.next/dev/cache/turbopack/` — the corruption layer is removed from the loop entirely
- Cold-start cost: ~+500ms-1s per `npm run dev`. Measured on Stages: was ~285ms ready, still ~285ms ready (project is small enough that the cache wasn't saving much anyway — the SST corruption was costing 10 min/session for ~0ms of speed gained)
- HMR / hot reload during a running session: unchanged (that's in-memory incremental compilation, not the on-disk cache)

Verified post-fix: `.next/dev/cache/` contains only `.rscinfo` (a tiny RSC marker, unrelated); no `turbopack/` subdir gets created. Startup line confirms: `Experiments (use with caution): ⨯ turbopackFileSystemCacheForDev` (the `⨯` indicates OFF).

**Revisit when:** the SST format gains crash-safety, likely Next 16.3 or 16.4. The Turbopack team has been actively hardening it on canary. When the upstream fix lands, this flag can be deleted (the default `true` restored) and the cache speedup recovered. Verify the fix took by running `next dev`, force-killing it during compilation, restarting — should not panic.

**Hands-off rule for future maintainers:** DO NOT re-enable this in a "speed it up" sweep without first confirming the SST corruption class is fixed upstream. The fix is reversible but the corruption recovery cost is asymmetric — flipping it back to `true` and then hitting corruption mid-week loses far more time than the ~500ms cold-start it saves.

Webpack fallback (`next dev --webpack`) is in the back pocket if this disable isn't enough — but it shouldn't be needed; the persistent cache was the entire crash class.

---

## Phase 4a — step 5a: pipeline canvas core (pan/zoom shell) (2026-05-21)

**Goal:** replace the 404 stub at `/w/[slug]/p/[pipeline-id]` with a real route that renders a pan/zoom canvas shell — the gesture surface that 5b's stage boxes, 5c's tasks, 5d's left rail + header, and 5e's edit mode will all sit on top of. The point of isolating 5a from the rest of step 5 was to nail the gesture feel before adding visual complexity that would make it harder to A/B the interaction layer.

**Scope intentionally narrow:** empty pan/zoom shell only. NO real stages, NO tasks, NO left rail, NO edit mode, NO task detail panel. 5a renders 3-4 throwaway blue-dashed placeholder boxes that get deleted in 5b when real stage rendering arrives.

### Migration (applied manually, no file in repo)

```sql
alter table public.profiles
  add column if not exists canvas_hint_dismissed boolean not null default false;
```

Per-user (not per-pipeline, not per-workspace) flag tracking whether the user has dismissed the canvas coachmark. Defaults `false` so brand-new + existing users both see the hint on their next canvas visit. Applied by hand in the Supabase SQL editor; no migration file checked in (matches the pattern from the dismissed_at rollback — manual app-once SQL when there's no CLI workflow). PROGRESS.md is the only audit trail for this.

### Library — react-zoom-pan-pinch v4.0.3

Chosen for the spec's locked recommendation. Figma-parity gestures are non-trivial to get right (delta normalization, trackpad vs mouse disambiguation, pinch detection, velocity inertia) — rolling our own would have eaten a week. The lib delivers all of that out of the box with the right config knobs.

**Configured for figma-parity:**

| Prop | Value | Rationale |
| --- | --- | --- |
| `wheel.activationKeys` | `(keys) => keys.includes("Meta") \|\| keys.includes("Control")` | **Critical bug caught:** array form `["Meta","Control"]` is interpreted by the lib as `keys.every(k => pressedKeys[k])` — i.e., requires BOTH simultaneously. Cmd+wheel alone never satisfied this, so the lib never activated zoom and the browser took over with native page zoom (the "leads me to another place" symptom in verification). Function form lets us return true for EITHER. |
| `wheel.step` | `0.03` | Lib default is `0.015`. Initial config was `0.15` = 10× default — single trackpad swipe slammed scale from min to max. `0.03` = 2× default, gradual + controllable, lands cleanly on intermediate scales. |
| `minScale / maxScale` | `0.25 / 2` | Clamps zoom to a usable range. 2x is plenty for stage/task work; lib default 8x is unusable. |
| `limitToBounds` | `false` | Free pan beyond content — required for the user to pan placeholders off-screen and exercise edge fades. |
| `centerOnInit` | `false` | We manually `zoomToElement("placeholder-1")` in `onInit` to target a specific element instead of the geometric center. In 5b this targets the current in-progress stage. |
| `trackPadPanning.disabled` | `true` | Our custom wheel handler covers trackpad two-finger pan. Letting the lib's trackpad handler also run would double-apply the pan delta. |
| `panning.allowLeftClickPan` | `true` | Click+drag pan, with velocity inertia (`velocityDisabled: false`). |
| `doubleClick.disabled` | `true` | No double-click zoom — would conflict with future task-row double-click semantics in step 6. |
| `pinch.step: 5` | default | Trackpad pinch zoom (browser fires synthetic ctrlKey, caught by activationKeys). |
| `smooth: true` | — | Smooth interpolation on all transforms. |

### Wheel handling (custom + lib, split deterministically)

react-zoom-pan-pinch handles all pan/zoom natively EXCEPT for the spec's "plain mouse wheel pans vertically, shift+wheel pans horizontally" requirement. We add a custom native wheel listener on the canvas wrapper:

```ts
const onWheel = (e: WheelEvent) => {
  e.preventDefault(); // unconditional — see below

  if (e.ctrlKey || e.metaKey) return; // lib handles zoom
  if (!transformRef.current) return;

  let dx = e.deltaX, dy = e.deltaY;
  if (e.shiftKey && Math.abs(dx) < 0.01) { dx = dy; dy = 0; }

  const { positionX, positionY, scale } = transformRef.current.state;
  transformRef.current.setTransform(positionX - dx, positionY - dy, scale, 0);
};
wrapper.addEventListener("wheel", onWheel, { passive: false });
```

**Two non-obvious points:**

1. **`preventDefault` is unconditional**, before the modifier-key branch. Without this, Cmd+wheel cascades to the browser's native page-zoom shortcut (the "navigated to another place" symptom — the entire app chrome scales up/down). The lib's own zoom path also calls preventDefault, but unconditional preventDefault in our handler guarantees we never lose a race against the browser default.
2. **`{ passive: false }` registration** — React 19's synthetic wheel events default to passive, which blocks preventDefault. Native registration with `passive: false` is required.

### Edge fade math (content-aware, all 4 sides)

```ts
const planeLeft   = -positionX / scale;
const planeRight  = (W - positionX) / scale;
const planeTop    = -positionY / scale;
const planeBottom = (H - positionY) / scale;

setEdges({
  left:   bbox.left   + EPS < planeLeft,
  right:  bbox.right  - EPS > planeRight,
  top:    bbox.top    + EPS < planeTop,
  bottom: bbox.bottom - EPS > planeBottom,
});
```

Recompute fires on every transform tick via `onTransform` callback. State is lifted to PipelineCanvas (rather than EdgeFades using `useTransformEffect` directly) so the fade component can live as a sibling of TransformWrapper without needing access to the lib's React context. Initial state computed via post-`onInit` `requestAnimationFrame` so the first paint has correct fades.

**Tokens locked:** 60px gradient strip per edge, `linear-gradient(direction, rgba(0,0,0,0.55), rgba(0,0,0,0))`, 180ms ease-out opacity transition. The 0.55 alpha was bumped from an initial 0.35 during verification — 0.35 read as a faint hint users could miss; 0.55 is the sweet spot where the fade clearly signals "more content over there" without obscuring nearby content. `pointer-events: none` so they never intercept pan drags. zIndex 10 (above content, below pill / coachmark / zoom controls at 20+).

### Other locked details

- **Dotted grid** lives inside the TransformComponent content plane so it pans + zooms with the canvas. Dot color `#4A4A4A` (one step brighter than the dashboard's `#424242` token) — the dots live inside a translate3d+scale parent, and the browser's transform render pipeline antialiases them slightly more than the dashboard's static grid; the brighter token brings perceived visibility back to dashboard-parity without making them "in your face."
- **Stage-indicator pill** top-center, persistent, "showing stage X of Y" — 5a shows "stage 1 of 4" against the placeholders. Click recenters via `zoomToElement("placeholder-1")`. 5b wires this to the real current-stage derivation.
- **Zoom controls** bottom-right, three buttons (+/−/fit) stacked vertically with 8px gap. 38px square buttons with backdrop-blur.
- **Coachmark** "drag to pan · scroll to zoom" bottom-center pill, renders once per user. Reads `canvas_hint_dismissed` SSR-side (so already-dismissed users don't see a flash). Dismisses on X click OR any pointerdown/wheel anywhere on the window. UPDATE persists the flag.

### Files added (this commit)

```
new file: src/app/w/[slug]/p/[pipeline-id]/page.tsx       (server, auth gate, 110 lines)
new file: src/components/canvas/PipelineCanvas.tsx        (client orchestrator, ~395 lines)
new file: src/components/canvas/EdgeFades.tsx             (4-edge fade overlay, ~105 lines)
new file: src/components/canvas/CanvasCoachmark.tsx       (first-time hint, ~120 lines)
new file: src/components/canvas/StageIndicatorPill.tsx    (top-center recenter pill, 61 lines)
new file: src/components/canvas/ZoomControls.tsx          (+/−/fit buttons, 92 lines)
modified: package.json + package-lock.json                (+ react-zoom-pan-pinch@4.0.3)
```

### Bugs caught + fixed during verification (in order)

1. **Corrupted `.next` cache (self-inflicted).** I ran `rm -rf .next` while Jordan's dev server was still running — wiped cache files his Turbopack workers had open handles into, surfaced as a 500 with ENOENT on `.next/dev/cache/turbopack`. Clean rebuild fixed it. **Lesson:** don't wipe `.next` while another dev server is alive; coordinate first.
2. **TransformWrapper / TransformComponent sizing collapse.** `TransformWrapper` renders NO DOM (just a Context.Provider); the only div is TransformComponent's outer wrapper. My initial `wrapperStyle={{ width: "100%", height: "100%" }}` competed with the lib's default class CSS (`width: fit-content; height: fit-content`) in a way that didn't fully resolve — visible as a partial-coverage grid with a dark band at the top. **Fix:** added `position: absolute; inset: 0;` to wrapperStyle alongside the width/height. Position absolute + inset 0 is the bulletproof CSS way to fill a `position: relative` parent.
3. **`setTimeout(0)` auto-center race.** Initial impl called `zoomToElement("placeholder-1")` from a `setTimeout` inside `useEffect`. The lib's internal init runs in ITS own useEffect on mount — `setTimeout(0)` raced that init and `zoomToElement` no-op'd when the lib's internal state wasn't ready. Placeholders sat at plane (1700, 1700) far off-screen. **Fix:** switched to the lib's `onInit` callback, which fires AFTER internal state + DOM refs are ready. Wrapped in `requestAnimationFrame` for one extra safety frame.
4. **Placeholders too subtle.** Initial `#2C2C2F` bg + `1px dashed #4A4A50` border = nearly invisible against the dotted grid. **Fix:** `rgba(16,140,233,0.12)` bg + `2px dashed #108CE9` border (Stages primary blue) + `#7FA7D9` text. Blue chosen because green is reserved for the Done badge semantic.
5. **`wheel.step` 10× too high.** Original `step: 0.15` vs lib default `0.015` made single trackpad swipes slam from min to max. **Fix:** `0.03` (2× default).
6. **`activationKeys` array form required BOTH keys simultaneously.** Lib uses `keys.every(...)` internally. With `["Meta", "Control"]` the user had to hold Cmd AND Ctrl together to activate zoom — they never did, so lib zoom never fired and the browser's native page-zoom kicked in. **Fix:** function form `(keys) => keys.includes("Meta") || keys.includes("Control")`.
7. **`preventDefault` conditional in custom wheel handler.** Initial impl only called preventDefault on the pan path (no modifier); the zoom-path branch returned early without preventing. When the lib's zoom path was slow to activate, browser default ran first and zoomed the page. **Fix:** unconditional preventDefault at the top of the wheel handler.
8. **Edge fade too subtle.** Initial `rgba(0,0,0,0.35)` read as a faint hint users could miss. **Fix:** `rgba(0,0,0,0.55)`.
9. **Canvas dots dimmer than dashboard dots despite same token.** Subpixel softening under CSS transform. **Fix:** bumped `#424242` → `#4A4A4A` on the canvas only (one notch brighter); dashboard stays `#424242`.

### Verification (verified by Jordan, gesture pass)

- `/w/[slug]/p/[pipeline-id]` renders the canvas (was 404 stub)
- Pan: click-drag, plain scroll, shift+scroll horizontal, trackpad two-finger — all smooth
- Zoom: Cmd+scroll, Ctrl+scroll, trackpad pinch, +/−/fit buttons — controllable and clamps at 0.25x–2x
- Edge fades visible at 0.55 opacity, content-aware, all 4 sides
- Coachmark renders bottom-center on first load (verified after resetting the dismissed flag), X dismisses, persists across reloads
- Stage-indicator pill top-center, recenter-on-click works
- Auto-center on load lands placeholder-1 in viewport center
- Unauthed → /auth/signin?next= (307)

### Deferred for later sub-steps

- **Coachmark auto-dismiss is window-scoped** (`window.addEventListener` for pointerdown/wheel). Any interaction anywhere on the page — header click, search bar focus, scroll on a non-canvas element — dismisses the hint. **Scope this to canvas-only in 5d** when the left rail + header land and there's a cleaner separation of what counts as "the canvas." Acceptable trade for MVP.
- **5b inherits:** real stage rendering with the locked 3-state coloring (grey/purple/green) per the figma. Placeholders go away. Stage-indicator pill wires to real current-stage derivation. Auto-center targets the in-progress stage.
- **5d inherits:** the left rail (cursor/chat/activity/links/members/+invite icons), the real header (member cluster + Edit pipeline button), and the role-gated affordances.

### Lessons learned (apply forever)

1. **Read library prop type semantics before configuring.** `activationKeys: string[]` vs `(keys) => boolean` look interchangeable in TypeScript — both compile, both typecheck. But the array form internally means `keys.every(...)` (ALL must be pressed); the function form lets you express EITHER. Cost: one verification round where Cmd+wheel triggered browser page zoom instead of canvas zoom because the lib's zoom path never activated. Lesson: when a prop accepts multiple type shapes, the JSON-style one usually has surprising semantics. Read the lib source if the docs don't explain.
2. **Always `preventDefault` on canvas wheel events unconditionally.** Browser-native Cmd+wheel = page zoom, plain wheel = page scroll if any ancestor has overflow. Both will steal the gesture from your in-app handler if your preventDefault has any conditional branches. Cover all cases at the top of the handler.
3. **Don't wipe `.next` while another dev server is running.** Turbopack workers hold file handles into the cache; wiping under them surfaces as cryptic 500s on the OTHER server. Coordinate cache cleanup, or just don't bother — `next build` is enough verification signal in most cases.

---

## Phase 4a — step 4 polish round + storage-free recently-done (2026-05-20)

**Goal:** annotate the populated My Tasks view across all six buckets, lock the visual surface, address the questions step 4 exposed (how long do completed tasks stay on screen? what's the keyboard story? what's the multi-plan story for headers?), and decide what step 5 inherits as locked tokens vs. open decisions.

**No net new migrations.** A `tasks.dismissed_at` migration (`20260520150000`) was authored mid-round to support a per-user soft-dismiss, then ripped out (file deleted from disk before commit, column + partial index dropped from the live DB by hand). See [Storage-free dismiss design](#storage-free-dismiss-design-replaces-dismissed_at) below for the reasoning.

### Storage-free dismiss design (replaces `dismissed_at`)

**The question that drove it:** how long does a completed task stay on the My Tasks list — forever (clutter), or auto-hide (and recover from where)?

**First-pass design (built, then rejected):**

- New column `tasks.dismissed_at timestamptz` + partial index `tasks_assignee_active_idx (assignee_id) WHERE dismissed_at IS NULL`.
- Hover-trash icon on completed rows for explicit dismiss.
- End-of-day auto-hide of completed tasks.
- New `/my-tasks/archived` route with Restore action.

Worked. But: an entire column + index + UI affordance + a recovery route, all to encode a flag that completion already implies. The same UX falls out for free from `completed_at`.

**Final design (storage-free):**

1. **Completion stays global** (`tasks.completed_at`, unchanged).
2. **Active My Tasks** auto-hides completed past end-of-day: server query filter `completed_at IS NULL OR completed_at >= today_boundary`. Reuses the existing day-boundary helper. No new state.
3. **Recently-done view** at `/w/[slug]/my-tasks/recently-done`: tasks assigned to me, completed in the last 7 days. Server-computed cutoff `now() - interval '7 days'`, sorted `completed_at DESC`. Read-only — no Restore action. Rolling window slides naturally with no cron / cleanup needed.
4. **Permanent delete moves to the task detail panel (step 6)** with a confirm dialog. NOT on My Tasks rows, NOT in recently-done.

**Cleanup performed live (no reverse migration, manual SQL):**

```sql
drop index if exists public.tasks_assignee_active_idx;
alter table public.tasks drop column if exists dismissed_at;
```

The migration file was uncommitted, so deleting it from disk leaves git history clean. Same Supabase SQL editor session that ran the cleanup also wiped the 11 polish-round seed tasks + all seed stages in `test-workspace-4b` (verified `0 | 0 | 0` post-wipe). Pipelines kept; workspace is now a clean slate for the proper demo build.

### Pill color tokens (LOCKED — step 5 canvas + step 6 task detail must reuse)

The locked urgency gradient for the `/my-tasks` view, after one mid-round swap to fix a Done-vs-thisWeek collision:

| Bucket / state | Pill text | Pill bg | Section dot |
| --- | --- | --- | --- |
| **Overdue** | `#DF1E5A` (red) | `rgba(223,30,90,0.18)` | `#DF1E5A` |
| **Today** | `#DF1E5A` (red) | `rgba(223,30,90,0.18)` | `#DF1E5A` |
| **Tomorrow** | `#E273C1` (pink) | `rgba(226,115,193,0.15)` | `#E273C1` |
| **This week** | `#108CE9` (blue) | `rgba(16,140,233,0.15)` | `#108CE9` |
| **Later** | `#979393` (grey) | `rgba(151,147,147,0.12)` | `#6B6B6B` |
| **No date** | `#979393` (grey) | `transparent` | `#6B6B6B` |
| **Done badge** | `#15B981` (green) | `#1F4535` | — |

**Why blue for This week, not green:** earlier rev used green (`#15B981` / `#1F4535`) for both the Done badge AND the thisWeek pill. With completed tasks sinking to the bottom of each bucket and Done pills sitting at the row end, a row showing "Sun" (thisWeek green) read identically to a row showing "Done" (completion green) at a glance — the disambiguation only landed once you noticed the strikethrough title. Moving thisWeek to blue (`#108CE9` — same Stages primary used on `+ Pipeline` and the active chip) frees green as the universal "completed" signal. Urgency gradient is preserved: red (now) → pink (next) → blue (this week) → grey (distant / untimed).

**For step 5 canvas:** when canvas surfaces task pills (stage column headers, mini task previews, etc.), reuse these exact tokens. Surface-dependent pill treatment was locked in step 4 — dashboard uses pipeline-colored, /my-tasks uses bucket-colored. Canvas needs its own decision documented when it ships; default expectation is bucket-colored for any canvas-side "my tasks" widget, pipeline-colored when grouping by stage.

### Visual + interaction polish (what shipped)

- **Dotted-grid background extension** — `min-h-full` → `flex-1` on all three workspace-scoped page wrappers (dashboard, my-tasks, p/new). `min-h-full` only extended to content height for short pages; `flex-1` extends through the AppShell content area to the bottom of the viewport.
- **Quick add row restyle** — bg `#222933`, dashed border `#25476B`, text + icon `#35C4EE`. Visual hint changed from `⌘N` to `N` (see Keyboard shortcuts below).
- **"Hide completed" toggle** — custom-styled to match the TaskRow checkboxes: native `<input type="checkbox">` inside the `<label>` (visually hidden, kept for click target + keyboard + screen-reader semantics), styled `<span>` shows the visual state. Grey fill + `#36363A` stroke unchecked, blue `#108CE9` fill checked.
- **Header avatar stroke** — 2px → 1px on `HeaderProfileMenu`. Subtler ring, doesn't pull attention from active workspace text.
- **My Tasks page header band** — pulled out of the dotted-grid area so the high-density header (search + count + subtitle) sits on a solid surface; dotted pattern only appears behind the section list below. Subtle bottom stroke separates the two regions.
- **TaskRow checkbox** — custom-styled (was relying on system checkbox before): 18×18px, 4px radius, blue fill + check on completion, white stroke at 30% opacity unchecked. Same visual language as the hide-completed toggle.
- **MyTasksCard row spacing (dashboard)** — vertical padding tightened from 12px to 8px to match the figma's at-a-glance density. Calibrated in two passes (first 6px read too cramped, settled at 8px). The full /my-tasks view keeps its looser 14px row padding — different surface, different density rule.
- **Stages logo → clickable** — wraps the header logo in a `<Link>` to the active workspace dashboard (or `/` if no active slug). Opacity hover. Standard webapp convention (Linear, Notion, Slack all do this). Falls back to `/` only on workspace-agnostic routes; on normal `/w/[slug]/*` navigation the slug is always known.
- **Avatar sizing fixes** — explicit `boxSizing: "border-box"` on `next/image` (Tailwind preflight doesn't reach next/image's inline styles, so the 2px border was rendering outside the 40px footprint and making the avatar visually 44px). `HeaderProfileMenu` internal Avatar's rounded-square ↔ circle threshold bumped from `<= 36` to `<= 40` to keep size 40 rendering as rounded-square (was flipping into circle mode at the threshold).
- **Dashboard task-click payload** — `MyTasksCard` and `/my-tasks` `TaskRow` click handlers now log `{ taskId, pipelineId, stageId }`. Step 5 canvas wires this to `router.push('/w/${slug}/p/${pipelineId}?stage=${stageId}')` — payload already loaded, the wire-up is one line. Step 6 may then auto-open the task detail panel overlay on top of the canvas.

### Keyboard shortcuts (LOCKED)

Two shortcuts, two conventions. Both gate on "active element is not an input/textarea/contenteditable" so typing the letter in a search box doesn't trigger them.

- **Bare `N`** — focuses the My Tasks quick-add input from anywhere on the page. Expands the collapsed row if needed (the input isn't mounted in collapsed state, so `setQuickAddExpanded(true)` + `setTimeout(focus, 0)` is the focus sequence). Originally spec'd as `⌘N` until we discovered live that **Cmd+N is browser-reserved for "New Window" — `e.preventDefault()` cannot override it**. Same fate as ⌘T, ⌘W, ⌘R. Industry pattern in webapps is a single-key shortcut (Linear: C, Todoist: Q, Trello: C). `N` matches the original "N for new" intent.
- **`⌘K`** — reserved for the global search / command palette. NOT wired to a handler yet — the actual palette ships post-4a — but the header search input has a `<kbd>⌘K</kbd>` badge as the public commitment. **Don't bind ⌘K to anything else.** Slack and Linear both establish this convention; users land in Stages expecting it.

### Role-gated affordances (first plan-aware code in the app)

Stages MVP has two plans: **Solo $29/mo** (single-user, always owner, always sees admin affordances) and **Team $39/mo/user** (multi-role: owner / admin / member, role is per-workspace). Two surfaces now respect the role.

- **`+ Pipeline` header button** (`AppShell`) — derives `activeWorkspaceContext` from `useUserContexts` (filters: `type='agency' AND source='workspace' AND workspaceSlug=activeSlug`). `canCreatePipeline = role === 'owner' || role === 'admin'`. Members + pipeline-only agency users have the button hidden; `flex-1` search bar to its left absorbs the freed space with no layout jump.
- **Dashboard empty-state CTA** (`PipelinesSection`) — same gate. Owner/admin gets "create your first pipeline to get started" + button. Members get "an owner or admin will set things up here." (no CTA — would just bounce to a no-permission panel anyway).

Multi-workspace setups: role is per-workspace, so the same user can have the button visible in workspace A (their own) and hidden in workspace B (where they're a member). While contexts is loading, `canCreatePipeline` defaults to `false` (no flash of button); once contexts ready, the correct state renders.

### Files touched

```
modified:   src/app/w/[slug]/my-tasks/page.tsx
modified:   src/app/w/[slug]/p/new/page.tsx
modified:   src/app/w/[slug]/page.tsx
modified:   src/components/app/AppShell.tsx
modified:   src/components/app/HeaderProfileMenu.tsx
modified:   src/components/dashboard/MyTasksCard.tsx
modified:   src/components/dashboard/PipelinesSection.tsx
modified:   src/components/my-tasks/MyTasksView.tsx
modified:   src/components/my-tasks/QuickAddRow.tsx
modified:   src/components/my-tasks/TaskRow.tsx
new file:   src/app/w/[slug]/my-tasks/recently-done/page.tsx
new file:   src/components/my-tasks/RecentlyDoneView.tsx
```

### Strategic decisions captured (deferred work, affect step 5 and beyond)

- **Task click routing (step 5 must wire).** Click on a task in /my-tasks or the dashboard's MyTasksCard → `router.push('/w/${slug}/p/${pipelineId}?stage=${stageId}')`. Pipeline canvas loads with the relevant stage focused/scrolled-to. Step 6 may then auto-open the task detail panel overlay. Click handler payload already includes `{taskId, pipelineId, stageId}` — wire-up is one line.
- **Client-facing dashboard / OAuth integrations.** Decision: build the architectural seam in step 5, defer real OAuth to v2.0 post-PMF. v1.1 ships orchestration-only checklist (no OAuth, no tokens, low risk). Architectural seam requirement: provider config supports both modes (held vs orchestrated) from day one; audit log table exists at v1 even if only logging checklist events; `hipaa_safe` flag baked into provider config shape from the start.
- **HIPAA target (new).** Medical is a target vertical later. Means: SOC 2 Type II + HITRUST become non-negotiable on the path to medical; `hipaa_safe` flag must be in provider config from day one; some providers stay orchestration-only forever even when others move to held-token mode.
- **Long-term token storage thesis.** At scale, hold tokens for most providers — gated by SOC 2 Type II → dedicated SecEng hire → cyber insurance with token-vault rider → per-provider legal/ToS review → customer signal → per-provider ROI. Roughly Series A / $5-10M ARR. Never-hold list: banking-tier credentials (Plaid/Stripe Issuing holds those), PHI/HIPAA-adjacent, gov SSO root tokens. The "business hub" thesis at scale REQUIRES owning the integration surface — Salesforce/HubSpot/Zapier all became hubs by holding more credentials over time.
- **Team vs Client pipeline types — REJECTED.** No type picker at creation. Use `pipelines.company` field as the implicit distinction (set = client, null = team). Surface the distinction on the dashboard when it earns its keep (>8 pipelines in a workspace, or when client-facing dashboard ships). Step 5 implication: keep `company` optional (already is), no schema work, purely "don't accidentally make `company` required."
- **Soft-delete pipelines** — deferred to step 5. Spec: `pipelines.archived_at timestamptz` nullable + filter on dashboard list + archived pipelines route similar to recently-done shape.

### Lessons learned (apply forever)

1. **Reach for the storage-free design first.** When a feature can be expressed as a query over existing data (completion + day-boundary helper + 7-day window), don't reach for a new column. The dismiss flag we built and ripped out was a useful object lesson: an entire column + index + UI affordance + recovery route, all to encode a flag that completion already implies. Same UX falls out for free. **New column = new failure mode + new schema cost forever. Validate that no existing column + query combination delivers the same UX before adding one.**
2. **Browser-reserved keyboard shortcuts must be tested live.** ⌘N, ⌘T, ⌘W, ⌘R, ⌘Q are all unrecoverable in JavaScript — `e.preventDefault()` does not override them. Industry pattern is single-key shortcuts (Linear: C, Todoist: Q). Confirm with a manual press before spec'ing `⌘<letter>` for any in-app action. The visual hint badge (`<kbd>`) is ALSO a public commitment — don't add one until the shortcut has been live-tested in the target browser/OS.
3. **Color tokens are surface-dependent, not global.** Two greens on the same surface (Done badge + thisWeek pill in /my-tasks) collide visually even when "semantically distinct" — context is too thin to disambiguate at a glance. Color choices that look fine in isolation can fail when surfaced together. Audit color pairings as the surface populates, not in component-level previews.

---

## Phase 4a — step 4: My Tasks full view + deadlines (2026-05-20)

**Goal:** turn the `/w/[slug]/my-tasks` placeholder route (from step 2's "See all N →" link) into the real surface — all tasks assigned to the current user across pipelines, grouped by deadline, with inline date editing and quick-add. Step 3 (deadlines) folded into step 4 because `tasks.deadline` already exists from the step-0 migration; the work was UI + the date picker, not schema.

**Migrations (applied to remote, in order):**

- `20260520130000_create_task_rpc.sql` — security-definer RPC `create_task(stage_id, title, assignee_id default null, deadline default null)`. Atomic position computation (max(position)+1 in the target stage) plus the INSERT in one transaction. Permission gate matches the `tasks_insert` RLS rule (`can_edit_pipeline`). Assignee defaults to caller (quick-add self-assigns); explicit assignment + unassign land in task detail (step 6). Title trim + non-empty + 200-char cap. Direct INSERT would have passed RLS but `tasks.position` is `NOT NULL` with no default — the RPC removes a client-side race.
- `20260520140000_fix_create_task_ambiguous_stage_id.sql` — hotfix. Original migration shipped with `where stage_id = create_task.stage_id` which Postgres flagged as ambiguous (column vs function parameter, same name). Caught during smoke-test runs of the prior migration before any client wired to it. Fix: alias the `tasks` table (`from public.tasks t where t.stage_id = create_task.stage_id`). The earlier `stages` lookup used `where id = create_task.stage_id` so wasn't affected (no column called `stage_id` on that table).

**Route + components:**

- `src/app/w/[slug]/my-tasks/page.tsx` — server component, all initial data at page level. Same auth + redirect rules as the dashboard (anon → `/auth/signin?next=…`, client → portal, non-member → last-active or `/`).
- `src/components/my-tasks/MyTasksView.tsx` — client component, owns task list state, chip filter, search, hide-completed toggle. Optimistic updates for toggle-complete and deadline-edit; quick-add hydrates the new task into the local list from the RPC's return + a 1-row stage lookup for pipeline metadata.
- `src/components/my-tasks/TaskRow.tsx` — row component. Checkbox + title + subtitle (`[emoji] [pipeline name] · Stage [N] · [stage name]`) + bucket-colored pill. Click pill opens DatePickerPopover. Null deadline shows "+ Add date" dashed affordance. Done state: strikethrough title + muted color + "Done" badge replaces pill + sinks to bucket bottom (sort logic in MyTasksView). Click on row body (not checkbox / pill) logs the step-6 stub.
- `src/components/my-tasks/DatePickerPopover.tsx` — hand-rolled month calendar (no external dep). Quick-set row on top (Today / Tomorrow / Next week / Clear), month grid below with prev/next nav. Closes on outside-click, Esc, or select. Auto-flips up when near viewport bottom.
- `src/components/my-tasks/QuickAddRow.tsx` — dashed "Quick add task" row at the bottom of the list. ⌘N from anywhere on the page focuses its input. Pipeline picker pre-selects to `profiles.last_active_pipeline_id`. Submit creates via `create_task` RPC, task lands in No date bucket (no deadline at creation), input clears + keeps focus for rapid multi-add. Pipeline picker filters out pipelines with no stages (the RPC needs a stage_id target).
- `src/lib/task-buckets.ts` — shared bucketing helper. `bucketForDeadline()` + `bucketMatchesChip()`. Imported by future surfaces (canvas, task detail) so they bucket consistently with My Tasks AND the dashboard's My Tasks card.

**Pill colors (locked surface-dependent treatment):** My Tasks uses BUCKET-colored pills (urgency-first); dashboard uses PIPELINE-colored pills (context-first). Pipeline identity is carried in the My Tasks subtitle so moving urgency onto the pill loses nothing. Canvas (step 5) and task detail (step 6) each get their own pill-color decision when built — `"pill color" is now surface-dependent, not one global rule`.

**Verification (live, jordan as workspace owner of Test Workspace 4b):**

- 10 tasks seeded across all 6 buckets (Overdue / Today / Tomorrow / This week / Later / No date) including one completed task. Sections render in correct order; Overdue only appears when populated.
- Chip counts reconcile: All = Today (incl. overdue) + This week (incl. tomorrow) + Later + No date.
- Quick-set picker (Today / Tomorrow / Next week / Clear) writes the deadline immediately and moves the task to the right bucket.
- "+ Add date" on null-deadline task opens picker; selecting moves it out of No date.
- Quick-add defaults to `last_active_pipeline_id`, creates via the RPC, lands in No date, input stays focused.
- ⌘N focuses quick-add from anywhere on page.
- Checkbox toggle: strikethrough + Done badge + sinks to bottom of bucket.
- Hide completed toggle: removes completed + updates counts; chip math still reconciles.
- Search filters client-side by title.
- Row click → console.log step-6 stub.
- Test data cleaned (0 tasks, 0 stages remaining in workspace 4b) before commit.

**Two bugs caught + fixed during verification:**

1. **Chip-count reconciliation bug (logic).** Initial implementation of `bucketMatchesChip()` mapped `overdue → no chip except All`. Result: clicking any non-All chip hid the overdue tasks entirely — the most urgent bucket became the most-filtered-out, exactly backwards. Fix: fold overdue into the Today chip (overdue is max urgency, belongs with "deal with now"). Locked rule: **chip counts must always reconcile to All; non-reconciling counts = hidden-bucket logic bug.** Every bucket must map to exactly one non-All chip.
2. **Seed deadlines at midnight-UTC misbucketed in local dev (TZ preview).** Test data seeded with `(now())::date::timestamptz` — midnight UTC of today. Server running locally (ET) computes `todayStartMs` as midnight ET = 04:00 UTC. Tasks seeded for "today" landed at May 20 00:00 UTC = 4 hours before today's ET midnight → bucketed as Overdue. Tasks seeded for "tomorrow" landed at May 21 00:00 UTC = May 20 20:00 ET = "today" in ET. The bucket logic is correct — the seed straddled the TZ boundary. **Live evidence that real US users in their evening hours will see deadlines mis-bucket the same way.** Workaround in test data: use noon-UTC instead of midnight-UTC (inside the calendar day in every TZ from UTC-11 to UTC+11). Real fix is the TZ-cookie launch-prep item — confirmed not optional.

**Lessons learned (apply forever):**

1. **Chip filters must reconcile to a partition.** Whenever a chip filter exists alongside a category total, the sum of category counts must equal the total. Buckets that don't map to any chip silently disappear when the user filters — and almost always those are the buckets the user wanted to see (overdue is the canonical example). When designing chip filters, draw the bucket-to-chip mapping explicitly and verify every bucket has exactly one home in the chip space.
2. **Use noon-UTC for test deadlines, not midnight-UTC.** Midnight-UTC straddles the day boundary for every timezone west of UTC; using it in seeds will mis-bucket tasks in local dev and quietly mask bugs. Noon-UTC is inside the calendar day in every timezone (UTC-11 to UTC+11). This isn't a hack — it's how to write TZ-portable test data until the TZ-cookie fix ships. The same trap will catch real US users in their evening hours; the launch-prep TZ-cookie fix isn't optional, this is the live evidence.

---

## Phase 4a — steps 1 + 2: pipeline creation + workspace dashboard (2026-05-19 → 2026-05-20)

**Goal:** ship pipeline creation end-to-end (RPC + route + form) and replace the legacy in-memory `<App />` render at `/w/[slug]` with a real Supabase-data-driven dashboard. Closes Phase 3.4 paper cut #1 (blank workspace home) and the dashboard half of lesson #10 (legacy sign-in fallback for unauthed visits).

**Step 1 — `create_pipeline_with_channels` RPC + `/w/[slug]/p/new` route (commit `2943b34`, applied 2026-05-19).**

Atomic security-definer RPC inserts pipeline + owner pipeline_membership + 2 channels (`general` is_client=false, `client` is_client=true) + creator's channel_memberships, all in one transaction. Permission gate is `is_workspace_owner_or_admin` (same helper Phase 3.4 step 6 uses for workspace_invites). Route at `/w/[slug]/p/new` renders the create form inside AppShell with name + emoji preset picker; on success persists `profiles.last_active_pipeline_id` and routes to `/w/[slug]/p/[new-id]` (a Phase 4a step 5 stub for now).

Step 1 verification (chrome, jordan as agency owner):
- Happy path: created "Step 1 Verification" pipeline. Redirect → `/w/test-workspace-4b/p/[uuid]` returns 404, expected (canvas is step 5 stub).
- SQL spot-check: pipelines row created with name + emoji correct; `channels` has 2 rows (general/client); `pipeline_memberships` has 1 row with role='owner'. Clean.
- Anonymous branch (incognito): `/w/test-workspace-4b/p/new` redirected to `/` with the legacy sign-in screen. Functionally equivalent to `/auth/signin` (unauthed user blocked) — same legacy fallback documented in Phase 3.4 lesson #10. Full normalization to `/auth/signin?next=…` deferred to a Phase 4c step; step 2 closes the dashboard half of this gap directly.
- One pre-existing finding flagged for cleanup: Supabase default privileges grant `EXECUTE` to `anon`/`authenticated`/`postgres`/`service_role` on every RPC independently of PUBLIC, so `REVOKE FROM PUBLIC` alone leaves anon callable. The in-function `auth.uid() is null` check is the actual gate. Logged as a separate task — not a step 1 regression.

**Step 2 — Workspace dashboard at `/w/[slug]` (this commit).**

Server component, all data fetched at page-level (no client waterfalls). Replaces the legacy `<App />` render. Auth + redirect rules per spec: anon → `/auth/signin?next=/w/[slug]` (closes the dashboard half of lesson #10); client-only members in this workspace → `/portal/[first-pipeline-id]`; non-member with a `last_active_workspace_id` elsewhere → that workspace; otherwise → `/`.

Layout:
- **Greeting block** — `Hey [first-letter-capitalized firstname]! 👋` in a #263D5F highlight with #7FA7D9 text, subhead "What can we get done today?", date line. Greeting parses `display_name.trim().split(/\s+/)[0]` then capitalizes; null/empty → "Hey there! 👋".
- **My Tasks card** — top 5 non-completed tasks assigned to current user, sorted: overdue first → deadline asc → no-deadline by created_at desc. Date pills in pipeline color; overdue tasks get red titles, pills stay pipeline-colored.
- **Activity card** — top 5 events from `activity_events`, filtered to `member_joined / stage_advanced / pipeline_submitted / pipeline_created` (the 4 types the current schema can write); mentions/replies/assignments/completions deferred to 4b (needs schema expansion + writer triggers). Subtitle locked as "Recent updates from your team" — don't promise mentions we can't deliver yet.
- **Team chat strip** — always renders in step 2; permanent empty state ("no messages yet." + "Start a conversation" CTA stub). TODO comments mark the spots for 4b workspace-channel schema and Phase 6 `workspaces.plan` gating.
- **Pipelines section** — filter chips (Progress asc default → stalled first / Name / Recents) above a responsive grid (1/2/3/4/5 cols at sm/md/lg/xl/2xl). Each card renders emoji block, name, optional `🏠 [company]` line (per the figma), member cluster (3 avatars + `+N`), current stage with locked 3-state visual derivation, and progress bar.

Shared components introduced:
- **`<UserAvatar user={...} size={...} />`** — new, dashboard-only scope. Renders `profiles.avatar_url` when present; else proportional rounded-square (size × 0.25) with deterministic-hashed bg and initial fallback. Email used ONLY for the single-character initial fallback — never in `alt`/`aria-label`/`title` (guard against agency↔client email leakage). The existing `src/components/Avatar.tsx` + the inline Avatar inside `HeaderProfileMenu` stay untouched; migrating those is a follow-up.
- **AppShell header** restructured: contents wrapped in matching `max-w-[1600px] mx-auto px-6 sm:px-12` so the workspace switcher's left edge and the avatar's right edge align with the cards below. Header gets a search-bar visual placeholder (cmd+K is post-4a) + a "+ Pipeline" button when `activeSlug` is known.

Schema additions:
- Migration `20260519140000_tasks_created_at` — adds `tasks.created_at timestamptz not null default now()` for the third-tier sort in My Tasks (no-deadline tasks by creation desc).
- Migration `20260520120000_create_pipeline_company_param` — extends `create_pipeline_with_channels` with an optional `pipeline_company text default null` parameter so the create form can populate `pipelines.company` (column has existed since `20260508120000_initial_schema`, just had no writer path until now).

Storage migration (Supabase auth):
- Client switched from `createClient` (supabase-js, localStorage) to `createBrowserClient` (`@supabase/ssr`, cookies). New server-side client at `src/lib/supabase-server.ts` reads the same cookies via `next/headers` so RSC can resolve `auth.uid()` correctly. Without this pairing, the dashboard server component saw no session and looped to `/auth/signin` while the client showed authenticated — the infinite-redirect bug observed mid-build.

Bug surfaced + fixed during build (the actual reason the dashboard returned empty data before the FK fix):
- **PostgREST PGRST201 ambiguous embed.** The schema has two FKs between `stages` and `pipelines`: `stages.pipeline_id → pipelines.id` (the parent FK we want) and `pipelines.current_stage_id → stages.id` (auto_advance_stage back-pointer). PostgREST refused to embed without a hint and three queries (`myTasksRes`, `workspaceTasksRes`, `stagesRes`) all returned errors that collapsed to empty arrays via the `.data ?? []` fallback. My Tasks surfaced as an error state in the UI; the other two failed *silently* and made every pipeline card render "0/0 + No stages yet" even when the data was there. Fix: disambiguate explicitly with `pipelines!stages_pipeline_id_fkey!inner(...)` in all three queries. Verified against the live REST endpoint — returns `[]` (RLS deny) instead of PGRST201 with the FK hint.

Verification (live, jordan as workspace owner of Test Workspace 4b):
- Seeded test data: 3 stages (Discovery #DF1E5A, Design #E273C1, Delivery #21B159), 6 tasks (3 done, 3 not), 3 mock activity events from non-jordan actors, `company = 'Smoke Test Co'` on 7a.
- Pipeline card derivation: 7a showed "Design" with 3/6 progress + light-pink bar + solid colored dot. Matches the locked 3-state rule (partial completion → highest-position stage with any completed task).
- My Tasks: 2 visible (First draft / Tomorrow / pipeline color dot · Final delivery / no pill), sorted correctly.
- Activity card: 3 events rendered newest-first with avatars matching actor identity (Jordan Perez Google avatar, William Wayne initials).
- Avatar fallback: jordanperez1270+client@gmail.com (null display_name) renders "J" (first letter of email) — not the previous "4" (first hex char of uuid).
- Unauthed redirect: smoke-tested via `curl` against the production build server → HTTP 307 to `/auth/signin?next=/w/test-workspace-4b`.
- Test data fully cleaned before commit (0 stages, 0 tasks, 0 activity_events, company reset to null on 7a).

Polish landed in step 2 (figma alignment): square greeting highlight, type-scale tweaks (40/600 → 40/500 greeting, 30 → 34 subhead), 48px emoji boxes with #212124 bg + #36363A border across all cards, dotted-grid backdrop (`.dotted-grid` class color refreshed to #424242, applied to dashboard + create-pipeline page), responsive header padding (`px-6 sm:px-12`), responsive max-width 1200 → 1600, pipelines grid xl/2xl breakpoints, rounded-square avatar treatment (size × 0.25 proportional), hover-pill rows with negative-margin pattern, pipeline cards now render `🏠 [company]` when set, conditional `#7FA7D9` text-link color on active "See all" / "Open chat" links.

Two deviations from the original SPEC, both green-lit on disclosure:
1. **My Tasks `+` quick-add** is a placeholder explanation ("Quick-add lands in step 4") instead of a half-broken title-only composer — tasks need a `stage_id` and there's no way to derive one from title alone. Step 4 builds the full picker.
2. **Avatar call-site count** — the new UserAvatar has TWO call sites in step 2 (Activity rows + Pipeline cluster), not three. My Tasks rows use a pipeline-color dot per the row spec, not an assignee avatar.

Convention added this phase (see CLAUDE.md → Conventions):
- **Dashboard sections stay position-agnostic.** User-customizable section ordering is a planned v1.1+ feature, deferred until post-launch validation. Every dashboard section component must stay self-contained, must not hardcode vertical position, and must own its own data/empty/error states. Keeps the v1.1 customization a layout-shell change rather than a rewrite. Free now, expensive to retrofit.

Scope addition deferred to Phase 4a step 5 (canvas):
- **Soft-delete pipelines** via `pipelines.archived_at timestamptz null` + `archive_pipeline` / `restore_pipeline` RPCs + dashboard filter (`.is('archived_at', null)`) + Archived view. Permission gate: workspace owner/admin OR pipeline owner. Activity event types `'pipeline_archived'` / `'pipeline_restored'` added to the CHECK constraint as part of the same migration. Folded into step 5 rather than spawned as a separate chip — pipeline lifecycle is naturally cohesive with the canvas + settings UI.

**Lessons learned (apply forever):**

1. **PostgREST `.data ?? []` fallbacks mask query errors.** A query returning PGRST201 (ambiguous embed, missing FK hint, schema mismatch) hits the JS error branch but the page-level `.data ?? []` pattern silently substitutes an empty array — UI shows empty state, no console log, no error state, no banner. The bug was only caught because the *other* failing query surfaced via `myTasksRes.error` into the My Tasks card's error UI. When checking dashboard data, verify failures aren't masquerading as empty results: log `*Res.error` for each query, or wire a per-card error prop and make sure it's not always-null.

2. **Disambiguate multi-FK embeds explicitly.** Any pair of tables with more than one FK between them (stages↔pipelines is the live example; pipelines.current_stage_id back-pointer is the second FK) requires the `tablename!fk_constraint_name!inner` syntax to embed. PostgREST will not pick a default. Audit happens at the query-write step, not at runtime.

3. **Header alignment matters more than expected.** Aligning the AppShell header's contents with the dashboard body's max-width container costs one extra `<div>` wrapper but pays off across every workspace-scoped surface (workspace switcher ↔ greeting ↔ first card all share a left edge). Don't leave the header at full-bleed if the body is constrained.

4. **Storage mismatch between Supabase client + server clients is silent until you SSR.** The browser client at `createClient` (supabase-js, localStorage) doesn't share session storage with the server's `createServerClient` (@supabase/ssr, cookies). Sessions written by the client are invisible to the server, producing infinite redirect-to-signin loops when SSR pages gate on auth. Pair them: `createBrowserClient` on the client side, `createServerClient` on the server, both via `@supabase/ssr`.

5. **TZ caveat on server-side day boundaries.** Dashboard's "overdue" sort uses midnight-today computed in the server's local TZ (UTC on Vercel). For users west of UTC, deadlines that fall in their local "today" but after server UTC midnight will misbucket as not-overdue. Pre-launch blocker (US-based GHL beachhead is mostly west of UTC). Locked fix path: read user TZ from a cookie set client-side on first load, compute the day boundary in that TZ. Tracked in launch-prep checklist.

---

## Phase 3 — Checkpoint 3.4 COMPLETE: auth wiring + invite flows + identity linking (2026-05-19)

**Goal:** wire Supabase auth end-to-end, ship agency + client invite flows, add identity linking + linked-accounts settings, and verify everything via a two-browser end-to-end run.

**Outcome:** all 8 implementation steps shipped, §9 two-browser verification passed across every section that's testable in Phase 3.4's auth-only scope. Phase 3.4 is closed.

**What shipped (8 implementation steps + verification):**

1. **Steps 1–4 — auth wiring + post-login selector + AppShell** (commit `99f5c83`)
   - `/auth/signin` + `/auth/signup` (email+password and Google OAuth)
   - `/auth/callback` for the PKCE return trip
   - `useSession` + `useUserContexts` hooks
   - WorkspaceSelector + AppShell (logo, workspace switcher, profile menu) — the persistent chrome for `/w/[slug]/*` and `/settings/*`
   - `profiles.last_active_workspace_id` fix (commit `01ca048`) so workspace switches actually persist

2. **Steps 5–7 — workspace creation + invites** (commit `a74c070`)
   - `create_workspace_with_owner` RPC (atomic workspace + owner-membership)
   - Per-user duplicate-name check inside the RPC
   - `workspace_invites` table + `is_workspace_owner_or_admin` helper + `get_workspace_invite_preview` / `accept_workspace_invite` RPCs
   - `client_invites` aligned to the same shape (token=uuid, accepted_at, accepted_by, expires_at)
   - Public-grant hygiene migration (5 RPCs revoked from PUBLIC)
   - `/accept-invite/[token]` (8-state UI) and `/portal/accept/[token]` (10-state UI)
   - `/w/[slug]/settings/team` + `/w/[slug]/p/[pipeline-id]/clients` invite UIs
   - Email send via Resend + React Email templates (`@react-email/components` + `@react-email/render`); API routes use `SUPABASE_SECRET_KEY` for `auth.admin.generateLink`
   - localStorage side-channel (`setPendingAcceptInvite` / `consumePendingAcceptInvite`) so the invite token survives the sign-in / sign-up round trip

3. **Branding polish** (commit `f810f61`) — full Stages wordmark on all auth surfaces

4. **Step 8 — /settings/account: linked accounts** (commit `435ab36`)
   - 8a layout + AppShell `activeSlug` fallback to `last_active_workspace_id` for workspace-agnostic routes
   - 8b Linked accounts section: email+password card (with `user_metadata.has_password` flag for the Supabase quirk where `updateUser({password})` on a Google-linked user skips the email-identity-row creation) + Google card via `linkIdentity`
   - 8c dismissible "Set password" banner (localStorage-persisted), CTA expands the inline form and scrolls it into view
   - 8d Settings link in HeaderProfileMenu

5. **§3 prefill+lock fix** (commit `e76af3b`, surfaced by §9 verification) — `/accept-invite/[token]` → "Create account" was routing to a blank, editable email field, so a recipient could sign up with a different address than the invite. SignUpPanel now fetches the invite preview, pre-fills + locks the email, reframes the title around "Accept your invitation." Defense-in-depth: `accept_workspace_invite` already enforces the email match server-side (migration lines 274–279); both layers are commented to call out the threat model each addresses.

**§9 two-browser verification PASS summary:**

| § | Test | Result |
|---|---|---|
| 1 | Agency A signup + workspace creation (incl. duplicate-name) | PASS |
| 2 | Team invite send / copy / resend | PASS |
| 3 | Teammate accept; prefill+lock fix verified | PASS |
| 5 | Client accept via magic link → `pipeline_memberships` row confirmed via SQL | PASS (portal route is a Phase 4 stub) |
| 6.1 | Client → `/w/agency-a` → blocked | PASS |
| 6.2 | Client → `/w/agency-a/settings/team` → blocked | PASS |
| 6.3 | Teammate (member role) → `/w/agency-a/settings/team` → blocked (role gate) | PASS |
| 6.4 | Unauthed → `/w/agency-a` → no content | PASS |
| 6.5 | Unauthed → `/portal/[id]` → 404 (degenerate, route is Phase 4 stub) | PASS |
| 7 | Teammate workspace switcher shows only Agency A | PASS |
| 8 | Cross-agency isolation | SKIPPED — trusted via §6.3 role-gate verification |

Sections not run: §4 against Agency A (no pipeline-creation route exists yet — substituted with 7a Smoke Test Pipeline in Test Workspace 4b, which exercised the same `/clients` invite path).

**Known transitional gaps for Phase 4 (not §9 failures — documented for the next phase):**

1. `/portal/[pipeline-id]` needs its own auth gate when the view is built — server-side session check + verify `pipeline_memberships` row with `role='client'` for that pipeline.
2. Unauthed `/w/agency-a` renders the legacy in-memory app sign-in screen rather than redirecting to `/auth/signin`. Functionally equivalent (no protected content shown) but should normalize when the legacy app is replaced.
3. `/w/[slug]` renders blank for Supabase-only workspaces — legacy `<App />` uses `useAppState` in-memory data; doesn't know about Supabase-only workspaces. Per `CLAUDE.md → Known transitional state`, Phase 4 wires real Supabase queries inside the views.
4. Pipeline creation has no Next.js route. Currently a legacy in-memory action; Phase 4 needs either `/w/[slug]/p/new` or a modal POSTing to a `create_pipeline` RPC.

**Launch-prep checklist (open):**

- Supabase Pro upgrade — covers email rate limit (4/hr free) + 30-day session timeout + production sending volume. One upgrade resolves three blockers.
- Custom SMTP (Resend or similar) to lift the 4/hr email rate limit. Either redundant with the Pro upgrade or done in addition for cost reasons depending on volume.
- `/portal/[pipeline-id]` auth gate (Phase 4, see gap #1 above).

**Migrations added this phase:**

- `20260511120000_create_workspace_with_owner.sql`
- `20260512120000_block_duplicate_workspace_names.sql`
- `20260513120000_workspace_invites.sql`
- `20260514120000_client_invites_align.sql`
- `20260514130000_revoke_public_rpc_grants.sql`

**Lessons learned (apply forever):**

1. **Supabase redirect URL allowlist matters.** Magic-link `redirect_to` silently fell back to the project's Site URL because `/portal/accept/*` wasn't in the allowlist. Diagnosed via Supabase logs after a long debug session. Solution: add `http://localhost:3000/**` and the production URL wildcard. Always verify wildcards cover every redirect path before debugging "magic links go to the wrong place" symptoms.
2. **`@react-email/render` is separate from `@react-email/components` and `resend`.** Installing the latter two without the renderer ships broken email sends. Watch for missing-dep errors at runtime.
3. **PostgREST nested-select array-vs-object typing is unreliable.** A one-to-one nested select can come back typed as an array even when it's a single object. Cast through `unknown` and handle both shapes defensively in client code.
4. **Phase 3.4 §9 surfaced a real security finding** — `/accept-invite/[token]` signup form let recipients pick any email. The accept RPC enforced server-side, but the UX let an attacker (or confused user) create the wrong account. **The two-browser verification gate is non-optional precisely because it surfaces this class of UX-to-security gap.**

---

## Phase 3 — Checkpoint 3.3 COMPLETE: RLS verified (21/21) + bug fix migration (2026-05-09)

**Goal:** run all 21 SQL-editor tests in `RLS_TEST.md`, document each one's exact query and output, and only advance to 3.4 with a clean board.

**Outcome:** 21 of 21 pass.

**Real production bug caught and fixed mid-run.** Test 16 (admin without `can_submit` cannot submit) initially returned a silent `UPDATE 0` instead of the expected trigger error. Diagnostic chain (D1: `can_submit_pipeline` returns false ✓; D2: admin's pipeline_memberships row exists ✓; D3: `can_edit_pipeline`, `is_pipeline_agency_member`, `auth.uid()` all return correct values ✓; D4: admin and member both see 0 pipelines via SELECT) traced root cause to `pipelines_select` and `workspaces_select` only admitting workspace-level memberships and clients — pipeline-level agency members (anyone added directly via `pipeline_memberships` with role `owner`/`admin`/`member` but no `workspace_memberships` row) failed the SELECT and so PostgreSQL never matched any row for their UPDATE. The trigger never got the chance to fire. Same shape error in `workspaces_select`. **Production-impact bug** — every freelancer or per-engagement teammate added to a single pipeline would have been blind to it. Patched in `20260509130000_fix_pipeline_visibility.sql`, regression-tested Tests 1, 6, 8, 15, 16, then completed 17–21 — all green.

**Three migrations now in the production DB:**
1. `20260508120000_initial_schema` — 18 tables, indexes, constraints
2. `20260509120000_rls_policies` — 9 helper functions, 7 triggers, ~50 RLS policies, 2 private storage buckets + their policies
3. `20260509130000_fix_pipeline_visibility` — pipeline-level agency members can now SELECT their pipeline (and the workspace it lives in)

`npx supabase migration list --linked` shows all three in both Local and Remote.

**Per-test record:** `supabase/RLS_TEST_RESULTS.md` — each of the 21 tests has its impersonation setup, exact SQL, exact observed output, and pass/fail. Test 16 includes the full diagnostic chain (D1–D4), root-cause analysis, and re-run output post-fix. Anyone reviewing this can verify on a per-test basis without re-running.

**Process improvements logged (apply forever):**
1. **Always paste full `db push` output.** A previous session moved on to test setup assuming the push succeeded; the migration had silently never applied. Forces explicit confirmation.
2. **Always run `npx supabase migration list --linked` after a push** and confirm Local + Remote columns both list the new migration. The push-output check above is necessary but not sufficient — verifying via the list is the second confirmation.
3. **Always understand the WHY of test results, not just the WHAT.** Test 15 had been marked PASS at the same time Test 16 silently failed — both produced "0 rows updated," but for different reasons (15: `can_edit_pipeline` denied; 16: SELECT visibility hid the row). Without checking the WHY, the bug would have shipped. Going forward: when a test passes by absence (zero rows / no error), confirm the absence is for the documented reason, not a coincidence.

**Still gated to post-3.4 (these are NOT skipped, just out of SQL-editor scope):**
1. Two-browser test (real auth sessions, full UI flow per `CLAUDE.md → Security model → The two-browser test`).
2. Signed-URL HTTP storage probe (Browser B fetches Agency A's attachment URL → must `403`).
3. Application-layer Layers 2 & 3 of the internal-message defense (server-side `is_internal=false` write enforcement; client-portal render-side filter).

These run during 3.4 and 4 alongside the auth + real-data wiring work.

---

## Phase 3 — Checkpoint 3.3 (verification plan): RLS_TEST.md (2026-05-09)

**Goal:** partial verification of RLS policies via the SQL editor before adding more layers (auth in 3.4) on top.

**What landed:**
- `supabase/RLS_TEST.md` — 21-test checklist for the SQL editor. Three phases: (1) create 5 test users via the Auth dashboard with auto-confirm, (2) seed test data with fixed UUIDs via one big DO block, (3) run impersonated queries using `set local role authenticated; set local request.jwt.claims to '{"sub": "..."}';` wrapped in `begin/rollback` so mutations don't persist between tests. Each test has expected output and a pass/fail checkbox.

**Coverage of the 8 boundaries the founder listed:**
1. Cross-agency workspace isolation — Tests 1–4
2. Client cannot see other agency's pipeline — Test 7
3. Client cannot see internal channel messages — Tests 12–14b (incl. INSERT-block test)
4. Client cannot see hidden stages/tasks/notes/files — Tests 8–11 (incl. parent-gate enforcement)
5. Member cannot submit — Test 15 (RLS silent denial)
6. Admin without can_submit cannot submit — Test 16 (trigger raises)
7. Owner can submit — Test 17
8. Storage cross-agency probe — Test 18 (real HTTP probe waits for 3.4)

**Bonus tests added:** admin can_check_tasks scope (Tests 19–20), last-owner protection trigger (Test 21).

**Status:** awaiting founder to apply the RLS migration and run through the 21-test checklist.

---

## Phase 3 — Checkpoint 3.3 (SQL written): RLS migration ready to apply (2026-05-09)

**Goal:** the RLS migration that enforces every rule in CLAUDE.md → Security model. Plan was approved with answers to the five open questions; SQL implements those answers exactly.

**What landed:**
- `supabase/migrations/20260509120000_rls_policies.sql` — 9 helper functions (security definer stable), 6 triggers (handle_new_user, sync_profile_email, prevent_last_workspace_owner_removal, enforce_admin_can_check_tasks_scope, protect_pipeline_submission, enforce_client_task_update_scope, auto_advance_stage), `enable row level security` on every public table, ~50 RLS policies with plain-English comment blocks, two private storage buckets (`stage_attachments`, `pipeline_files`) with their object-level policies. Verification queries documented at the bottom (commented out — run manually post-apply).
- `CLAUDE.md` — the three-layer internal-message defense-in-depth section now explicitly warns future maintainers not to remove any layer thinking the others are sufficient. Each layer's threat model spelled out.
- `supabase/RLS_PLAN.md` — marked approved, answers to the five open questions documented inline so reviewers can trace plan → SQL.

**Apply path:** `git pull` then `npx supabase db push` from the founder's terminal.

**Verification gate (non-optional before 3.4):** the two-browser test documented in CLAUDE.md. Browser A (Agency A) sets up a pipeline + client invite + internal/public messages. Browser B (Agency B) probes for cross-agency leaks. Browser C (the client of A's pipeline) probes for visibility-scope and internal-message-privacy leaks. Every check must pass.

---

## Phase 3 — Checkpoint 3.3 (planning): RLS plan + security model locked (2026-05-09)

**Goal:** consolidate the security model in CLAUDE.md and write a per-table RLS policy plan. No SQL written this checkpoint — plan-and-review first, then SQL.

**What landed:**
- `CLAUDE.md` — "Permission model" section replaced and expanded into "Security model": role matrix (Owner / Admin / Member / Client), the three coexisting auth methods (password, Google OAuth, magic link) with identity linking, the four critical isolation rules (workspace, cross-agency, client visibility, internal-message privacy), explicit client write surface, submit-final-pipeline gate, storage bucket policies, pricing-driven seat-count gate for Phase 6, and the canonical two-browser verification test.
- `supabase/RLS_PLAN.md` — per-table policy plan (18 tables) in plain English; helper-function inventory (8 functions, all `security definer stable`); trigger plan (5-6 triggers including `auto_log_stage_advance` for activity events); storage bucket structure with path conventions and policy outlines; index audit confirming existing indexes cover RLS lookups; 5 open questions for founder review before SQL is written.

**Status:** awaiting founder approval of the plan. Once approved, `0002_rls_policies.sql` gets written + applied + verified via the two-browser test before any 3.4 work begins.

**Hard rule re-stated in CLAUDE.md:** the two-browser test (Browser A = Agency A, Browser B = Agency B, Browser C = client of A's pipeline) is non-optional. Phase 3.3 does NOT advance to 3.4 until every check passes.

---

## Phase 3 — Checkpoint 3.2: schema reviewed + CLI ready (2026-05-08)

**Goal:** Founder-approved schema migration ready to apply via the Supabase CLI once the us-east-1-az4 incident clears.

**Schema revisions applied during review:**
- `workspace_memberships.role` CHECK loosened to `('owner', 'admin', 'member')`. MVP only writes `'owner'`, but the column is pre-loosened to avoid the migration cost when an agency wants a workspace-wide admin role (cross-pipeline visibility without being a co-owner).
- `activity_events.actor_name text not null` added alongside `actor_id`. Both `stage_name` and `actor_name` are denormalized at write time so historical entries survive renames, deletes, AND user account deletions ("Sarah completed task X" stays correct forever).
- TODO comment added near `team_invites` / `client_invites` flagging the explicit decision to evaluate Supabase's native `inviteUserByEmail` flow during 3.4. If native handles both agency (email+password) and client (magic-link) cases cleanly, drop the custom tables. If not, keep them.

**Index audit:** all four query-pattern indexes already present:
- `channel_messages_channel_idx` on `(channel_id, created_at DESC)`
- `activity_events_pipeline_idx` on `(pipeline_id, created_at DESC)`
- `tasks_stage_pos_idx` on `(stage_id, position)`
- `stage_notes_stage_idx` on `(stage_id, created_at DESC)`

**CLI infrastructure:**
- `supabase` installed as a dev dependency (v2.98.2). No global install needed; commands run via `npx supabase ...`.
- `npx supabase init` ran cleanly — generated `supabase/config.toml` and `supabase/.gitignore`. Migrations directory preserved.
- `supabase/README.md` documents the apply flow (`login` → `link --project-ref fdukdjbrqtltqzhvmmsz` → `db push`) and the discipline that applied migrations are immutable; future schema changes go in new migration files.

**Status:** schema is **finalized but NOT applied**. Apply blocked on Supabase incident clearing.

**Pending storage-policy work for 3.3:** when RLS lands, storage bucket policies must be treated with equal scrutiny. The two-browser RLS test plan must include "client A tries to access client B's stage attachment via direct storage URL and gets denied." Storage is the second half of security; do not let it become an afterthought.

**Pending:** RLS policies + storage bucket policies (3.3) and auth wiring (3.4). RLS is the security gate — do not expose any of these tables to the publishable key without policies in place.

---

## Phase 3 — Checkpoint 3.1: Supabase client wired (2026-05-08)

**Goal:** install `@supabase/supabase-js`, set up env files, expose a typed client.

**What landed:**
- `@supabase/supabase-js` installed.
- `.gitignore` now allows `.env.example` while still ignoring `.env.local`.
- `.env.local` (gitignored) has the real project URL + publishable key.
- `.env.example` (committed) has clearly-fake placeholders.
- `src/lib/supabase.ts` — exports a `SupabaseClient` constructed from the env vars; throws at module load if vars are missing. Dev-only `window.__supabase` escape hatch for browser-console testing.
- `src/components/App.tsx` eagerly imports the client so it's constructed at app start.

**Connectivity test:** REST endpoint reachable (returns expected 401 "Secret API key required" for the publishable key — as designed). Auth endpoints time out, traced to a Supabase-side incident in us-east-1-az4 (active outage as of 2026-05-08, "several more hours" ETA per their status page). Code is verified at the source level; full end-to-end auth round-trip waits for the incident to clear.

---

## Phase 2 — Checkpoint E: client portal (2026-05-07)

**Goal:** Replace the PortalPlaceholder with the real `ClientPortal`. Add the new Files section that the prototype was missing.

**What landed:**
- `src/components/portal/ClientPortal.tsx` — full client portal with three tabs (Project / Chat / Files). Project tab: status pill, overall progress, action items, project journey of `clientVisible` stages with their visible tasks + visible notes. Chat tab shown only when the client is a member of at least one channel. Files tab unconditional.
- `src/components/portal/ClientPortalChat.tsx` — read-only-styled subset of the chat ecosystem reusing `MessageRow`, `ChannelComposer`, `ChannelRow`, `MembersAvatarStack`. Filters internal messages at render in addition to the storage-layer guard.
- `src/components/portal/ClientPortalFiles.tsx` — the new section. Rolls up `clientVisible` items from `pipeline.links` + `clientVisible` items from `stage.attachments` across all stages. Sorted newest-first. Image thumbnails with click-to-preview lightbox. Stage-attachment items show the colored stage badge. Read-only — no upload, no toggle, no delete.
- `src/components/App.tsx` — replaces `PortalPlaceholder` with the real `<ClientPortal />` and wires `sendClientChannelMessage` for client-side channel posts.
- `WISHLIST.md` — captures per-task notes (single field) as intentional MVP design. Notes that the asymmetry with stage notes (threaded) is on purpose: stage notes for ongoing commentary, task notes for quick reminders. Don't change without real customer signal.

**Verified:** dev server returns HTTP 200, no console errors. Agency-side flow still works (sign in → homepage → create pipeline → open). Source-reviewed the portal wiring (App.tsx → ClientPortal → tabs).

**Known limitation:** The full magic-link landing → portal experience can't be tested end-to-end in the in-memory stub setup, because the stub clears on page reload and the magic-link flow detects the token in the load useEffect at mount. Phase 4 (Supabase) makes this testable since the DB persists across navigations.

**Phase 2 complete.** All checkpoints A–E shipped. Sole feature addition during the refactor: inline task name editing in `ChecklistItem` (Checkpoint D3).

---

## Phase 2 — Checkpoint D3: stage page + links + remaining modals (2026-05-07)

See git history (`Phase 2 checkpoint D3`).

---

## Phase 2 — Checkpoint D2: chat ecosystem (2026-05-07)

See git history (`Phase 2 checkpoint D2`).

---

## Phase 2 — Checkpoint D1: pipeline view chrome + canvas + activity + members (2026-05-07)

See git history (`Phase 2 checkpoint D1`).

---

## Phase 2 — Checkpoint C: homepage / ClientList ecosystem (2026-05-07)

See git history (`Phase 2 checkpoint C`).

---

## Phase 2 — Checkpoint B: state hook + auth + app routing (2026-05-07)

See git history (`Phase 2 checkpoint B`).

---

## Phase 2 — Checkpoint A: foundation (2026-05-07)

**Goal:** lay TypeScript / lib / primitives groundwork without changing visible behavior.

**What landed:**
- `src/types/stages.ts` — full type set mirroring prototype shapes.
- `src/lib/{constants,format,buildStages,storage}.ts` — utilities + `window.storage` in-memory stub.
- `src/components/icons/{StagesLogo,WorkspaceIcon,StatIcons}.tsx`.
- `src/components/{Avatar,Toast}.tsx`.
- `src/app/globals.css` — `@layer components` ported from the prototype's `<GlobalStyles>` (`panel-card`, `btn-primary`, `btn-ghost`, `icon-btn`, `field`, `check-box`, `stage-node`, etc.).
- `src/app/page.tsx` — uses imported `StagesLogo` instead of inlining.

**Verified:** Hello-stages page renders identically (logo, wordmark, tagline, dotted grid, footer). No console errors.

**Phase 3 schema decisions locked** during checkpoint review — see [CLAUDE.md → Phase 3 schema decisions](CLAUDE.md). Seven flags surfaced from the prototype, all answered: drop owner columns, drop legacy `messages[]`, single `stage_notes` shape, mentions as `user_id`, multi-owner workspaces, all inline arrays become tables, normalized `read_state`.

**Pending for Checkpoint D — pipeline view:**
- **Inline task-name editing in `ChecklistItem`.** The prototype locks task names after creation (bug, not feature). Click the task text → inline editable input (Notion/Linear style). Enter saves, Escape cancels, blur saves. Permission gate matches `canEditDescription` (owner + admins). Don't trigger from clicks on deadline pill, visibility toggle, or note expand icon — only the text itself. UX should mirror the stage-description inline edit on StagePage. State handler already in place: `editTaskText` in `useAppState`.

**Pending for Checkpoint E — client portal:**
- **Add a Files section to `ClientPortal`.** The prototype has no receiving view for files the agency marked `clientVisible`. Surface them in the portal:
  - All `clientVisible` items from `pipeline.links` plus all `clientVisible` items from `stage.attachments` across every stage.
  - Sort newest-first. Image thumbnails. Stage-attachment items show the colored stage badge (same component the agency-side rolled-up Files tab uses).
  - Click an image to open the existing lightbox modal.
  - Read-only — no upload, no toggle, no delete.
  - Surface as a third tab next to Project / Chat, OR as a section below the project journey — pick whichever feels cleaner during implementation.

---

## Phase 1 — Skeleton (2026-05-07)

**Goal:** working Next.js scaffold deployed locally, on-brand, pushed to GitHub.

**Stack chosen:**
- Next.js 16.2.6 (App Router, `--no-turbopack` for predictability during migration)
- React 19.2.4
- TypeScript (strict)
- Tailwind v4 (CSS-based config via `@theme inline` in `globals.css`)
- lucide-react for icons
- Plus Jakarta Sans via `next/font/google` (replaces Geist)
- npm

**What landed:**
- Project scaffolded at `./stages/` with `create-next-app`. The prototype `Client Workspaces.jsx` stays at the parent dir as the source of truth.
- Brand palette wired up as Tailwind v4 theme tokens (`text-stages-text`, `bg-stages-bg`, etc.) — full set of colors ported from the prototype's `GlobalStyles`.
- Plus Jakarta Sans loaded via `next/font` with weights 400/500/600/700/800.
- Hello-Stages landing page rendering on `localhost:3000` — logo, wordmark, tagline, dotted-grid backdrop.
- `CLAUDE.md` written as the cross-session project memory; `AGENTS.md` (auto-generated, contains a Next 16 warning) preserved and imported from CLAUDE.md.
- Git repo initialized (auto by `create-next-app`), Phase 1 changes committed locally on `main`. Remote `origin` set to `https://github.com/jperez203-coder/stages.git` (HTTPS). **Push to GitHub is pending — local machine has no GitHub credential helper configured yet; once a PAT is set up, `git push -u origin main` will complete the phase.**

**Verified:** dev server starts clean on port 3000, page renders with correct font/colors. Brand palette utilities (`bg-stages-bg`, `text-stages-blue`, `dotted-grid`, etc.) confirmed in compiled CSS.

**Open items / flagged for later phases:**
- Prototype's full `GlobalStyles` utility class set (`panel-card`, `btn-primary`, `btn-ghost`, `icon-btn`, `field`, `check-box`, `stage-node`, etc.) NOT yet ported — they'll come over in Phase 2 alongside the components that use them.
- `StagesLogo` is currently inlined in `page.tsx`; will move to `src/components/StagesLogo.tsx` in Phase 2 alongside the rest of the component split.

**Next session — Phase 2:** refactor the monolithic JSX into module structure (`/components`, `/hooks`, `/lib`, `/types`). Get the prototype rendering identically to the artifact, still on a stub in-memory store.
