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

**Slice S1 Phase 3 status (2026-06-07)**: still active. The C1 client-boundary instance of this same architectural pattern (app-layer-only enforcement → direct-PostgREST bypass) was closed by Slice S1 Phase 3 Fix 4 (`f34fe32` — `workspaces_insert` RLS-layer enforcement via `can_create_workspace` helper). That fix demonstrates the pattern (SECURITY DEFINER predicate helper + RLS policy WITH CHECK) that this broader billing-state hardening will use too. The billing-state half of this entry remains unaddressed — ~25 direct-PostgREST write sites still pass through to Supabase regardless of `subscription_status`.

---

### Slice S1 follow-on — Tier 3 RLS tests (column-grant alignment + refined weak-policy heuristic)

**Surfaced**: 2026-06-06 during Slice S1 Phase 1 audit (Q5 lock) — deferred from Phase 2 to keep that sprint scoped at 7 tests (Tier 1 + Tier 2).

**Status**: deferred. Phase 2 (`scripts/test-rls-phase3.mjs`, commit `a473156`) ships 4 critical-regression tests + 3 defensive canaries — all passing 7/7. Tier 3 extends the harness with two additional standing-invariant tests that would catch broader-pattern regressions earlier than waiting for them to manifest as a specific bug.

**The two Tier 3 tests:**

1. **Column-grant alignment.** For every public-schema table with an RLS UPDATE policy, verify the `authenticated` column-level GRANT allowlist contains exactly the columns the policy implicitly permits writing — no more, no less. Catches the Slice 0.1 shape (RLS-permits, GRANT-missing → 42501) generically across the schema, not just on `profiles`. Implementation: a SECURITY DEFINER RPC `audit_column_grant_alignment()` (sibling of `audit_grant_without_rls()`) that returns a row per misalignment, plus a harness test that asserts the RPC returns 0 rows.

2. **Refined weak-policy heuristic.** The Phase 1 Query 6 regex matched several `template_*` policies as "weak" but they were correct (`workspace_id IS NOT NULL` as a join guard, NULL `with_check` on DELETE, etc.). Per Phase 1 § 8 the refined predicate is:
   - USING is literally `true` / `(true)`, OR
   - USING's only condition is `auth.uid() IS NOT NULL` / `auth.role() = 'authenticated'` (full match, not substring),
   - AND the policy command is SELECT / UPDATE / DELETE.
   Implementation: a SECURITY DEFINER RPC `audit_weak_policies()` returning matching policies, plus a snapshot-vs-current harness test that flags any new policy that newly matches the weak heuristic (i.e. tighter than just "not zero").

**Estimated cost**: ~1.5–2 hours. Two RPCs (mirroring the `audit_grant_without_rls` shape) + two harness tests + their verification + a WISHLIST `RESOLVED` update.

**Trigger**: either (a) a future Phase 2 run reveals a Tier 1+2 gap that a Tier 3 test could have caught earlier, or (b) the pre-launch hardening sweep wants stricter standing invariants in CI before live-mode Stripe flip.

**Cross-references**:
- `docs/RLS-AUDIT.md` § 9 — Phase 2 test harness recommendations (Tier 3 explicitly named).
- `docs/RLS-AUDIT.md` § 10 Q5 — the lock that deferred Tier 3.
- `supabase/migrations/20260624150000_audit_grant_without_rls_rpc.sql` — pattern to mirror for the two new RPCs.

---

### Slice S1 Phase 2 follow-on — T1.2 cross-workspace test has no eligible exclusion target

**Surfaced**: 2026-06-07 during the first run of `scripts/test-rls-phase3.mjs`. T1.2 reported `SKIPPED — no eligible excluded workspace`.

**The gap.** T1.2 cross-workspace isolation needs a workspace where the target user (Sarah) is NOT a member AND has no pipeline_memberships to any pipeline in it — so the test can assert Sarah's authenticated session sees zero rows. Sarah is currently a member (workspace or pipeline) of every workspace Jordan owns, so the eligibility probe returns no candidate, and T1.2 skips with a green check by harness convention.

**Why this is a weak pass, not a real failure.** The cross-workspace isolation policy itself (C2 from CLAUDE.md → Security Model) has been live since Slice 1's RLS migrations — same shape as the policies T1.1 / T1.3 / T1.4 are already validating. C2 isn't relying on this one test for coverage. But T1.2 was supposed to be the standing automated proof of C2; right now it's effectively skipped at every harness run.

**Two fix options:**

1. **Dedicated single-membership test account.** Add a new test user (e.g. `jordanperez1270+rls-isolation@gmail.com`) whose ONLY membership is to the seeded test pipeline. T1.2 then uses that user instead of Sarah, and is guaranteed to find an eligible excluded workspace. ~10 min: create the account, add ID to the harness `ACCOUNTS` map, swap the user in the T1.2 body.

2. **Seed an excluded workspace as part of fixture setup.** Service-role create a second workspace `rls-phase3-test-exclusion-${runId}` with a pipeline inside, owned by Jordan but with no Sarah membership. T1.2 reads from THAT workspace's pipeline. Costs more setup time + cleanup complexity; option 1 is cleaner.

**Recommendation**: option 1. Keep the harness fixture footprint small; pay the 10-min account-creation cost once.

**Estimated cost**: ~15 min including the account creation, harness update, re-run verification.

**Trigger**: opportunistic. Cross-workspace isolation isn't going untested in practice — every Tier 1 test that uses Sarah as a non-member implicitly relies on the same policy. But the harness should be honest about its own coverage, and SKIPPED-by-convention is not the same as PASS.

**Cross-references**:
- `scripts/test-rls-phase3.mjs` — `resolveExclusionTargets()` and `t12_crossWorkspace()`.

---

### Slice S2 Phase 3 — stage_attachments policy typo fix

**Surfaced**: 2026-06-07 during Slice S2 Phase 1 storage audit. Documented in `docs/STORAGE-AUDIT.md` § 4.2.

**Status**: medium severity. **Not exploitable** — the typo makes the policy more restrictive than intended, never less. But the `stage_attachments` feature is structurally broken from the storage layer — first agency to upload a stage attachment in production would lose access to the file the moment the page reloads.

**The bug.** Both `stage_attachments_storage_select` (line 1108 of `20260509120000_rls_policies.sql`) and `stage_attachments_storage_delete` (line 1137) use a bare `name` reference inside an EXISTS subquery that joins `public.stages`. PostgreSQL resolves `name` to `stages.name` (the human-readable stage label) instead of `storage.objects.name` (the file path). The query becomes `sa.storage_path = s.name` — comparing a file path to a stage label — which never matches. EXISTS returns false; SELECT/DELETE deny.

The mirror policies on `pipeline_files` are correct because `pipeline_links` has no `name` column, so the bare reference resolves correctly to `storage.objects.name`. Same author wrote both; the typo only manifests where the joined table happens to share a column name with the policy target — a latent landmine that propagates whenever a new metadata table joins another table with a `name` column.

**Why no user-facing incident yet.** `public.stage_attachments` has 0 rows in production, and the `stage_attachments` storage bucket has 0 objects. The broken policy paths have never been exercised. Feature is wired in app code (`TaskDetailPanel.tsx:1608`) but not in use.

**The fix** (one-character qualification, applied to two policies):

```sql
-- stage_attachments_storage_select USING — change:
where sa.storage_path = name
-- to:
where sa.storage_path = storage.objects.name

-- stage_attachments_storage_delete USING — same change.
```

DROP + CREATE pattern matching Slice S1 Phase 3 Fix 2 (commit `24f65d2`).

**Estimated cost**: ~30 min including the migration, the verification queries, and the Phase 2 harness test T2.6 (which fails pre-fix and passes post-fix — explicit proof the fix works).

**Trigger**: pre-launch — within the Slice S2 sprint. Single fix migration, single commit.

**Cross-references**:
- `docs/STORAGE-AUDIT.md` § 4.2 — exact mechanism + comparison with the correct `pipeline_files` shape
- `docs/STORAGE-AUDIT.md` § 4.5 — fix shape rationale
- Slice S1 Phase 3 Fix 2 (commit `24f65d2`) — DROP + CREATE pattern this fix mirrors

---

#### ✅ RESOLVED 2026-06-07 in commit `d1cb6c8` — `fix(slice-s2): qualify storage.objects.name in stage_attachments policies (typo fix)`

Single migration `20260624170000_fix_stage_attachments_storage_typo.sql` — DROP + CREATE both affected policies with `where sa.storage_path = storage.objects.name` (qualified). INSERT policy untouched (no metadata-table join → no ambiguity).

**Verified post-apply:**
- Probe (a): both fixed policies show `has_qualified_ref=true` and `has_bare_buggy_ref=false`. `pg_policies` normalizer stored form: `sa.storage_path = objects.name` (schema prefix dropped because policy is `ON storage.objects`).
- Probe (b): INSERT policy untouched (`stage_attachments_storage_insert`).
- Probe (c): 6 total Stages-defined storage policies — count unchanged.
- Probe (d) — canonical behavior probe via `scripts/test-rls-phase3.mjs`:
  - Pre-fix: `S2.6 SKIPPED — Waiting on Slice S2 Phase 3 typo fix`
  - Post-fix: `S2.6 PASS — Phase 3 fix is live — Jordan mint+fetch ok`

Harness now reports 13/13 PASS (with only the pre-existing T1.2 SKIP on the Sarah-membership gap, separately tracked).

**Lesson for future policy authors:** when a SECURITY DEFINER / RLS policy's USING/WITH CHECK joins a metadata table inside an EXISTS subquery, **always qualify** any column reference shared with the policy's target table. The Slice S2 typo pattern fires whenever the joined table happens to share a column name (e.g. `name`, `id`, `created_at`) with the target — silently broken, no compile-time warning, no test failure unless the policy is exercised with real data.

---

### Storage bucket hygiene — file_size_limit + allowed_mime_types defaults

