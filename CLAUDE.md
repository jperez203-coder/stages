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

## Permission model

Three tiers, all **per-pipeline** (not org-wide):

| Role | Can do |
| --- | --- |
| Owner | Full access. Only one who can submit the final pipeline by default. |
| Admin | Full edit access. Can submit *only* if owner flips that admin's `canSubmit` flag. |
| Member | View, comment, update tasks they're assigned to. |

**Client** is a role on a membership, not a separate kind of account — see [Identity model](#identity-model). A user with the `client` role on a pipeline sees only `clientVisible: true` items, and `internal: true` messages are filtered out at render in two places (defense in depth). Clients post into channels they're members of, with `internal: false` hard-coded server-side.

Auth (Phase 3 onward):
- **Default for clients** = magic-link only (no password). Lands directly on the portal. Email cached in localStorage so return visits show "Welcome back, [email] — send a new sign-in link?". Sessions long-lived (30 days).
- **Default for agency owners** = email + password.
- **Both methods can coexist** on one user via Supabase `identities`. A magic-link-only client who later creates their own workspace can add a password to the same `auth.users` row — no duplicate account.

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

## Reading order for a new session

1. This file.
2. [PROGRESS.md](PROGRESS.md) — what shipped most recently.
3. [`../Client Workspaces.jsx`](../Client%20Workspaces.jsx) — the prototype, source of truth for product scope. Specific sections only; full re-read only if needed.
