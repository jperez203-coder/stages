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
- **Session (agency)** `{ email, role: "owner" | "member" }`.
- **Client session** `{ email, clientId, role: "client", token }` — magic-link only, 30-day expiry intended.
- **Read state** keyed `${email}|${clientId}|${tab}` for unread badges; `|celebration` marker for one-time confetti.

## Permission model

Three tiers, all **per-pipeline** (not org-wide):

| Role | Can do |
| --- | --- |
| Owner | Full access. Only one who can submit the final pipeline by default. |
| Admin | Full edit access. Can submit *only* if owner flips that admin's `canSubmit` flag. |
| Member | View, comment, update tasks they're assigned to. |

**Client** is a separate identity entirely — magic-link auth (no password), sees only `clientVisible: true` items, and `internal: true` messages are filtered out at render in two places (defense in depth). Clients post into channels they're members of, with `internal: false` hard-coded server-side.

Auth (Phase 3 onward):
- **Agency** = email + password (Supabase Auth).
- **Client** = magic-link only. Lands directly on portal. Email cached in localStorage so return visits show "Welcome back, [email] — send a new sign-in link?". Sessions long-lived (30 days).

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
