@AGENTS.md

# Stages — Project Memory

This file is the cross-session memory for working on Stages. Read it first; it captures what's stable. Phase-by-phase progress lives in [PROGRESS.md](PROGRESS.md). The original React prototype — the source of truth for product scope — lives one directory up at `../Client Workspaces.jsx` (~7,300 lines, single file).

## Product positioning

Stages is the **operating system for client services businesses** — agencies, consultants, freelancers. Core wedge: today these teams juggle ClickUp/Asana for work, Slack for chat, email for client communication, and Drive for files. Stages unifies all of that into one tool where every client interaction lives in the context of a structured pipeline.

The differentiator vs. Slack/Notion/ClickUp is that **the agency and the client work in the same system**, with each side seeing exactly what they need. The long-term moat is an AI knowledge base that can answer any question about any client by drawing on the structured stages data, chat history, files, and notes — something Slack and Notion can't do because they lack the underlying project structure.

The founder is non-developer with strong design instincts; the prototype is the source of truth for scope. Don't add features that aren't in it without asking.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router) |
| Language | TypeScript, strict mode |
| Styling | Tailwind v4 (CSS-based config in `globals.css`) |
| Icons | lucide-react |
| Type | Plus Jakarta Sans via `next/font/google` (400/500/600/700/800) |
| Backend | Supabase (Postgres, RLS, Auth, Storage) — wired up in Phase 3 |
| Email | Resend via Supabase Auth — Phase 3 |
| Hosting | Vercel — Phase 5 |
| Package manager | npm |

## Design tokens

Brand palette (exposed as Tailwind theme tokens — `bg-stages-bg`, `text-stages-blue`, etc.):

| Token | Hex | Use |
| --- | --- | --- |
| `stages-bg` | `#212124` | Page background |
| `stages-card` | `#2C2C2F` | Panel / card surfaces |
| `stages-border` | `#36363A` | Default border |
| `stages-border-hover` | `#4A4A50` | Hover border |
| `stages-text` | `#E4E4E7` | Body text |
| `stages-muted` | `#979393` | Secondary text |
| `stages-subtle` | `#71717A` | Tertiary / placeholder |
| `stages-blue` | `#108CE9` | Primary actions, mentions |
| `stages-green` | `#15B981` | Success, complete |
| `stages-red` | `#F43F5E` | Errors, destructive, unread |
| `stages-amber` | `#F59E0B` | Internal notes, deadlines-today |
| `stages-purple` | `#8B5CF6` | Admin role pill |

Stage rotation palette (12 colors): `#3BA5EE, #8B5CF6, #EC4899, #F59E0B, #10B981, #06B6D4, #F43F5E, #3B82F6, #A855F7, #14B8A6, #EAB308, #EF4444`. Stage index → color via `pickColor(idx % 12)`.

Typography: Plus Jakarta Sans throughout. Body 13–15px, headers 15–32px, mono used only inside `.field` value previews. Antialiasing on.

## Data model (mirrors prototype)

When in doubt, mirror the prototype's shapes — don't over-normalize. Refactor later when there's real usage.

