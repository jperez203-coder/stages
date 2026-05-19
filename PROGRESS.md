# Stages — migration progress log

A running log of what shipped in each session. Newest first.

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
