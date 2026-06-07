# Stages — Data Collection Inventory

**Status:** Slice 0 Part 0.A complete (user-provided data inventory). Parts 0.B–0.D are placeholders below, scheduled for follow-up sessions.

**Last updated:** 2026-06-06

**Purpose.** This document is the source of truth for what data Stages collects from its users, how it's stored, who can read it, what happens when it gets deleted, and which third parties touch it. It feeds directly into Slice S7 (Terms + Privacy Policy) and any future data-protection / GDPR / SOC-2 / vendor-questionnaire work.

**Method.** Inventory derived from a read-only audit of `supabase/migrations/` (54 files, schema state as of HEAD `7683767`) and the application source (`src/app/`, `src/components/`, `src/lib/`). Where the migration files and source code are ambiguous, items are flagged in Section 5 for founder review.

---

## Sensitivity scale

| Level    | Meaning                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------ |
| CRITICAL | Uploaded files (arbitrary user content), billing identifiers, raw auth credentials, payment intent     |
| HIGH     | Free-text client/agency content (chat, notes, task descriptions), invite tokens, email addresses       |
| MEDIUM   | Structural names (workspaces, pipelines, stages, tasks), display names, company names, membership rows |
| LOW      | Positions, timestamps, completion flags, enum values, system-generated IDs                             |

The "Risk if leaked" line is plain-English consequence framing — not a threat model.

---

# Section 1. User-provided data (Part 0.A)

For each category: what gets collected, where it lives, who can read it (plain-English RLS summary), what happens to it on delete, which third-party processors touch it, sensitivity, and risk if leaked.

## 1.1 Account data

### What
The user's identity: email address, password (or magic-link / Google OAuth instead), and display name. Optionally a company name (asked once at first-workspace creation, editable in settings).

### Stored
- **`auth.users`** (Supabase-managed table):
  - `email` — login email, also the primary contact
  - encrypted password hash (only for users who set a password — clients on magic-link have no password)
  - `raw_user_meta_data.full_name` — captured at signup
  - linked OAuth identities row in `auth.identities` (provider = `google` when applicable)
- **`profiles`** (our mirror, kept in sync via the `handle_new_user` and `sync_profile_email` triggers):
  - `id` — same as `auth.users.id`
  - `email` — mirrored from `auth.users.email`
  - `display_name` — user's chosen name; auto-populated from Google OAuth or signup form
  - `company_name` — added by `20260616120000_profiles_company_name.sql`; user's agency / company name, optional, max 80 chars (enforced client-side)
  - `avatar_url` — **not currently present** in schema (planned post-MVP per `WISHLIST.md`)
  - `last_active_workspace_id`, `last_active_pipeline_id` — UX hint columns (system-managed)

### RLS scope
- Users can SELECT their own profile, plus profiles of anyone they share a workspace or pipeline with (so teammate names and message author names can render).
- Users can UPDATE only their own profile row (display_name, company_name).
- INSERT and DELETE happen automatically via the `handle_new_user` trigger and the `auth.users` CASCADE — never directly by the client.

### Retention
- User deletion via Supabase Auth deletes the `auth.users` row, which CASCADEs to `profiles`, `workspace_memberships`, `pipeline_memberships`, `channel_memberships`, `user_billing`, `read_state`, and `user_templates`.
- Most authored-content columns (`stage_notes.author_id`, `channel_messages.author_id`, `tasks.assignee_id`, `tasks.completed_by`, etc.) are `ON DELETE SET NULL` — the content survives but the authorship attribution is wiped.
- `activity_events.actor_name` is denormalized: a text snapshot of the user's display name at the time of the event. Survives user deletion. **Trade-off:** durable audit trail vs. inability to "forget" the actor name from historical events.

### Processors
- **Supabase Auth** (passwords, sessions, OAuth orchestration)
- **Google** (for users who sign in with Google — Google sees Stages as an OAuth relying party)
- **Resend** (transactional email — receives email address + display name in `to:` headers for invite, day-12, day-28, etc. emails)
- **Vercel** (request logs may include user IDs in URL paths)

### Sensitivity
- Email + name + company name: **HIGH** (PII, primary identifier)
- Password hash: **CRITICAL** (Supabase managed; we do not have access to plaintext or hashes from app code)

### Risk if leaked
Email enumeration enables targeted phishing of Stages users. Display name + company name links a real-world identity to membership in specific workspaces, exposing the agency–client relationship.

---

## 1.2 Workspace data

### What
The workspace (= one agency's tenant boundary) and its URL slug. Created during onboarding.

### Stored
- **`workspaces`**:
  - `name` — agency/workspace name, free text, max 80 chars
  - `slug` — URL-safe identifier auto-generated from name by the `workspaces_auto_slug` trigger; user cannot customize directly
- **`workspace_memberships`**:
  - `workspace_id`, `user_id`, `role` (owner / admin / member), `joined_at`
  - No free-text user input — pure relationship + role flag

### RLS scope
- Only members of a workspace can read its row. Non-members cannot enumerate or discover workspaces.
- Membership reads scoped to fellow workspace members (so a team list can render).
- Only the workspace owner can rename, change roles, or delete. The `prevent_last_workspace_owner_removal` trigger blocks deleting the final owner row.
- New workspaces are created by any authenticated user via the `create_workspace_with_owner` RPC, which atomically inserts the workspace + the owner membership.

### Retention
- Workspace deletion is the broadest CASCADE in the system: it deletes the workspace row plus every dependent (memberships, invites, templates, all pipelines and their full subtree — stages, tasks, notes, channels, messages, files, activity events, billing). See Section 1 Cascade Diagram below.
- A user leaving a workspace deletes only their `workspace_memberships` row; workspace data is untouched.

### Processors
- **Supabase** (storage)
- **Vercel** (slug appears in URL paths, logged)

### Sensitivity
- **MEDIUM** — names often reveal the agency identity; slug is public to anyone who has the URL.

### Risk if leaked
A workspace name + member list discloses an agency's team composition. The slug is already de-facto semi-public (it's in every URL).

---

## 1.3 Pipeline structures (pipelines, stages, tasks, checklist items)

### What
The collaboration unit between an agency and one client. Holds the project's name, the agency-chosen company label for the client, the agency-defined stages (e.g. "Discovery", "Design", "Launch"), and tasks/checklists inside each stage. All free-text fields, written by agency-side users.

### Stored
- **`pipelines`**:
  - `name` — project name (free text, max 80 chars client-side)
  - `company` — client company label (free text, max 80, nullable)
  - `emoji` — visual marker
  - `submitted_at`, `submitted_by` — gated by `protect_pipeline_submission` trigger
- **`stages`**:
  - `name`, `description`, `color`, `deadline`, `client_visible` (default false)
- **`tasks`** (column was `text`, renamed to `title` in migration `20260519120000_phase_4a_data_model.sql`):
  - `title`, `description`, `deadline`, `note` (legacy field, retained), `assignee_id`, `pos_x`, `pos_y`, `client_visible`, `done`
- **`checklist_items`**:
  - `title`, `position`, `completed_at`, `client_visible` (inherits from parent task at INSERT via trigger)
- **`stage_notes`**:
  - `text` — free-form note authored by an agency member
  - `client_visible` (default false), `author_id`, `edited_at`

### RLS scope
- Agency members of a pipeline see the full tree.
- Clients (`pipeline_memberships.role = 'client'`) see only rows where `client_visible = true` AND every ancestor in the chain (stage → task → checklist item) is also `client_visible = true`. This is defense in depth — the cascade is enforced both in the policy and by the `cascade_stage_client_visible_from_tasks` migration.
- Writes are agency-only with one tightly-scoped exception: clients with visibility can toggle `tasks.done` and `checklist_items.completed_at`, restricted via the `enforce_client_task_update_scope` trigger. Members with `can_check_tasks` can toggle done on otherwise-restricted tasks.

### Retention
- Pipeline deletion CASCADEs to stages, tasks, checklist items, notes, attachments, channels, messages, links, and activity events.
- Workspace deletion CASCADEs through pipelines.
- User deletion sets author / assignee / completer fields to NULL on these rows; the content itself survives.

### Processors
- **Supabase** (storage)
- **Vercel** (logs include pipeline IDs in URL paths)

### Sensitivity
- Names + structure: **MEDIUM**
- Free-text fields (task descriptions, stage notes): **HIGH** — agencies routinely paste client briefs, internal critique, deadline negotiations into these fields. No server-side validation, no PII detection, no profanity / secret scanning.

### Risk if leaked
Stage/task names can disclose client trade secrets, launch timelines, or unannounced products. Stage notes commonly contain candid internal commentary that an agency would never want a client (or competitor) to see. Free-text fields are an unbounded vector — users may paste API keys, credentials, contracts, or PII.

---

## 1.4 Chat / channel messages

### What
Real-time messages exchanged between agency members and (in the dedicated client channel) the client.

### Stored
- **`channels`**:
  - `name` — channel name, free text
  - `is_client` — boolean; exactly one client channel per pipeline (enforced by partial unique index)
- **`channel_memberships`** — relationship table, no user-input fields
- **`channel_messages`** — the actual messages:
  - `text` — message body, free text, no length limit enforced server-side
  - `mentions` — `uuid[]` of mentioned user IDs (extracted client-side from `@`-tags)
  - `is_internal` — boolean; agency-only messages, hidden from clients
  - `author_id`, `created_at`

### RLS scope
**This is the highest-risk privacy surface in the system.** Three-layer defense (locked decision in CLAUDE.md):
1. **RLS policy (Layer 1):** SELECT requires channel membership; AND, for `is_internal = true`, the reader must also be an agency-side member of the parent pipeline. Clients are channel members but not agency members, so they cannot read internal messages via the API.
2. **Server-side write enforcement (Layer 2):** Application code hard-codes `is_internal = false` on writes from client users. The RLS WITH CHECK clause refuses `is_internal = true` from non-agency posters as a backstop.
3. **Render-side filter (Layer 3):** The client portal UI filters `is_internal = true` messages before rendering, so even if a leak occurred upstream, the UI wouldn't show them.

**Locked decision: none of the three layers may be removed.** Each defends against a distinct threat (compromised auth, server-code bug, client UI hack).

Messages are immutable in MVP — no UPDATE or DELETE policies. Realtime subscriptions are enabled (`20260526120000_enable_realtime_channel_messages.sql`).

### Retention
- Channel deletion CASCADEs to messages.
- Pipeline deletion CASCADEs through channels.
- User deletion sets `author_id` to NULL; the message text survives.
- **No retention policy** — messages live forever until the parent pipeline / workspace is deleted.

### Processors
- **Supabase** (storage + Realtime relay)
- **Vercel** (no message body in logs by default, but URL paths include channel IDs)

### Sensitivity
- **HIGH** for client-visible messages
- **CRITICAL** for internal messages (agency-only candor about clients, internal pricing discussions, etc.)

### Risk if leaked
Internal-message leakage to a client is the single most damaging foreseeable outcome in the app's threat model — it can destroy the agency–client relationship in one disclosure. Even client-visible messages may contain sensitive project information (campaign launch dates, financial figures, beta product details).

---

## 1.5 File uploads (Storage)

### What
Image files uploaded by agency users (and, in some surfaces, clients) attached to stages or to the pipeline-level Files & Links tab.

### Stored
- **Storage bucket `stage_attachments`** (private):
  - Path: `{pipeline_id}/{stage_id}/{attachment_id}.{ext}`
  - **`stage_attachments` table:** `kind` (currently `'image'` only), `label`, `file_name` (original filename), `file_size`, `storage_path`, `added_by`, `client_visible`
- **Storage bucket `pipeline_files`** (private):
  - Path: `{pipeline_id}/links/{link_id}.{ext}`
  - **`pipeline_links` table** (multi-purpose — also stores URL links, see § 1.6): for image rows, `storage_path`, `file_name`, `file_size` populated
- Access is always via Supabase-signed URLs — never via permanent public URLs.

### RLS scope
- Agency members of the pipeline can read all attachments.
- Clients can read an attachment only when the row AND every ancestor (parent stage for stage_attachments) is `client_visible = true`. Enforced at both the row level (table RLS) and the storage object level (storage.objects policy joins path back to the row).
- Storage policies migrated in `20260601120000_client_file_upload_rls.sql` and `20260602120000_pipeline_links_storage_path_binding.sql` bind the storage path to the row's visibility — agencies cannot reuse a path to bypass row-level visibility.

### Retention
- Attachment rows CASCADE on stage / pipeline / workspace deletion.
- **Storage objects do NOT automatically delete on row delete.** The DB row vanishes but the underlying file in the bucket may persist until a janitor cleanup cron purges it. **Locked decision (2026-06-06):** privacy-safe gap. The bucket SELECT policies require a joined metadata row to evaluate access — orphaned bytes are unreachable via any client path. A storage-janitor cron is tracked on `WISHLIST.md` ("Storage janitor (orphan bytes from deleted pipelines)"). Disclosure language in § 1.15.
- User deletion sets `added_by` to NULL; the file remains accessible to other members.