- **Workspace** `{ id, name, ownerEmail, createdAt }` — owns many Clients (a.k.a. pipelines).
- **Client / Pipeline** `{ id, name, company, emoji, ownerEmail, workspaceId, members[], template, createdAt, lastEdited, currentStage, links[], activity[], stages[], channels[], submittedAt?, submittedBy? }`. Legacy `messages[]` exists at the top level — superseded by channels; will be cut at the schema step.
- **Member** (per-pipeline) `{ email, joinedAt, role: "member" | "admin", canSubmit: bool }`.
- **Stage** `{ id, name, description, deadline, color, completed, completedAt, notes[], tasks[], attachments[], clientVisible }`.
- **Task** `{ id, text, done, pos: {x,y} | null, deadline, note, clientVisible }`.
- **Stage note** `{ id, text, author, ts, editedAt?, clientVisible }` (threaded; legacy string/object shapes handled by `normalizeNotes`).
- **Channel** `{ id, name, isClient, memberEmails[], createdAt, createdBy, messages[] }`. **Hard rule: max one `isClient: true` channel per pipeline**, enforced in three places.
- **Message** `{ id, author, text, ts, mentions[], internal: bool }`.
- **Link / pipeline file** `{ id, label, url? | dataUrl?, kind: "url" | "image", fileName?, fileSize?, addedBy, ts, clientVisible }`.
- **Stage attachment** `{ id, label, kind: "image", dataUrl, fileName, fileSize, addedBy, ts, clientVisible }`. Rolled up into the pipeline-level Files tab.
- **Activity entry** `{ id, type: "stage_advanced" | "member_joined" | "client_created" | "pipeline_submitted", who, ts, stageName? }` — append-only.
- **Team invite** `{ token: { clientId, email, invitedBy, createdAt, accepted } }`.
- **Client portal invite** (magic-link) `{ token: { clientId, clientEmail, agencyEmail, accepted, ts, acceptedAt? } }`.
- **User template** `{ id, name, icon, description, ownerEmail, createdAt, stages: [{ name, tasks: string[] }] }`.
- **Session** (prototype shape) — currently splits into `{ email, role: "owner" | "member" }` for agency-side and `{ email, clientId, role: "client", token }` for clients. **This collapses in Phase 3** per [Identity model](#identity-model): one session shape with role resolved per active context, regardless of how the user authed.
- **Read state** keyed `${email}|${clientId}|${tab}` for unread badges; `|celebration` marker for one-time confetti.

## Identity model

**One user = one email.** A person who first joins as a client via magic-link can later create their own agency workspace and become an owner — using the same account. There is exactly one Supabase `auth.users` row per email, ever. Don't model "client users" and "agency users" as separate tables or namespaces; that conflates identity with role.

**Role is a property of the relationship, not of the user.** A user has a separate membership record per (user, workspace) and per (user, pipeline). The `role` column lives on the membership row. The same email can be `owner` of one workspace and `client` of a different workspace's pipeline at the same time, with no contradiction.

**Login → workspace switcher.** After authentication, fetch the user's full set of memberships across all workspaces and pipelines. If they have exactly one context, route them straight in. If multiple, render a switcher — each row shows the workspace or pipeline name plus the role they hold there (e.g. "Mikey's Tree Removals — client", "Apex Roofing Marketing — owner"). Once a context is selected, the agency-side vs client-portal UI choice follows from the role: `owner | admin | member` → agency UI; `client` → portal.

**Auth methods coexist on one user.** A typical client signs up via magic-link (no password). When that same person later upgrades to running their own agency workspace, they can add a password to the same account for faster sign-in. Supabase supports both auth methods on a single user via the `identities` table — use that, don't duplicate accounts.

## Security model

The canonical source of truth for who can do what. Everything else (RLS policies, app-layer gates, route guards) implements what's here.

### Roles

Four roles. The first three apply at the agency side; the fourth is the external-user role. All are properties of a **membership row**, not the user.

| Role | Scope | Read | Write | Notes |
| --- | --- | --- | --- | --- |
| **Owner** | workspace + pipeline | Full | Full | Workspace creator. The only role that can delete the workspace, manage billing, invite teammates at the workspace level, and submit the final pipeline by default. |
| **Admin** | pipeline | Full edit access on pipeline | All edits incl. stage/task/note/file/channel management | Can submit final pipeline only if the owner flips `pipeline_memberships.can_submit = true`. Can grant `can_check_tasks` to members (lower-stakes than `can_submit`). |
| **Member** | pipeline | View + comment | Toggle task `done` only if `can_check_tasks = true`; cannot edit stage structure | Default role for invited teammates. |
| **Client** | pipeline (one only, via magic-link) | Only rows flagged `client_visible = true` (stages, tasks, notes, files); only channels they're a member of; only non-internal messages | Toggle task `done` on `client_visible` tasks; post messages with `is_internal` forced to `false` | Cannot create channels, see internal channels/notes, manage members, edit anything else, or submit. Tracked via `pipeline_memberships` with `role = 'client'` only — no `workspace_memberships` row. |

### Identity stays the same across roles

See the Identity model section above. One user, one email, same `auth.users` row. The same person can simultaneously be an Owner of one workspace, an Admin on a different agency's pipeline, and a Client on a third — no contradiction, all enforced by membership rows.

### Auth methods (3.4 onward)

Three coexist on the same `auth.users` row via Supabase Identity Linking:

| Method | Primary use | Notes |
| --- | --- | --- |
| Email + password | Agencies (default) | Standard sign-up flow. |
| Google OAuth | Agencies + teammates | "Sign in with Google" on the auth screen. |
| Magic link | Clients (default), agencies (alternative) | Passwordless. Long-lived session (30 days) for clients so they don't constantly re-auth. |

A magic-link-only client who later creates their own agency workspace can add a password (or link Google) to the same account — no duplicate `auth.users` row. **Policies must not assume a specific auth method**, only that `auth.uid()` returns the stable user ID.

### The four critical isolation rules (the things RLS exists to enforce)

These are the policies that, if wrong, leak data.

1. **Workspace isolation.** A user can only read `workspaces`, `workspace_memberships`, and any descendants if they have an active membership in that workspace OR are a client on a pipeline that belongs to that workspace. Cross-workspace queries must return zero rows for non-members.
2. **Cross-agency isolation.** A user cannot query data from any workspace they don't belong to, by any means. RLS filters by membership, not by `user_id` presence in some unrelated table.
3. **Client visibility scope.** A client invited to pipeline X can only see:
   - The pipeline record itself
   - Stages where `client_visible = true`
   - Tasks where `client_visible = true` AND the parent stage is also client-visible
   - Stage notes where `client_visible = true`
   - Pipeline links where `client_visible = true`
   - Stage attachments where `client_visible = true`
   - Channels they're explicitly a member of
   - Messages in those channels where `is_internal = false`

   Anything not in this list is invisible to them, even via direct API access.
4. **Internal-message privacy is enforced in three layers.** Defense in depth, in order from most to least important:
   - **Layer 1 — RLS policy on `channel_messages`** filters `is_internal = true` from any SELECT a client runs. **The only layer that protects against direct API access.** If a client crafts a query bypassing the app entirely, this is what stops them.
   - **Layer 2 — Application server-side write enforcement** hard-codes `is_internal = false` for any message a client sends (in `clientToggleTask` / `sendClientChannelMessage` patterns). Protects against compromised client-side code attempting to set `is_internal = true` on outgoing messages.
   - **Layer 3 — Application render-side filter** on the client portal removes any `is_internal = true` message that somehow reached the browser. Protects against UI rendering bugs that might surface a message before the data fetch completed.

   **DO NOT remove any of these three layers thinking the others are sufficient.** Each protects against a different threat model. The most likely failure mode is a future maintainer (or sleep-deprived me in 2027) deleting one because it "looks redundant." It is not redundant — it is layered. Any change that touches one of these layers requires re-auditing all three.

### Client write surface (the only mutations clients can make)

Clients can:
- Toggle `tasks.done` on tasks where `client_visible = true` AND parent stage is `client_visible` AND they're a member of the parent pipeline as `role = 'client'`. *(Note: client task-checking does NOT require a `can_check_tasks` flag — that flag is for agency members. For clients, "tasks they're assigned to" == `client_visible` tasks.)*
- INSERT a `channel_messages` row in channels they're a member of, with `is_internal` forced to `false` by RLS WITH CHECK clause.

Clients **cannot**:
- Create / edit stages, tasks (other than `done`), notes, files, channels, members
- Toggle any visibility flag
- Submit pipelines
- Read anything outside the visibility scope above

### Submit-final-pipeline gate

Only specific roles can mutate `pipelines.submitted_at` / `pipelines.submitted_by`:

- Workspace owner of the pipeline's workspace: always.
- Pipeline-level admin: only if `pipeline_memberships.can_submit = true`.
- Member: never.
- Client: never.

### Storage bucket policies (security half #2)

Two private buckets with signed-URL access. Public buckets are not allowed.

| Bucket | Path convention | Holds |
| --- | --- | --- |
| `stage-attachments` | `{pipeline_id}/{stage_id}/{attachment_id}.{ext}` | Files uploaded on the stage page |
| `pipeline-files` | `{pipeline_id}/{link_id}.{ext}` | Pipeline-level Files & Links uploads |

Policies must enforce:
- Only authenticated users can upload.
- A user can only read a file if they're authorized to read the corresponding `stage_attachments` / `pipeline_links` row (joined by `storage_path = name`). For clients, that means the row's `client_visible = true`.
- File URLs are signed (time-limited), never public.
- Path encoding allows policies to extract `pipeline_id` via `(storage.foldername(name))[1]` for fast membership checks.

Storage gets the same scrutiny as table RLS. The two-browser test (below) explicitly probes "client A tries to fetch client B's file via direct storage URL — must 403."

### Pricing-driven gates (Phase 6 — Stripe billing)

Schema must support fast seat-counting for the Solo vs Team plan distinction. Definitions:

- **Agency seat** = a unique user with EITHER a `workspace_memberships` row in the workspace, OR a `pipeline_memberships` row with `role IN ('owner', 'admin', 'member')` on any pipeline in the workspace.
- **Client seat** = a `pipeline_memberships` row with `role = 'client'`. Always free, never counted.

Seat-count query (must be fast):
```sql
select count(distinct user_id) from (
  select user_id from workspace_memberships where workspace_id = $1
  union
  select pm.user_id from pipeline_memberships pm
  join pipelines p on p.id = pm.pipeline_id
  where p.workspace_id = $1 and pm.role in ('owner', 'admin', 'member')
) seat_holders;
```

Existing indexes (`workspace_memberships` PK on `(workspace_id, user_id)`, `pipelines_workspace_idx`, `pipeline_memberships_role_idx`) cover this. Don't enforce the seat cap in RLS — that's an application-layer pre-flight check before INSERTing a `pipeline_memberships` row with an agency role. RLS guards the perimeter; pricing guards the seat count above the perimeter.

### The two-browser test (the verification gate before 3.4)

After RLS + storage policies are written, this test runs before any auth-wiring or production deploy. Failure on any point = RLS is broken, do not advance.

**Browser A — Agency A:**
1. Sign up as Agency A, create Workspace A, create Pipeline A1.
2. Invite a client to Pipeline A1, upload a stage attachment.
3. In the client channel, post a public message AND an internal message.

**Browser B — Agency B (different email, incognito or separate browser):**
1. Sign up as Agency B, create Workspace B, create Pipeline B1.
2. Try to:
   - `select * from workspaces` → only Workspace B in result.
   - `select * from pipelines` → only Pipeline B1.
   - `select * from pipelines where id = '<Pipeline A1 id>'` → empty result.
   - `select * from channel_messages` → only B1's messages.
   - `GET <Pipeline A1's stage attachment direct storage URL>` → **403 Forbidden**.

**Browser C — the client of Pipeline A1 (third session):**
1. Should see Pipeline A1.
2. Should NOT see Workspace A as a top-level workspace.
3. Should NOT see Pipeline B1.
4. Should see only `client_visible` stages, tasks, notes, files for A1.
5. Should see ONLY non-internal messages in their client channel — the internal message must be invisible.
6. Should NOT see other Agency A pipelines (if any).

Every check passes or RLS is broken. **Two-browser testing is non-optional.** Phase 3.3 doesn't advance to 3.4 until this passes.

## Phase 3 schema decisions (locked)

Decided ahead of Phase 3 to inform schema design. The prototype's shapes (mirrored in `src/types/stages.ts`) are the *current* state, not the target. Phase 3 schema will diverge in these specific ways:

1. **No denormalized owner columns.** Workspaces and pipelines do not store `owner_email`. Owner is just a `workspace_memberships` (or `pipeline_memberships`) row with `role: 'owner'`.
2. **Drop `pipeline.messages[]` entirely.** It's legacy, superseded by channels in the prototype, never needed in Phase 3. No migration shim.
3. **Single `stage_notes` table.** No string/object/array shape variants — one normalized shape per row.
4. **Mentions reference `user_id`, not email strings.** Future-proof against email changes.
5. **Multi-owner workspaces.** Allowed via multiple `role: 'owner'` membership rows. Real agencies need this.
6. **All inline arrays become tables.** `pipeline.activity` → `activity_events`; `pipeline.links` → `pipeline_links`; `stage.attachments` → `stage_attachments`; `pipeline.channels` → `channels`; `channel.memberEmails` → `channel_members`; `channel.messages` → `channel_messages`. The last one matters most — `channel_messages` will grow large and needs RLS to filter `internal: true` for client viewers.
7. **Normalized `read_state` table.** Columns `(user_id, scope_type, scope_id, kind, last_read_at)` instead of concatenated string keys.

These answers pre-decide the schema; Phase 3 work is to express them as Postgres tables + RLS, not to revisit them.

## Target file structure (Phase 2 onward)

```
stages/
├── src/
│   ├── app/                  # Next.js App Router (routes, layouts)
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/           # Reusable UI components ported from prototype
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities, helpers, Supabase client
│   └── types/                # Shared TypeScript types
├── public/
├── CLAUDE.md
├── PROGRESS.md
└── AGENTS.md
```

## Conventions

- **Tailwind v4** uses `@theme inline` in `globals.css` — no `tailwind.config.js`. Brand colors are theme tokens; reference them as `bg-stages-bg`, `text-stages-blue`, etc.
- **Reusable utility classes** from the prototype's `GlobalStyles` (`.panel-card`, `.btn-primary`, `.btn-ghost`, `.icon-btn`, `.field`, `.check-box`, `.stage-node`, etc.) will be ported into `globals.css` `@layer components` during Phase 2 — keep the same class names so the migration is mechanical.
- **Components** are colocated by domain when reasonable, but flat under `/components` is fine while the codebase is small.
- **No CLAUDE.md/PROGRESS.md churn** unless something durable changed; phase-end updates only.
- **Push to `main`** directly until production. PR discipline starts when there are real customers.
- **Don't expand scope** beyond the prototype — flag missing/weird things, don't fix silently.
- **[v1.1 wishlist](WISHLIST.md)** captures intentionally-deferred features. Anything not in the prototype goes there, not into Phase 2 code. Don't act on wishlist items without explicit go-ahead.
- **Dashboard sections stay position-agnostic.** Customizable dashboard ordering (user decides whether pipelines, tasks, activity, etc. come first) is a planned v1.1+ feature, deferred until post-launch validation. NOT being built now. But every dashboard section component (the cards under `src/components/dashboard/`, plus future sections) must (a) be self-contained — no section assumes what renders above or below it, (b) not hardcode its vertical position or order, (c) own its own data fetching / empty / error states independently. Keeps v1.1 customization a layout-shell change (persist a per-user order, drag-to-reorder the shell) rather than a rewrite of every card. Don't couple sections to fixed positions or to each other.

## Known transitional state (Phase 3.4 → 4)

The AppShell global header (logo + workspace switcher + profile menu) is introduced in Phase 3.4 step 4c. Its workspace switcher fetches real data from Supabase via the `useUserContexts` hook. But the views nested under it (`ClientList`, `ClientBoard`, `StagePage`) still render in-memory stub data via `useAppState` — they don't consume the active-workspace context from the shell yet.

**During Phase 3.4 → Phase 4, switching workspaces in the AppShell switcher will update the URL (`/w/[slug]/...`) and write `profiles.last_active_workspace_id`, but will NOT change what the in-memory views display.** This is a known transitional state, not a bug. Phase 4 replaces `useAppState` with real Supabase queries; at that point the views will honor the active workspace from the URL.

Do NOT try to "fix" this during Phase 3.4 — it's the wrong layer. The fix is finishing Phase 4.

## Reading order for a new session

1. This file.
2. [PROGRESS.md](PROGRESS.md) — what shipped most recently.
3. [`../Client Workspaces.jsx`](../Client%20Workspaces.jsx) — the prototype, source of truth for product scope. Specific sections only; full re-read only if needed.
