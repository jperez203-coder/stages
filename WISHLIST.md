# Stages — wishlist & deferred work

Two categories of deferred items, both off the current critical path.

- **Post-MVP follow-ups** — planned work scoped out of the current phase to keep scope tight. Will land in a known later phase, not gated on customer feedback. Schedule deliberately.
- **v1.1 wishlist** — items intentionally deferred from MVP, gated on real customer signal. Don't act without explicit go-ahead from the founder.

---

## Post-MVP follow-ups

### Profile pictures (after Phase 3.4)

Avatars are not wired up yet. Three pieces, in order:

1. **Schema** — add `avatar_url text` to `public.profiles` (currently the table has only `id`, `email`, `display_name`, `created_at`). Single migration.

2. **Google avatar auto-population** — extend `handle_new_user` (in `20260509120000_rls_policies.sql`) to extract the avatar from OAuth metadata at signup. Pattern:

   ```sql
   insert into public.profiles (id, email, avatar_url)
   values (
     new.id,
     new.email,
     coalesce(
       new.raw_user_meta_data->>'avatar_url',
       new.raw_user_meta_data->>'picture'
     )
   )
   on conflict (id) do nothing;
   ```

   Different OAuth providers use different field names — Google uses `picture`, others use `avatar_url`. The `coalesce` handles both. **Free conversion improvement:** Google sign-ups land with a populated avatar at zero work. Add this in the same migration that adds the column.

3. **Profile picture upload UI for email+password users** — Storage bucket (`profile_avatars` or similar, private with signed URLs) + upload UI in account settings + crop/resize on the client side. More work than the schema piece. Not blocking launch, but worth scheduling.

Also extend `sync_profile_email` (or add a sibling trigger) to keep `avatar_url` in sync if Google updates the user's photo on subsequent sign-ins.

---

### Team settings table (after step 6 closes)

- **"ROLE" column in the members table feels cramped.** Header text width is narrower than the badge content below it, causing visual cramping. Easiest fix: bump the header column to align with the badge's visual width (likely `min-w-[64px]` or set explicit `width` on the `<th>`). Surfaced during 6c-ii verification; non-blocking. Same issue probably applies to the pending-invites table's ROLE column — audit both when polishing.

---

### Slice 5 follow-up: founding-member edge-case banners

**Status**: founders in non-standard billing states currently see no banner. Specifically — Track A founders with any of:
- `subscription_status='past_due'`
- `subscription_status='incomplete'`
- `subscription_status='paused'`
- billing row missing (`workspace_billing` has zero rows for this workspace_id)