**Surfaced**: 2026-06-07 during Slice S2 Phase 1 storage audit (`docs/STORAGE-AUDIT.md` § 3, hygiene items H1 + H2).

**The gap.** Both `stage_attachments` and `pipeline_files` buckets have `file_size_limit = null` (no size cap) and `allowed_mime_types = null` (any MIME accepted). Not a security finding — RLS still gates who can upload what — but a hygiene one: an authenticated agency user can upload any size file of any type. A motivated insider could upload multi-GB binaries or executable types without architectural friction.

**Recommended defaults** (locked 2026-06-07 — future implementer starts here, not from a blank slate):

- **`file_size_limit`**: **50 MB** (52,428,800 bytes). Covers most agency assets — designs, photos, short videos, PDFs. Adjustable later based on real usage patterns.
- **`allowed_mime_types`** — a curated allowlist covering the assets agencies actually exchange with clients:
  - **Images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
  - **Documents**: `application/pdf`; Office: `application/msword` (.doc), `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx), `application/vnd.ms-excel` (.xls), `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx), `application/vnd.ms-powerpoint` (.ppt), `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx); text: `text/plain` (.txt), `text/csv`
  - **Video**: `video/mp4`, `video/quicktime` (.mov), `video/webm`, `video/x-msvideo` (.avi)
  - **Audio**: `audio/mpeg` (.mp3), `audio/mp4` (.m4a), `audio/wav`
  - **Archive**: `application/zip`

**The migration shape**:

```sql
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = ARRAY[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain', 'text/csv',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
      'audio/mpeg', 'audio/mp4', 'audio/wav',
      'application/zip'
    ]
where id in ('stage_attachments', 'pipeline_files');
```

**Estimated cost**: ~30 min including the migration, app-side handling of the new rejection error from Supabase (a `400` with `mime_type_not_allowed` or `payload_too_large` shape), a brief user-facing error toast ("File too large — max 50 MB" / "File type not supported"), and a Phase 2 test asserting the limits actually enforce.

**Trigger**: opportunistic. Pre-launch nice-to-have, not blocking. Reasonable companion to either the Slice S2 Phase 3 typo fix above or the existing storage-janitor entry — could ship in the same PR window as either.

**Cross-references**:
- `docs/STORAGE-AUDIT.md` § 3 — bucket configuration table where the null values were observed
- WISHLIST → existing "Storage janitor (orphan bytes from deleted pipelines)" — natural PR companion

---

### docs/DATA-COLLECTION.md § 1.6 — `kind` value drift (`'image'` → `'file'`)

**Surfaced**: 2026-06-07 during Slice S2 Phase 2 harness implementation. First seed run crashed with `new row for relation "pipeline_links" violates check constraint "pipeline_links_kind_check"`.

**The drift.** Migration `20260531120000_pipeline_links_file_kind_and_mime_type.sql` renamed the storage-backed `pipeline_links.kind` value from `'image'` to `'file'`. `docs/DATA-COLLECTION.md` § 1.6 (Pipeline links section) still lists `kind` as taking `'url'` or `'image'`. Other doc sections may have the same drift — worth a grep before fixing.

**The fix.** Grep `docs/` for `kind = 'image'` / `kind='image'` / `'image'` in pipeline-links context, replace with `'file'` where appropriate. Single ~10-min docs touch-up.

**Estimated cost**: ~10 min (grep + edit + one-paragraph note in the section explaining the rename happened in the linked migration).

**Trigger**: opportunistic — pure docs hygiene. Caught harness implementation, no user impact.

**Cross-references**:
- `supabase/migrations/20260531120000_pipeline_links_file_kind_and_mime_type.sql` — the migration that renamed the value
- `docs/DATA-COLLECTION.md` § 1.6 — the stale doc section

---

### Slice S3 follow-on — Webhook concurrent-delivery race fix

**Surfaced**: 2026-06-07 during Slice S3 Stripe webhook audit. Documented in `docs/STRIPE-WEBHOOK-AUDIT.md` § 4 (the single ⚠️ MEDIUM finding).

**The race.** Two simultaneous webhook deliveries of the same `event_id` (Stripe re-sending while the first delivery is still mid-flight) both fall past the dedup check and run the handler concurrently:

```
T=0   Delivery A: INSERT { ..., processed_successfully=false }. Handler starts.
T=1   Delivery B: INSERT collides (ignoreDuplicates). SELECT processed_successfully → false.
T=2   Delivery B falls through and re-runs the handler in parallel with A.
T=3,4 Both finish + UPSERT/UPDATE the same target state → idempotent today.
```

**Not exploitable.** Only Stripe can re-deliver the same `event_id`, and re-delivery is rare. Current handlers (`handleCheckoutSessionCompleted`, `handleSubscriptionUpdated`, etc.) all write via UPSERT or UPDATE — running them twice produces the same end state.

**Why fix it anyway.** The architectural assumption "future handlers can rely on single-fire semantics" is NOT enforced by the code — only by convention. A future non-idempotent handler (e.g. "send a welcome email on first checkout", "post to a third-party API once") would double-fire under simultaneous delivery.

**The fix** (per `docs/STRIPE-WEBHOOK-AUDIT.md` § 4):

```sql
-- pseudocode for the migration / handler change — NOT applied yet.
INSERT INTO public.stripe_events (event_id, event_type, payload)
VALUES (...)
ON CONFLICT (event_id) DO UPDATE
  SET processed_successfully = false
RETURNING (xmax = 0) AS fresh;
```

The `xmax = 0` trick distinguishes a fresh INSERT from an UPDATE-of-existing-row at the same statement. Then before running the handler, `SELECT ... FOR UPDATE` on the existing row — two simultaneous deliveries serialize on the row lock; one runs the handler, the other waits for the first to commit (or fail) then re-evaluates `processed_successfully`.

**Estimated cost**: ~30 min including the migration shape change, handler refactor at `src/app/api/billing/webhook/route.ts` lines 351–393, and a harness test that simulates concurrent delivery (would extend `scripts/test-rls-phase3.mjs` with an S3.1 test invoking two parallel POST requests against a test event).

**Trigger**: **REQUIRED before shipping any non-idempotent handler.** Not blocking the live-mode flip (current handlers are idempotent). The fix gates the future "first-action email" or similar non-idempotent feature.

**Cross-references**:
- `docs/STRIPE-WEBHOOK-AUDIT.md` § 4 — exact race scenario + fix shape rationale
- `src/app/api/billing/webhook/route.ts` lines 351–393 — current dedup pattern

---

### Slice S3 follow-on — Webhook rate limiting / Stripe IP allowlist

**Surfaced**: 2026-06-07 during Slice S3 Stripe webhook audit. Documented in `docs/STRIPE-WEBHOOK-AUDIT.md` § 8 (hygiene item H1).

**The gap.** `/api/billing/webhook` has no app-level rate limiter. An attacker could spam the endpoint with random POSTs; each one consumes minimal resources (raw body read + signature check fail + 400 response). No DB write, no handler execution.

**Why hygiene, not MEDIUM.** Per-request CPU cost is tiny (Stripe SDK signature verification is microseconds). Vercel's edge layer provides baseline DDoS protection. Stripe sends webhooks from a finite, well-known IP range — any spam from outside that range fails signature verification.

**Defense-in-depth options for a future hardening pass:**

1. **Vercel edge rate limit** — `@vercel/edge-config` + the new Vercel Firewall (or a small middleware) limiting `/api/billing/webhook` to say 100 req/min. Cheap to add; catches the lazy spammer.
2. **Stripe IP allowlist** — Stripe publishes their webhook source IPs at <https://stripe.com/files/ips/ips_webhooks.json>. A Vercel middleware could reject requests whose `x-forwarded-for` isn't in that list. Tighter but requires keeping the list fresh (Stripe updates rarely; a quarterly review is fine).

**Estimated cost**: ~1 hour for either path including the middleware code + a test exercising the rate-limit denial.

**Trigger**: pre-launch hardening sweep. Not blocking the live-mode flip; defer until the other S3 follow-ons (race fix, monitoring sub-slice) ship together as one webhook-hardening PR.

**Cross-references**:
- `docs/STRIPE-WEBHOOK-AUDIT.md` § 8 — rationale + Vercel/Stripe options
- Stripe's published IP list: <https://stripe.com/files/ips/ips_webhooks.json>

---

### Slice S3 follow-on — `customer.subscription.trial_will_end` native handler

**Surfaced**: 2026-06-07 during Slice S3 audit Q2 review. Stripe sends `customer.subscription.trial_will_end` ~3 days before a trialing subscription's `trial_end` timestamp.

**The opportunity.** Currently the Slice 6 day-12 reminder cron (`/api/cron/enqueue-trackb-day12`, see PROGRESS.md / handoff) handles the "trial is about to end" prompt by enqueuing a Resend email from our side. Stripe-native `trial_will_end` could either replace it (simpler — Stripe schedules the notification, we just react) or supplement it (double the surfaces; defensive against cron failures).

**The trade-off.**

- **Native Stripe (replace):** simpler architecture; one less cron to maintain; tied to Stripe's lifecycle truth. But puts the email scheduling timing in Stripe's hands; if Stripe ever shifts the event timing (currently 3 days pre-end), our copy / cadence shifts with it.
- **Supplement (both):** redundant signal; defensive against either side failing. But duplicate-email risk if both fire successfully + handler not idempotent (loops back into the § 4 race finding).

**Recommendation**: native replace, but only after the concurrent-delivery race fix (§ 4 above) ships so the handler's single-fire semantics are guaranteed.

**Estimated cost**: ~30 min including the new handler in `route.ts`, Resend email template (or reuse the existing day-12 one), and removing the day-12 cron route + schedule once verified.

**Trigger**: post-launch. Not blocking. Quality-of-life simplification.

**Cross-references**:
- `docs/STRIPE-WEBHOOK-AUDIT.md` § 2 — current 5 explicit handlers + default-branch behavior
- Slice 6 day-12 cron and email template (handoff history)

---

### Slice S3 follow-on — Stripe webhook monitoring sub-slice (`audit_stuck_webhook_events()` RPC)

**Surfaced**: 2026-06-07 during Slice S3 audit § 11 (forward-looking section).

**The opportunity.** Mirror the standing-invariant canary pattern from `audit_grant_without_rls` (Slice S1 Phase 2, commit `a473156`) and `audit_public_buckets` (Slice S2 Phase 2, commit `cefbb63`). A new `audit_stuck_webhook_events()` RPC returns rows from `stripe_events` where `processed_successfully = false AND received_at < now() - interval '1 hour'`.

**Why it's useful.**

- Today: a stuck event would only surface via the Vercel logs error stream OR a support ticket from a confused customer.
- With the canary: any standing CI invocation of the harness OR a periodic cron call to the RPC would alert in real time. The Slice S3 audit's Q3 (0 stuck events) would become a continuous health check.

**Scope.**

1. **Migration**: `audit_stuck_webhook_events()` SECURITY DEFINER returning `(event_id, event_type, received_at, age_interval)`. Mirrors the audit-RPC pattern from `20260624150000_audit_grant_without_rls_rpc.sql` and `20260624160000_audit_public_buckets_rpc.sql`. ~15 min.
2. **Harness test**: extend `scripts/test-rls-phase3.mjs` with a Tier 2 canary test S3.1 that calls the RPC and asserts 0 rows. ~10 min. Internal naming: S3.1 to avoid collision with the storage tier's S2.x.
3. **Optional alerting**: if any future cron / monitoring infra is wired, hook the RPC into it. Out of scope for this sub-slice.

**Estimated cost**: ~45 min total (15 migration + 10 harness + 20 verification/commit).

**Trigger**: opportunistic. Pairs well with whichever S3 follow-on ships first — could land in the same PR as the concurrent-delivery race fix to get one consolidated webhook-hardening commit.

**Cross-references**:
- `docs/STRIPE-WEBHOOK-AUDIT.md` § 11 — forward-looking sub-slice design
- `supabase/migrations/20260624150000_audit_grant_without_rls_rpc.sql` — pattern to mirror
- `supabase/migrations/20260624160000_audit_public_buckets_rpc.sql` — pattern to mirror

---

### Slice S8 follow-on — full Content-Security-Policy rollout

**Surfaced**: 2026-06-08 during Slice S8 OWASP sweep. Documented in `docs/OWASP-AUDIT.md` § 6 (WO1).

**Status**: deferred per the Slice S8 spec ("Don't try to add comprehensive CSP if app uses dynamic scripts — start permissive, tighten in follow-on"). Slice S8 shipped 5 statically-safe baseline headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy`); CSP is the next layer.

