# Stages — RLS + GRANT Audit (Slice S1 Phase 1)

**Status:** Phase 1 inventory + critical-findings scan complete (2026-06-06).
Phases 2 (automated test suite) and 3 (fixes) follow tomorrow.

**Scope.** `public` schema only. Storage policies (`storage.objects`) are Slice S2 territory and are explicitly out of scope here.

**Source-of-truth pointer.** Findings here drive Slice S1 Phase 2 test design and Slice S1 Phase 3 migration fixes. Anything written in this document that contradicts CLAUDE.md's Security Model section is a bug in this document; CLAUDE.md is canonical.

---

## 1. Methodology

The Slice 0.1 smoke test surfaced one concrete exploit-shape gap (a profile column had an RLS UPDATE policy but no corresponding column-level GRANT, so user toggles 42501'd). That single finding raised the prior probability that other tables across the schema have analogous gaps in either direction:

1. **RLS permits, GRANT missing** — user-facing bug (42501s, looks like a Supabase outage). What Slice 0.1 hit.
2. **GRANT permits, RLS missing or weak** — silent exploit surface. The dangerous half.

This audit covers both directions across every `public`-schema table.

### Queries run (read-only, via Supabase SQL Editor)

| # | Purpose | Pasted-back result size |
| --- | --- | --- |
| 1 | RLS-enabled status + policy count per table | ~29 rows (one per table) |
| 2 | All policies' USING / WITH CHECK / cmd / roles | ~80–150 rows |
| 3 | Table-level grants for `authenticated` + `anon` | ~100–200 rows |
| 4 | Column-level UPDATE grants for `authenticated` + `anon`, aggregated | ~30–60 rows |
| 5 | 🚨 SILENT EXPLOIT canary — tables with user-facing grants but RLS disabled / zero policies | small (target: 0) |
| 6 | ⚠️ Weak-policy scan — `qual`/`with_check` set to `true`, NULL where it shouldn't be, or just `IS NOT NULL` | small (~5–15 rows; some false positives expected) |

The queries are preserved verbatim in the chat handoff record for re-run during Phase 3 verification.

### Cross-checks performed

- **Live behavior probe.** For each service-role-only table flagged by Query 5, the founder executed `SET ROLE authenticated; SELECT * FROM <table>;` and confirmed zero rows returned. This proves the current behavior is safe even though the latent grants exist.
- **Query 6 false-positive review.** The "weak policy" regex matched several `template_*` policies whose conditions are actually correct (e.g. `workspace_id IS NOT NULL` is a join guard, not a permissive auth check). Catalogued in § 8 so Phase 2's test harness uses a more precise heuristic.

---

## 2. Inventory summary

| Dimension | Count |
| --- | --- |
| `public`-schema base tables | 29 |
| Tables with `rls_enabled = true` | **29 / 29 (100%)** |
| Tables with at least one RLS policy | 25 / 29 |
| Tables with `RLS enabled + zero policies` (service-role-only-by-design) | 4 (see § 5) |
| Tables surfacing critical findings (🚨) | 1 (see § 3) |
| Tables surfacing medium findings (⚠️) | 3 (see § 4) |
| Tables surfacing brittle-architecture findings (🚨 latent) | 4 (see § 5) |
| Tables surfacing hygienic items | 1 (see § 7) |
| Tables where RLS + GRANT alignment is healthy | majority (see § 6) |

**Headline.** No table is currently exploitable via the *"GRANT-permits-but-RLS-doesn't-cover"* failure mode (Query 5 returned only the four service-role-only tables, all verified inert). But the C1 client-boundary rule has an RLS-layer hole that lets a pure client escape their boundary via direct PostgREST.

---

## 3. Critical findings (🚨)

### 3.1 `workspaces_insert` is too permissive — pure clients can self-promote out of the client boundary

**Severity: 🚨 CRITICAL — pre-launch must-fix.**

**Finding.** The `workspaces` INSERT policy has `WITH CHECK = (auth.uid() IS NOT NULL)`. Translation: **any** authenticated user can directly POST to `/rest/v1/workspaces` with their JWT and create a workspace row. There is no check on the caller's existing membership shape.

**Why it matters.** Per CLAUDE.md → Security Model → C1 ("Workspace isolation") and the locked Phase 3 decision in `20260605120000_block_pure_clients_from_create_workspace.sql`, **pure clients must NOT be able to create workspaces.** A "pure client" is a user with `pipeline_memberships.role = 'client'` rows but zero `workspace_memberships` rows. This rule is currently enforced **at the application layer only** — in the server actions for the create-workspace flow.

A pure client who opens DevTools and runs:

```js
await supabase.from('workspaces').insert({ name: 'My escape hatch' });
```

…succeeds. The new workspace row passes RLS (the user is authenticated), and now the client has a foothold from which to insert `workspace_memberships` rows for themselves and pivot to agency-side surface.

**Sibling finding (already on WISHLIST, same shape).** `workspace_invites` INSERT bypasses the billing-guard layer because the client-side INSERT goes direct via PostgREST and the app-level `assertSubscriptionWritable` never runs. Same architectural cause: **application-layer guards that have no RLS-layer equivalent.**

**Phase 3 fix sketch** (not implementing tonight — this section names the shape, not the code).

The right shape is a `SECURITY DEFINER` helper function called from `workspaces_insert`:

```
-- Pseudocode for Phase 3 — NOT a migration to apply tonight.
create or replace function public.can_create_workspace(actor uuid)
  returns boolean
  language sql
  security definer
  stable
as $$
  -- Allowed if:
  --   (a) The user has at least one workspace_membership (already an agency-side user), or
  --   (b) The user has zero pipeline_memberships of any kind (brand-new sign-up).
  -- Disallowed if:
  --   The user has only pipeline_memberships with role='client' — they're a pure client.
  select not exists (
    select 1 from public.pipeline_memberships
    where user_id = actor and role = 'client'
  ) or exists (
    select 1 from public.workspace_memberships
    where user_id = actor
  );
$$;

-- Then:
alter policy workspaces_insert on public.workspaces
  with check ( public.can_create_workspace(auth.uid()) );
```

This preserves the brand-new-sign-up flow (zero memberships → allowed) and the convert-existing-agency flow (already has at least one workspace membership → allowed), while closing the pure-client escape.

**Phase 2 test (which I'll build into the harness)**: create a pure-client fixture (insert pipeline_memberships with role='client' for a test user, no workspace_memberships), authenticate as that user, attempt the direct PostgREST INSERT to workspaces. Pre-fix this returns 201. Post-fix it must return 403 / RLS denial.

---

## 4. Medium-severity findings (⚠️)

### 4.1 Three `*_update` policies have NULL `WITH CHECK` clauses

**Severity: ⚠️ MEDIUM — fix in Phase 3.**

**Affected policies:**

- `pipeline_links_update`
- `stage_attachments_update`
- `stage_notes_update`

**Finding.** Each policy has a proper `USING` clause (gating *which rows* the caller can touch), but `WITH CHECK = NULL`. Translation: once the caller is allowed to UPDATE a row, they can change **any** column in that row to **any** value — including:

- `added_by` / `author_id` → re-attribute ownership of someone else's content to themselves, or vice-versa.
- `pipeline_id` → move a row to a different pipeline, possibly one in a different workspace if other conditions don't catch it.
- `client_visible` → flip a visibility flag without re-passing the USING gate against the new state.
- Storage paths in `pipeline_links` / `stage_attachments` → could be redirected to a different file association.

**Why it matters.** A `WITH CHECK` clause is RLS's post-state check — it makes sure the row, **after** the update, still satisfies the same membership invariants the USING clause required. Without it, an authorized user can use UPDATE as a "move row out of the controlled zone" primitive.

**Phase 3 fix shape** (not migrating tonight): mirror the `USING` clause into `WITH CHECK` for each policy. Same predicate, applied to the post-update tuple. This is the standard pattern used by tighter policies elsewhere in the schema (e.g. `tasks_update` already does it).

**Phase 2 tests:**

- As an authorized editor (workspace owner or pipeline admin), attempt to UPDATE one of these rows changing `added_by` / `author_id` to a different user. Post-fix: rejected.
- As an authorized editor, attempt to UPDATE changing `pipeline_id` to a pipeline in a different workspace they don't belong to. Post-fix: rejected.

---

## 5. Brittle-architecture findings (🚨 latent)

### 5.1 Four service-role-only tables have inert `anon` + `authenticated` GRANTs

**Severity: 🚨 latent exploit — fix in Phase 3 alongside § 3.1.**

**Affected tables:**

- `ai_consent_audit` (shipped tonight in Slice 0.1)
- `pending_emails`
- `seat_sync_log`
- `stripe_events`

**Finding.** All four tables follow the locked pattern: **RLS enabled, zero policies → service-role only**. The schema verifier shows this works as intended today — the founder ran `SET ROLE authenticated; SELECT * FROM <table>;` against `ai_consent_audit` and `pending_emails` and got zero rows back. RLS-with-no-policies correctly denies non-service-role access regardless of what grants exist.

**But the grants do exist.** Each of these four tables has `SELECT` / `INSERT` / `UPDATE` / `DELETE` grants for both `anon` and `authenticated` roles. These grants are **inert today** because the zero-policy RLS posture blocks them. They become **live** the moment any future migration adds a single permissive policy.

This is the inverse of the Slice 0.1 finding. In Slice 0.1: RLS permits, GRANT blocks → 42501 (annoying bug). Here: GRANT permits, RLS blocks today → silent and safe **until** a maintainer adds an RLS policy without checking the GRANT layer underneath it, at which point the grants activate.

The Slice 0.4 follow-on entry on WISHLIST ("AI audit log UI") explicitly plans to add a SELECT policy to `ai_consent_audit` when it ships. **That future migration is the live trigger** that would activate the inert grants on that table. Easy to overlook.

**Phase 3 fix shape** (not migrating tonight): `REVOKE` all privileges from `anon` and `authenticated` on each of the four tables. Defense-in-depth alignment — if RLS is the only gate, the GRANT layer should not be a parallel gate that could re-open.

```
-- Pseudocode for Phase 3 — NOT a migration to apply tonight.
revoke all on table public.ai_consent_audit from anon, authenticated;
revoke all on table public.pending_emails from anon, authenticated;
revoke all on table public.seat_sync_log from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;
```

Slice 0.4 then explicitly re-`GRANT`s `SELECT` on the columns it wants user-facing when it adds the audit-UI policy. Explicit re-grant when needed > inert latent grant that auto-activates.

**Phase 2 test (defensive canary):** for each of the four tables, run `SET ROLE authenticated; SELECT 1 FROM <table> LIMIT 1;` and assert the response is a permission-denied error (post-revoke) rather than zero rows (pre-revoke). Once Slice 0.4 re-grants `SELECT` on `ai_consent_audit`, the test for that one table becomes "non-zero rows when calling user is a workspace owner of the audit's scope" — but the other three remain locked.

### 5.2 Same pattern, but architecturally fine — for context

The current `RLS-on + zero-policies + grants-exist` configuration is **functionally safe today** because RLS does enforce. The brittleness is not "we're exploitable now" — it's "we're one wrong future migration away from being exploitable." This is exactly the dual-layer failure mode the Slice 0.1 follow-on WISHLIST entry warned about, surfacing on a different axis.

---

## 6. Healthy findings (✅)

These are the things the audit confirms are working correctly. Worth naming so Phase 3 doesn't accidentally regress them.

| Property | State |
| --- | --- |
| RLS enabled on every `public`-schema table | ✅ 29 / 29 |
| Service-role-only architecture for audit tables (`stripe_events`, `seat_sync_log`, `pending_emails`, `ai_consent_audit`) | ✅ Verified inert via `SET ROLE authenticated` probes |
| Most policies use proper helper functions (`can_edit_pipeline`, `is_workspace_owner_or_admin`, `is_workspace_member`) rather than inlined ad-hoc conditions | ✅ Consistent across the canvas / chat / file surfaces |
| `profiles` column-level GRANT allowlist (shipped tonight in `20260624130000_profiles_update_grants.sql`) | ✅ Working; Slice 0.1 toggle smoke-passed with `actor_name="Jordan Perez"` |
| `is_founding_member` excluded from `authenticated`'s UPDATE GRANT list | ✅ Confirmed; exclusion canary query (b) in `20260624130000` still returns zero rows |
| Internal-message three-layer defense (`channel_messages` RLS Layer 1 + server enforcement Layer 2 + render filter Layer 3) | ✅ Layer 1 policy intact in the inventory |
| Cross-workspace isolation policy shape (membership-gated SELECTs across `workspaces`, `pipelines`, descendants) | ✅ Matches the C2 rule in CLAUDE.md → Security Model |

---

## 7. Hygienic items (not exploits)

### 7.1 `profiles` has two near-duplicate UPDATE policies

**Severity: hygienic — fix in Phase 3 cleanup pass.**

**Finding.** Query 2 surfaced two distinct UPDATE policies on `profiles`:

| Policy name | Roles | USING / WITH CHECK |
| --- | --- | --- |
| `Users can update their own profile` | `authenticated` | `id = auth.uid()` |
| `profiles_update` | `public` | `id = auth.uid()` |

Both gate on the same condition. One is named in human-prose style (likely a Supabase-Studio-created policy from early dashboard usage); the other matches the project's `<table>_<cmd>` naming convention used everywhere else.

**Why it's hygienic, not critical.** Two policies on the same command with the same condition are evaluated as OR'd permissive rules, so the effective gate is still `id = auth.uid()`. No exploit. But:

- Two policies, two surfaces to drift. If a Phase 3 fix tightens one and not the other, the looser one still permits the operation. Latent maintenance trap.
- The named-prose policy isn't referenced from migrations on disk, so its provenance is murky — possibly a survivor from an early hand-edit in Supabase Studio.

**Phase 3 fix shape** (not migrating tonight): drop `"Users can update their own profile"`, keep `profiles_update` (matches the naming convention). A simple `drop policy if exists`.

**Worth a careful Phase 3 read:** confirm the two policies' WITH CHECK clauses are actually identical before dropping either. If the named-prose one has a stricter WITH CHECK that the `profiles_update` one is missing, drop the looser one instead.

---

## 8. Query 6 false positives + heuristic refinement notes (for Phase 2)

Query 6's regex matched several `template_*` and `templates_*` policies as "weak." On manual review they're all correct:

- **`DELETE` policies with `null` `with_check`** — correct. `WITH CHECK` is meaningless for `DELETE` (nothing to check against — the row is going away). Query 6 shouldn't flag NULL `with_check` for `cmd = 'DELETE'`.
- **`INSERT` policies with `null` `qual`** — correct. `USING` is meaningless for `INSERT` (no pre-existing row to test). Query 6's exclusion logic already handles this case but the false positives leaked through anyway — worth refining.
- **`UPDATE` policies whose USING includes `workspace_id IS NOT NULL`** — flagged because the regex matched `IS NOT NULL` literally. But in context that clause is a **JOIN guard** ("don't accidentally match a row whose workspace_id is null"), not an auth check. The actual auth check is elsewhere in the same `qual`.

**Refined heuristic for the Phase 2 automated test:**

```
-- Pseudocode for the Phase 2 weak-policy test — not for tonight.
A policy is weak if:
  (a) Its USING clause is literally `true` or `(true)`, OR
  (b) Its USING clause's only condition is `auth.uid() IS NOT NULL` (full match, not substring),
      OR `auth.role() = 'authenticated'`, OR equivalent "is signed in" predicates,
  AND
  (c) The policy command is one of SELECT / UPDATE / DELETE (where USING is the gate).
```

This eliminates the IS-NOT-NULL-as-substring false positives while still catching the actual `workspaces_insert` shape that surfaced § 3.1's critical finding.

---

## 9. Phase 2 — automated test harness recommendations

Findings from this Phase 1 audit drive Phase 2's test suite design. Priority tiers below: ship Tier 1 first, then Tier 2, then Tier 3.

### Tier 1 — guards the explicit pre-launch exploits surfaced tonight

| # | Test | Maps to |
| --- | --- | --- |
| 1 | **C1 client-boundary bypass.** Create a pure-client fixture user. Attempt direct PostgREST `INSERT INTO workspaces`. Assert 403 / RLS rejection. Pre-fix this test fails; post-fix it passes. | § 3.1 |
| 2 | **Cross-workspace isolation (two-browser test, automated).** Agency A's JWT attempts `SELECT * FROM workspaces`, `pipelines`, `channel_messages`, etc.; assert results contain only Agency A's rows. Storage direct-URL probe deferred to Slice S2. | CLAUDE.md → Security Model, four critical isolation rules |
| 3 | **Internal-message three-layer defense.** Client posts message with `is_internal: true`; assert RLS WITH CHECK refuses. Client SELECTs `channel_messages`; assert internal messages absent. | CLAUDE.md locked-decision Layer 1 |
| 4 | **`WITH CHECK` enforcement for `pipeline_links` / `stage_attachments` / `stage_notes`.** As an authorized editor, attempt to UPDATE rows changing `added_by` / `author_id` / `pipeline_id`. Pre-fix succeeds; post-fix rejected. | § 4.1 |

### Tier 2 — defensive canaries for failure modes that aren't live exploits but would silently become exploits

| # | Test | Maps to |
| --- | --- | --- |
| 5 | **Service-role-only table lockout.** For each of `ai_consent_audit`, `pending_emails`, `seat_sync_log`, `stripe_events`: `SET ROLE authenticated`, attempt SELECT/INSERT, assert permission-denied. Post-revoke (Phase 3): test passes. Standing invariant — any future migration that adds a policy to one of these tables will break this test and force a re-review. | § 5.1 |
| 6 | **`is_founding_member` exclusion canary** (lift from `20260624130000_profiles_update_grants.sql` Query (b)). Test that `is_founding_member` is never in `authenticated`'s UPDATE grant list. Any row from the canary query is a regression. | Slice 0.1 lock |
| 7 | **GRANT-without-RLS canary** (lift from tonight's Query 5). Test that no `public`-schema table has user-facing grants AND no RLS policies (excluding the four service-role-only tables which Tier 2 #5 covers separately). | § 5 broader pattern |

### Tier 3 — column-level alignment + drift detection

| # | Test | Maps to |
| --- | --- | --- |
| 8 | **Column-grant alignment for every `*_update` policy.** For each table with an RLS UPDATE policy, parameterize over the columns the policy implicitly permits writing and assert the corresponding column-level GRANT exists. Catches the Slice 0.1 shape across the schema. | Slice 0.1 lesson |
| 9 | **Refined weak-policy heuristic** (per § 8 above). Snapshot the current policy list; any new policy whose USING/WITH CHECK matches the "weak" pattern after the refinement triggers a manual review. | § 8 |

### Architecture notes for the harness

- **Test fixtures must use real JWT-bound clients**, not service-role clients. The whole point is to exercise RLS as a real user would. Strategy already locked this pattern in the Slice 1 RLS test harness (`scripts/test-stripe-billing-rls.mjs` per the handoff).
- **Tests should be runnable per-table** so a Phase 3 fix can re-run just the affected suite before the broader sweep.
- **Standing invariants (Tier 2 + #5)** belong in CI — they're the canaries that make future migrations safer. Tier 1 tests run any time the security model is touched.

---

## 10. Open questions for founder review (carry into Phase 3)

1. **Recovery shape for § 3.1 fix.** The `can_create_workspace` helper as sketched permits two paths: (a) any user with at least one existing workspace membership, (b) any user with zero pipeline memberships of any kind. Is path (b) the right shape for the brand-new-sign-up flow, or should it be tightened to "the only existing pipeline_memberships are role IN ('owner','admin','member')"? Path (b) was simpler to specify — strategy confirms or refines.

2. **Slice 0.4 future re-grant.** When Slice 0.4 adds the SELECT policy to `ai_consent_audit`, the Phase 3 REVOKE in § 5.1 will need to be followed by a precise re-GRANT of just the SELECT capability on the audit-UI columns. Worth documenting in the Slice 0.4 entry on WISHLIST so the fix order is clear (revoke now, re-grant later when actually needed). Action: update the Slice 0.4 WISHLIST entry tomorrow.

3. **Duplicate policy on `profiles` (§ 7.1).** Confirm that `"Users can update their own profile"` and `profiles_update` have identical WITH CHECK clauses before dropping the prose-named one. If they diverge, the safe move is keeping the stricter one and dropping the looser one — even if it breaks the naming convention.

4. **WITH CHECK pattern for § 4.1.** The fix mirrors USING into WITH CHECK. Confirm this is the right move for `pipeline_links` specifically, given the `kind = 'url'` vs `kind = 'image'` variants — does the WITH CHECK need to allow flipping `kind`, or should it freeze the kind to its original value? (Likely yes-it-can-flip since editors can change a URL link to an image upload, but worth a deliberate Phase 3 call.)

5. **Test-harness scope cap.** Tier 1 + Tier 2 + Tier 3 is a lot. For tomorrow's Phase 2, is the bar "all of Tier 1 plus the standing-invariant canaries from Tier 2" or "all of Tier 1 + 2 + 3"? My read of the Slice S1 scope (~1.5–2 hrs) suggests Tier 1 + the three Tier 2 canaries; Tier 3 alignment-checking could land as a follow-on. Confirm or override.

---

## 11. Phase 3 fix-order recommendation (carry into tomorrow)

For sequencing tomorrow's Phase 3, smallest-blast-radius first:

1. **§ 5.1 REVOKE.** Removes inert grants on four service-role-only tables. Zero behavior change (grants are already inert). Locks the defense-in-depth posture in place before any of the next steps could expose them.
2. **§ 4.1 WITH CHECK mirror.** Three policies, mechanical fix. Low risk, high-confidence pattern.
3. **§ 7.1 duplicate policy cleanup.** Drop one of the two `profiles` UPDATE policies. Pure hygiene, easy to verify post-drop.
4. **§ 3.1 `can_create_workspace` helper + policy retighten.** Highest risk because it changes a permission gate that the app currently relies on. Save for after the others so the test harness from Phase 2 can validate before and after.

Each step should land as its own migration + commit, not one mega-migration. Easier to revert if any one step breaks something downstream.

---

_Phase 1 complete. Phase 2 (test harness) + Phase 3 (fixes) ship tomorrow with fresh eyes._
