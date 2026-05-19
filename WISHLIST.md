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