**The gap.** Without a CSP, the only protection against script injection is React's automatic JSX escaping (which Slice S8 verified — zero `dangerouslySetInnerHTML` in `src/`). If a future maintainer introduces a `dangerouslySetInnerHTML` usage, an `eval`-based pattern, or a third-party script that gets compromised, there's no second-layer defense to fall back on. CSP provides that defense — a server-side allowlist of which origins the browser is permitted to load script/style/image/font/connect targets from.

**The fix shape — three phases:**

1. **Empirically enumerate origins.** Survey the app for all script/style/image/font/connect targets. Known so far: Supabase (`*.supabase.co`), Stripe (`js.stripe.com`, Stripe Checkout iframes), Google OAuth (`accounts.google.com`), our own origin, fonts (already self-hosted via `next/font` so no external font origin needed).

2. **Deploy in report-only mode for 1–2 weeks.** Use the `Content-Security-Policy-Report-Only` header — browsers report violations but don't block. Collect violations from real traffic. Especially watch for blind spots (third-party integrations that surprise us, dynamic imports that have a CDN-hosted manifest, etc.).

3. **Tighten to enforcement mode.** Switch the header from `-Report-Only` to enforcement. Lock the policy in `next.config.ts` alongside the existing baseline headers.

**Estimated cost**: ~3–4 hours including the report-only window (mostly waiting for traffic to surface violations). Implementation itself is ~1 hour.

**Trigger**: post-launch hardening sweep. Not blocking pre-launch — the baseline headers close the immediate clickjacking + MIME-sniff + referrer-leak gaps; CSP is the next layer of defense, not the first.