All four cases fall through the precedence tree in `src/app/w/(workspace)/[slug]/page.tsx` without rendering a banner. Acceptable for Slice 5 because:
- `past_due` / `incomplete` / `paused` only happen AFTER a founding member has already upgraded (so there's an active Stripe subscription) — they're rare downstream states, not initial-funnel cases.
- `null` billing row is a manual-grant-failure case; the SQL template creates a row from day 1 of founding-member status.

**Worth revisiting when post-launch data shows incidence.** Possible solutions:
1. Generic "Founding member — billing needs attention, contact support" fallback for the 4 edge states. Hooks into `?founding=upgrade` modal but with a different starting copy.
2. Specific banner per state (e.g. `past_due` → "Update your payment method" with a Stripe Customer Portal link).
3. Just emit a console.warn from the page so the workspace owner notices in DevTools (lowest-cost solution; not user-friendly).

The `is_founding_member` flag is eternal so any of these can ship as a Slice 5.5 / Slice 6 polish.

---

### Slice 5 follow-up: client-side billing prop threading (within Slice 5, deferred to next session)

**Status:** Slice 5 ships with the server-side billing gate covering only API routes today. The locked Bucket 1 enumeration had ~47 sites total: 4 API routes (✅ instrumented), 1 server-side flow that turned out to be `"use client"` (moves to this entry), and ~42 direct-PostgREST + client-RPC write sites that need the `subscription_status` prop threaded down from server-rendered parent pages.

**Per-locked decision (this slice):** server gate is the law; client gate is UX optimization. Tonight's instrumentation already meets the "law" bar — invite-send + invite-resend routes (both teammate and client variants) all honor `assertSubscriptionWritable` against the right `workspace_id`. A canceled workspace cannot mint new invite emails.

**What's not yet gated:** in-app writes from the canvas surface (task done toggles, stage rename, file uploads, chat message sends, etc.). Until the prop threading lands, an expired-trial user can still mutate workspace content from the UI without seeing the read-only banner trigger. Per the locked decision this is bounded — the determined-bypass exposure already documented in `src/lib/billing-guard.ts`'s "KNOWN GAP" block covers the same class of issue from a different angle.

**Estimated cost.** ~3–4 hours:
- Add `subscription_status` to the data bundle passed to each server-rendered parent page that hosts a client write (`/w/[slug]`, `/w/[slug]/my-tasks`, `/w/[slug]/p/[id]`, `/w/[slug]/p/[id]/chat|files|clients`, `/w/[slug]/p/new`, `/w/[slug]/settings/team`, `/portal/[id]/canvas|files`, `/portal/[id]` for task-detail panels). 8-10 pages.
- Thread the prop down to each client component's TS props interface (~12 components).
- Add `if (subscriptionStatus !== 'trialing' && subscriptionStatus !== 'active') { router.refresh(); return; }` to each write handler (~42 sites).
- tsc + build green check.
- Browser smoke test: trigger expired state via SQL on a test workspace, confirm UI write actions are gated, banner appears.

**Distinct from the RLS-layer hardening below.** That's an entirely separate slice that hardens against direct-PostgREST DevTools bypass — fundamentally different threat model. This entry is about UI-layer enforcement; the RLS entry below is about belt-and-suspenders DB-layer enforcement. Both should ship before live-mode Stripe flip.

---

### StartTrialModal pre-flight Stripe config check

Currently relies on the generic "Couldn't start checkout — please try
again." message when Stripe price env vars are missing or misconfigured
(via the existing `mapCheckoutError` fallback). A pre-flight could
surface "Pricing isn't configured — contact support" more clearly:

* Modal mount fires `GET /api/billing/config-check` that returns
  `{ ok: true }` or `{ error: "pricing_not_configured" }`.
* On error, render a banner above the tiles and disable both CTAs.

**Low priority** — only triggers if Vercel env vars get out of sync
(`STRIPE_PRICE_SOLO_MONTHLY` / `STRIPE_PRICE_TEAM_MONTHLY` removed or
misnamed). The current generic error path is functional for everyone
but the on-call debugger.

**Estimated cost**: ~30 min. New route + 6-line modal useEffect +
banner JSX. No DB changes.

**Trigger**: first time "Couldn't start checkout — please try again."
shows up in Vercel logs without a corresponding Stripe API failure.

---

### Workspace settings refactor: client → server components (after Slice 4)

`src/app/w/[slug]/settings/team/page.tsx` is `"use client"` — legacy from
phase 3.4 (heavy useEffect-driven data flow via useTeamData / useSession /
useUserContexts hooks). The Slice 4 billing page is a server component;
the shared `<WorkspaceSettingsTabs />` chrome was forced to be `"use
client"` purely so the existing team page can import it without
restructuring.

**The refactor**: convert `team/page.tsx` to a server component. Push the
auth gate + initial data fetches up to the server (mirroring
`billing/page.tsx`'s pattern); keep only the interactive bits (invite
form, role change menus, kick/leave confirms) as client subcomponents
mounted as children.

**Net wins**:
- Initial paint faster (no client-side hook waterfall before team list
  renders)
- `<WorkspaceSettingsTabs />` can drop the `"use client"` tag
- Reduces direct-PostgREST surface on the client side (aligns with the
  separate RLS-hardening wishlist item)
- Brings team page in line with the broader app's server-component-first
  posture

**Estimated cost**: 4–6 hours. Touches useTeamData → server fetch
conversion, all `supabase.from(...)` calls in the page → server client,
form submission → server action OR API route, role-change handlers →
same. Privacy harness extension to verify SSR auth path. Smoke test of
all team page interactions post-refactor.

**Trigger**: pre-launch hardening sweep alongside the RLS-layer billing
gate. Both share the "server-side enforcement matters" theme; doing them
together compresses the surface area being touched.

---

### Track B day-12 email — blocked-actions list freshness (post-launch milestone)

The Slice 6 Part F email body lists specific blocked write actions when
the workspace goes read-only: "creating pipelines, sending messages,
uploading files." This list is accurate as of Slice 6 ship date but
will go stale as we add features.

**Specifically becomes stale when**:
- Templates editor lands (would add "saving templates" to the list)
- Export functionality ships (would add "exporting data")
- Any new agency-side write surface ships

**At the next launch milestone**: re-read this email body against the
current set of `billing-guard.ts` gated routes + the `~25 direct-
PostgREST write sites` audit from the WISHLIST RLS-hardening item.
Update the list (or move to a vaguer phrase like "any changes to your
workspace") so the email doesn't promise consequences that don't match
reality.

**Estimated cost**: 5 min copy edit per occurrence. Low priority but
worth a habit-check at each major-feature ship.

---

### Track B day-12 email copy A/B test (post-launch)

Current Slice 6 Part F email copy: *"Your free trial ends [phrase]. Add
a card today to keep your workspace active — same plan, same pricing,
just continue working."* + consequence paragraph framing "workspace
becomes read-only" / "writes will pause until you do."

Neutral, low-pressure, honest. Right shape for first launch where we
don't yet know what resonates.

**Post-launch A/B test once we have ≥30 day-12 sends per week:**
- Variant A (current): "keep your workspace active" framing
- Variant B: "Continue where you left off" (engagement-led)
- Variant C: "Your trial ends [phrase]. Add a card to stay" (shorter, more urgent)
- Variant D: explicit feature loss list ("You'll lose access to your X
  pipelines, Y client portals, Z files" if we have aggregate counts)

Track: open rate, click-through to /w/[slug]?addcard=true, eventual
checkout completion rate. Pick winner after ~2 weeks of statistically
meaningful volume.

**Low priority** until volume justifies the analytics work. Subject-line
test (a separate dimension) is cheaper to run first.

---

### Track B canceled / past_due banner UX (after Slice 6)

Post-Slice-6, the dashboard banner IIFE shows nothing for Track B users
whose `workspace_billing.subscription_status` is `'canceled'` or
`'past_due'` (defensive fallthrough — see
`src/app/w/(workspace)/[slug]/page.tsx` IIFE for the precedence tree).

The result: a user in either state has zero on-page signal of WHY their
writes are blocked. billing-guard.ts returns 403 on every write attempt
(correct), but the UX is: click a button, nothing happens, no visible
explanation. Same for the Stripe Customer Portal — they have a path to
fix it, but no in-app pointer to that path.

**The fix**: explicit Track B banners for both states.

* `'canceled'`: red AlertCircle banner. "Your subscription was canceled."
  Subtitle suggests re-subscribing via `/settings/billing` → "Manage
  billing" portal flow. Same red palette as the expired-trial variant
  already in StartTrialBanner.tsx.

* `'past_due'`: amber banner (stages-amber for "needs attention").
  "Payment failed — your subscription is past due." Subtitle points to
  the Stripe Customer Portal "Update payment method" flow.

**Why low priority**: these states are rare for Track B users post-
launch (`'canceled'` requires the user to explicitly cancel in the
portal; `'past_due'` requires Stripe-side payment failure). Both
trigger Stripe-side email notifications already, so users aren't
totally in the dark. The in-app gap is real but not silent.

**Estimated cost**: ~30 min. Add 2 new variants to `StartTrialBanner.tsx`
(or fork a `BillingIssueBanner.tsx` if the visual treatment diverges).
Extend the IIFE precedence tree to mount them.

**Trigger**: first time a real customer asks "why can't I edit anything?"

---

### Hardening: RLS-layer billing-state write enforcement (after Stripe Slice 5)

**The gap.** Slice 5 ships an app-layer billing guard (`src/lib/billing-guard.ts`) that protects API route + server action writes when `workspace_billing.subscription_status NOT IN ('trialing','active')`. But the ~25 direct-PostgREST write sites in the agency canvas and client portal (task done toggles, file uploads, chat message inserts, stage rename, etc.) talk directly from the browser to Supabase. The server gate never runs for them. Their only gate is a client-side check on a `subscription_status` prop passed down from the server-rendered parent page.

**The exposure.** A user with technical skill + hostile intent can open DevTools and run `supabase.from("tasks").update({ done: true }).eq("id", "…")` against a canceled workspace. The write succeeds because (a) the client-side gate never gets called, (b) the table's RLS policy gates on workspace membership and column-specific rules — not on the workspace's billing status. Honest users get the read-only experience the locked spec calls for; determined users bypass it.

**The fix.** Extend every workspace-table write policy with an EXISTS clause requiring billing-active state. Touches at minimum: `tasks_update`, `tasks_insert`, `tasks_delete`, `stages_*`, `pipelines_update`, `pipelines_delete`, `stage_notes_*`, `pipeline_links_*`, `stage_attachments_*`, `channel_messages_insert`, `channel_memberships_*`, `pipeline_memberships_insert` (member adds), `workspace_invites_insert`, `client_invites_insert`, plus the corresponding storage bucket policies for path-derived workspace_id. SECURITY DEFINER helper `is_workspace_billing_active(workspace_id uuid)` keeps each policy one line of additional logic.

**Estimated cost.** ~6–8 hours including:
- 1 SECURITY DEFINER helper function
- ~15 policy migrations (one per affected table)
- Privacy harness extension (re-run all RLS tests with billing-canceled state to confirm gating)
- Perf check (the helper runs on every write — should be a single PK lookup on `workspace_billing`, cached per-statement)

**Why deferred.** Risk/reward math at Slice 5 ship time: cost of the gap is bounded (only sophisticated users; minimal revenue impact pre-launch). Cost of doing it now is meaningful (RLS migrations are high-stakes, need careful per-policy testing). Slice 5 ships with the gap; hardening is tracked here.

**Trigger to do this work.** Either:
1. Real-customer signal (a customer asks "can I lock teammates out after I cancel?"), or
2. Pre-launch hardening sweep before flipping live-mode Stripe.

## v1.1 wishlist

Items intentionally **deferred from MVP** to v1.1. The discipline is to ship the prototype's feature set unchanged, then let real customer signal shape v1.1. Don't act on anything in this list without explicit go-ahead from the founder.

### Dashboard / homepage

- **Better triage UX once agencies have 8+ pipelines.** Specific filter type TBD based on real customer feedback — should they filter by status (active / stalled / submitted), by current stage, by progress %, by a "needs attention" computed signal, or something else? Wait for real signal before building.
- **Stat tiles use the search-filtered list.** "Pipelines in progress" and "Pipelines completed (Week)" shrink as you type in the search box. Probably should count across all visible pipelines regardless of search filter. Minor polish.

### Stage page

- **Per-task notes are currently a single text field.** Some users may want them as a thread (multi-note with author/timestamp, like stage notes). Build only if real customer feedback confirms the need — don't pre-emptively rebuild. The inconsistency between *stage notes* (threaded) and *task notes* (single field) is intentional for now: stage notes are for substantive ongoing commentary, task notes are for quick reminders. If customers complain they want both threaded, we'll build it. Don't change the current design without that signal.

### Canvas surface

- **Double-click task to edit in canvas.** Currently a task click opens the side panel; in edit mode the title becomes inline-editable. A double-click shortcut to enter inline rename directly (without going through panel or edit mode) would be faster for power users who rename a lot of tasks. Wait for customer feedback — the existing paths already cover the use case; this is convenience.
- **Hide the members icon cluster when the pipeline has 1 member.** Single-member pipelines (typical solo agency) render a cluster of one avatar, which adds chrome noise without conveying information. Hide when `members.length === 1`. Pure cosmetic polish.

### Project completion / lifecycle

- **Confetti on project completion.** When the final stage's last task gets marked done (whole pipeline reaches a "fully done" state), trigger a brief confetti burst on the canvas. The prototype had this; deferred to v1.1. Make it dismissible / disable-able for agencies who find it noisy.
- **Restart a project in the same pipeline.** Once a pipeline is "completed," an agency may want to re-use the same client engagement structure for a new round (quarterly retainer cycles, recurring campaigns, etc.). Options to scope when this lands: (a) bulk-uncheck all tasks (resets state, keeps the pipeline + members + history); (b) snapshot the completed state to `activity_events` then reset; (c) deep-copy to a new pipeline keeping the same client member; (d) flip a "round number" counter and archive the prior state. Wait for customer signal on which they actually want — likely (a) or (c), but the trade-off is data-history vs. visual-clutter.

### Pipeline templates

- **"Manage templates" workspace settings surface.** Today: saved templates can only be renamed or deleted via direct SQL (no UI). The Pipeline Templates feature (shipped 2026-05-26 — see PROGRESS.md) covers create / use / save-from-existing, but managing the library happens at the DB level. A `/w/[slug]/settings/templates` route with a list of saved templates + rename + delete affordances would close the gap. Gated on `is_workspace_owner_or_admin`. Built-ins (`workspace_id IS NULL`) read-only — RLS already enforces this so the UI can show but not edit them. Defer until an agency reports actually needing it post-MVP; until then, accidental-cleanup via SQL is cheap and the feature works without it.

### Storage janitor (orphan bytes from deleted pipelines)

- **Reclaim storage bucket space when a pipeline is deleted.** The `delete_pipeline` RPC (migration `20260610120000`) cascades all DB rows away — memberships, stages, tasks, channels, messages, file metadata — but does **NOT** delete the underlying bytes in the `pipeline_files` and `stage_attachments` storage buckets. Reason: Supabase rejects `DELETE FROM storage.objects` even from security-definer functions (server-level protection independent of RLS — surfaces as *"Direct deletion from storage tables is not allowed. Use the Storage API instead."*). The Storage API path (`storage.from(bucket).remove([paths])`) is the only sanctioned mechanism and lives outside SQL.
- **Why it's safe to defer**: both buckets' SELECT policies require a joined `pipeline_links` / `stage_attachments` metadata row to evaluate access. Those metadata rows cascade away with the pipeline, so orphaned bytes are unreachable via any client path. The only cost is bucket storage $$ accumulating over time.
- **Options when this ships**:
  - **(a) Scheduled Edge Function janitor** — nightly pass that finds storage objects whose path-extracted `pipeline_id` no longer matches a row in `public.pipelines`, then removes them via the Storage API. Most thorough; needs a deployed Edge Function + a cron schedule.
  - **(b) App-side best-effort cleanup at delete time** — UI fires `supabase.storage.from(...).remove([paths])` for both buckets after the `delete_pipeline` RPC returns. Simpler; racy (partial-delete possible if the browser tab closes mid-cleanup); user waits on extra round trips before the redirect. Reasonable belt-and-suspenders when combined with (a).
- Pick when there's customer signal that storage cost matters, or pre-launch if we want a clean baseline. Until then: orphans persist invisibly. Affects all pipelines deleted via the overflow `…` menu's "Delete pipeline" item (shipped 2026-05-26).
