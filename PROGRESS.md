# Stages — migration progress log

A running log of what shipped in each session. Newest first.

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