**Cross-references**:
- `docs/OWASP-AUDIT.md` § 6 (WO1) — full rollout plan
- `next.config.ts` — where the CSP will live alongside the existing 5 baseline headers
- Slice S8 commit (this slice's `feat(slice-s8): OWASP sweep`) — established the headers infrastructure

---

### Slice S8 follow-on — `postcss` transitive CVE upstream watch

**Surfaced**: 2026-06-08 during Slice S8 `npm audit`. Documented in `docs/OWASP-AUDIT.md` § 3 (F2) + § 6 (WO2).

**The CVE.** `postcss` <8.5.10 has a moderate-severity XSS vector via unescaped `</style>` in stringify output. The vulnerable version is pulled in as a transitive dependency by Next.js (`node_modules/next/node_modules/postcss`). `npm audit fix --force` would downgrade Next.js to 9.3.3, which is unacceptable. Slice S8 left the CVE in place per the Slice S3 cost-justified posture (accept-and-wait for upstream).

**App-side risk.** Minimal. The vulnerability requires the attacker to control the CSS that postcss is processing. Stages only processes CSS at build time on our infrastructure (CI), not in response to user input. There is no runtime path from user input to postcss.

**The fix path.** Wait for Next.js to bump the transitive `postcss` dependency past 8.5.10. Track via:
- Next.js GitHub releases or upgrade-guide notes
- Re-running `npm audit` at each Next.js patch bump

**Estimated cost**: opportunistic — the fix is automatic when Next.js publishes a patch. Just verify post-upgrade with another `npm audit`.

**Trigger**: every Next.js minor or patch bump. Founder can re-run `npm audit` opportunistically.

**Cross-references**:
- `docs/OWASP-AUDIT.md` § 3 (F2) + § 6 (WO2)
- Advisory: <https://github.com/advisories/GHSA-qx2v-qp2m-jg93>

---

### Slice S8 follow-on — forgot-password / reset-password smoke verification

**Surfaced**: 2026-06-08 during Slice S8 auth-flow inventory. Documented in `docs/OWASP-AUDIT.md` § 5 (A07) + § 6 (WO3).

**The handoff context.** The original Slice 0 handoff WISHLIST flagged a 404 on `/auth/signin`'s "Forgot password?" link (reset page missing). Slice S8 verified both `ForgotPasswordPanel.tsx` and `reset-password/page.tsx` exist on disk with clean structure, so the 404 was likely already fixed at some point. **Spot-check did not run end-to-end (would require sending a reset email and clicking through).**

**The fix.** A 5-minute manual smoke test by the founder:

1. Sign out (or use incognito).
2. Visit `/auth/signin`.
3. Click "Forgot password?" — assert: lands at `/auth/forgot-password`, no 404.
4. Submit an email — assert: triggers Supabase reset-email send, success state renders.
5. Open the email, click the reset link — assert: lands at `/auth/reset-password`, no 404.
6. Set a new password — assert: signs in successfully on the next attempt.

If any step fails, the symptoms drive a targeted code fix (the components exist, so most likely root cause is a Supabase email-template redirect-URL mismatch or a broken intermediate route).

**Estimated cost**: 5 min smoke + at most ~30 min fix if a route's broken.

**Trigger**: post-S8 smoke window or any pre-launch test pass.

**Cross-references**:
- `docs/OWASP-AUDIT.md` § 5 (A07) — auth flows survey
- `src/components/auth/ForgotPasswordPanel.tsx` — component exists
- `src/app/auth/reset-password/page.tsx` — page exists

---

### Slice S7 follow-on — marketing-site Privacy/Terms sync (single source of truth)

**Surfaced**: 2026-06-08 during Slice S8 commit window. The Slice S7 legal pages live at `app.trystages.com/{privacy,terms}` and were built consuming the locked drafts from `docs/DATA-COLLECTION.md`. The marketing site (`trystages.com`) has its own `/privacy` and `/terms` pages that currently require manual copy-paste sync — every legal-review update would need to touch both surfaces.

**The drift risk.** With two surfaces of the "same" document:
- A founder or counsel edits the app version; marketing version stays stale.
- A founder or counsel edits the marketing version; app version stays stale.
- Customers reading via different entry paths see different commitments. Worst case: a published commitment on one surface is not honored on the other — direct contractual exposure.

**Recommended fix — 301 redirects from marketing → app.** Make `app.trystages.com/{privacy,terms}` the single source of truth. The marketing site sets up 301 (permanent) redirects:

```
trystages.com/privacy → app.trystages.com/privacy
trystages.com/terms   → app.trystages.com/terms
```

301 preserves SEO link equity and tells search engines the canonical URL has moved. Any link to `trystages.com/privacy` (e.g., from old emails, marketing collateral) still resolves to the live, correct version.

**Implementation depends on marketing platform.** The exact mechanism is whatever the marketing site uses for routing:
- **Static site (Vercel / Netlify / Cloudflare Pages)** — add a `_redirects` file or `redirects()` config function.
- **CMS-hosted (Webflow / Framer)** — platform's redirect-settings UI.
- **Custom Next.js marketing site** — `next.config.ts` `async redirects()` mirroring the app's `headers()` pattern.

**Estimated cost**: ~30 min depending on marketing platform's redirect support. Founder typically does this in the marketing-platform admin UI; engineer-level work only if the marketing site is custom-coded.

**Trigger**: opportunistic. Recommended before the next legal-review pass so the syncing toil doesn't get reintroduced. Pre-launch if marketing-site visitors are a significant signin source.

**Cross-references**:
- `src/app/(legal)/` — Slice S7 — the canonical source-of-truth surface
- `docs/DATA-COLLECTION.md` § 1.15 + § 4.2 — locked content sourced from here

---

### Slice S7 follow-on — engage professional legal review for /privacy and /terms

**Surfaced**: 2026-06-08 during Slice S7 polish window. The Slice S7 drafts ship without the prior pending-legal-review banner (removed per founder call: banner adds noise without value; substantive commitments are already accurate; competitor SaaS legal pages don't carry similar banners).

**The position.** The substantive commitments in `/privacy` and `/terms` are verified accurate to the system's current behavior (audited through Slices 0, 0.1, S1–S3, S7). What benefits from counsel is **language refinement**, not commitments-correction. Specific areas where professional legal review will likely refine:

- Jurisdiction-specific GDPR / CCPA / state-privacy-law language (e.g., California CPRA-specific rights phrasings, Virginia VCDPA, Colorado CPA).
- Limitation-of-liability cap enforceability across more jurisdictions than the New Jersey base assumed in ToS § 13.
- Boilerplate refinements (force majeure clause, severability, third-party beneficiary, entire agreement) — currently minimal-to-absent.
- Specific language for the AI agent-platform commitments in Privacy § 9 — these are unusually granular for a SaaS privacy policy (most don't have a 4-level consent framework articulated publicly) and may benefit from counsel's eye on which commitments create the cleanest contractual hooks.
- Mailing address insertion (currently flagged as "to be added on next legal-review iteration" in Privacy § 13).

**Recommended engagement shape.** A 2-3 hour SaaS-experienced counsel review focused on:
1. Confirming the substantive commitments don't create unintended exposure (especially the agent-platform § 4.2 language).
2. Adding jurisdictional refinements for the major US states + EU/UK GDPR coverage.
3. Refining the limitation-of-liability and indemnification clauses.
4. Adding the standard boilerplate.

**Estimated cost**: counsel time, ~$1-2K for a focused review at typical SaaS-counsel rates. Self-engineering cost is ~30 min to integrate counsel's redlines back into the page components.

**Target**: post-launch (Q3 2026 or upon hitting $5K MRR, whichever sooner). Pre-launch is fine without professional review because the commitments are accurate and the disclaimer-footer ("This document does not constitute legal advice. We recommend customers consult their own counsel...") sets the right expectation.

**Cross-references**:
- `src/app/(legal)/privacy/page.tsx` — current draft
- `src/app/(legal)/terms/page.tsx` — current draft
- `docs/DATA-COLLECTION.md` § 1.15 + § 4.2 — locked source-of-truth content

---

### Slice S7 follow-on — broader AI-tell editorial pass on /privacy and /terms

**Surfaced**: 2026-06-08 during Slice S7 polish window. Em-dash removal pass (locked + shipped same commit window) closes the strongest single AI-tell. Several softer tells remain but are not worth fixing in tonight's window.

**What was kept (deliberate, not deferred).** Per founder review: bold lead-ins (`<strong>Supabase.</strong> Our primary backend...`) are standard in good legal writing — Stripe + Vercel + Linear all use them. Nested lists with consistent indentation are good UX. Section-level structure mirrors the underlying audit doc by design (and that mirror is contractually meaningful given § 4.2's verbatim consumption).

**What could be softened in a focused copyediting pass:**

- **Sentence-length variance.** Current prose runs in a fairly narrow length range. Mixing in shorter declarative sentences ("That's it." / "We do not.") and occasional longer flowing sentences breaks the rhythm that machine-generated copy tends to produce.
- **Parenthetical density.** The em-dash removal converted many em-dash pairs to parentheses; the page now has more parenthetical asides than pre-removal. A copyedit pass could push some back to standalone sentences or rephrase to avoid the aside entirely.
- **Perfectly-symmetric structure.** The Privacy Policy's 13 sections + Terms' 16 sections each follow consistent internal patterns (paragraph + bullet list, paragraph + bullet list). Selectively breaking the pattern in a few places (e.g., one section reads as pure prose, no bullets) makes the whole feel more hand-crafted.
- **Lead-in formula.** Many sections open with a single-sentence paragraph that states what the section is about. Varying the opening (sometimes lead with the rule, sometimes with the rationale, sometimes with a question) reduces formulaic feel.

**Scope and cost.** A focused copyediting pass by someone with strong SaaS copy instincts. Not a re-write; a structural-rhythm refinement. ~2-3 hours of judgment-applied editing.

**Why deferred.** Half-finished scrubs read worse than the current state. Tonight's em-dash pass is internally consistent (one rule, applied uniformly). A broader editorial pass needs sharp focus, not a tail-end-of-marathon attempt. Post-launch when the first 5-10 customers' reactions inform what actually matters is the right window.

**Target trigger**: post-launch + first customer cohort feedback. Or earlier if legal-review counsel flags rhythm-related issues during their pass.

**Cross-references**:
- `src/app/(legal)/privacy/page.tsx` — current draft (em-dash pass applied 2026-06-07)
- `src/app/(legal)/terms/page.tsx` — current draft (em-dash pass applied 2026-06-07)
- WISHLIST → "Engage professional legal review for /privacy and /terms" — adjacent priority; might be the natural moment for the rhythm pass too

---

### ✅ RESOLVED 2026-06-07: workspaces_insert C1 client-boundary bypass

**Surfaced**: 2026-06-06 during Slice S1 Phase 1 RLS audit. Documented in `docs/RLS-AUDIT.md` § 3.1 as the single 🚨 CRITICAL finding of the audit.

**The exploit.** Pre-fix `workspaces_insert` had `WITH CHECK = (auth.uid() IS NOT NULL)` — any authenticated user could POST directly to `/rest/v1/workspaces` with their JWT and create a workspace row. A pure client could open DevTools and escape the C1 client-boundary entirely. The C1 rule was enforced only in the application layer (`create_workspace_with_owner` RPC) — direct PostgREST INSERT bypassed the RPC and the rule never ran.

**Fixed in**: `f34fe32` — `fix(slice-s1): close C1 bypass via can_create_workspace helper + RLS policy`.

Three-part fix in one migration (`20260624140300_workspaces_insert_c1_enforcement.sql`):
1. `public.can_create_workspace(actor uuid)` SECURITY DEFINER helper mirroring the locked three-case rule from the existing RPC (20260605120000) byte-for-byte. `has_agency` includes both `workspace_memberships` AND agency-role `pipeline_memberships` (owner/admin/member) — matches the RPC's broader definition so mixed-role users pass through as agency.
2. Least-privilege EXECUTE allowlist on the helper: revoked from `public` AND `anon` explicitly, granted only to `authenticated`. The `anon` revoke was the post-apply discovery — in Supabase, revoking from PUBLIC does NOT transitively cover `anon`/`authenticated`. Lesson captured inline in the migration header.
3. `workspaces_insert` DROP + CREATE with WITH CHECK calling the helper.

The application-layer RPC check STAYS — defense-in-depth, two distinct threat models. RPC callers hit the RPC's check first (clearer error). Direct-PostgREST callers now hit the new RLS policy.

**Canonical proof of close** (probe (e) from the migration):
- Pre-fix: pure client `supabase.from('workspaces').insert(...)` → 201, row inserted (THE EXPLOIT).
- Post-fix: same call → BLOCKED at helper level. `activity_test_allowed = false` verified live.
- Onboarding regression check: Jordan created `post-fix4-regression-test` workspace via standard `/onboarding/create-workspace` UI without issue.

**Pattern reusable.** The SECURITY DEFINER helper + RLS WITH CHECK pattern this fix demonstrates is the same shape the broader RLS-billing-state hardening entry (above) will use when it ships. Worth noting: the C1 helper here is straightforward (membership-existence checks across two tables); a billing-state helper would be a single PK lookup on `workspace_billing` and is per-statement cacheable.

---

### Hardening: table-level GRANT audit across `public` schema

**Surfaced**: 2026-06-06 during Slice 0.1 smoke test.

**The finding**. PostgreSQL evaluates `GRANT` privileges BEFORE RLS policies. A table can have a perfectly-correct RLS UPDATE policy (e.g. `id = auth.uid()`) and still refuse the operation with `42501 permission denied for table X` if the calling role doesn't hold the corresponding column-level UPDATE GRANT.

Slice 0.1's user toggle for `improvement_signals` 42501'd immediately on the first smoke click — even though the `profiles_update` RLS policy is correct — because the `authenticated` role's GRANT allowlist on `public.profiles` didn't include the new `ai_consent` column (and was also missing the older `avatar_url` column the audit doc previously claimed was wired up).

Ad-hoc SQL applied to prod added both columns to the allowlist; captured as migration `20260624130000_profiles_update_grants.sql` for restore parity.

**The risk to other tables**. The same shape of mismatch may exist elsewhere in the `public` schema, in two directions:

1. **RLS exists, GRANT missing** — false-sense-of-access: the policy reads "this is allowed" but operationally everything 42501s. User-facing bugs that look like Supabase outages. Easy to detect via integration tests.
2. **GRANT exists, RLS missing** — real exploit surface: the policy doesn't constrain who can read or write a column, but the GRANT layer let it through anyway. Silent data leak or privilege escalation. Hard to detect without an explicit audit.

The second case is the dangerous one. The Slice 0.1 finding raises the prior probability that other policy/grant pairs are out of sync across the ~30 tables.

**The audit**. For every table in the `public` schema, verify:
- Column-level `GRANT` lists for `authenticated` and `anon` roles match the intent expressed by RLS policies.
- No column is grant-permitted but RLS-blocked (false-promise pattern — annoying but safe).
- More importantly: no column is RLS-blocked but GRANT-permitted, or RLS-missing-entirely while GRANT-permitted.
- The exclusion-canary pattern from `20260624130000` is replicated for every other "must not be user-writable" column (e.g. any future `is_*` flag that confers paid access).

Single SQL query to enumerate every grant + policy pair:

```sql
select t.table_name,
       array_agg(distinct cp.column_name || ':' || cp.privilege_type)
         filter (where cp.grantee = 'authenticated') as auth_grants,
       array_agg(distinct p.cmd) as rls_cmds
from information_schema.tables t
left join information_schema.column_privileges cp
  on cp.table_schema = t.table_schema
 and cp.table_name = t.table_name
left join pg_policies p
  on p.schemaname = t.table_schema
 and p.tablename = t.table_name
where t.table_schema = 'public'
  and t.table_type = 'BASE TABLE'
group by t.table_name
order by t.table_name;
```

Read the output table-by-table, flag every mismatch as either a fix-migration or an open finding.

**Estimated cost**: ~2 hours including the enumeration query, manual review of all ~30 tables, fix migrations for any anomalies found, and a privacy-harness extension that asserts the policy/grant pairing for every table.

**Scoped within Slice S1** (RLS audit + automated test suite — see the slice plan in the project handoff). Flagging here explicitly because Slice S1 as originally scoped focused on the RLS layer; the GRANT layer is a co-equal concern that the Slice 0.1 smoke surfaced as material risk.

**Trigger**: pre-launch hardening sweep before live-mode Stripe flip, alongside the broader RLS-billing-state hardening above.

**Cross-references**:
- `supabase/migrations/20260624130000_profiles_update_grants.sql` (the Slice 0.1 fix that surfaced this pattern)
- `supabase/migrations/20260621120100_founding_member_grant_amendment.sql` (prior incident — same shape, smaller blast radius)
- `docs/DATA-COLLECTION.md` § 5 (Slice S1 referenced as the home for the test suite)

---

### 🚨 CRITICAL: RTBF (Right To Be Forgotten) deletion handler

**Surfaced**: 2026-06-06 during Slice 0 Part 0.A data audit.

**The gap**: when a user requests account deletion today, Supabase Auth's CASCADE wipes most attribution (FK SET NULL on author / assignee / completer fields), but several PII-bearing columns survive in denormalized or queue-table form:

- `upgrade_interest.email` — survives via `user_id ON DELETE SET NULL`; the email column is untouched.
- `pending_emails.recipient` + `pending_emails.recipient_name` — no FK to `auth.users`, so user deletion does nothing.
- `activity_events.actor_name` — denormalized text snapshot; intentional for audit integrity, but conflicts with right-to-be-forgotten if the user requests a full scrub.
- `profiles.email` — mirrored from `auth.users.email`; should CASCADE on user delete, but the sync direction for full account deletion (vs. soft-delete) is worth verifying as part of this slice.

**Required for**: GDPR Article 17 + CCPA "Delete My Personal Information" requests. Blocking customer #1 in EU.

**The fix**: a server-side `delete_user_account(user_id)` RPC + route handler that:

1. Validates the caller is the user being deleted (or service-role).
2. Within a SQL transaction (SECURITY DEFINER RPC):
   - Anonymizes `activity_events.actor_name` for that user to `"Former user"` (preserves audit integrity per the locked § 1.15 PP language).
   - Hard-deletes `upgrade_interest` rows where `email = (select email from auth.users where id = $1)`.
   - Hard-deletes `pending_emails` rows where `recipient = (select email from auth.users where id = $1)` AND `sent_at IS NULL`.
3. Outside the transaction, fans out to the processor APIs:
   - **Stripe**: if `user_billing.stripe_customer_id` exists, call `stripe.customers.del(customer_id)`. Stripe will mark the customer deleted but retain transaction history per AML (acceptable carveout for the privacy policy).
   - **Google OAuth**: if the user signed in with Google, call `https://oauth2.googleapis.com/revoke?token=${refresh_token}` to revoke the OAuth grant on Google's side. Otherwise refresh tokens stay valid on Google indefinitely.
   - (Resend: no per-recipient delete API; the 30-day backup window is documented as a privacy-policy carveout — no action.)
4. Calls Supabase Admin API `auth.admin.deleteUser(user_id)` to trigger CASCADE on `auth.users`.
5. Returns success / failure JSON.

A "Delete my account" affordance lives in `/settings/account` with a confirmation modal. Privacy-harness extension verifies the sweep is complete (zero rows for the user's email across all PII columns; Stripe customer marked deleted; Google revoke returned 200).

**Estimated cost**: ~4–5 hours (revised up from initial 3–4h estimate to include processor-side fan-out, error handling for the partial-success case, and the harness test).

**Trigger**: pre-launch. Required before accepting EU customers, before flipping live-mode Stripe, and before Slice S7 (Privacy Policy) can promise full deletion without hedging.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 1.1, 1.11, 1.12, 1.15, 3.1, 3.2, 3.6
- Slice S7 depends on this shipping or PP language must hedge.
- Founder checklist § 3.9 items 5, 8, 22 verify this works end-to-end after the handler ships.

---

### 🚨 CRITICAL: POST /api/invites/send returns 404 from browser (Slice 5 pre-existing, ALL invites broken in prod)

**Surfaced**: 2026-06-25 during Slice 6 Part F Phase 7 smoke test.

**Symptom**: invite email never gets sent. POST `/api/invites/send` returns **HTTP 404 from the browser** (via the team-settings invite form). Direct `curl` against the same endpoint returns HTTP 400 with `"Invalid email"` — proving the route file exists and registers.

**Where it lives**: `src/app/api/invites/send/route.ts` (committed in `3679a5c`, Slice 5). Route is registered in `npm run build` output. Probed live via Slice 5/6 build verification — confirmed deployed.

**Likely causes** (ranked):
1. Client code path mismatch — the form submits to a wrong URL (e.g., trailing slash, lowercase variation, or a typo in `fetch(...)` URL).
2. Request header difference — browser sends a header the route handler rejects with a 404-like response before reaching the actual route logic.
3. Middleware redirect — Next.js middleware intercepts the request shape from the browser specifically.

**Diagnostic next steps** (when picked up):
1. Open DevTools Network tab on team-settings invite submit → copy the exact request URL + headers.
2. Reproduce that exact request via `curl -H "..." -H "..." ...` → if curl ALSO 404s → route resolution issue. If curl 200/400s → header-specific rejection.
3. Check `src/middleware.ts` (if it exists) for any redirect on `/api/...` paths.
4. Grep for `fetch("/api/invites/send"` and `fetch('/api/invites/send'` — confirm casing + slashes match the route file's path.

**Real impact**: PRE-EXISTING Slice 5 bug, NOT a Slice 6 regression — but Slice 6 confirmed it via Phase 7 smoke. **Invite emails currently failing in production for ALL users.** Founders can't onboard teammates via the invite form path; they'd have to manually share workspace URLs and have the recipient sign up + be added.

**Estimated cost**: ~30 min to diagnose by comparing browser vs. curl headers. Fix is likely a 1-line URL correction in the client form code or a middleware bypass.

**Trigger**: pre-launch — invites broken is a launch-blocker for any agency with >1 teammate. Worth fixing before flipping live-mode Stripe.

---

#### ✅ RESOLVED 2026-06-06 in commit `fix(slice-x1): bind JWT to Supabase client in invites/send route`

**Actual root cause** (none of the three original "Likely causes" was correct — all three guessed at client-side or routing issues):

`/api/invites/send/route.ts:73` constructed the Supabase client with no JWT binding —
`createClient(SUPABASE_URL, SUPABASE_KEY)`. The subsequent `supa.auth.getUser(jwt)` call decoded the token to *identify* the user but did NOT bind the JWT to the client for PostgREST queries. The `workspace_invites` lookup below it therefore ran as `anon`, the `workspace_invites_select` RLS policy (owner/admin only) returned zero rows, and the route fell through to its **own intentional 404 at line 109-110**: `{"error":"Invite not found or no permission"}`.

The 404 was the route's application-layer "not found or no permission" path — never a routing 404.

**Why the curl test misled the diagnosis.** curl was called with an empty body, which failed `parseBody` at line 49-51 and returned **400 before reaching the workspace_invites lookup**. The bug only manifests when the body parses successfully — exactly the code path curl never executed. The "curl returns 400, browser returns 404" asymmetry that read like a header/middleware issue was actually two different early-exits in the same route.

**Pattern divergence.** Three of four invite routes were already correct:

| Route | Pattern | Pre-fix status |
| --- | --- | --- |
| `/api/invites/send` | `createClient(URL, KEY)` (anon) | 🚨 broken |
| `/api/invites/resend` | `createClient(URL, KEY, { global: { headers: { Authorization: 'Bearer …' } } })` | ✅ correct |
| `/api/client-invites/send` | Same JWT-bound pattern | ✅ correct |
| `/api/client-invites/resend` | Same JWT-bound pattern | ✅ correct |

`/api/invites/resend` even had an inline comment documenting the rationale (*"User-scoped client: every PostgREST request includes the caller's JWT, so RLS evaluates as that user. If the caller has no permission, the invite query returns null (no row → no error) and we collapse to a 404, indistinguishable from 'doesn't exist.'"*). A maintainer had already understood the trap on the resend route but never propagated the fix back to send. Slice 5 (commit `3679a5c`) is when the send route was rebuilt and the JWT-binding step was dropped.

**The fix.** Three lines on `src/app/api/invites/send/route.ts:73` — replace anon-bound client construction with the JWT-bound shape mirroring `invites/resend/route.ts:75-78` verbatim. Added an inline comment explaining why so future maintainers don't strip it again.

**Lessons** (carry forward into any future "browser-only 404" diagnosis):
1. **Check the response body, not just the status code.** DevTools' status-code-at-a-glance can't tell you whether a 404 is a routing 404 or the route's own `{"error":"…"}` response. The body is the diagnostic tell.
2. **curl-vs-browser asymmetry doesn't always mean a transport-layer divergence.** It can mean the two requests are hitting different early-exits in the same route. Compare what each request *does* on the server, not just what each sends.
3. **Patterns that exist in 3-of-4 sibling routes should be lifted into a shared helper.** If a fourth maintainer rebuilds another invite route in the future without inheriting the JWT-binding step, the same bug recurs. Tracked separately under Slice S1 (RLS audit + test suite) as a follow-on: a `createUserScopedSupabaseClient(jwt)` helper in `src/lib/` would prevent recurrence by giving everyone one obvious right-shape to import.

---

### Hardening: workspace_invites INSERT bypasses billing-guard (architectural gap matching RLS-billing item above)

**Re-confirmed**: 2026-06-25 during Slice 6 Part F Phase 7 smoke test.

**The gap**: the `workspace_invites` row INSERT happens **client-side via direct PostgREST**, bypassing the app-layer billing-guard at `src/lib/billing-guard.ts`. A user whose workspace is in `subscription_status='trialing'` + `stripe_subscription_id IS NULL` + `trial_ends_at <= now()` (Slice 6 Track B expired state) can still create invite rows via direct `supabase.from("workspace_invites").insert(...)` calls from a client component. The InviteForm code path doesn't traverse any API route that would call `assertSubscriptionWritable`.

The downstream email send (which IS gated via `/api/invites/send`) doesn't matter — the row exists, the workspace_invites table has data the user shouldn't have been able to create in read-only state, and a future "manual resend" UX could still email it without re-checking billing state.

**Matches the existing entry** "Hardening: RLS-layer billing-state write enforcement (after Stripe Slice 5)" above. This is one specific instance of the broader pattern; the fix is the same SECURITY DEFINER helper `is_workspace_billing_active(workspace_id uuid)` extended to the `workspace_invites_insert` RLS policy.

**Two paths to fix** (pick one when picking up):
1. **RLS-layer** (aligned with broader hardening item) — extend `workspace_invites_insert` policy with `AND public.is_workspace_billing_active(workspace_id)`. ~30 min if `is_workspace_billing_active` already exists from the broader hardening sweep.
2. **Refactor to API route** — move the workspace_invites INSERT into a new POST route (e.g., `/api/invites/create`) that calls `assertSubscriptionWritable` before INSERT. ~2 hours; preserves the existing direct-PostgREST → API split pattern that other slices use.

**Estimated cost**: ~3-4 hours including either approach + privacy harness re-run + smoke verification across canceled/trialing/expired states.

**Trigger**: same as the broader RLS-billing hardening item — pre-launch hardening sweep before live-mode Stripe flip. Suggest doing both items in the same migration touch.

---

### Cosmetic: send-pending-emails cron response shape under-reports `sent` count

**Surfaced**: 2026-06-25 during Slice 6 Part F Phase 10 smoke test.

**Symptom**: `GET /api/cron/send-pending-emails` returned `{"processed":3,"sent":3}` even though 10 queued emails (1 smoke workspace + 9 grace-cohort) were ACTUALLY sent successfully — verified via `sent_at` timestamps on all 10 `pending_emails` rows post-cron.

**Likely cause**: the route's batching loop counts only the most recent batch in its response body, not the cumulative sent across all batches. The work is correct (all rows actually got drained and marked sent); the response is just inaccurate.

**Where it lives**: `src/app/api/cron/send-pending-emails/route.ts`. The `sent` accumulator likely resets between batches in the for-loop, or the response builder reads only the last loop iteration's value.

**Impact**: cosmetic only. Real behavior is correct — emails were sent. The response shape is what's wrong.
- Monitoring / alerting impact: minimal. cron-job.org dashboard only checks HTTP status, not response body.
- Audit-trail impact: `sent_at` timestamps in `pending_emails` are the source of truth, not the cron response.
- Developer-confusion impact: future debugging of the cron will second-guess the count — "did 10 send or 3?" — which adds 5-15 min of `pending_emails` lookup to figure out.

**Estimated cost**: ~10 min. Likely a single-line fix where the loop accumulator was scoped to the inner block instead of the outer function.

**Trigger**: low-priority. Fix opportunistically next time the file is touched for a related reason.

---

### pending_emails 90-day cleanup cron (Slice 0.X)

**Surfaced**: 2026-06-06 during Slice 0 Part 0.A data audit.

**Locked policy** (`docs/DATA-COLLECTION.md` § 1.11, § 1.15): `pending_emails` rows retained for **up to 90 days** for support and debugging. Privacy-Policy language already pre-approved: *"We retain email delivery records for up to 90 days for support and debugging purposes."*

**Current state**: no cleanup running. Rows persist unbounded. The locked policy is 90 days; the implementation is this entry.

**The fix**: a daily cron route `/api/cron/cleanup-pending-emails`:
- Bearer `${CRON_SECRET}` auth (matches existing cron pattern).
- Service-role client.
- Runs `delete from pending_emails where created_at < now() - interval '90 days'` (NB: keyed on `created_at`, not `sent_at` — even orphaned unsent enqueues drop).
- Logs row count to console for cron-job.org observability.

**Estimated cost**: ~30 min. Mirror the existing cron route structure (`/api/cron/sync-seats` is the simplest template). Schedule on cron-job.org daily at e.g. 04:00 UTC, after the existing trial-lifecycle crons finish.

**Why "minor slice" (Slice 0.X)**: privacy minimization is a one-route delivery, not a full slice. Ship after Slice 0 wraps Parts 0.B/C/D.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 1.11, § 1.14, § 1.15

---

### Strip recipient email from success-path Resend log line

**Surfaced**: 2026-06-06 during Slice 0 Part 0.B telemetry audit.

**The line**: `src/lib/email.ts` logs every successful send as `[email] Sent invite to ${payload.to} via Resend (id: ${result.data?.id ?? "unknown"})`. The recipient email lands in Vercel function logs, which:
- May survive 1h–7d depending on Vercel plan tier (founder to verify).
- Are accessible to anyone with Vercel project access (founder today; future teammates as the team grows).
- Aggregated over time = a complete list of every Stages-mailed person, including invitees who never signed up.

**Privacy posture**: The information is technically already in Resend's dashboard (which is necessary — Resend has to know who to send to). The Vercel log line is duplicative leakage into a second processor's log retention. Removing it doesn't reduce our operational capability — the Resend dashboard remains the system-of-record for "did the email send" queries.

**The fix**:

```ts
// Before:
console.log(`[email] Sent invite to ${payload.to} via Resend (id: ${result.data?.id ?? "unknown"})`);

// After:
console.log(`[email] Sent invite via Resend (id: ${result.data?.id ?? "unknown"})`);
```

Repeat for any sibling success-path logs in `src/lib/email.ts` and any per-template helper (Day-12, Day-28, founding-upgrade, first-pipeline emails). The Resend message ID is sufficient for support / debugging — paired with the Resend dashboard, the founder can always re-resolve email-id → recipient.

**Estimated cost**: ~15 min including grep for sibling log lines + sanity-build.

**Why low priority**: Vercel logs are already access-controlled and short-lived. But privacy minimization is the right default, and the fix is trivial.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 2.3, § 2.4, § 2.11
- Consider in the same PR as the pending_emails cleanup cron above (both touch the email lifecycle).

---

### Migrate cron triggers from cron-job.org → Vercel Cron (pre-launch)

**Surfaced**: 2026-06-06 during Slice 0 Part 0.C processor audit.

**The gap**. cron-job.org is the only processor in Stages' stack with:
- **No DPA published.** No GDPR Article 28 processor terms; the operator (Patrick Schlangen, Aachen, Germany) is a single individual on a free/freemium model.
- **No security certifications.** No SOC 2, no ISO 27001, no PCI, no HIPAA.
- **No breach notification SLA.** No commitment in their privacy policy or terms.
- **Bearer token stored unencrypted on their side**, per their own privacy policy: "HTTP auth credentials configured for cronjobs are stored unencrypted for technical functionality." Stages' `CRON_SECRET` is therefore visible to cron-job.org operators in plaintext.

Per the founder checklist (§ 3.9 item 19), an email to `info@cron-job.org` requesting a GDPR Art. 28 AVV should confirm the gap. Expected response: no.

**The fix**: migrate cron triggers to **Vercel Cron** (https://vercel.com/docs/cron-jobs). Same triggering semantics (scheduled HTTPS hit to a route); inherits Vercel's:
- Auto-incorporated DPA
- SOC 2 Type II + ISO 27001
- "Without undue delay" breach SLA (matched by Stages' Article 33 controller obligation)
- Same security boundary as the app (the cron and the route live in the same Vercel project)

**Implementation steps**:
1. Add a `crons` array to `vercel.json` with the five current schedules:
   - `03:15 UTC` → `/api/cron/sync-seats`
   - `03:30 UTC` → `/api/cron/enqueue-founding-day28`
   - `03:45 UTC` → `/api/cron/expire-founding-trials`
   - `03:45 UTC` → `/api/cron/enqueue-trackb-day12`
   - Every ~10 min → `/api/cron/send-pending-emails`
2. Update each route's auth check. Vercel Cron sends an `Authorization: Bearer ${CRON_SECRET}` matching the value of the `CRON_SECRET` env var — same shape as cron-job.org sends today, so the existing route auth checks should work as-is. **Verify** by reading the Vercel Cron docs: confirm the header format and `vercel.json` schedule grammar.
3. Rotate `CRON_SECRET` to invalidate the value cron-job.org has stored unencrypted.
4. Pause (or delete) the schedules at cron-job.org's console.
5. Verify each cron fires from Vercel via Vercel Dashboard → Project → Crons → Logs.

**Estimated cost**: ~1–2 hours including `vercel.json` edit, secret rotation, dual-running window for verification, and decommissioning the old schedules.

**Why pre-launch**: removing the cron-job.org dependency closes three compliance gaps (DPA, certs, secret-storage) before we make any privacy / security promises to paying customers. Migration cost is tiny relative to the explanation burden of "we use a small German cron service with no DPA."

**Trigger**: pre-launch hardening sweep, ideally before live-mode Stripe flip. Has dependency: requires Vercel plan tier that supports Cron (currently Pro+ for unlimited; Hobby allows up to 2 cron jobs at limited frequencies).

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 3.5, § 3.8, § 3.9 (items 17–19)

---

### `stripe_events` 90-day purge cron

**Surfaced**: 2026-06-06 during Slice 0 Part 0.C processor audit (resolves § 2.12 item 7).

**The gap**: `stripe_events.payload` stores the full Stripe webhook event JSON for idempotency + audit (§ 1.9). The table has no purge policy — it grows unbounded. The payload contains customer IDs, subscription IDs, plan IDs, and amounts; while not raw PII, it's a Stripe-transaction archive that doesn't need to live forever in our DB.

**Locked decision**: 90 days (mirrors the `pending_emails` retention locked in Slice 0 Part 0.A § 1.11). Idempotency only needs the most recent ~24h of events; 90 days is generous headroom for support / debugging lookback.

**The fix**: a daily cron route `/api/cron/cleanup-stripe-events`:
- Bearer `${CRON_SECRET}` auth (matches the existing cron pattern; if Vercel Cron migration ships first, inherits that).
- Service-role client.
- Runs `delete from stripe_events where received_at < now() - interval '90 days' and processed_successfully = true`.
- The `processed_successfully = true` guard avoids deleting any still-failing events that may need re-investigation.
- Logs row count for cron observability.

**Estimated cost**: ~30 min. Sibling of the `pending_emails` cleanup cron — same pattern, different table.

**Why ship together with `pending_emails` cleanup**: both are 90-day retention crons added to address Part 0.A / 0.B findings; one PR is half the review burden of two.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 1.9, § 2.12 (item 7), § 3.2

---

### Drop vestigial `user_templates` table

**Surfaced**: 2026-06-06 during Slice 0 Part 0.A data audit; SQL-confirmed empty in production (0 rows).

**Status**: `user_templates` predates the current `templates` / `template_stages` / `template_tasks` trio (introduced in `20260606120000_pipeline_templates_schema_and_rls.sql`). No code path writes to `user_templates` — confirmed by reading the `save_pipeline_as_template` RPC source, which writes to the trio. Production row count: **0**.

**The fix**: drop the table in a single migration.

**Estimated cost**: ~15 min including:
- Confirm no FKs reference `user_templates` (one `select * from information_schema.referential_constraints` query).
- Drop migration with `drop table public.user_templates;`.
- Apply via Supabase SQL editor (same flow as every other migration; never `db push`).

**Why low priority**: schema hygiene, not security. The empty table is invisible to RLS-filtered queries (owner-only policy returns zero rows for everyone), so it's not a leak vector — just dead weight.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 1.8

---

### Slice 0.1 — AI consent infrastructure (agent platform)

**Surfaced**: 2026-06-06 during Slice 0 Part 0.D (AI-readiness disclosure).

**Status**: pre-AI-feature blocker. Builds Level 1 (workspace AI enablement) + Level 4 (improvement signals) of the 4-level consent framework documented in `docs/DATA-COLLECTION.md` § 4.2.B. Levels 2 and 3 are deferred to their own slices (below).

**Meta-commitment** (locked, § 4): *"Stages AI acts on your behalf within tools you connect. Every action requires your permission. We never train on your data."*

**Scope**:

1. **Migration** (file written, pending strategy approval): `supabase/migrations/20260624120000_ai_consent_infrastructure.sql`
   - `workspaces.ai_consent` JSONB default `{"agent_enabled": false}`
   - `profiles.ai_consent` JSONB default `{"improvement_signals": false}`
   - `ai_consent_audit` sibling table (modeled on `seat_sync_log`; service-role only)
   - Verification queries in commented footer
2. **RLS**: no new policies — both consent columns inherit existing table-level SELECT/UPDATE behavior (workspace owner UPDATE, member SELECT; profile own UPDATE, shared-context SELECT). Documented in `docs/DATA-COLLECTION.md` § 4.3.B.
3. **Settings page** at `/w/[slug]/settings/privacy` — four sections: workspace AI (owner-only toggle), your AI preferences (improvement-signals toggle), Connected Integrations (placeholder for Slice 0.2), AI Action History (placeholder for Slice 0.3/0.4). Mock layout in § 4.3.C.
4. **Server action** for toggle updates with permission validation + JSONB merge (`||`) update + audit-row write via service-role admin client. Wired to `ai_consent_audit`. Flow in § 4.3.D.
5. **`src/lib/ai-consent.ts` utility** with `checkAgentEnabled(workspaceId, supa)` + `checkImprovementSignals(userId, supa)`. Both fail closed on read error (privacy-by-default at runtime). Source in § 4.3.E. Every future AI feature must call into this module before touching user content.

**Estimated cost**: ~2–3 hours including migration, RLS verification, settings page, server action, utility module, and smoke test.

**Trigger**: pre-AI-feature blocker. **Ship in the same PR window as the 🚨 CRITICAL: RTBF deletion handler entry above** — shared settings infrastructure, paired "prove we respect your data" framing, both close the two biggest pre-launch privacy gaps simultaneously.

**Open architectural decision pending strategy approval**: whether `ai_consent_audit` lives as its own table (proposed, matches `seat_sync_log` pattern) or extends `activity_events` (would require nullable `workspace_id` + new `payload jsonb` column). See § 4.3.D + § 4.4 for the analysis.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 4 (entire section)
- `supabase/migrations/20260624120000_ai_consent_infrastructure.sql`
- WISHLIST → "🚨 CRITICAL: RTBF deletion handler" (paired PR)
- WISHLIST → Slices 0.2 / 0.3 / 0.4 below (deferred)

---

### Slice 0.2 — Per-integration consent UI (DEFERRED until first integration ships)

**Surfaced**: 2026-06-06 as part of the 4-level consent framework locked in `docs/DATA-COLLECTION.md` § 4.

**Status**: deferred. Builds **Level 2** of the framework — when the first external integration ships (Google Docs, Slack, Instantly, etc.), Stages needs a UI for users to grant the AI agent permission to read/write to that integration on their behalf.

**Scope (placeholder until first integration is designed)**:
- Per-integration row in `/w/[slug]/settings/privacy` (slot reserved in Slice 0.1's "Connected Integrations" placeholder).
- Toggle per integration with scope description ("Stages AI can read your Google Docs" / "Stages AI can send messages in your Slack workspace").
- OAuth flow handoff to the integration's authorization server; encrypted token storage in a new `user_integrations` table (schema TBD with the first integration).
- Audit row in `ai_consent_audit` on grant + revoke.
- Revoke flow that invalidates the token at both ends (Stages-side delete + integration-side revoke call).
- New JSONB key on `workspaces.ai_consent` or new column entirely — TBD based on integration shape (per-user grants live on `profiles.ai_consent` JSONB; workspace-level scope limits live on `workspaces.ai_consent`).

**Estimated cost**: ~3–4 hours per integration (the framework itself is ~2 hours; each new integration adds ~1–2 hours for its specific OAuth scopes and audit rows). The first integration carries the framework cost; subsequent ones are cheaper.

**Trigger**: first integration is designed.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 4.2.B (Level 2), § 4.3.C (placeholder slot)
- `docs/DATA-COLLECTION.md` § 4.4 (forward-looking question on per-user vs workspace-level scope limits)

---

### Slice 0.3 — Per-action consent flow (DEFERRED until first AI agent action ships)

**Surfaced**: 2026-06-06 as part of the 4-level consent framework locked in `docs/DATA-COLLECTION.md` § 4.

**Status**: deferred. Builds **Level 3** of the framework — when the first AI agent action ships, Stages needs a per-action consent flow that classifies each action by risk and asks the user accordingly.

**Scope (placeholder until first AI action is designed)**:
- **Risk classification per action**:
  - **LOW-RISK** (read-only retrieval, draft generation that stays in-app, suggestion display): pre-authorized after Level 2 — no per-action prompt.
  - **HIGH-RISK** (sends external email, posts to Slack, writes to a connected doc, modifies workspace data irreversibly): confirmation modal before action executes — "Stages AI is about to send this email to alice@example.com. Approve?".
  - **HIGH-VALUE / IRREVERSIBLE** (moves money, signs documents, deletes connected-service data): explicit re-authentication required — password / biometric / OAuth re-confirm at the moment of action.
- Static classification config per integration. Reviewed and signed off by Jordan before each integration ships. Living source: a TypeScript config module `src/lib/ai-action-classification.ts`.
- Audit row in `ai_consent_audit` (or sibling table) for every AI action: invocation, classification, user response, outcome.
- Failure-mode UX: what happens when the user denies consent mid-action (graceful cancel + audit trail).

**Estimated cost**: ~4–6 hours for the framework (classification table + consent modal + re-auth flow + audit wiring + denial-path UX). Each new action then maps to its classification with negligible incremental cost.

**Trigger**: first AI action is being designed (would likely block on Slice 0.2 also being live).

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 4.2.B (Level 3), § 4.3.C (placeholder slot)
- `docs/DATA-COLLECTION.md` § 4.4 (forward-looking question on classification process)

---

### Slice 0.4 — AI audit log UI (DEFERRED until first AI agent action ships)

**Surfaced**: 2026-06-06 as part of the 4-level consent framework locked in `docs/DATA-COLLECTION.md` § 4.

**Status**: deferred. Builds the user-visible UI surface for the AI audit trail accumulated in `ai_consent_audit` (Slice 0.1) + Slice 0.3's per-action audit rows.

**Scope**:
- New tab in `/w/[slug]/settings/privacy` (Slice 0.1 reserves the "AI Action History" placeholder slot for it) showing the workspace's AI activity log.
- Filters: action type, integration, user (actor), date range.
- Two views:
  - **Consent changes**: who turned what on/off and when (Slice 0.1's `ai_consent_audit` rows).
  - **AI actions taken**: per-action audit (Slice 0.3's audit rows) — what was asked, classification, user response, outcome.
- Export to CSV for compliance review.
- New RLS SELECT policy on `ai_consent_audit` (added in this slice's migration, not Slice 0.1's): workspace owners can read `where scope_type = 'workspace' and scope_id = $workspace_id`, plus their own `where scope_type = 'user' and scope_id = auth.uid()`. Members read only own `scope_type = 'user'` rows.

**🚨 Pre-requisite from Slice S1 Phase 3 Fix 1 (2026-06-06, commit `2500e56`)**: `ai_consent_audit` had its `anon` + `authenticated` table-level GRANTs revoked as part of the brittle-architecture cleanup. **This slice's SELECT policy alone will NOT work — it must also re-GRANT `SELECT` at the column level to `authenticated`.** Pattern matches `20260624130000_profiles_update_grants.sql` (column-level grant allowlist excluding sensitive columns). Recommended column scope for the audit-UI: `id, scope_type, scope_id, actor_name, changed_field, old_value, new_value, changed_at` — exclude nothing today (no sensitive columns on this table), but the column-level form keeps the door open for future column additions to be off by default. Without the re-grant, the SELECT policy will 42501 the same way Slice 0.1's `profiles.ai_consent` toggle did before its grants migration.

**Estimated cost**: ~3–4 hours including the RLS policy migration, the column-level re-grant migration, two query patterns (consent vs actions), table rendering, filters, and CSV export.

**Trigger**: first AI action ships (no point shipping the audit UI before there are actions to audit). Also useful for compliance review and trust-building with customers.

**Cross-references**:
- `docs/DATA-COLLECTION.md` § 4.3.C (placeholder slot), § 4.3.D (audit-table design), § 4.4 (forward-looking question on member-visibility)
- `supabase/migrations/20260624140000_revoke_service_role_table_grants.sql` (Slice S1 Phase 3 Fix 1 — the REVOKE this slice must re-grant against)
- WISHLIST → Slice 0.3 (audit rows for AI actions originate there)

---

### Slice WT-7 follow-ups

Carryover items from the workspace-type sprint (WT-1 through WT-7). None blocking; all deferred until either a customer signal lands or a follow-up sprint clears the backlog.

- **Personal → Agency in-place conversion.** Currently blocked by the WT-6 type-immutability trigger (`workspaces_prevent_type_change`). The trigger fires for all writes including SECURITY DEFINER, so a future conversion RPC will need to `ALTER TABLE ... DISABLE TRIGGER` inside its transaction (and re-enable on exit, or rely on transaction-local scope). Design questions before building: (a) how does conversion interact with `workspace_billing` — fresh 14-day trial row from `init_workspace_billing` semantics, or immediate paid with seat-count reconciliation? (b) what's the UX entry point — a "Convert to Agency" affordance on the personal workspace's billing settings tab? (c) inverse direction Agency → Personal — almost certainly not allowed once a workspace has additional members or clients; if zero, allowed at the same entry point with a confirmation flow? Defer until there's demand signal — a personal-workspace user explicitly asking how to invite a teammate.

- **Workspace-type-aware UI badge on agency settings.** Minor polish: show a small badge on the workspace's settings surface (or wherever a general workspace-info card lands) indicating "Agency workspace" or "Personal workspace". Today there's no visual indicator outside the switcher's section grouping and the billing tab's Personal info card. Small cleanup, harmless if deferred indefinitely.

- **RLS test harness extension for workspace_type.** `scripts/test-rls-phase3.mjs` is gitignored (test credentials + inline JWTs). When that harness is refactored to use checked-in fixtures, add workspace_type test cases:
  - Agency workspace: direct PostgREST INSERT `workspace_invites` SUCCEEDS for owner/admin (regression).
  - Personal workspace: direct PostgREST INSERT `workspace_invites` FAILS with RLS denial.
  - Agency workspace: direct INSERT `client_invites` SUCCEEDS for owner/admin (regression).
  - Personal workspace: direct INSERT `client_invites` FAILS with RLS denial.
  - Personal workspace: `UPDATE workspaces SET type='agency'` FAILS with the trigger error 0A000.
  - SECURITY DEFINER regression — `create_workspace_with_owner`, `accept_workspace_invite`, `accept_client_invite` still work on agency workspaces and reject personal targets at the RPC layer.

  Until automation lands, the verification queries embedded in migration `20260627120000_workspace_type_rls.sql` cover the same surface manually via Supabase SQL Editor.

- **Legacy Phase 2 file deletion.** Carryforward from prior sprint. The Phase 2 prototype port (`src/components/App.tsx`, `src/hooks/useAppState.ts`, `src/components/auth/LoginScreen.tsx`, `src/components/home/*`, `src/components/board/*` legacy files, `src/components/portal/ClientPortal.tsx`) has been unreachable since the root-redirect fix in commit `3c9c980`. Verify nothing else imports from them (full-tree `grep`), then delete. One-pass cleanup — no behavioral change. Worth one focused commit so the next maintainer doesn't accidentally pattern-match off legacy state-management code.

---

### Pipeline-invite sprint follow-ups (PI-7 close-out)

Five deferred items surfaced during the PI-1 → PI-7 pipeline-invite sprint. None block launch; all are surface-area gaps worth tracking.

- **Admin role picker on Members sub-tab.** The schema + `add_pipeline_member` RPC already accept `role='admin'`, but the picker UI only lets the founder add `'member'`. Promotion to admin is SQL-only today. Wire a small role selector inline with the Add button when there's demand signal (e.g., an agency wants per-pipeline admin delegation without granting workspace-level admin).

- **"Change role" — re-invite-as-different-role.** Currently blocked by the `(pipeline_id, user_id)` PK on `pipeline_memberships`: you can't insert a second row with a different role, so changing someone from member → admin (or vice versa) requires remove-then-add. Future: a single Change Role UI affordance + an `update_pipeline_member_role` RPC that flips the column in place, preserving channel memberships, history, and avoiding the seed-channels trigger re-fire that an add-after-remove cycle would cause.

- **`pipeline_memberships` SELECT recursion in Supabase SQL Editor.** Jordan observed `42P17 infinite recursion detected in policy for relation 'pipeline_memberships'` when running a plain `SELECT * FROM pipeline_memberships` from the Supabase SQL Editor authenticated as a real user. App-facing SELECTs work because they go through PostgREST endpoints that hit different planner paths (or join through pipelines / workspaces first), but direct SELECT-as-authenticated trips it. Suspect: the `pipeline_memberships_select` policy calls `is_pipeline_agency_member`, which queries `pipeline_memberships` — even though the helper is SECURITY DEFINER, certain planner shapes still flag the cycle. Doesn't affect prod app traffic but blocks ad-hoc admin SQL. Investigate whether replacing the helper call in the policy with an inlined join (or splitting agency vs. self into two separate permissive policies) makes the recursion go away without losing correctness.

- **Workspace switcher labeling for pipeline-only members.** A user who is a member of pipelines in workspace W (via `pipeline_memberships`) but NOT a workspace seat (no `workspace_memberships` row) sees workspace W in their `HeaderWorkspaceSwitcher` under MY AGENCY with no indication they're pipeline-scoped, not a full seat. Mirrors the existing "Client of: {workspace}" portal-mode pill — add a similar pipeline-scoped label/badge so the user knows their access is narrow. Low-priority cosmetic; surfaces only when a workspace has both seat-based and pipeline-only members.

- **`/w/[slug]/settings/*` sub-page audit for pipeline-only `workspaceRole` sentinel.** PI-5a widened the `/w/[slug]` and `/w/[slug]/p/[…]` route gates to admit pipeline-only members (workspace_memberships row absent, `workspaceRole` sentinel = `""`). Downstream settings sub-pages — Team, Billing, Privacy, Profile — may not all handle the empty-sentinel case correctly. Either they should hide themselves on the empty sentinel (matching the PI-5a narrowing intent — pipeline-only members shouldn't see Team / Billing), or they should explicitly admit the access with the right read-only treatment. Audit each `/w/[slug]/settings/*` route, decide per-page, and add a self-suppress gate where appropriate.

---

### NF-2.4 follow-ups

Two cleanup items unlocked by the channel-membership symmetry fix.

- **Simplify the NF-2.3 picker UI union after NF-2.4 verifies in prod.** `ChatBody.tsx`'s `mentionablePeopleForActiveChannel` currently branches on `channel.is_client` and UNIONs `channel_memberships` with every agency-role pipeline member for client channels. That branch was a UI band-aid for the seed-trigger asymmetry. Once NF-2.4 lands and the backfill is verified (every agency pipeline_memberships user now has a `channel_memberships` row for every channel on the pipeline), the union is redundant — `channel_memberships` alone is canonical for both channel types. Collapse the branch back to the pre-NF-2.3 shape: `members.filter(m => allowedSet.has(m.user.id))`. Low-risk simplification, one block of code, ~15 lines removed.

- **Parallel gap: no AFTER INSERT trigger on `public.channels`.** Today every channel is created inside `create_pipeline_with_channels`, which manually inserts `channel_memberships` for the pipeline creator only — and now (post-NF-2.4) the seed-on-pipeline-membership-INSERT trigger covers everyone else for THAT moment. But there's no equivalent for the inverse direction: if/when an "add channel later" UI/RPC ships (a per-pipeline "+ New channel" affordance), existing pipeline members would miss `channel_memberships` rows for the new channel and silently lose access to it. Fix at that time: either bake the seed-everyone INSERT into the new "add channel" RPC, or add an `AFTER INSERT ON public.channels` trigger that mirrors `seed_channel_memberships_on_pipeline_join` from the channel's side. Pure forward gap — no broken behavior today.

---

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