### Processors
- **Supabase Storage** (S3-backed; encrypted at rest per Supabase infrastructure defaults)
- **Vercel** (signed URL request flows pass through serverless functions)

### Sensitivity
- **CRITICAL.** Files are arbitrary user-uploaded content. Could be design comps, branding assets, contracts, screenshots of internal tools — anything. The application has no content inspection.

### Risk if leaked
A file leak surfaces the agency's working materials, the client's confidential assets, and potentially regulated content (HR docs, contracts, financial models). Signed URLs are time-bound, but anyone who scrapes one within the validity window can download.

---

## 1.6 Pipeline links (external URLs)

### What
Arbitrary URLs the agency (or, with a relaxation migration, the client) adds to the pipeline as references — Figma files, Google Drive folders, GitHub repos, anything else.

### Stored
- **`pipeline_links`** (same table as image uploads above, distinguished by `kind`):
  - `kind = 'url'`
  - `url` — the link text, free-form
  - `label` — optional user-provided description
  - `task_id` — optional association to a task (column added by `20260611120000_pipeline_links_task_id.sql`)
  - `client_visible` — visibility flag

### RLS scope
- Same as § 1.5: agency-all, client-only-if-`client_visible`.
- Clients can INSERT under restricted conditions per `20260603120000_client_url_insert_relaxation.sql`.

### Retention
Same cascade behavior as § 1.5 — deleted on pipeline delete.

### Processors
- **Supabase** (storage of the URL string only — the destination is not crawled or contacted by Stages)
- **The external target** the URL points to (out of our scope; users should expect any link they paste to be retained until the pipeline is deleted)

### Sensitivity
- **MEDIUM.** A URL is metadata; the linked-target content is not in our system. But a URL may contain identifying tokens (signed Drive links, shared Notion URLs) that grant access to the underlying resource.

### Risk if leaked
Tokenized URLs (e.g. Google Drive "anyone with link" or signed share URLs) effectively delegate access to the target. A leaked link is a leaked resource.

---

## 1.7 Invites (workspace + client portal)

### What
Email addresses of people the agency wants to add to a workspace (as teammates) or a pipeline (as a client). Plus the magic-link tokens that grant acceptance.

### Stored
- **`workspace_invites`** (current teammate-invite flow):
  - `token` — UUID, doubles as primary key and URL slug
  - `email` — invitee's email (free text, basic regex validation)
  - `role` — `'admin'` or `'member'` (CHECK constraint blocks `'owner'`)
  - `workspace_id`, `invited_by`, `created_at`, `expires_at` (7-day TTL), `accepted_at`, `accepted_by`
- **`client_invites`** (client-portal magic-link flow):
  - `token` — text PK
  - `client_email` — invitee's email
  - `pipeline_id`, `invited_by`, `created_at`, `accepted`, `accepted_at`
- **`team_invites`** — was superseded by `workspace_invites` in Phase 3.4 and dropped in `20260519120000_phase_4a_data_model.sql`. SQL-confirmed absent from production schema (2026-06-06). Not documented further.

### RLS scope
- Workspace owners/admins SELECT invites for their own workspace. Invitees themselves do not read the table directly; they call the `get_workspace_invite_preview(token)` SECURITY DEFINER RPC, which returns a safe preview.
- INSERT restricted to workspace owners/admins (and pipeline owners/admins for client_invites).
- Acceptance happens via the `accept_workspace_invite(token)` RPC, which validates the caller's email matches the invite email (case-insensitive), checks expiry, and atomically writes the membership row.
- DELETE is a hard delete by the inviter (revoke flow).

### Retention
- CASCADEs on workspace / pipeline deletion.
- The accepted-invite row is retained as an audit trail, including `accepted_by` and `accepted_at`.

### Processors
- **Resend** — receives the invitee email + token to send the invite message. Token in the email body is the access credential until accepted.
- **Supabase** (storage)
- **Vercel** (the accept URL hits a Next.js route, which logs the request)

### Sensitivity
- **HIGH.** The token is a bearer credential — whoever has the URL can accept (subject to the email-match check for `workspace_invites`).
- Email addresses themselves: **HIGH** (PII).

### Risk if leaked
A leaked `workspace_invites` row gives an attacker an email-token pair. Because acceptance enforces an email-match server-side, the attacker also needs to control the invitee's mailbox — but a leak of the token alongside compromise of the invitee email defeats the gate. The 7-day TTL bounds exposure.

For `client_invites`, the magic link uses Supabase Auth's standard magic-link flow; whoever has the URL gets a one-time signin to that pipeline as a client.

---

## 1.8 Templates (built-in + user-saved)

### What
Reusable pipeline scaffolds. Two flavors: **built-in** (shipped by Stages, seeded by `20260607120000_seed_builtin_starter_templates.sql`), and **user-saved** (created via "Save pipeline as template" by an agency user).

### Stored
- **`templates`** (shared workspace-scoped):
  - `name`, `description`, `emoji`
  - `workspace_id` — NULL for built-ins (read-only), NOT NULL for workspace-saved
  - `source_pipeline_id` — provenance pointer; `ON DELETE SET NULL` so the template survives source deletion
- **`template_stages`**: `name`, `description`, `client_visible`, `position`
- **`template_tasks`**: `title`, `description`, `client_visible`, `position`
- **`user_templates`** — **vestigial schema artifact.** Predates the `templates` / `template_stages` / `template_tasks` trio above. SQL-confirmed empty in production (0 rows, 2026-06-06). No code path writes to it; the `save_pipeline_as_template` RPC writes to the trio (confirmed by reading the RPC source in `20260608120000_save_pipeline_as_template_rpc.sql`). Scheduled for cleanup-drop per `WISHLIST.md` ("Drop vestigial `user_templates` table"). RLS policy is owner-only, so the empty table is invisible to all users and is not a leak vector.

### RLS scope
- Built-ins (templates with `workspace_id IS NULL`): readable by any authenticated user, never editable.
- Workspace-saved templates: readable by workspace members, editable by owners/admins of the workspace.
- `user_templates`: owner-only.

### Retention
- Workspace deletion CASCADEs to workspace-saved templates.
- Source pipeline deletion sets `source_pipeline_id` to NULL; the template itself survives.
- User deletion CASCADEs `user_templates`; sets `templates.created_by` to NULL.

### Processors
- **Supabase** (storage)

### Sensitivity
- **MEDIUM.** A saved template snapshots stage/task names and structure. These can reveal an agency's process methodology and may include client-specific naming if the source pipeline was used as the basis.

### Risk if leaked
Process IP exposure. Less acute than chat or files but still confidential.

---

## 1.9 Billing data

### What
Stripe-side billing identifiers and subscription state mirrored into our DB. **Stages never sees raw payment card data** — card collection happens entirely in Stripe's hosted Checkout iframe and Customer Portal.

### Stored
- **`user_billing`**:
  - `user_id` (PK), `stripe_customer_id` (Stripe Customer ID, e.g. `cus_...`)
