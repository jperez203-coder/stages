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