- **`workspace_billing`**:
  - `workspace_id` (PK), `stripe_subscription_id`, `subscription_status` (CHECK-allowlisted to Stripe's 7 states), `plan` (`solo` | `team`), `trial_ends_at`, `current_period_end`, plus state-tracking columns added in Slices 5–6 (`day28_notified_at`, `day12_notified_at`)
- **`stripe_events`** (idempotency / audit log):
  - `event_id`, `event_type`, `received_at`, `payload` (full Stripe event JSON), `processed_successfully`
- **`seat_sync_log`** (audit log for the per-seat sync cron):
  - `workspace_id`, `stripe_subscription_id`, `to_qty`, `from_qty`, `delta`, `ran_at`, `status`, `error_message`
- **`profiles.is_founding_member`** (boolean) — added in Slice 5; eternal flag per locked decision.

### RLS scope
- `user_billing`: users SELECT/UPDATE only their own row. INSERT/DELETE service-role only.
- `workspace_billing`: only workspace owners and admins can SELECT. INSERT/UPDATE/DELETE service-role only — all writes flow through the Stripe webhook handler.
- `stripe_events` and `seat_sync_log`: RLS enabled, **zero policies** — service-role only. No user can read webhook payloads through the app.

### Retention
- `user_billing` CASCADEs on profile / user deletion.
- `workspace_billing` CASCADEs on workspace deletion.
- `stripe_events` and `seat_sync_log` are not CASCADEd to anything — they live indefinitely as audit logs.
- **Stripe-side data** (cards, charges, invoices, customer rows): governed by Stripe's retention policies, not ours. Stripe is the system of record for payment information.

### Processors
- **Stripe** — owns all payment data; we hold only the identifiers
- **Supabase** (mirror storage)
- **Resend** — receives email + name for day-12 / day-28 trial-lifecycle and founding-member emails
- **cron-job.org** — triggers the daily seat-sync and trial-lifecycle cron routes (sends only a Bearer token; no user data crosses the boundary)
- **Vercel** (webhook and cron routes log request metadata)

### Sensitivity
- Stripe IDs: **HIGH** (link to PCI-scope data at Stripe; in the wrong hands enable customer-impersonation attempts against the support team)
- `subscription_status`, `plan`: **MEDIUM** (commercial signal)
- `payload` in `stripe_events`: **HIGH** (contains Stripe's full event JSON, including customer details, plan IDs, amounts)

### Risk if leaked
Stripe customer IDs are not credentials in themselves but enable social-engineering against Stripe support. Webhook payloads expose financial transaction history. The webhook signing secret (env var `STRIPE_WEBHOOK_SECRET`) is the actual credential — flagged for Slice S3 review.

---

## 1.10 Read state & activity feed

### What
- **Read state**: per-user "last read at" markers used for unread badge rendering. Implicit — not user-typed.
- **Activity feed**: a denormalized append-only log of pipeline-level events (pipeline created, member joined, stage advanced, pipeline submitted) for the activity tab.

### Stored
- **`read_state`**: `user_id`, `scope_type` (`channel` / `pipeline_tab` / `celebration`), `scope_id`, `kind`, `last_read_at`
- **`activity_events`**: `pipeline_id`, `actor_id`, `actor_name` (denormalized text snapshot), `type`, `stage_name` (denormalized), `created_at`. UPDATE/DELETE not allowed (append-only).

### RLS scope
- `read_state`: users see only their own rows. Full CRUD on own rows.
- `activity_events`: agency members of the pipeline only — clients do not see the activity feed (deliberate, to avoid leaking team-operational signal). INSERT by agency members; trigger inserts also fire from `tasks_auto_advance_stage`.

### Retention
- `read_state` CASCADEs on user deletion.
- `activity_events` CASCADEs on pipeline / workspace deletion.
- `actor_name` denormalization is **deliberate** — it preserves "Jordan completed stage 'Design'" even if Jordan later leaves the workspace.

### Processors
- **Supabase** (storage)

### Sensitivity
- **LOW** for read_state.
- **MEDIUM** for activity_events (operational signal about who's active on what).

### Risk if leaked
Activity feed leakage discloses team activity patterns (who works when, what was advanced, who joined). Less acute than direct content leakage.

---

## 1.11 Pending emails queue

### What
Outbound transactional email queue. Pre-populated by triggers (e.g. first-pipeline welcome email) and crons (day-12 trial reminder, day-28 founding upgrade reminder). Sent by the `/api/cron/send-pending-emails` cron.

### Stored
- **`pending_emails`**:
  - `email_type`, `recipient` (email address), `recipient_name` (display name snapshot), `payload` (JSONB context), `send_after`, `sent_at`

### RLS scope
- RLS enabled, **zero policies** — service-role only. Authenticated and anon users see no rows.

### Retention
- **Locked decision (2026-06-06): up to 90 days.** A future Slice 0.X cleanup cron will run daily and delete `pending_emails` rows where `created_at < now() - interval '90 days'` (regardless of `sent_at` — even stale unsent enqueues drop). Tracked on `WISHLIST.md` ("pending_emails 90-day cleanup cron").
- **Current state**: until the cleanup cron ships, rows persist unbounded. The locked POLICY is 90 days; the implementation is forthcoming.
- Disclosure language in § 1.15.

### Processors
- **Resend** (recipient email + name in the outbound email)
- **Supabase** (storage)
- **cron-job.org** (triggers the send cron)

### Sensitivity
- **HIGH** — contains every email address Stages has ever sent transactional mail to, plus the names snapshot at send time.

### Risk if leaked
A bulk dump exposes the full user-email-list to attackers for phishing. The 90-day retention ceiling caps the historical exposure window once the cleanup cron ships.

---

## 1.12 Upgrade interest (waitlist)

### What
A waitlist / interest-capture form for users who want to upgrade but aren't ready to check out — captured on `/upgrade?source=...` paths and from in-app CTAs.

### Stored
- **`upgrade_interest`**:
  - `email` (free text), `source` (UI hint, e.g. `switcher_cta`), `plan_interest` (`'solo'` / `'team'` / NULL), `notes` (free text, 500-char cap), `user_id` (NULL for anonymous submissions)

### RLS scope
- Users SELECT only their own rows (for the "you're on the list" confirmation UX).
- Authenticated users INSERT under WITH CHECK binding `user_id = auth.uid()`.
- UPDATE/DELETE not allowed via policy.

### Retention
- `user_id ON DELETE SET NULL` — the row survives user deletion, but loses attribution. The `email` column persists even when the linked user is deleted, **which is a Right-to-Be-Forgotten gap.** A workspace-wide RTBF deletion handler is on `WISHLIST.md` as a CRITICAL pre-launch item ("RTBF (Right To Be Forgotten) deletion handler") that will sweep `upgrade_interest.email`, `pending_emails.recipient`, `activity_events.actor_name`, and any other PII-bearing surviving columns when a user requests account deletion. Until that ships, the gap exists; the Privacy Policy must hedge accordingly (see § 1.15).

### Processors
- **Supabase** (storage)

### Sensitivity
- **HIGH** — captures emails of prospective customers, including their stated plan preference, which is commercial-signal data.

### Risk if leaked
A waitlist dump is a high-quality lead list for a competitor, plus an email-enumeration vector for attackers.

---

## 1.13 What we explicitly do NOT collect

- **Payment card numbers, CVCs, expiry dates, ZIPs.** All card collection happens inside Stripe's hosted Checkout iframe and Customer Portal. We never see, store, log, or transmit raw card data. Stripe holds it under its PCI-DSS Level 1 attestation.
- **Browser fingerprints / device telemetry.** No analytics SDK is integrated as of HEAD `7683767`. Vercel collects standard request logs (IP, User-Agent, path) per its platform defaults; Supabase Auth tracks session metadata. Nothing else.
- **Geolocation.** Not requested via the browser geolocation API.
- **Microphone / camera / clipboard.** Not requested.
- **Cookies beyond auth.** Supabase Auth session cookie + Next.js routing cookies only.
- **Third-party tracking pixels.** None.
- **AI processing of user content.** **Zero AI/ML features in production today** — no embeddings, no classification, no LLM API calls against user data. See Section 4.

---

## 1.14 Cascade summary (retention at a glance)

| Trigger event              | What gets deleted                                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User account deletion**  | profiles, workspace_memberships, pipeline_memberships, channel_memberships, user_billing, read_state, user_templates. Author/assignee/completer fields on content set to NULL.   |
| **Workspace deletion**     | Workspace + all memberships, invites, templates, billing, pipelines (and their full subtree: stages, tasks, notes, attachments, links, channels, messages, activity events).     |
| **Pipeline deletion**      | All pipeline children: stages, tasks, checklist_items, notes, attachments, links, channels, channel_memberships, channel_messages, activity_events, pipeline_memberships.        |
| **Stage deletion**         | Tasks, checklist_items, stage_notes, stage_attachments rows. Pipeline's `current_stage_id` set to NULL.                                                                          |
| **Task deletion**          | Checklist_items.                                                                                                                                                                 |
| **Storage objects**        | **NOT automatically cascaded** when their row is deleted. Privacy-safe per RLS row binding; janitor cleanup tracked on WISHLIST.                                                  |
| **`pending_emails`**       | **Locked 90-day retention** (cleanup cron pending — see WISHLIST). Currently unbounded until cron ships.                                                                          |
| **`stripe_events`, `seat_sync_log`, `activity_events`** | Append-only logs with no retention policy. Survive indefinitely.                                                                                          |

---

## 1.15 Privacy-policy disclosure language (locked)

The following short clauses are pre-approved for inclusion in the forthcoming Privacy Policy (Slice S7). They reflect locked decisions from the Slice 0 Part 0.A audit. Privacy-policy authors can copy these verbatim or paraphrase, but the substance is locked.

- **Account deletion + audit logs** *(Q6 locked, intentional for audit integrity)*: "Your name may persist in workspace audit logs for actions you took, even after account deletion." (Source: `activity_events.actor_name` denormalization.)
- **Email delivery records** *(Q5 locked, 90-day retention)*: "We retain email delivery records for up to 90 days for support and debugging purposes." (Source: `pending_emails` 90-day retention policy. Cleanup cron forthcoming — see WISHLIST.)
- **File deletion** *(Q1 locked, storage orphan known + janitor pending)*: "File binaries may persist briefly after deletion request, pending storage cleanup janitor." (Source: Supabase Storage does not auto-cascade on row delete; RLS row binding still gates access while the binary persists.)
- **No AI processing** *(Section 4 locked)*: "Stages does not use AI/ML to process your content. If we add AI features in the future, we will update this Privacy Policy and offer an opt-out before processing your data." (Source: confirmed no AI/ML features at HEAD `7683767`.)
- **No card data** *(§ 1.13 locked)*: "We do not see, store, or transmit your payment card details. Card processing happens entirely on Stripe's hosted payment pages." (Source: Stripe Checkout + Customer Portal flow.)
- **Open RTBF gap** *(acknowledged, pre-launch blocker)*: Until the RTBF deletion handler ships (CRITICAL pre-launch WISHLIST item), the Privacy Policy must NOT promise full deletion of all PII columns on account deletion. Specifically, the `upgrade_interest.email`, `pending_emails.recipient` / `recipient_name`, and `activity_events.actor_name` columns survive account deletion today. Either ship the RTBF handler first, or hedge the policy language until it does.

---

# Section 2. Behavioral / telemetry data (Part 0.B)

**Status:** Part 0.B complete as of 2026-06-06.

Passively-collected data is anything that attaches to a user without them typing it: session cookies, request logs, webhook archives, realtime broadcasts, and processor-side telemetry at Vercel / Supabase / Stripe / Resend / cron-job.org. Same schema as § 1 — What / Stored / Access scope / Retention / Processors / Sensitivity / Risk.

**Methodology.** Comprehensive read-only sweep of the codebase at HEAD `7683767`: every API route, every `console.*` call site, the Supabase client configuration, `next.config.ts`, `package.json`, every `headers().get()` and `cookies()` usage, all `localStorage` / `sessionStorage` / `IndexedDB` access, and the realtime subscription wiring. Looked for analytics, monitoring, error-tracking, session-replay, fingerprinting, and tracking-pixel SDKs (PostHog, Plausible, Mixpanel, Amplitude, GA, Segment, Sentry, LogRocket, Datadog, New Relic, FullStory, Hotjar, Intercom, etc.). **None found in dependencies, code, or config.**

---

## 2.1 Authentication session (browser cookies)

### What
A JWT session token that authenticates the user to Supabase. Set automatically by Supabase Auth on signin and refreshed in the background.

### Stored
- **Browser cookies** (NOT localStorage — verified at `src/lib/supabase.ts`, which uses `@supabase/ssr`'s `createBrowserClient`):
  - `sb-{project-id}-auth-token` — JWT containing `auth.uid()`, expiry, and refresh token reference
  - `sb-{project-id}-auth-token-code-verifier` — PKCE code verifier during OAuth flows (transient)
- Server components read the same cookies via `next/headers` in `src/lib/supabase-server.ts` for RLS evaluation.

### Access scope
- HTTP-only cookies (Supabase default), so JavaScript on the page cannot read them.
- Sent automatically on every same-origin request to Vercel and Supabase.

### Retention
- **Magic-link sessions (clients)**: 30 days, per CLAUDE.md's documented identity-model decision (long-lived to avoid re-auth friction).
- **Password / OAuth sessions (agencies)**: Supabase Auth default (currently 1 hour access token + 1 year refresh token rotation).
- Cleared on signout or when the user clears browser storage.

### Processors
- **Supabase Auth** (signs the JWT, validates on every request)
- **Vercel** (cookies traverse the edge on every request)

### Sensitivity
- **CRITICAL.** The JWT is the user's bearer credential. Anyone with the cookie can impersonate the user until expiry / refresh-token revocation.

### Risk if leaked
Full account takeover until token rotation. Mitigated by HTTPS-only transport and `HttpOnly` cookie flag.

---

## 2.2 Client-side UI state (`localStorage`)

### What
Four UI-state keys, none of them analytics. All are client-side conveniences that survive a page reload.

### Stored
- `settings-add-password-banner-dismissed` — `"true"` string, set when user dismisses the "add a password" banner on `/settings/account`.
- `stages_recent_emoji` — JSON array of recently-picked emojis for the emoji picker (UX cache).
- `pending-accept-invite` — invite token (UUID) buffered between landing on `/accept-invite/[token]` and completing signin; cleared by `consumePendingAcceptInvite` immediately after signin completes (`src/lib/auth.ts`).
- `dismiss-missing-name-banner` — `"true"` string, set when user dismisses the "fill in your name" banner on the dashboard.

All four are wrapped in `try / catch` for private-browsing graceful degradation and guarded with `typeof window !== 'undefined'` for SSR safety.

### Access scope
- Browser-local. Same-origin only; no third party reads or writes these.

### Retention
- Until the user clears their browser storage or, for `pending-accept-invite`, until signin completes (typically seconds).

### Processors
- None. Purely client-side.

### Sensitivity
- **LOW.** No PII, no behavioral analytics, no cross-session tracking. Dismissal flags are UX preferences.

### Risk if leaked
Negligible. An attacker with browser access to one of these strings learns the user's emoji preferences or that they dismissed a banner.

**`sessionStorage` and `IndexedDB` are not used anywhere in the codebase** — confirmed zero references.

---

## 2.3 Server-side function logs (Vercel-captured `stdout` from API routes)

### What
Whatever Stages' API route handlers print to `console.log` / `console.warn` / `console.error`. Captured automatically by Vercel and surfaced in the Vercel dashboard under Logs.

### Stored
Logged from the following API routes (audited 2026-06-06):

| Route | What's logged | PII? |
| --- | --- | --- |
| `/api/billing/webhook` | Stripe event types, dedup hits, signature failures, handler exceptions. Logged values are Stripe IDs (`evt_…`, `sub_…`, `cus_…`), event types, and error messages. | Stripe identifiers only, no user email or name. |
| `/api/billing/checkout`, `/api/billing/founding-upgrade`, `/api/billing/portal-session` | Error messages + Supabase error codes on failure paths. No request bodies dumped. | None on the happy path. |
| `/api/invites/send`, `/api/client-invites/send` | Error details on lookup failures (Supabase error messages + codes). | None — error logs don't include the recipient email. |
| `/api/cron/sync-seats` | Workspace IDs on per-workspace error logs; aggregate counts on success. | Workspace ID only. |
| `/api/cron/expire-founding-trials` | Aggregate count of expired workspaces; admin-client init errors. | None. |
| `/api/cron/send-pending-emails` | Recipient email + Resend message ID per successful send (see § 2.4) — **this is the one PII-leaking log line**. | YES (recipient email). |

### Access scope
- Vercel dashboard, gated by Vercel team membership. Founder (Jordan) is the only team member today.
- Vercel staff have platform-level access under their DPA.

### Retention
- **Vercel default**: 1 hour to 7 days depending on plan tier. **Needs founder verification** — flagged in § 2.12.
- No external log shipper is configured (no Datadog, Axiom, Logflare integration in code or config).

### Processors
- **Vercel** (captures and stores function logs)

### Sensitivity
- **MEDIUM** on the email-log line in `src/lib/email.ts` — recipient email is PII.
- **LOW** elsewhere — logs are error messages and Stripe identifiers.

### Risk if leaked
A leaked Vercel log dump exposes (a) every email Stages has sent transactional mail to, recoverable to seed phishing campaigns; (b) Stripe identifiers that could enable social engineering against Stripe support. Mitigation tracked on WISHLIST ("Strip recipient email from success-path Resend log line").

---

## 2.4 Email delivery records (Resend + Vercel log line)

### What
Email send results — recipient address, Resend message ID, and success/failure status. Persists in two places: Vercel function logs (per § 2.3) and Resend's own dashboard.

### Stored
- **`src/lib/email.ts`** logs on success: `[email] Sent invite to {payload.to} via Resend (id: {result.data?.id})`. **This line captures the recipient email into Vercel logs.**
- **Resend dashboard** (`resend.com`): every email sent by the API key is visible to anyone with dashboard access, including subject, sender, recipient, send timestamp, and delivery status.
- The Resend SDK is called with `{ from, to, subject, react }` only — no `tracking` / `tags` options enabled — so opens / clicks are NOT explicitly captured by Stages-side code. **Whether Resend tracks opens / clicks platform-side regardless is a founder-side check** (Resend dashboard settings) — flagged in § 2.12.

### Access scope
- **Vercel logs**: see § 2.3.
- **Resend dashboard**: anyone on the Resend account with login access (currently the founder).
- **No app-side surface exposes this data** — the `pending_emails` queue table (§ 1.11) is the closest thing, and it has zero RLS policies (service-role only).

### Retention
- **Vercel logs**: see § 2.3 (1h–7d).
- **Resend dashboard**: per Resend's retention policy. **Needs founder verification** — flagged in § 2.12.

### Processors
- **Resend** (sends the email and logs it on their platform)
- **Vercel** (captures the success-path log line)

### Sensitivity
- **HIGH.** The aggregate of all email recipients over time is a complete list of every Stages-mailed person — including invitees who never signed up.

### Risk if leaked
Same as § 1.11 (`pending_emails`): a bulk dump is a phishing-grade contact list.

---

## 2.5 Cron heartbeat metadata (cron-job.org)

### What
The HTTP requests cron-job.org sends to the Stages cron routes, plus the JSON response bodies it receives. These persist in cron-job.org's own logging system.

### Stored
- **Outbound (cron-job.org → Stages)**: HTTP GET with `Authorization: Bearer ${CRON_SECRET}` header. The secret is the only sensitive header sent.
- **Inbound (Stages → cron-job.org)**: response bodies are aggregate counts only — verified at the 4 cron routes:
  - `/api/cron/sync-seats`: `{ summary: { scanned, synced, no_change, skipped, error }, ran_at }`
  - `/api/cron/send-pending-emails`: `{ processed, sent, ran_at }`
  - `/api/cron/expire-founding-trials`: `{ expired, ran_at }`
  - `/api/cron/enqueue-founding-day28`, `/api/cron/enqueue-trackb-day12`: aggregate counts of enqueued reminders
- **No PII in any response body** — no email addresses, no user IDs, no workspace names. Counts only.

### Access scope
- cron-job.org account holder (Jordan).
- cron-job.org platform staff under their TOS.

### Retention
- cron-job.org's own log retention policy applies. **Needs founder verification** — flagged in § 2.12.

### Processors
- **cron-job.org** (scheduler + log retention)

### Sensitivity
- **LOW** for response bodies (aggregate counts).
- **CRITICAL** for the Bearer secret — but it's a header, not stored in logs as a value (cron-job.org's UI shows it masked).

### Risk if leaked
Leaked cron logs reveal Stages' cron schedule and aggregate volume signal (e.g. "they enqueued 9 trial reminders on day X") — operational metadata, not user PII.

---

## 2.6 Supabase Realtime broadcasts

### What
Chat messages stream over Supabase Realtime to subscribed clients (the chat UI). Each `channel_messages` INSERT is broadcast in near-real-time.

### Stored
- **Wire data**: `{ id, channel_id, author_id, text, is_internal, created_at, mentions }` — the full new-message row payload.
- **At-rest data**: just the row in `channel_messages` (already covered in § 1.4).
- **Subscription wiring**: `src/app/w/(canvas)/[slug]/p/[pipeline-id]/chat/ChatBody.tsx` opens a `postgres_changes` subscription per channel; Supabase relays inserts that pass RLS.
- **Realtime was explicitly enabled on `channel_messages` in migration `20260526120000_enable_realtime_channel_messages.sql`** — no other tables broadcast.

### Access scope
- **RLS Layer 1 is honored on broadcast** — Supabase evaluates the same SELECT policy before relaying a row to a subscriber. Clients never receive `is_internal = true` rows.
- WebSocket transport (encrypted under HTTPS).

### Retention
- Broadcasts are ephemeral — no persistence on the Supabase Realtime layer beyond delivery. The persistent copy lives in `channel_messages` (§ 1.4).
- Supabase platform may log subscription / delivery metadata; **needs founder verification**, flagged in § 2.12.

### Processors
- **Supabase Realtime** (relay)

### Sensitivity
- Mirrors § 1.4 — **HIGH** for client-visible content, **CRITICAL** for internal messages.

### Risk if leaked
A Realtime relay breach would expose live message traffic to anyone with intercept access. The three-layer defense (RLS Layer 1 on broadcast + server-side `is_internal=false` enforcement on writes + client-side render filter) still applies because RLS is evaluated at broadcast time. CLAUDE.md's locked decision that none of the three layers may be removed continues to hold.

---

## 2.7 Vercel platform-level telemetry (out-of-app, captured automatically)

### What
Vercel captures request metadata for every incoming request as part of its platform — regardless of whether Stages' code references it. Stages does not extract any of this in app code (verified: zero matches for `x-forwarded-for`, `x-real-ip`, `user-agent`, `referer`, `referrer`, `request.ip`, or any `VERCEL_*` env var).

### Stored (at Vercel, not in our DB)
- Client IP address (derived from `x-forwarded-for`)
- User-Agent string
- Referer header
- Request URL path (which includes workspace slugs and pipeline IDs that ARE user data)
- Status code, response time, region (Vercel's own region tagging)
- Geolocation: Vercel may infer country / region from IP. **Needs founder verification** — flagged in § 2.12.

### Access scope
- Vercel dashboard (founder).
- Vercel platform staff under DPA.

### Retention
- Vercel's platform default. **Needs founder verification.**

### Processors
- **Vercel** (sole processor at this layer)

### Sensitivity
- IP address: **HIGH** (regulatory-grade PII in EU under GDPR).
- User-Agent + Referer: **MEDIUM** (behavioral signal).
- URL paths containing workspace slugs / pipeline IDs: **MEDIUM** (workspace identification possible from logs).

### Risk if leaked
A Vercel access-log dump can profile user activity patterns (when they logged in from where, on what device, which workspaces they accessed). Stages' code never touches this layer, but the data exists at Vercel.

---

## 2.8 Supabase platform-level telemetry (out-of-app, captured automatically)

### What
Supabase captures its own platform telemetry alongside the data Stages reads / writes:
- **Auth events**: signups, signins (success / failure), magic-link sends, password resets, OAuth identity links, signouts. Surfaced in the Supabase dashboard under Auth → Logs.
- **DB query logs**: depending on plan tier, some level of slow-query / error logging is retained.
- **Storage object access**: bucket reads and writes, with signed-URL request metadata.
- **Realtime subscription operations**: subscribe / unsubscribe, broadcast counts per connection.

### Stored (at Supabase, not in our DB)
- Timestamp, user ID, IP address (Supabase sees the IP via the edge), event type, success / failure.

### Access scope
- Supabase dashboard (founder).
- Supabase platform staff under DPA.

### Retention
- Per-plan default. **Needs founder verification** — flagged in § 2.12.

### Processors
- **Supabase** (sole processor at this layer)

### Sensitivity
- Auth event logs: **HIGH** (login pattern is sensitive metadata; failed-signin attempts can indicate targeted attacks).
- DB query logs: variable depending on what's logged.

### Risk if leaked
A Supabase log dump exposes login patterns and possibly query shapes against user data. Stages cannot disable these logs — they're platform-side.

---

## 2.9 Stripe-side telemetry (out-of-app, payment processor)

### What
Stripe captures everything that happens inside its hosted Checkout iframe and Customer Portal — card data, billing addresses, device fingerprints used for fraud detection, retry attempts, decline reasons, and so on. Stages never sees any of this directly.

### Stored (at Stripe)
- All of the above; covered by Stripe's documentation and DPA.

### Access scope
- Stripe dashboard (founder).
- Stripe platform staff under PCI-DSS and DPA.

### Retention
- Per Stripe's policies — typically 7 years for transaction records to satisfy financial regulations.

### Processors
- **Stripe** (sole processor at this layer)

### Sensitivity
- Card data: **CRITICAL** but governed by Stripe under PCI-DSS Level 1, not Stages.
- Fraud-detection signals: **HIGH**.

### Risk if leaked
A Stripe-side breach is governed by Stripe's incident response and our DPA. Stages' role is to record this processor relationship in the Privacy Policy and inform users.

---

## 2.10 What we explicitly do NOT collect (Part 0.B reinforcement)

Repeating and extending § 1.13 with the audit-confirmed zero-findings from this slice:

- **No analytics SDK installed.** Verified across `package.json` and `package-lock.json`: no PostHog, Plausible, Mixpanel, Amplitude, Google Analytics (`gtag`, `react-ga`, `@google-analytics/*`), Segment, Heap, June, or similar.
- **No error monitoring / session replay.** No Sentry, Datadog, New Relic, LogRocket, FullStory, Hotjar, Smartlook.
- **No support widgets.** No Intercom, Crisp, HubSpot chat, Drift, Pylon.
- **No tag managers.** No GTM, no Adobe Launch.
- **No middleware.** `src/middleware.ts` does not exist; no `Set-Cookie` headers are injected from a middleware layer. No header / cookie rewrites.
- **No `next.config.ts` telemetry.** Inspected — file contains only a Turbopack cache-disable flag for dev. No `analytics`, `images.loader: 'imgix'`, custom headers, redirects, or rewrites that touch user data.
- **No request-metadata extraction.** Codebase has zero references to `x-forwarded-for`, `x-real-ip`, `user-agent`, `referer`, `referrer`, `request.ip`, or any `VERCEL_*` env var. Stages does not log IPs, UAs, or referrers itself — though Vercel may capture them at the platform layer (§ 2.7).
- **No Service Workers / Web Workers.** Verified — `public/sw.js` does not exist; no `navigator.serviceWorker.register(...)` calls; no `new Worker(...)` calls.
- **No browser permission requests.** No `navigator.geolocation`, `Notification.requestPermission`, `navigator.mediaDevices.getUserMedia`, or `navigator.permissions.query` calls.
- **No third-party tracking pixels** in any page template.
- **No font tracking.** Plus Jakarta Sans is loaded via `next/font/google`, which Vercel self-hosts at build time — no runtime call to Google Fonts.
- **No Resend open / click tracking enabled** by Stages' SDK calls. (Resend may track at the platform layer regardless — that's the founder-verification item below.)
- **No cookies beyond Supabase Auth.** Verified — zero app-level `Set-Cookie` calls.

---

## 2.11 Cascade summary — Part 0.B retention at a glance

| Layer | What | Retention | Notes |
| --- | --- | --- | --- |
| Browser cookies | Supabase Auth JWT | 30d (clients) / 1y (agencies) | Cleared on signout |
| localStorage | UI state (4 keys) | Until user clears storage | No PII, no analytics |
| Vercel function logs | App-side `console.*` output | Vercel plan default (1h–7d) | Email recipient appears on one log line (WISHLIST entry to strip) |
| Vercel platform logs | IP / UA / referrer / paths | Vercel platform default | Founder to verify |
| Resend dashboard | Email send history | Per Resend retention | Founder to verify |
| cron-job.org logs | Request + response bodies (no PII) | Per cron-job.org retention | Founder to verify |
| Supabase Auth logs | Login events, IPs | Per Supabase plan | Founder to verify |
| Supabase DB logs | Query / error logs | Per Supabase plan | Founder to verify |
| Supabase Realtime | Ephemeral broadcast (RLS-filtered) | None at relay; persistence in `channel_messages` | RLS Layer 1 active on broadcast |
| Stripe dashboard | Card + fraud + transaction data | ~7 years (Stripe policy) | Outside Stages' control |

---

## 2.12 Open items for founder verification

**Status (2026-06-06):** All items in this list have been addressed by Part 0.C — see specifically:

- Items 1–6 (processor-side dashboard verifications) → **consolidated into § 3.9** (founder verification checklist, 25 numbered actions grouped by processor).
- Item 7 (`stripe_events` retention) → **WISHLIST entry** "`stripe_events` 90-day purge cron" — locked at 90 days, mirrors the `pending_emails` cleanup.
- Item 8 (DPAs + sub-processors) → **resolved categorically by § 3** (each of the six processors fully inventoried).

The original list is preserved below for traceability.

1. **Vercel function log retention window.** Default depends on plan tier. → § 3.4 ("Retention" attribute) — public values: Hobby 1h / Pro 1d / Enterprise 3d / Observability Plus 30d. Founder must confirm plan tier (§ 3.9 item 14).
2. **Vercel access / edge log retention** + geo-tagging. → § 3.4 + § 2.7.
3. **Supabase plan-tier log retention.** → § 3.1 ("Retention" + "Certifications") — windows are in the DPA itself; founder must check signed DPA (§ 3.9 items 1–2).
4. **Resend platform-side open / click tracking.** → § 3.9 item 13.
5. **Resend log retention.** → § 3.3 ("Retention") — 30d backup / 90d post-termination. Founder verifies active-account log lookback in dashboard (§ 3.9 item 12).
6. **cron-job.org log retention.** → § 3.5 ("Retention") — unspecified; founder documents lookback (§ 3.9 item 20). Migration recommended (§ 3.5 + WISHLIST "Migrate cron triggers to Vercel Cron").
7. **`stripe_events` purge policy.** → WISHLIST "`stripe_events` 90-day purge cron" (locked at 90 days).
8. **DPA / sub-processor agreements.** → § 3.1–§ 3.6 (each processor inventoried) + § 3.9 (counter-signatures and downloads enumerated).

---

---

# Section 3. Third-party data sharing (Part 0.C)

**Status:** Part 0.C complete as of 2026-06-06.

Every external service that touches Stages user data, inventoried against 11 attributes (role, data flow, residency, DPA, sub-processors, retention, certifications, deletion process, breach SLA, security contact, sub-processor URL). Each attribute is labeled:

- **[PUBLIC]** — citable from the processor's public trust / security / DPA / privacy pages, with URL.
- **[FOUNDER]** — needs Jordan to check a dashboard or contact support. Consolidated checklist in § 3.9.
- **[N/A]** — the attribute doesn't apply to this processor.

**Six processors in scope.** Researched via direct fetch of each processor's public trust/security/DPA/privacy pages on 2026-06-06.

---

## 3.1 Supabase — Postgres + Auth + Storage + Realtime

**Role.** Primary backend. Hosts the entire `public` schema (every table from § 1.1–§ 1.12), Supabase Auth (cookies session per § 2.1), Storage buckets (`stage_attachments` and `pipeline_files`), and Realtime channel for `channel_messages` (§ 2.6). [PUBLIC]

**Data flow in.** All user-typed content per § 1; all Auth metadata; all uploaded files; signing-time cookie tokens.

**Data residency.** Single-region per project, on AWS. [PUBLIC — [regions list](https://supabase.com/docs/guides/platform/regions)] [FOUNDER] Confirm Stages' actual region in dashboard.

**DPA.** Self-service DPA published; counter-signed copy executable via dashboard. [PUBLIC — [DPA landing](https://supabase.com/legal/dpa), [DPA PDF](https://supabase.com/downloads/docs/Supabase+DPA+260601.pdf)] [FOUNDER] Execute counter-signed copy.

**Sub-processor list.** AWS (infra), Google LLC, Fly.io, HubSpot, Notion, Slack, Sentry, Stripe, Twilio, GitHub, Salesforce/Tableau, OpenAI, Common Room. **Published as PDF only** — embedded in the Transfer Impact Assessment. No standalone HTML page. [PUBLIC — [TIA PDF](https://supabase.com/downloads/docs/Supabase+TIA+250314.pdf)]

**Retention.** Paid databases backed up daily with Point-in-Time Recovery. Specific post-termination windows are in the DPA. [PUBLIC for backup cadence — [Security page](https://supabase.com/security)] [FOUNDER] Confirm exact termination retention in signed DPA.

**Certifications.** SOC 2 Type II (annual), ISO/IEC 27001:2022, HIPAA, PCI DSS, GDPR. SOC 2 Type II report gated to Team or Enterprise plan. [PUBLIC — [Trust portal](https://trust.supabase.io/), [SOC 2 guide](https://supabase.com/docs/guides/security/soc-2-compliance), [HIPAA guide](https://supabase.com/docs/guides/security/hipaa-compliance)] [FOUNDER] Download SOC 2 report (requires plan tier check).

**Data deletion.** Project-level delete wipes DB + Storage. App-level user delete cascades via Stages' FKs (see § 1.14) and, when the RTBF handler ships (see WISHLIST), also clears denormalized PII. Backups age out per PITR window. [PUBLIC] [FOUNDER] End-to-end deletion sweep test with a throwaway test user (instructions in § 3.9).

**Breach SLA.** Inherits GDPR Article 33 "without undue delay". No published hour count. [FOUNDER] Confirm exact clause in signed DPA — typically 48–72h in this template.

**Security contact.** [security@supabase.io](mailto:security@supabase.io) + [security.txt](https://supabase.com/.well-known/security.txt). General incidents via dashboard support ticket. [PUBLIC]

**Sub-processor URL.** PDF only — [TIA](https://supabase.com/downloads/docs/Supabase+TIA+250314.pdf). [PUBLIC]

---

## 3.2 Stripe — Payment processing

**Role.** Payment card collection (hosted Checkout), Customer Portal, subscription state, invoicing, webhook event delivery. **Stages never sees raw card data** (PCI scope offloaded). [PUBLIC]

**Data flow in.** Card details via Stripe-hosted iframe; customer email at checkout; subscription state changes; Customer Portal interactions. Webhook events flow back to Stages and persist in `stripe_events` (§ 1.9 + § 2.4).

**Data residency.** Global multi-region on AWS as primary cloud sub-processor. No EU-only residency tier on self-serve. EU→US transfers under EU-US DPF + SCCs. [PUBLIC — [DPA §11](https://stripe.com/legal/dpa)]

**DPA.** Auto-incorporated into the Stripe Services Agreement — no separate signature for self-serve. [PUBLIC — [DPA](https://stripe.com/legal/dpa), [DPA FAQ](https://stripe.com/legal/dpa/faqs)]

**Sub-processor list.** Public, curated list. Includes AWS (US + India), hCaptcha (Intuition Machines), Verifi, LegitScript, Ekata, Twilio, Microsoft, plus BPO support vendors (TELUS, Teleperformance, TDCX, Cognizant, WNS) and identity verification (Trulioo, Shufti, LexisNexis). **30-day advance notice for new sub-processors.** [PUBLIC — [list](https://stripe.com/service-providers/legal)]

**Retention.** ≥5 years after end of business relationship or last transaction (driven by AML / KYC). Biometric ≤1 year. Call recordings ≤1 year (≤5 years for support). [PUBLIC — [Privacy Center](https://stripe.com/legal/privacy-center)]

**Certifications.** PCI DSS **Level 1** Service Provider, SOC 1 Type II, SOC 2 Type II (annual), SOC 3 (public), EMVCo Level 1 & 2, PA-DSS, TrustArc CBPR + PRP, EU-US DPF (with UK + Swiss extensions). **No prominently-listed ISO 27001. No HIPAA BAA** (Stripe does not offer one — payments data is not PHI for our use case). [PUBLIC — [Stripe security](https://docs.stripe.com/security)] [FOUNDER] Request SOC 2 Type II report via Dashboard.

**Data deletion.** "Delete or return" on termination except records Stripe is legally required to retain (AML / KYC). App-level user delete must call `customers.del()` for the user's Stripe customer ID. Stripe marks the customer deleted but retains transaction history. [PUBLIC — [data retention FAQ](https://support.stripe.com/questions/data-retention-policy)] [FOUNDER] Confirm Stages' user-delete path calls `customers.del()`.

**Breach SLA.** **48 hours** for incidents affecting GDPR / UK-GDPR personal data; "without undue delay" otherwise. Quote from DPA: *"notify User without undue delay, which for Data Incidents affecting Personal Data subject to the GDPR or UK GDPR will be no later than 48 hours."* [PUBLIC — [DPA](https://stripe.com/legal/dpa)] **This is the only hard hour count across the six processors.**

**Security contact.** Vulnerability disclosure via [Stripe HackerOne](https://hackerone.com/stripe). General incident escalation via Dashboard support. No dedicated security@ published. [PUBLIC]

**Sub-processor URL.** [https://stripe.com/service-providers/legal](https://stripe.com/service-providers/legal) [PUBLIC]

---

## 3.3 Resend — Transactional email

**Role.** Outbound transactional email delivery. React Email templates render server-side; Resend SDK delivers. [PUBLIC]

**Data flow in.** Recipient email, recipient display name, sender email, subject, fully-rendered HTML/React body. Stages does NOT pass `tracking` options in SDK calls → opens/clicks not requested from us. **Resend may still log delivery metadata platform-side** — see retention. [PUBLIC]

**Data residency.** "Primary processing operations take place in the United States." [PUBLIC — [DPA §6.1](https://resend.com/legal/dpa)] EU customer data flows under EU-US DPF certification. [PUBLIC — [DPF changelog](https://resend.com/changelog/data-privacy-framework-certification)]

**DPA.** Public, self-serve. [PUBLIC — [DPA](https://resend.com/legal/dpa)] [FOUNDER] Counter-sign.

**Sub-processor list.** **21 sub-processors, all US-based**: AWS (hosting/sending), Anthropic (AI), Attio (CRM), Cloudflare (WAF), Datadog, Elastic, Estuary, Google (email + analytics), Inngest, Liveblocks, Metabase, Plain, Retool, RunPod, Slack (via Salesforce), Snowflake, Stripe, Supabase, Svix (webhooks), Tinybird, Vercel. [PUBLIC — [Sub-processors](https://resend.com/legal/subprocessors)] **Notable: Resend's own stack overlaps significantly with Stages' (Supabase + Vercel + Stripe).** Concentration risk surfaced in § 3.7.

**Retention.** Backups persisted **30 days** and globally replicated for disaster resilience. Customer data deleted **within 90 days** of account termination. Compliance records retained **3 years** after agreement termination. [PUBLIC — [Security page](https://resend.com/security), [DPA Exhibit A + §8.3](https://resend.com/legal/dpa)]

**Certifications.** **SOC 2 Type II** — auditor Advantage Partners, audit period Feb 1 2025 → Feb 1 2026. EU-US Data Privacy Framework certified. **No ISO 27001, no HIPAA BAA** mentioned in any published Resend doc. [PUBLIC — [SOC 2](https://resend.com/security/soc-2), [GDPR](https://resend.com/security/gdpr)] [FOUNDER] Download SOC 2 Type II report from dashboard.

**Data deletion.** Account-level: 90 days after termination. **30-day backup persistence means deleted user PII in transactional email content lingers up to 30 days post-delete** — disclose this in the privacy policy as the right-to-erasure worst case. [PUBLIC] [FOUNDER] On Stages user-delete, optionally call Resend audience-removal API if used; confirm log retention in dashboard.

**Breach SLA.** "Without undue delay" — no specific hour count. [PUBLIC — [DPA §8.6](https://resend.com/legal/dpa)]

**Security contact.** [privacy@resend.com](mailto:privacy@resend.com) (DPA §7.3 + Exhibit B). Vulnerability disclosure linked from [security page](https://resend.com/security). [PUBLIC]

**Sub-processor URL.** [https://resend.com/legal/subprocessors](https://resend.com/legal/subprocessors) [PUBLIC]

---

## 3.4 Vercel — Hosting + serverless functions + edge

**Role.** App hosting, Next.js serverless/edge functions, edge CDN, build pipeline. [PUBLIC]

**Data flow in.** Edge request logs (IP, User-Agent, Referer, path, status, duration), captured platform-side per § 2.7. Function `stdout`/`stderr` from Stages' API routes (whatever Stages logs). Build artifacts. Stages does NOT extract IP/UA/Referer at app level — Vercel captures these automatically at the edge.

**Data residency.** Primary processing in the US. Vercel may process Customer Data globally under SCCs / EU-US DPF / Swiss-US DPF. Edge network is global by design; function placement is configurable per route. [PUBLIC — [DPA](https://vercel.com/legal/dpa)] [FOUNDER] Confirm function region in dashboard (defaults to `iad1` US-East — should match Supabase region for latency + residency story).

**DPA.** Auto-incorporated into Vercel Customer Terms. [PUBLIC — [DPA](https://vercel.com/legal/dpa), [DPA PDF](https://assets.vercel.com/image/upload/q_auto/front/legal/dpa/Vercel_Inc_-_Data_Processing_Addendum.pdf)]

**Sub-processor list.** AWS, Google Cloud, Microsoft Azure, Cloudflare, Datadog, Honeycomb. Plus AI sub-processors (Cerebras, Baseten, Raindrop, Groq) for v0 — **not in Stages' data path.** [PUBLIC — [list](https://security.vercel.com/subprocessors)]

**Retention.** Runtime (function) logs: **1 hour on Hobby, 1 day on Pro, 3 days on Enterprise.** Extended 30-day retention requires Observability Plus add-on. Customer Data deleted within a "commercially reasonable timeframe" upon termination. [PUBLIC — [function logs](https://vercel.com/docs/functions/logs), [30-day add-on changelog](https://vercel.com/changelog/30-day-runtime-log-retention-now-available-in-observability-plus), [DPA §12](https://vercel.com/legal/dpa)] [FOUNDER] Confirm Stages' Vercel plan tier — Hobby's 1h is too short for production forensics.

**Certifications.** SOC 2 Type II (Security + Confidentiality + Availability, annual), ISO/IEC 27001, HIPAA BAA available (Enterprise), PCI DSS SAQ-D AOC (2025). Plus HITECH, GDPR, CCPA/CPRA, EU-US + Swiss-US DPF, PIPEDA, DSA, NIS 2, DORA, nFADP, TISAX. [PUBLIC — [compliance](https://vercel.com/docs/security/compliance), [Trust Center](https://security.vercel.com/)] [FOUNDER] Download SOC 2 report (NDA-gated).

**Data deletion.** Self-service: deleting a project/team triggers Customer Data deletion within a commercially reasonable timeframe. Logs age out automatically per plan tier (**Vercel's short log retention is itself a privacy feature**). Vercel does not maintain a per-end-user PII table separate from Stages' app — there is no Vercel-side "user" to purge on Stages user-delete. [PUBLIC]

**Breach SLA.** "Without undue delay." Quote: *"Upon becoming aware of a confirmed Security Incident, Vercel will notify Customer without undue delay unless prohibited by applicable law."* [PUBLIC — [DPA](https://vercel.com/legal/dpa)]

**Security contact.** [security@vercel.com](mailto:security@vercel.com) (general), [responsible-disclosure@vercel.com](mailto:responsible-disclosure@vercel.com) (vulns), [privacy@vercel.com](mailto:privacy@vercel.com) (DPA + privacy). [PUBLIC — [Trust Center](https://security.vercel.com/)]

**Sub-processor URL.** [https://security.vercel.com/subprocessors](https://security.vercel.com/subprocessors) [PUBLIC]

---

## 3.5 cron-job.org — External cron scheduler

**Role.** Triggers Stages' `/api/cron/*` routes daily via HTTPS GET with `Authorization: Bearer ${CRON_SECRET}` header. [PUBLIC]

**Data flow in.** Outbound Bearer token. Response bodies contain aggregate counts only — **zero PII** (verified in Part 0.B, § 2.5). cron-job.org also logs request URL, HTTP status, and response timing per execution.

**Data residency.** **Germany.** Service operated by Patrick Schlangen, Maria-Theresia-Allee 79, D-52064 Aachen, Germany. Data stored on German/EU infrastructure (no explicit cloud-provider disclosure). [PUBLIC — [Contact / Imprint](https://cron-job.org/en/contact/)]

**DPA.** **No published DPA.** [PUBLIC — [Privacy Policy](https://cron-job.org/en/privacy/) makes no reference to Article 28 GDPR processor terms.] [FOUNDER] Email [info@cron-job.org](mailto:info@cron-job.org) requesting a GDPR Article 28 Auftragsverarbeitungsvertrag (AVV); expect "no" for free-tier individual-operator service. **Risk flag** — see § 3.8.

**Sub-processor list.** Disclosed in privacy policy (no dedicated page): **Paddle** (subscription billing, UK + US entities), **Cloudflare Turnstile** (anti-bot), **Google reCAPTCHA**, **Google Analytics**. No AWS / hosting provider named explicitly. [PUBLIC]

**Retention.** **Not specified** in the privacy policy. Execution history persists indefinitely in the account console while the account is active. [FOUNDER] Log into [console.cron-job.org](https://console.cron-job.org) → job → History → document log lookback window.

**Certifications.** **None published.** No SOC 2, no ISO 27001, no PCI, no HIPAA. Privacy policy claims "state-of-the-art encryption" for passwords (salted hash) but notes **HTTP auth credentials configured for cronjobs are stored unencrypted** for technical functionality. **Stages' Bearer token is therefore stored unencrypted on cron-job.org's side.** [PUBLIC — [Privacy Policy](https://cron-job.org/en/privacy/)] **Risk flag** — see § 3.8.

**Data deletion.** Privacy policy commits not to share data with third parties except where legally required. Account deletion presumably purges jobs and history. [FOUNDER] Log into console → Account → confirm deletion path exists; document as offboarding step if Stages decommissions cron-job.org.

**Breach SLA.** **None.** No breach notification commitment in the privacy policy or anywhere on the site. **Risk flag.**

**Security contact.** [info@cron-job.org](mailto:info@cron-job.org) — same as general contact. GitHub security policy on [open-source repo](https://github.com/pschlan/cron-job.org). [PUBLIC]

**Sub-processor URL.** [https://cron-job.org/en/privacy/](https://cron-job.org/en/privacy/) (no dedicated page). [PUBLIC]

**Strong recommendation: migrate to Vercel Cron** (inherits Vercel's DPA, SOC 2, ISO 27001, and stays within same security boundary as the app). WISHLIST entry added.

---

## 3.6 Google — OAuth identity provider ("Sign in with Google")

**Role.** OAuth 2.0 / OpenID Connect identity provider. Stages is the relying party; Google authenticates the user and returns ID token + UserInfo. [PUBLIC]

**Data flow in.** Stages sends Google: `client_id`, requested scopes (`openid email profile`), `redirect_uri`. **Stages does not push other users' data to Google.** From Google, Stages receives: email, name, picture URL, `email_verified` flag, `sub` (Google user ID), and session metadata. [PUBLIC]

**Data residency.** Google processes data across global infrastructure. No residency commitment for the consumer OAuth flow. [PUBLIC — [Google Privacy](https://policies.google.com/privacy)]

**DPA.** **Not applicable for our use case.** The Google Cloud DPA covers Cloud Identity, Workspace, GCP — it does NOT automatically apply to the free "Sign in with Google" identity-provider relationship. For consumer OAuth, the governing terms are Google's Privacy Policy + the [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies). **Google is an independent controller for end-user account data, not Stages' processor.** Practical implication: **Stages does not need to sign a DPA with Google for the Sign-in-with-Google flow.** Stages IS responsible for handling the email/name/picture received from Google as its own controller. [PUBLIC — [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) for reference scope]

**Sub-processor list.** Google publishes [sub-processor lists](https://cloud.google.com/terms/subprocessors) for paid Cloud/Workspace services. For consumer OAuth, no separate list applies — Google operates the IdP entirely on its own infrastructure. [N/A for this use case]

**Retention.** Google's own retention follows Google's general account policy. For Stages-side: the access/refresh tokens Stages stores follow Stages' own retention. Stages should call [`https://oauth2.googleapis.com/revoke`](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) on user deletion. [PUBLIC]

**Certifications.** Google holds SOC 1/2/3, ISO 27001/27017/27018/27701, PCI DSS, HIPAA, FedRAMP for Cloud services. These cover the IdP infrastructure operationally though they apply to Cloud customers contractually. [PUBLIC — [Google Cloud Compliance](https://cloud.google.com/security/compliance)] **No PCI scope applies to Stages-via-OAuth. No HIPAA BAA in play.**

**Data deletion.** Users can revoke Stages' access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). When Stages deletes a user, Stages should: (a) call `https://oauth2.googleapis.com/revoke?token={refresh_token}` to revoke the OAuth grant, (b) delete the locally stored tokens and the `sub` from Supabase. **Token revocation does NOT delete data Google already gave Stages — Stages must delete that from Supabase itself.** [PUBLIC — [revoke guide](https://developers.google.com/identity/gsi/web/guides/revoke)] [FOUNDER] Confirm Stages' user-delete path calls Google's revoke endpoint. **WISHLIST entry added.**

**Breach SLA.** Google Cloud DPA: "promptly and without undue delay" (no specific hours). **Not contractually owed to Stages for the free OAuth flow** — Stages would learn about an OAuth incident via Google's general status/blog channels. [PUBLIC — [DPA §7.2.1](https://cloud.google.com/terms/data-processing-addendum)]

**Security contact.** OAuth-app-level abuse: Google Cloud Console → OAuth consent screen → "Report abuse" path. Account compromise: [support.google.com/accounts](https://support.google.com/accounts). [PUBLIC]

**Sub-processor URL.** [https://cloud.google.com/terms/subprocessors](https://cloud.google.com/terms/subprocessors) (Cloud — not directly applicable to consumer OAuth).

---

## 3.7 Comparative summary table

Scanning at a glance:

| Processor | DPA | Sub-proc public | SOC 2 II | ISO 27001 | HIPAA BAA | Breach SLA | Public retention | Residency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Supabase** | Self-serve | PDF | ✅ | ✅ | Add-on | Undue delay | In DPA | US/EU/APAC (configurable) |
| **Stripe** | Auto-incorporated | HTML | ✅ | ❌ | ❌ | **48h GDPR** | ≥5y (AML) | Global / US-primary |
| **Resend** | Self-serve | HTML | ✅ | ❌ | ❌ | Undue delay | 90d termination / 30d backup | US-primary |
| **Vercel** | Auto-incorporated | HTML | ✅ | ✅ | Enterprise | Undue delay | 1h–3d logs / Plan-tier | US-primary / global edge |
| **cron-job.org** | **❌ None** | Prose | ❌ | ❌ | ❌ | **❌ None** | Indefinite (account active) | Germany |
| **Google OAuth** | N/A (controller) | N/A | ✅ | ✅ | ❌ (consumer OAuth) | Undue delay | Per Google policy | Global |

**Stripe sets the floor at 48h.** Stages' Article 33 controller obligation is 72h. Combine these: Stages' breach-response runbook should treat every confirmed processor incident as "report within 48h."

---

## 3.8 Cross-cutting findings + risk flags

1. **cron-job.org is the weakest link.** No DPA, no certifications, no breach SLA, **stores our Bearer token unencrypted on their side** per their own privacy policy. Operated by a single individual in Germany on a freemium model. **Strong recommendation: migrate to Vercel Cron.** WISHLIST entry covers ~1–2h cutover (move `vercel.json` cron entries + rotate `CRON_SECRET`). Stages' new cron then inherits Vercel's DPA, SOC 2, ISO 27001 — and lives inside the same security boundary as the app.

2. **Resend's stack overlaps with ours (Supabase + Vercel + Stripe).** Concentration risk: an AWS `us-east-1` outage potentially degrades Stages' app + database + email simultaneously. Acceptable today (no SLA promises to customers yet); track as we go live.

3. **Public sub-processor pages: 4 of 6.** Stripe, Resend, Vercel, Google publish clean HTML pages. Supabase buries its list in a TIA PDF; cron-job.org discloses only the four integrations in prose. **For compliance reviewers**, mirror Supabase's list in Stages' internal doc and re-check at each Supabase TIA version update.

4. **Vercel function logs at Hobby = 1h retention.** If Stages is on Hobby plan, incident-forensics window is essentially zero. [FOUNDER] confirm Pro or Enterprise (or add log drain to Axiom/Better Stack) before going live.

5. **Google OAuth revoke must be wired into user-delete.** If the user-delete path doesn't call `https://oauth2.googleapis.com/revoke`, refresh tokens stay valid on Google's side. Small GDPR / UX gap. WISHLIST entry folded into the existing RTBF handler entry.

6. **Resend 30-day backup window** means deleted user PII in transactional email content lingers up to 30 days post-delete. Common for transactional email vendors; disclose in the privacy policy as right-to-erasure worst case (see § 1.15).

7. **HIPAA BAA availability.** Only Supabase + Vercel offer HIPAA BAAs. Stripe + Resend + cron-job.org + Google-OAuth do not. **Irrelevant today** (no PHI in Stages); hard ceiling if Stages ever ships clinical features.

8. **No sub-processor change-notice subscriptions are active.** Stripe sends 30-day notices via email; the other three trust centers offer "Subscribe to updates" toggles. [FOUNDER] subscribe each to a monitored email (e.g. `privacy@trystages.com`) — operational, not engineering.

---

## 3.9 Founder verification checklist

Consolidated checklist of `[FOUNDER]` items from § 3.1–§ 3.6 plus § 2.12 carryover. Each task is a discrete dashboard-or-email action. Items grouped by processor for efficient batching.

### Supabase
1. **Region check.** Dashboard → Project Settings → General → record the "Region" field. Verify it matches your customer-data-residency story (typically `us-east-1` or `eu-central-1`).
2. **Counter-sign DPA.** Dashboard → Organization → Legal Documents → DPA PandaDoc → counter-sign. Save executed PDF to Stages' compliance folder.
3. **Download SOC 2 Type II.** Same Legal Documents panel. **Requires Team or Enterprise plan** — confirm plan tier first.
4. **(Skip unless PHI relevant) HIPAA add-on.** Dashboard → Add-ons → HIPAA. Counter-sign BAA.
5. **User-delete cascade test.** Create a throwaway test user. Populate workspaces / pipelines / tasks / notes / files / chat. Trigger Stages' user-delete path (or the forthcoming RTBF handler). Query each table; confirm zero orphan rows.

### Stripe
6. **Confirm DPA is acknowledged.** Dashboard → Settings → Team and security → Compliance and documents → confirm the DPA document is listed as accepted and downloadable.
7. **Request SOC 2 Type II report.** Same Compliance panel; NDA usually auto-applies.
8. **Customer-delete propagation test.** Create a test customer in test mode; delete in Stages; verify Stripe Dashboard → Customers shows record as deleted (transaction history retained per AML).
9. **Subscribe to sub-processor updates.** Dashboard → Settings → Notifications → enable Compliance / Service-Provider updates; route to a monitored address.

### Resend
10. **Counter-sign DPA.** Resend Dashboard → Settings → Documents → DPA → counter-sign.
11. **Download SOC 2 Type II.** Same Documents panel.
12. **Log retention check.** Resend Dashboard → Logs → filter by a known test recipient → document how far back logs go. Reconcile with the 30-day backup window stated in the public DPA.
13. **Verify platform-side tracking config.** Resend Dashboard → Project settings → confirm whether platform-level open / click tracking is enabled. If yes and it's not desired, disable it (the SDK doesn't ask for it, but platform default may differ).

### Vercel
14. **Confirm plan tier.** Vercel Dashboard → Settings → Billing → confirm **Pro at minimum** (Hobby's 1h log retention is too short for production forensics).
15. **Function region.** Vercel Dashboard → Project → Settings → Functions → confirm region. Match Supabase region for latency + residency consistency.
16. **Download SOC 2 + DPA.** Vercel Trust Center → request access → NDA-gated.
17. **Subscribe to security updates.** Vercel Trust Center → "Subscribe to updates" → route to monitored address.
18. **(Recommended for production) Configure log drain.** Vercel Dashboard → Project → Integrations → connect Axiom / Better Stack / Datadog for >3d retention without Observability Plus.

### cron-job.org
19. **Email info@cron-job.org requesting GDPR Art. 28 AVV.** Save the response. Expect "no"; that confirms the migration recommendation.
20. **Document execution-log lookback.** Console → Stages job → History → scroll back → note how far the history goes.
21. **Decision point: migrate to Vercel Cron?** WISHLIST entry has the cutover plan. If staying, document the residual risk in the compliance folder.

### Google OAuth
22. **Verify revoke endpoint is wired.** Audit Stages' user-delete server action — confirm it calls `https://oauth2.googleapis.com/revoke?token=${refresh_token}` before the Supabase delete. **Likely currently missing** — WISHLIST has this folded into the RTBF handler entry.
23. **OAuth consent screen verification.** Google Cloud Console → APIs & Services → OAuth consent screen → confirm "Published / Verified" status (not "Testing"). Required before public launch.

### Cross-cutting
24. **Privacy-policy processor enumeration.** Stages' public privacy policy (Slice S7) must name all six processors and link to their respective sub-processor lists. Use the URLs in § 3.1–§ 3.6.
25. **Subscribe to all four trust-center update feeds.** Supabase ([trust.supabase.io](https://trust.supabase.io)), Vercel ([security.vercel.com](https://security.vercel.com)), Resend (changelog), Stripe (Stripe Newsletter / sub-processor notification). Route to `privacy@trystages.com` or equivalent.

---

## 3.10 Where users will request data export / deletion (forward-looking)

Placeholder for Slice S7 (Privacy + Terms). Once the **RTBF deletion handler** ships (CRITICAL pre-launch WISHLIST item), the privacy policy will direct users to:

- **Self-serve deletion.** Account settings → "Delete my account." Triggers the RTBF handler, which sweeps Stages-side PII, calls Stripe `customers.del()`, calls Google `oauth2/revoke`, and finally calls Supabase Admin API `auth.admin.deleteUser()`.
- **Data export request.** Currently manual: email `support@trystages.com` with the request. A self-serve "Download my data" feature (data-portability under GDPR Article 20) is out of scope for Slice S7 — track as v1.1 WISHLIST when the underlying RTBF infrastructure exists.
- **Processor-side deletion.** Stripe transaction history retained ≥5 years for AML (regulatory carveout). Resend up to 30 days post-delete for backup-replication windows. Vercel logs age out per plan tier. Disclose all three in the privacy policy as legitimate carveouts to "we delete on request."

Resolution of § 2.12 item 8 (DPAs in place): see § 3.1–§ 3.6 + the founder checklist above.

---

---

# Section 4. AI-readiness disclosure (Part 0.D)

**Status:** Part 0.D complete as of 2026-06-06.

**Purpose.** Draft the Privacy Policy language for AI features Jordan plans to ship later, and spec the opt-out infrastructure (Slice 0.1) that must exist before any AI feature processes user data. Goal: ship AI later without a "betrayal moment" where customers feel their data was used without consent.

---

## 4.1 Current state (locked baseline, 2026-06-06)

**Stages does not currently use AI or ML to process user data.** Verified by audit of the full source tree at HEAD `7683767`:

- No third-party AI SDK in `package.json` (no `openai`, no `@anthropic-ai/sdk`, no Cohere, no Hugging Face, no Replicate, etc.).
- No embedding pipelines, no classification jobs, no LLM-driven features in the app.
- No data sent to any AI service from any API route or background job.
- No fine-tuned model holdings.

This baseline finding is locked. Privacy Policy may state without qualification: *"Stages does not use AI/ML to process your content."* (See locked clause in § 1.15.)

---

## 4.2 Privacy Policy language — drafts for the "AI and machine learning" section

**Framing locked 2026-06-06.** Stages is an **agent platform** — long-term vision: *"Google for your business" / "the brain of the business."* AI features will not be consumer-style "we train models on your data" but agent-style "AI acts on your behalf within tools you've connected." The Privacy Policy language reflects this and pre-discloses the four-layer consent framework that gates every AI action.

**Meta-commitment** (the architectural principle the PP language is built around):

> **Stages AI acts on your behalf within tools you connect. Every action requires your permission. We never train on your data.**

Strategy can edit the wording; the substance below should be preserved.

### 4.2.A Opening paragraph

> **AI and machine learning.** Stages is a workspace where you and your AI assistant collaborate to manage client work. Our AI acts on your behalf within tools you've connected — like a smart assistant who can take actions you delegate. Here's how that works and how you stay in control.

### 4.2.B How you stay in control — four layers of consent

> Stages AI is gated by four layers of consent that you control.
>
> 1. **Workspace AI enablement.** A workspace owner must explicitly turn on AI agent features for the workspace. Default off.
> 2. **Per-integration consent.** When you connect an external service (Google Docs, Slack, Instantly, etc.) to Stages, you grant Stages AI permission to read or write that service on your behalf when you invoke AI actions.
> 3. **Per-action consent.** Routine, low-risk actions are pre-authorized once you've connected an integration. Actions that are high-risk (e.g. sending an email) require a confirmation. Actions that are high-value or irreversible (e.g. moving money) require an explicit re-authentication.
> 4. **Improvement signals.** Optionally, you can let us learn from anonymized usage patterns (which features you use, which suggestions you accept) to make AI features better for everyone. Default off; turn it on at **Settings → Privacy** if you wish.

### 4.2.C No-training commitment

> **We do not train AI models on your data.** When you use AI features, your data is processed by zero-retention AI providers (currently Anthropic and/or OpenAI API tiers that contractually prohibit training on inputs) to generate the specific output you requested. Your data is not stored, learned from, or used for any other purpose by those providers.

### 4.2.D Improvement signals (opt-in)

> **Improvement signals (opt-in).** With your explicit consent — off by default — we may use anonymized signals about how AI features get used (e.g. which suggestions get accepted, which actions you redo) to make AI features better for everyone. We never use the content of your work, your messages, or your connected-service data for this; we only use aggregated, anonymized behavioral signals. You can turn this on or off any time at **Settings → Privacy**.

### 4.2.E Data flow during an AI action

> **What data flows where during an AI action.** When you invoke an AI feature, Stages may need to send relevant context to an AI provider to generate the output you asked for. For example, if you ask the AI to draft a reply to a client based on the project history, Stages may send the conversation history from that pipeline to our AI provider. If you ask the AI to perform an action in a connected integration (e.g. *"draft a thank-you email in Instantly"*), Stages sends the necessary context to the AI provider and the resulting draft to the integration on your behalf. The data flow is scoped to the action you invoked; AI providers never receive your full workspace, only the slice relevant to the request. The AI provider's no-training commitment applies to the entire flow.

### 4.2.F Sub-processor notice

> **Sub-processor notice.** We publish our AI sub-processor list at [link to sub-processor page]. Before we add a new AI provider, we will give you at least 30 days' notice via an in-app banner so you can pause your use of AI features if you object to the new provider.

### 4.2.G Security-incident carveout

> **Security-incident carveout.** We may swap one AI provider for another without 30 days' advance notice if we need to do so to address an active security incident — for example, if a current provider experiences a breach or sustained outage that puts your data at risk. In that case, we will inform you promptly after the swap and explain why.

### 4.2.H Human review for safety and quality

> **Human review for safety and quality.** A small percentage of AI agent inputs and outputs may be sampled for review by Stages employees, under confidentiality agreements, solely to evaluate quality and detect safety issues (for example, prompt-injection attempts or misuse of an integration). Reviewed material is never used to train AI models — this is consistent with our broader commitment that no AI provider trains on your data.

### 4.2.I Where to direct AI-related questions

> **Questions or concerns.** For any AI-related question — including requests to clarify what an action did, to revoke an integration's permission, or to opt out of improvement signals — email **privacy@trystages.com**.

---

## 4.3 Slice 0.1 — AI consent infrastructure (agent platform)

Slice 0.1 ships the foundational consent gates for Stages' AI agent platform. It builds **Level 1** (workspace AI enablement) and **Level 4** (improvement signals) of the 4-level framework from § 4.2.B. **Levels 2 and 3** (per-integration and per-action) are deferred until the first integration / first AI action ships — separately scoped on WISHLIST as Slices 0.2 and 0.3.

This is a **pre-AI-feature blocker**: no AI feature may begin processing user data until Slice 0.1 is live, because the gating utility module (§ 4.3.E) is the contract every future AI feature consumes.

### 4.3.A Schema (migration)

JSONB columns on `workspaces` and `profiles`, both with privacy-by-default values. JSONB chosen over multiple booleans so future consent fields (e.g. per-integration scopes in Slice 0.2) get added via JSONB key insertion — no schema migration churn. JSONB merge (`||`) in the server-action UPDATE preserves any future keys.

**Migration file:** `supabase/migrations/20260624120000_ai_consent_infrastructure.sql` (written, awaiting strategy approval before founder applies).

```sql
alter table public.workspaces
  add column ai_consent jsonb not null default '{"agent_enabled": false}'::jsonb;

alter table public.profiles
  add column ai_consent jsonb not null default '{"improvement_signals": false}'::jsonb;
```

Existing rows pick up the default on backfill via the `not null default …` semantics. Defaults are LOCKED: `agent_enabled = false`, `improvement_signals = false`.

The migration also creates the audit table — see § 4.3.D.

### 4.3.B RLS — inheritance from existing policies

**No new RLS policies are added** for the `ai_consent` columns. They inherit SELECT and UPDATE behavior from the existing table-level policies, which already enforce the intended access pattern:

- **`workspaces.ai_consent`**
  - **SELECT** — workspace members can read (existing `workspaces_select`). Members need to see whether AI is enabled in the settings UI even though they cannot flip it.
  - **UPDATE** — workspace owners only (existing `workspaces_update`). Owner-only because workspace-level enablement is an organizational decision, not an individual member's.
- **`profiles.ai_consent`**
  - **SELECT** — own profile + shared-workspace/pipeline visibility (existing `profiles_select`). Other members can see your `improvement_signals` toggle state — same visibility regime as your `display_name` and `company_name`. Strategy-confirmed as acceptable; not a privacy regression.
  - **UPDATE** — own profile only (existing `profiles_update`).

The migration includes verification queries (commented footer) that:

1. Confirm both columns exist with locked default values.
2. Confirm every existing `workspaces` row has `ai_consent = '{"agent_enabled": false}'`.
3. Confirm every existing `profiles` row has `ai_consent = '{"improvement_signals": false}'`.
4. Confirm `ai_consent_audit` exists with RLS enabled and zero policies.
5. Confirm existing policies cover the new columns by inheritance.

### 4.3.C Settings page — `/w/[slug]/settings/privacy`

New route under the existing workspace-settings tab structure. One page, four sections — two active toggles plus two placeholders for the deferred levels:

```
WORKSPACE AI                                 [Owner only]
─────────────────────────────────────────────────────────
[ Toggle ] Enable AI agent features in this workspace
  When off, no AI features can be invoked in this workspace —
  even by members who have opted in to improvement signals.

YOUR AI PREFERENCES                          [Your own]
─────────────────────────────────────────────────────────
[ Toggle ] Allow anonymized usage signals to improve AI
           features for everyone
  Off by default. Anonymized signals only — never the content
  of your work, messages, or connected-service data.

CONNECTED INTEGRATIONS                       [Coming soon]
─────────────────────────────────────────────────────────
Integration controls will appear here as you connect external
services to Stages. (Slice 0.2 will build this surface.)

AI ACTION HISTORY                            [Coming soon]
─────────────────────────────────────────────────────────
When you invoke AI actions, you'll be asked for permission as
needed. A log of every action will appear here. (Slice 0.3 / 0.4
will build this surface.)
```

The workspace section renders interactively for owners and as a read-only status line for non-owners (*"AI agent features are off in this workspace — talk to your workspace owner to change."*).

### 4.3.D Server action + audit table

**Design wrinkle surfaced 2026-06-06.** Strategy's initial spec said to write the audit row to `activity_events`. But `activity_events.pipeline_id` is `NOT NULL` (per § 1.10) and there is no `payload` column — the table is pipeline-scoped and typed by `type` + `stage_name` only. It cannot host a workspace- or user-level consent event without a schema change.

**Resolution (proposed; flag for strategy override).** Introduce a sibling audit table modeled on `seat_sync_log` (§ 1.9):

```sql
create table public.ai_consent_audit (
  id            uuid primary key default gen_random_uuid(),
  scope_type    text not null check (scope_type in ('workspace', 'user')),
  scope_id      uuid not null,
  actor_id      uuid references auth.users(id) on delete set null,
  actor_name    text not null,
  changed_field text not null,           -- 'agent_enabled' | 'improvement_signals'
  old_value     jsonb,
  new_value     jsonb not null,
  changed_at    timestamptz not null default now()
);

create index ai_consent_audit_scope_idx
  on public.ai_consent_audit (scope_type, scope_id, changed_at desc);

alter table public.ai_consent_audit enable row level security;
-- No policies. Service-role only in Slice 0.1. Slice 0.4 will add a
-- SELECT policy for workspace owners when the audit-UI ships.
```

Why a new table:

- Preserves `activity_events`' pipeline-scoped semantics (no nullable-pipeline_id hack).
- Matches the existing `seat_sync_log` + `stripe_events` + `pending_emails` pattern (service-role-only audit logs).
- Slice 0.4 can add a SELECT policy without touching `activity_events`' RLS.

If strategy prefers extending `activity_events` instead (add nullable `workspace_id` + `payload jsonb` columns), the migration can pivot — but the table-per-purpose pattern matches how the codebase already audits subsystem events.

**Server action flow** (`/w/[slug]/settings/privacy` form POST):

1. Authenticate the caller (Supabase session).
2. Identify which toggle changed — workspace `agent_enabled` or profile `improvement_signals`.
3. Validate permissions:
   - Workspace toggle: caller must be a workspace owner. Verified via `workspace_memberships.role = 'owner'` for the calling user against the workspace slug from the route.
   - Profile toggle: no extra check — RLS enforces "own row only" automatically.
4. Update the JSONB field via merge (preserves future keys):
   - `update workspaces set ai_consent = ai_consent || $1::jsonb where id = $2`
   - `update profiles set ai_consent = ai_consent || $1::jsonb where id = auth.uid()`
5. Write an audit row in `ai_consent_audit` via the **service-role admin client**:
   - `scope_type = 'workspace' | 'user'`
   - `scope_id = workspace_id | user_id`
   - `actor_id = auth.uid()`
   - `actor_name = profile.display_name` (denormalized snapshot per the locked § 1.10 audit-integrity pattern)
   - `changed_field`, `old_value`, `new_value` filled from the request.
6. Return success / failure JSON.

### 4.3.E `src/lib/ai-consent.ts` — the gating utility

Every future AI feature must call into this module before touching user content. It's the runtime contract that enforces the framework documented in § 4.2.B.

```typescript
// src/lib/ai-consent.ts
//
// Consent-gate utility for AI features. Every future AI feature MUST gate
// access through one or both of these helpers before touching user content.
//
// Meta-commitment (locked in docs/DATA-COLLECTION.md § 4):
//   "Stages AI acts on your behalf within tools you connect. Every action
//    requires your permission. We never train on your data."
//
// 4-level consent framework (docs/DATA-COLLECTION.md § 4.2.B):
//   Level 1 — workspace AI enablement (checkAgentEnabled)
//   Level 2 — per-integration consent (Slice 0.2, not yet shipped)
//   Level 3 — per-action consent (Slice 0.3, not yet shipped)
//   Level 4 — improvement signals (checkImprovementSignals)

import type { SupabaseClient } from "@supabase/supabase-js";

export async function checkAgentEnabled(
  workspaceId: string,
  supa: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supa
    .from("workspaces")
    .select("ai_consent")
    .eq("id", workspaceId)
    .single();
  if (error || !data) return false; // privacy-by-default on read failure
  const consent = data.ai_consent as { agent_enabled?: boolean } | null;
  return Boolean(consent?.agent_enabled);
}

export async function checkImprovementSignals(
  userId: string,
  supa: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supa
    .from("profiles")
    .select("ai_consent")
    .eq("id", userId)
    .single();
  if (error || !data) return false; // privacy-by-default on read failure
  const consent = data.ai_consent as { improvement_signals?: boolean } | null;
  return Boolean(consent?.improvement_signals);
}
```

Both helpers fail closed — a read error returns `false`, never `true`. Privacy-by-default extends to the runtime, not just the schema default.

### 4.3.F Estimated cost + sequencing

**~2–3 hours** including the migration, RLS verification queries, settings page (one route, four sections, two active toggles + two placeholders), server action with audit-table write, the `ai-consent.ts` utility, and a smoke test.

**Pre-AI-feature blocker.** Ship alongside the **RTBF handler** (existing CRITICAL WISHLIST entry):

- Shared settings infrastructure (`/w/[slug]/settings/privacy` and `/settings/account` are sibling routes).
- Shared "prove we respect your data" framing for the launch story.
- One paired PR closes both pre-launch privacy gaps simultaneously.

---

## 4.4 Resolution log

All Part 0.D open questions were resolved on 2026-06-06 when strategy locked the agent-platform framing. Original numbering preserved for traceability.

| Q | Topic | Resolution |
| --- | --- | --- |
| Q1 | Opt-in default vs opt-out default | **RESOLVED — Posture A (privacy by default).** Single-boolean approach replaced with **JSONB columns** (`workspaces.ai_consent`, `profiles.ai_consent`) for extensibility. Defaults: `agent_enabled = false`, `improvement_signals = false`. Both off. |
| Q2 | Per-user vs per-workspace toggle | **RESOLVED — both, at different levels.** Workspace toggle = Level 1 (owner-only). User toggle = Level 4 (improvement signals). |
| Q3 | Opt-out blocks inference too? | **RESOLVED — training opt-out only.** Inference is consent-by-invocation. Improvement-signals toggle gates behavioral signal use, never the AI features themselves. |
| Q4 | 30-day sub-processor notice | **RESOLVED — keep 30 days** + security-incident carveout (§ 4.2.G). |
| Q5 | Human-review disclosure | **RESOLVED — keep,** adapted for agent context: bounded to safety-and-quality review, explicit "never used to train AI models" (§ 4.2.H). |
| Q6 | Slice 0.1 timing | **RESOLVED — ship alongside RTBF handler.** Shared settings infrastructure + paired framing. |

### Forward-looking questions (future slices, not Slice 0.1 blockers)

Surface from the agent-platform pivot but don't block Slice 0.1:

- **Per-integration consent shape (Slice 0.2):** per-user grant only, or also workspace-level limits (e.g. workspace owner says "no Slack integration in this workspace" overriding individual grants)?
- **Per-action consent UX (Slice 0.3):** how to classify which actions are LOW / HIGH-risk / HIGH-VALUE. Likely a static config table per integration, with the classification reviewed before each integration ships.
- **Audit-log UI scope (Slice 0.4):** workspace-owner-only? Or also visible to members for transparency about what AI is doing in their workspace?
- **Workspace-owner enablement vs member veto:** today, if the workspace owner enables AI, every member is in. Should an individual member be able to opt their own contributions (chat messages, notes) out of AI context windows? Adds complexity; defer until customer signal.

### Open architectural decision (Slice 0.1 review)

- **Audit-table location.** § 4.3.D proposes a new `ai_consent_audit` table (modeled on `seat_sync_log`) because `activity_events` is pipeline-scoped with no `payload` column. Alternative: extend `activity_events` with nullable `workspace_id` + `payload jsonb`. Recommendation: new table (matches existing pattern, isolates Slice 0.4's future SELECT policy). Strategy confirms or pivots.

---

## 4.5 Cross-references

- **§ 1.4** — `channel_messages` three-layer defense remains in force for AI agent context. Messages flagged `is_internal = true` must never enter AI prompts even when the workspace has `agent_enabled = true`. The internal-message layer is a per-row consent signal that supersedes the workspace-level toggle. The `ai-consent.ts` utility does not cover this — every AI feature builder must enforce it at the query level when assembling AI context windows.
- **§ 1.10** — `activity_events` is pipeline-scoped with no `payload` column. Driver for the new `ai_consent_audit` table in § 4.3.D.
- **§ 1.15** — locked baseline AI clause is extended by the agent-platform PP language (§ 4.2.A–§ 4.2.I).
- **§ 3** — third-party processor inventory. The 30-day sub-processor notice commitment (§ 4.2.F) applies to new AI providers when added; matches Stripe's own 30-day standard (§ 3.2).
- **WISHLIST** → Slice 0.1 (AI consent infrastructure, ~2–3h, pre-AI blocker), Slice 0.2 (per-integration consent UI, deferred), Slice 0.3 (per-action consent flow, deferred), Slice 0.4 (AI audit log UI, deferred).
- **WISHLIST** → 🚨 CRITICAL: RTBF deletion handler — ship Slice 0.1 in the same PR window.
- **CLAUDE.md** — *"operating system for client services businesses"* + agent-platform positioning is the long-term frame the PP language is designed to make shippable.

---

---

# Section 5. Open questions for founder review

Eight items resolved as of 2026-06-06 (Q1 / Q4 / Q5 / Q6 by strategy lock; Q2 / Q3 / Q10 by code-or-SQL inspection; Q9 partially folded into § 2.12). Two items remain.

1. **Free-text field length limits — DEFERRED to Slice S5 (input validation).** Several free-text columns (`stage_notes.text`, `channel_messages.text`, `tasks.description`, `pipeline_links.url`, `tasks.note`) have no server-side length limit. A malicious user could write multi-MB single rows. **Disposition:** Slice S5 will add server-side caps as part of the broader input-validation pass. No action in Slice 0.

2. **`auth.users.raw_user_meta_data` audit.** Supabase Auth stores OAuth metadata (Google `name`, `picture`, `email`, `email_verified`, etc.) in `auth.users.raw_user_meta_data`. Some of this may not be mirrored to our `profiles` table and so isn't documented in § 1.1. **Question:** Should the doc enumerate what we know lands in `raw_user_meta_data` so the Privacy Policy can cover it explicitly, even though we never write to that column from app code? Likely a 30-minute follow-up to query Supabase Auth docs + spot-check one Google-OAuth user's row.

**Processor-side retention questions** (originally Q9) were consolidated into **§ 3.9** (founder verification checklist, 25 items grouped by processor) as part of Part 0.C. § 2.12 carries the original list with status pointers.

---

## Resolution log (running)

For traceability. Original numbering preserved so anyone reviewing prior conversation logs can map back.

| Q    | Topic                                            | Resolved | Resolution                                                                                                              |
| ---- | ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| Q1   | Orphaned storage objects                         | 2026-06-06 | LOCKED. Privacy-safe (RLS row binding). Janitor cron on WISHLIST. PP language in § 1.15.                              |
| Q2   | `team_invites` status                            | 2026-06-06 | RESOLVED via SQL. Table dropped in `20260519120000_phase_4a_data_model.sql`. Confirmed absent from production schema. |
| Q3   | `user_templates` vs `templates`                  | 2026-06-06 | RESOLVED via SQL + RPC source. `user_templates` is vestigial (0 rows, no writers); current trio is `templates` + stages + tasks. WISHLIST: drop the vestigial table. |
| Q4   | `upgrade_interest.email` survives user delete    | 2026-06-06 | LOCKED as RTBF gap. CRITICAL pre-launch WISHLIST entry covers the fix (workspace-wide deletion handler).             |
| Q5   | `pending_emails` retention                       | 2026-06-06 | LOCKED at 90 days. Cleanup cron on WISHLIST (Slice 0.X). PP language in § 1.15.                                       |
| Q6   | `activity_events.actor_name` denormalization     | 2026-06-06 | LOCKED as intentional for audit integrity. PP language in § 1.15.                                                     |
| Q9   | Vercel / Supabase request logs                   | 2026-06-06 | PARTIAL: app-layer behavior documented in § 2.3 (function logs), § 2.7 (Vercel platform), § 2.8 (Supabase platform). Processor-side retention windows moved to § 2.12 for founder verification + Part 0.C inclusion. |
| Q10  | Anonymous `upgrade_interest` submissions         | 2026-06-06 | RESOLVED via code inspection. UI is auth-gated at `src/app/upgrade/page.tsx:79–90` (`if (session.status !== 'authenticated') { setError(...); return; }`). RLS WITH CHECK on `user_id = auth.uid()` is the server-side belt to the client-side suspenders. No anonymous submissions reach the table. |

---

_Slice 0 complete (Parts A–D, 2026-06-06). Slice 0.1 (AI consent infrastructure — Level 1 + Level 4 toggles + audit table + `ai-consent.ts` gate utility) ships in a separate commit. Slices 0.2 / 0.3 / 0.4 (per-integration consent UI, per-action consent flow, AI audit log UI) deferred to WISHLIST until the first integration / first AI action ships. Next: Slice X1 (invites/send 404 fix) handoff._
