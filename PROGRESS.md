# Stages — migration progress log

A running log of what shipped in each session. Newest first.

---

## Phase 4a — step 5a: pipeline canvas core (pan/zoom shell) (2026-05-21)

**Goal:** replace the 404 stub at `/w/[slug]/p/[pipeline-id]` with a real route that renders a pan/zoom canvas shell — the gesture surface that 5b's stage boxes, 5c's tasks, 5d's left rail + header, and 5e's edit mode will all sit on top of. The point of isolating 5a from the rest of step 5 was to nail the gesture feel before adding visual complexity that would make it harder to A/B the interaction layer.

**Scope intentionally narrow:** empty pan/zoom shell only. NO real stages, NO tasks, NO left rail, NO edit mode, NO task detail panel. 5a renders 3-4 throwaway blue-dashed placeholder boxes that get deleted in 5b when real stage rendering arrives.

### Migration (applied manually, no file in repo)

```sql
alter table public.profiles
  add column if not exists canvas_hint_dismissed boolean not null default false;
```

Per-user (not per-pipeline, not per-workspace) flag tracking whether the user has dismissed the canvas coachmark. Defaults `false` so brand-new + existing users both see the hint on their next canvas visit. Applied by hand in the Supabase SQL editor; no migration file checked in (matches the pattern from the dismissed_at rollback — manual app-once SQL when there's no CLI workflow). PROGRESS.md is the only audit trail for this.

### Library — react-zoom-pan-pinch v4.0.3

Chosen for the spec's locked recommendation. Figma-parity gestures are non-trivial to get right (delta normalization, trackpad vs mouse disambiguation, pinch detection, velocity inertia) — rolling our own would have eaten a week. The lib delivers all of that out of the box with the right config knobs.

**Configured for figma-parity:**

| Prop | Value | Rationale |
| --- | --- | --- |
| `wheel.activationKeys` | `(keys) => keys.includes("Meta") \|\| keys.includes("Control")` | **Critical bug caught:** array form `["Meta","Control"]` is interpreted by the lib as `keys.every(k => pressedKeys[k])` — i.e., requires BOTH simultaneously. Cmd+wheel alone never satisfied this, so the lib never activated zoom and the browser took over with native page zoom (the "leads me to another place" symptom in verification). Function form lets us return true for EITHER. |
| `wheel.step` | `0.03` | Lib default is `0.015`. Initial config was `0.15` = 10× default — single trackpad swipe slammed scale from min to max. `0.03` = 2× default, gradual + controllable, lands cleanly on intermediate scales. |
| `minScale / maxScale` | `0.25 / 2` | Clamps zoom to a usable range. 2x is plenty for stage/task work; lib default 8x is unusable. |
| `limitToBounds` | `false` | Free pan beyond content — required for the user to pan placeholders off-screen and exercise edge fades. |
| `centerOnInit` | `false` | We manually `zoomToElement("placeholder-1")` in `onInit` to target a specific element instead of the geometric center. In 5b this targets the current in-progress stage. |
| `trackPadPanning.disabled` | `true` | Our custom wheel handler covers trackpad two-finger pan. Letting the lib's trackpad handler also run would double-apply the pan delta. |
| `panning.allowLeftClickPan` | `true` | Click+drag pan, with velocity inertia (`velocityDisabled: false`). |
| `doubleClick.disabled` | `true` | No double-click zoom — would conflict with future task-row double-click semantics in step 6. |
| `pinch.step: 5` | default | Trackpad pinch zoom (browser fires synthetic ctrlKey, caught by activationKeys). |
| `smooth: true` | — | Smooth interpolation on all transforms. |

### Wheel handling (custom + lib, split deterministically)

react-zoom-pan-pinch handles all pan/zoom natively EXCEPT for the spec's "plain mouse wheel pans vertically, shift+wheel pans horizontally" requirement. We add a custom native wheel listener on the canvas wrapper:

```ts
const onWheel = (e: WheelEvent) => {
  e.preventDefault(); // unconditional — see below

  if (e.ctrlKey || e.metaKey) return; // lib handles zoom
  if (!transformRef.current) return;

  let dx = e.deltaX, dy = e.deltaY;
  if (e.shiftKey && Math.abs(dx) < 0.01) { dx = dy; dy = 0; }

  const { positionX, positionY, scale } = transformRef.current.state;
  transformRef.current.setTransform(positionX - dx, positionY - dy, scale, 0);
};
wrapper.addEventListener("wheel", onWheel, { passive: false });
```

**Two non-obvious points:**

1. **`preventDefault` is unconditional**, before the modifier-key branch. Without this, Cmd+wheel cascades to the browser's native page-zoom shortcut (the "navigated to another place" symptom — the entire app chrome scales up/down). The lib's own zoom path also calls preventDefault, but unconditional preventDefault in our handler guarantees we never lose a race against the browser default.
2. **`{ passive: false }` registration** — React 19's synthetic wheel events default to passive, which blocks preventDefault. Native registration with `passive: false` is required.

### Edge fade math (content-aware, all 4 sides)

```ts
const planeLeft   = -positionX / scale;
const planeRight  = (W - positionX) / scale;
const planeTop    = -positionY / scale;
const planeBottom = (H - positionY) / scale;

setEdges({
  left:   bbox.left   + EPS < planeLeft,
  right:  bbox.right  - EPS > planeRight,
  top:    bbox.top    + EPS < planeTop,
  bottom: bbox.bottom - EPS > planeBottom,
});
```

Recompute fires on every transform tick via `onTransform` callback. State is lifted to PipelineCanvas (rather than EdgeFades using `useTransformEffect` directly) so the fade component can live as a sibling of TransformWrapper without needing access to the lib's React context. Initial state computed via post-`onInit` `requestAnimationFrame` so the first paint has correct fades.

**Tokens locked:** 60px gradient strip per edge, `linear-gradient(direction, rgba(0,0,0,0.55), rgba(0,0,0,0))`, 180ms ease-out opacity transition. The 0.55 alpha was bumped from an initial 0.35 during verification — 0.35 read as a faint hint users could miss; 0.55 is the sweet spot where the fade clearly signals "more content over there" without obscuring nearby content. `pointer-events: none` so they never intercept pan drags. zIndex 10 (above content, below pill / coachmark / zoom controls at 20+).

### Other locked details

- **Dotted grid** lives inside the TransformComponent content plane so it pans + zooms with the canvas. Dot color `#4A4A4A` (one step brighter than the dashboard's `#424242` token) — the dots live inside a translate3d+scale parent, and the browser's transform render pipeline antialiases them slightly more than the dashboard's static grid; the brighter token brings perceived visibility back to dashboard-parity without making them "in your face."
- **Stage-indicator pill** top-center, persistent, "showing stage X of Y" — 5a shows "stage 1 of 4" against the placeholders. Click recenters via `zoomToElement("placeholder-1")`. 5b wires this to the real current-stage derivation.
- **Zoom controls** bottom-right, three buttons (+/−/fit) stacked vertically with 8px gap. 38px square buttons with backdrop-blur.
- **Coachmark** "drag to pan · scroll to zoom" bottom-center pill, renders once per user. Reads `canvas_hint_dismissed` SSR-side (so already-dismissed users don't see a flash). Dismisses on X click OR any pointerdown/wheel anywhere on the window. UPDATE persists the flag.

### Files added (this commit)

```
new file: src/app/w/[slug]/p/[pipeline-id]/page.tsx       (server, auth gate, 110 lines)
new file: src/components/canvas/PipelineCanvas.tsx        (client orchestrator, ~395 lines)
new file: src/components/canvas/EdgeFades.tsx             (4-edge fade overlay, ~105 lines)
new file: src/components/canvas/CanvasCoachmark.tsx       (first-time hint, ~120 lines)
new file: src/components/canvas/StageIndicatorPill.tsx    (top-center recenter pill, 61 lines)
new file: src/components/canvas/ZoomControls.tsx          (+/−/fit buttons, 92 lines)
modified: package.json + package-lock.json                (+ react-zoom-pan-pinch@4.0.3)
```

### Bugs caught + fixed during verification (in order)

1. **Corrupted `.next` cache (self-inflicted).** I ran `rm -rf .next` while Jordan's dev server was still running — wiped cache files his Turbopack workers had open handles into, surfaced as a 500 with ENOENT on `.next/dev/cache/turbopack`. Clean rebuild fixed it. **Lesson:** don't wipe `.next` while another dev server is alive; coordinate first.
2. **TransformWrapper / TransformComponent sizing collapse.** `TransformWrapper` renders NO DOM (just a Context.Provider); the only div is TransformComponent's outer wrapper. My initial `wrapperStyle={{ width: "100%", height: "100%" }}` competed with the lib's default class CSS (`width: fit-content; height: fit-content`) in a way that didn't fully resolve — visible as a partial-coverage grid with a dark band at the top. **Fix:** added `position: absolute; inset: 0;` to wrapperStyle alongside the width/height. Position absolute + inset 0 is the bulletproof CSS way to fill a `position: relative` parent.
3. **`setTimeout(0)` auto-center race.** Initial impl called `zoomToElement("placeholder-1")` from a `setTimeout` inside `useEffect`. The lib's internal init runs in ITS own useEffect on mount — `setTimeout(0)` raced that init and `zoomToElement` no-op'd when the lib's internal state wasn't ready. Placeholders sat at plane (1700, 1700) far off-screen. **Fix:** switched to the lib's `onInit` callback, which fires AFTER internal state + DOM refs are ready. Wrapped in `requestAnimationFrame` for one extra safety frame.
4. **Placeholders too subtle.** Initial `#2C2C2F` bg + `1px dashed #4A4A50` border = nearly invisible against the dotted grid. **Fix:** `rgba(16,140,233,0.12)` bg + `2px dashed #108CE9` border (Stages primary blue) + `#7FA7D9` text. Blue chosen because green is reserved for the Done badge semantic.
5. **`wheel.step` 10× too high.** Original `step: 0.15` vs lib default `0.015` made single trackpad swipes slam from min to max. **Fix:** `0.03` (2× default).
6. **`activationKeys` array form required BOTH keys simultaneously.** Lib uses `keys.every(...)` internally. With `["Meta", "Control"]` the user had to hold Cmd AND Ctrl together to activate zoom — they never did, so lib zoom never fired and the browser's native page-zoom kicked in. **Fix:** function form `(keys) => keys.includes("Meta") || keys.includes("Control")`.
7. **`preventDefault` conditional in custom wheel handler.** Initial impl only called preventDefault on the pan path (no modifier); the zoom-path branch returned early without preventing. When the lib's zoom path was slow to activate, browser default ran first and zoomed the page. **Fix:** unconditional preventDefault at the top of the wheel handler.
8. **Edge fade too subtle.** Initial `rgba(0,0,0,0.35)` read as a faint hint users could miss. **Fix:** `rgba(0,0,0,0.55)`.
9. **Canvas dots dimmer than dashboard dots despite same token.** Subpixel softening under CSS transform. **Fix:** bumped `#424242` → `#4A4A4A` on the canvas only (one notch brighter); dashboard stays `#424242`.

### Verification (verified by Jordan, gesture pass)

- `/w/[slug]/p/[pipeline-id]` renders the canvas (was 404 stub)
- Pan: click-drag, plain scroll, shift+scroll horizontal, trackpad two-finger — all smooth
- Zoom: Cmd+scroll, Ctrl+scroll, trackpad pinch, +/−/fit buttons — controllable and clamps at 0.25x–2x
- Edge fades visible at 0.55 opacity, content-aware, all 4 sides
- Coachmark renders bottom-center on first load (verified after resetting the dismissed flag), X dismisses, persists across reloads
- Stage-indicator pill top-center, recenter-on-click works
- Auto-center on load lands placeholder-1 in viewport center
- Unauthed → /auth/signin?next= (307)

### Deferred for later sub-steps

- **Coachmark auto-dismiss is window-scoped** (`window.addEventListener` for pointerdown/wheel). Any interaction anywhere on the page — header click, search bar focus, scroll on a non-canvas element — dismisses the hint. **Scope this to canvas-only in 5d** when the left rail + header land and there's a cleaner separation of what counts as "the canvas." Acceptable trade for MVP.
- **5b inherits:** real stage rendering with the locked 3-state coloring (grey/purple/green) per the figma. Placeholders go away. Stage-indicator pill wires to real current-stage derivation. Auto-center targets the in-progress stage.
- **5d inherits:** the left rail (cursor/chat/activity/links/members/+invite icons), the real header (member cluster + Edit pipeline button), and the role-gated affordances.

### Lessons learned (apply forever)

1. **Read library prop type semantics before configuring.** `activationKeys: string[]` vs `(keys) => boolean` look interchangeable in TypeScript — both compile, both typecheck. But the array form internally means `keys.every(...)` (ALL must be pressed); the function form lets you express EITHER. Cost: one verification round where Cmd+wheel triggered browser page zoom instead of canvas zoom because the lib's zoom path never activated. Lesson: when a prop accepts multiple type shapes, the JSON-style one usually has surprising semantics. Read the lib source if the docs don't explain.
2. **Always `preventDefault` on canvas wheel events unconditionally.** Browser-native Cmd+wheel = page zoom, plain wheel = page scroll if any ancestor has overflow. Both will steal the gesture from your in-app handler if your preventDefault has any conditional branches. Cover all cases at the top of the handler.
3. **Don't wipe `.next` while another dev server is running.** Turbopack workers hold file handles into the cache; wiping under them surfaces as cryptic 500s on the OTHER server. Coordinate cache cleanup, or just don't bother — `next build` is enough verification signal in most cases.

---

## Phase 4a — step 4 polish round + storage-free recently-done (2026-05-20)

**Goal:** annotate the populated My Tasks view across all six buckets, lock the visual surface, address the questions step 4 exposed (how long do completed tasks stay on screen? what's the keyboard story? what's the multi-plan story for headers?), and decide what step 5 inherits as locked tokens vs. open decisions.

**No net new migrations.** A `tasks.dismissed_at` migration (`20260520150000`) was authored mid-round to support a per-user soft-dismiss, then ripped out (file deleted from disk before commit, column + partial index dropped from the live DB by hand). See [Storage-free dismiss design](#storage-free-dismiss-design-replaces-dismissed_at) below for the reasoning.

### Storage-free dismiss design (replaces `dismissed_at`)

**The question that drove it:** how long does a completed task stay on the My Tasks list — forever (clutter), or auto-hide (and recover from where)?

**First-pass design (built, then rejected):**

- New column `tasks.dismissed_at timestamptz` + partial index `tasks_assignee_active_idx (assignee_id) WHERE dismissed_at IS NULL`.
- Hover-trash icon on completed rows for explicit dismiss.
- End-of-day auto-hide of completed tasks.
- New `/my-tasks/archived` route with Restore action.

Worked. But: an entire column + index + UI affordance + a recovery route, all to encode a flag that completion already implies. The same UX falls out for free from `completed_at`.

**Final design (storage-free):**

1. **Completion stays global** (`tasks.completed_at`, unchanged).
2. **Active My Tasks** auto-hides completed past end-of-day: server query filter `completed_at IS NULL OR completed_at >= today_boundary`. Reuses the existing day-boundary helper. No new state.
3. **Recently-done view** at `/w/[slug]/my-tasks/recently-done`: tasks assigned to me, completed in the last 7 days. Server-computed cutoff `now() - interval '7 days'`, sorted `completed_at DESC`. Read-only — no Restore action. Rolling window slides naturally with no cron / cleanup needed.
4. **Permanent delete moves to the task detail panel (step 6)** with a confirm dialog. NOT on My Tasks rows, NOT in recently-done.

**Cleanup performed live (no reverse migration, manual SQL):**

```sql
drop index if exists public.tasks_assignee_active_idx;
alter table public.tasks drop column if exists dismissed_at;
```

The migration file was uncommitted, so deleting it from disk leaves git history clean. Same Supabase SQL editor session that ran the cleanup also wiped the 11 polish-round seed tasks + all seed stages in `test-workspace-4b` (verified `0 | 0 | 0` post-wipe). Pipelines kept; workspace is now a clean slate for the proper demo build.

### Pill color tokens (LOCKED — step 5 canvas + step 6 task detail must reuse)

The locked urgency gradient for the `/my-tasks` view, after one mid-round swap to fix a Done-vs-thisWeek collision:

| Bucket / state | Pill text | Pill bg | Section dot |
| --- | --- | --- | --- |
| **Overdue** | `#DF1E5A` (red) | `rgba(223,30,90,0.18)` | `#DF1E5A` |
| **Today** | `#DF1E5A` (red) | `rgba(223,30,90,0.18)` | `#DF1E5A` |
| **Tomorrow** | `#E273C1` (pink) | `rgba(226,115,193,0.15)` | `#E273C1` |
| **This week** | `#108CE9` (blue) | `rgba(16,140,233,0.15)` | `#108CE9` |
| **Later** | `#979393` (grey) | `rgba(151,147,147,0.12)` | `#6B6B6B` |
| **No date** | `#979393` (grey) | `transparent` | `#6B6B6B` |
| **Done badge** | `#15B981` (green) | `#1F4535` | — |

**Why blue for This week, not green:** earlier rev used green (`#15B981` / `#1F4535`) for both the Done badge AND the thisWeek pill. With completed tasks sinking to the bottom of each bucket and Done pills sitting at the row end, a row showing "Sun" (thisWeek green) read identically to a row showing "Done" (completion green) at a glance — the disambiguation only landed once you noticed the strikethrough title. Moving thisWeek to blue (`#108CE9` — same Stages primary used on `+ Pipeline` and the active chip) frees green as the universal "completed" signal. Urgency gradient is preserved: red (now) → pink (next) → blue (this week) → grey (distant / untimed).

**For step 5 canvas:** when canvas surfaces task pills (stage column headers, mini task previews, etc.), reuse these exact tokens. Surface-dependent pill treatment was locked in step 4 — dashboard uses pipeline-colored, /my-tasks uses bucket-colored. Canvas needs its own decision documented when it ships; default expectation is bucket-colored for any canvas-side "my tasks" widget, pipeline-colored when grouping by stage.

### Visual + interaction polish (what shipped)

- **Dotted-grid background extension** — `min-h-full` → `flex-1` on all three workspace-scoped page wrappers (dashboard, my-tasks, p/new). `min-h-full` only extended to content height for short pages; `flex-1` extends through the AppShell content area to the bottom of the viewport.
- **Quick add row restyle** — bg `#222933`, dashed border `#25476B`, text + icon `#35C4EE`. Visual hint changed from `⌘N` to `N` (see Keyboard shortcuts below).
- **"Hide completed" toggle** — custom-styled to match the TaskRow checkboxes: native `<input type="checkbox">` inside the `<label>` (visually hidden, kept for click target + keyboard + screen-reader semantics), styled `<span>` shows the visual state. Grey fill + `#36363A` stroke unchecked, blue `#108CE9` fill checked.
- **Header avatar stroke** — 2px → 1px on `HeaderProfileMenu`. Subtler ring, doesn't pull attention from active workspace text.
- **My Tasks page header band** — pulled out of the dotted-grid area so the high-density header (search + count + subtitle) sits on a solid surface; dotted pattern only appears behind the section list below. Subtle bottom stroke separates the two regions.
- **TaskRow checkbox** — custom-styled (was relying on system checkbox before): 18×18px, 4px radius, blue fill + check on completion, white stroke at 30% opacity unchecked. Same visual language as the hide-completed toggle.
- **MyTasksCard row spacing (dashboard)** — vertical padding tightened from 12px to 8px to match the figma's at-a-glance density. Calibrated in two passes (first 6px read too cramped, settled at 8px). The full /my-tasks view keeps its looser 14px row padding — different surface, different density rule.
- **Stages logo → clickable** — wraps the header logo in a `<Link>` to the active workspace dashboard (or `/` if no active slug). Opacity hover. Standard webapp convention (Linear, Notion, Slack all do this). Falls back to `/` only on workspace-agnostic routes; on normal `/w/[slug]/*` navigation the slug is always known.
- **Avatar sizing fixes** — explicit `boxSizing: "border-box"` on `next/image` (Tailwind preflight doesn't reach next/image's inline styles, so the 2px border was rendering outside the 40px footprint and making the avatar visually 44px). `HeaderProfileMenu` internal Avatar's rounded-square ↔ circle threshold bumped from `<= 36` to `<= 40` to keep size 40 rendering as rounded-square (was flipping into circle mode at the threshold).
- **Dashboard task-click payload** — `MyTasksCard` and `/my-tasks` `TaskRow` click handlers now log `{ taskId, pipelineId, stageId }`. Step 5 canvas wires this to `router.push('/w/${slug}/p/${pipelineId}?stage=${stageId}')` — payload already loaded, the wire-up is one line. Step 6 may then auto-open the task detail panel overlay on top of the canvas.

### Keyboard shortcuts (LOCKED)

Two shortcuts, two conventions. Both gate on "active element is not an input/textarea/contenteditable" so typing the letter in a search box doesn't trigger them.

- **Bare `N`** — focuses the My Tasks quick-add input from anywhere on the page. Expands the collapsed row if needed (the input isn't mounted in collapsed state, so `setQuickAddExpanded(true)` + `setTimeout(focus, 0)` is the focus sequence). Originally spec'd as `⌘N` until we discovered live that **Cmd+N is browser-reserved for "New Window" — `e.preventDefault()` cannot override it**. Same fate as ⌘T, ⌘W, ⌘R. Industry pattern in webapps is a single-key shortcut (Linear: C, Todoist: Q, Trello: C). `N` matches the original "N for new" intent.
- **`⌘K`** — reserved for the global search / command palette. NOT wired to a handler yet — the actual palette ships post-4a — but the header search input has a `<kbd>⌘K</kbd>` badge as the public commitment. **Don't bind ⌘K to anything else.** Slack and Linear both establish this convention; users land in Stages expecting it.

### Role-gated affordances (first plan-aware code in the app)

Stages MVP has two plans: **Solo $29/mo** (single-user, always owner, always sees admin affordances) and **Team $39/mo/user** (multi-role: owner / admin / member, role is per-workspace). Two surfaces now respect the role.

- **`+ Pipeline` header button** (`AppShell`) — derives `activeWorkspaceContext` from `useUserContexts` (filters: `type='agency' AND source='workspace' AND workspaceSlug=activeSlug`). `canCreatePipeline = role === 'owner' || role === 'admin'`. Members + pipeline-only agency users have the button hidden; `flex-1` search bar to its left absorbs the freed space with no layout jump.
- **Dashboard empty-state CTA** (`PipelinesSection`) — same gate. Owner/admin gets "create your first pipeline to get started" + button. Members get "an owner or admin will set things up here." (no CTA — would just bounce to a no-permission panel anyway).

Multi-workspace setups: role is per-workspace, so the same user can have the button visible in workspace A (their own) and hidden in workspace B (where they're a member). While contexts is loading, `canCreatePipeline` defaults to `false` (no flash of button); once contexts ready, the correct state renders.

### Files touched

```
modified:   src/app/w/[slug]/my-tasks/page.tsx
modified:   src/app/w/[slug]/p/new/page.tsx
modified:   src/app/w/[slug]/page.tsx
modified:   src/components/app/AppShell.tsx
modified:   src/components/app/HeaderProfileMenu.tsx
modified:   src/components/dashboard/MyTasksCard.tsx
modified:   src/components/dashboard/PipelinesSection.tsx
modified:   src/components/my-tasks/MyTasksView.tsx
modified:   src/components/my-tasks/QuickAddRow.tsx
modified:   src/components/my-tasks/TaskRow.tsx
new file:   src/app/w/[slug]/my-tasks/recently-done/page.tsx
new file:   src/components/my-tasks/RecentlyDoneView.tsx
```

### Strategic decisions captured (deferred work, affect step 5 and beyond)

- **Task click routing (step 5 must wire).** Click on a task in /my-tasks or the dashboard's MyTasksCard → `router.push('/w/${slug}/p/${pipelineId}?stage=${stageId}')`. Pipeline canvas loads with the relevant stage focused/scrolled-to. Step 6 may then auto-open the task detail panel overlay. Click handler payload already includes `{taskId, pipelineId, stageId}` — wire-up is one line.
- **Client-facing dashboard / OAuth integrations.** Decision: build the architectural seam in step 5, defer real OAuth to v2.0 post-PMF. v1.1 ships orchestration-only checklist (no OAuth, no tokens, low risk). Architectural seam requirement: provider config supports both modes (held vs orchestrated) from day one; audit log table exists at v1 even if only logging checklist events; `hipaa_safe` flag baked into provider config shape from the start.
- **HIPAA target (new).** Medical is a target vertical later. Means: SOC 2 Type II + HITRUST become non-negotiable on the path to medical; `hipaa_safe` flag must be in provider config from day one; some providers stay orchestration-only forever even when others move to held-token mode.
- **Long-term token storage thesis.** At scale, hold tokens for most providers — gated by SOC 2 Type II → dedicated SecEng hire → cyber insurance with token-vault rider → per-provider legal/ToS review → customer signal → per-provider ROI. Roughly Series A / $5-10M ARR. Never-hold list: banking-tier credentials (Plaid/Stripe Issuing holds those), PHI/HIPAA-adjacent, gov SSO root tokens. The "business hub" thesis at scale REQUIRES owning the integration surface — Salesforce/HubSpot/Zapier all became hubs by holding more credentials over time.
- **Team vs Client pipeline types — REJECTED.** No type picker at creation. Use `pipelines.company` field as the implicit distinction (set = client, null = team). Surface the distinction on the dashboard when it earns its keep (>8 pipelines in a workspace, or when client-facing dashboard ships). Step 5 implication: keep `company` optional (already is), no schema work, purely "don't accidentally make `company` required."
- **Soft-delete pipelines** — deferred to step 5. Spec: `pipelines.archived_at timestamptz` nullable + filter on dashboard list + archived pipelines route similar to recently-done shape.

### Lessons learned (apply forever)

1. **Reach for the storage-free design first.** When a feature can be expressed as a query over existing data (completion + day-boundary helper + 7-day window), don't reach for a new column. The dismiss flag we built and ripped out was a useful object lesson: an entire column + index + UI affordance + recovery route, all to encode a flag that completion already implies. Same UX falls out for free. **New column = new failure mode + new schema cost forever. Validate that no existing column + query combination delivers the same UX before adding one.**
2. **Browser-reserved keyboard shortcuts must be tested live.** ⌘N, ⌘T, ⌘W, ⌘R, ⌘Q are all unrecoverable in JavaScript — `e.preventDefault()` does not override them. Industry pattern is single-key shortcuts (Linear: C, Todoist: Q). Confirm with a manual press before spec'ing `⌘<letter>` for any in-app action. The visual hint badge (`<kbd>`) is ALSO a public commitment — don't add one until the shortcut has been live-tested in the target browser/OS.
3. **Color tokens are surface-dependent, not global.** Two greens on the same surface (Done badge + thisWeek pill in /my-tasks) collide visually even when "semantically distinct" — context is too thin to disambiguate at a glance. Color choices that look fine in isolation can fail when surfaced together. Audit color pairings as the surface populates, not in component-level previews.

---

## Phase 4a — step 4: My Tasks full view + deadlines (2026-05-20)

**Goal:** turn the `/w/[slug]/my-tasks` placeholder route (from step 2's "See all N →" link) into the real surface — all tasks assigned to the current user across pipelines, grouped by deadline, with inline date editing and quick-add. Step 3 (deadlines) folded into step 4 because `tasks.deadline` already exists from the step-0 migration; the work was UI + the date picker, not schema.

**Migrations (applied to remote, in order):**

- `20260520130000_create_task_rpc.sql` — security-definer RPC `create_task(stage_id, title, assignee_id default null, deadline default null)`. Atomic position computation (max(position)+1 in the target stage) plus the INSERT in one transaction. Permission gate matches the `tasks_insert` RLS rule (`can_edit_pipeline`). Assignee defaults to caller (quick-add self-assigns); explicit assignment + unassign land in task detail (step 6). Title trim + non-empty + 200-char cap. Direct INSERT would have passed RLS but `tasks.position` is `NOT NULL` with no default — the RPC removes a client-side race.
- `20260520140000_fix_create_task_ambiguous_stage_id.sql` — hotfix. Original migration shipped with `where stage_id = create_task.stage_id` which Postgres flagged as ambiguous (column vs function parameter, same name). Caught during smoke-test runs of the prior migration before any client wired to it. Fix: alias the `tasks` table (`from public.tasks t where t.stage_id = create_task.stage_id`). The earlier `stages` lookup used `where id = create_task.stage_id` so wasn't affected (no column called `stage_id` on that table).

**Route + components:**

- `src/app/w/[slug]/my-tasks/page.tsx` — server component, all initial data at page level. Same auth + redirect rules as the dashboard (anon → `/auth/signin?next=…`, client → portal, non-member → last-active or `/`).
- `src/components/my-tasks/MyTasksView.tsx` — client component, owns task list state, chip filter, search, hide-completed toggle. Optimistic updates for toggle-complete and deadline-edit; quick-add hydrates the new task into the local list from the RPC's return + a 1-row stage lookup for pipeline metadata.
- `src/components/my-tasks/TaskRow.tsx` — row component. Checkbox + title + subtitle (`[emoji] [pipeline name] · Stage [N] · [stage name]`) + bucket-colored pill. Click pill opens DatePickerPopover. Null deadline shows "+ Add date" dashed affordance. Done state: strikethrough title + muted color + "Done" badge replaces pill + sinks to bucket bottom (sort logic in MyTasksView). Click on row body (not checkbox / pill) logs the step-6 stub.
- `src/components/my-tasks/DatePickerPopover.tsx` — hand-rolled month calendar (no external dep). Quick-set row on top (Today / Tomorrow / Next week / Clear), month grid below with prev/next nav. Closes on outside-click, Esc, or select. Auto-flips up when near viewport bottom.
- `src/components/my-tasks/QuickAddRow.tsx` — dashed "Quick add task" row at the bottom of the list. ⌘N from anywhere on the page focuses its input. Pipeline picker pre-selects to `profiles.last_active_pipeline_id`. Submit creates via `create_task` RPC, task lands in No date bucket (no deadline at creation), input clears + keeps focus for rapid multi-add. Pipeline picker filters out pipelines with no stages (the RPC needs a stage_id target).
- `src/lib/task-buckets.ts` — shared bucketing helper. `bucketForDeadline()` + `bucketMatchesChip()`. Imported by future surfaces (canvas, task detail) so they bucket consistently with My Tasks AND the dashboard's My Tasks card.

**Pill colors (locked surface-dependent treatment):** My Tasks uses BUCKET-colored pills (urgency-first); dashboard uses PIPELINE-colored pills (context-first). Pipeline identity is carried in the My Tasks subtitle so moving urgency onto the pill loses nothing. Canvas (step 5) and task detail (step 6) each get their own pill-color decision when built — `"pill color" is now surface-dependent, not one global rule`.

**Verification (live, jordan as workspace owner of Test Workspace 4b):**

- 10 tasks seeded across all 6 buckets (Overdue / Today / Tomorrow / This week / Later / No date) including one completed task. Sections render in correct order; Overdue only appears when populated.
- Chip counts reconcile: All = Today (incl. overdue) + This week (incl. tomorrow) + Later + No date.
- Quick-set picker (Today / Tomorrow / Next week / Clear) writes the deadline immediately and moves the task to the right bucket.
- "+ Add date" on null-deadline task opens picker; selecting moves it out of No date.
- Quick-add defaults to `last_active_pipeline_id`, creates via the RPC, lands in No date, input stays focused.
- ⌘N focuses quick-add from anywhere on page.
- Checkbox toggle: strikethrough + Done badge + sinks to bottom of bucket.
- Hide completed toggle: removes completed + updates counts; chip math still reconciles.
- Search filters client-side by title.
- Row click → console.log step-6 stub.
- Test data cleaned (0 tasks, 0 stages remaining in workspace 4b) before commit.

**Two bugs caught + fixed during verification:**

1. **Chip-count reconciliation bug (logic).** Initial implementation of `bucketMatchesChip()` mapped `overdue → no chip except All`. Result: clicking any non-All chip hid the overdue tasks entirely — the most urgent bucket became the most-filtered-out, exactly backwards. Fix: fold overdue into the Today chip (overdue is max urgency, belongs with "deal with now"). Locked rule: **chip counts must always reconcile to All; non-reconciling counts = hidden-bucket logic bug.** Every bucket must map to exactly one non-All chip.
2. **Seed deadlines at midnight-UTC misbucketed in local dev (TZ preview).** Test data seeded with `(now())::date::timestamptz` — midnight UTC of today. Server running locally (ET) computes `todayStartMs` as midnight ET = 04:00 UTC. Tasks seeded for "today" landed at May 20 00:00 UTC = 4 hours before today's ET midnight → bucketed as Overdue. Tasks seeded for "tomorrow" landed at May 21 00:00 UTC = May 20 20:00 ET = "today" in ET. The bucket logic is correct — the seed straddled the TZ boundary. **Live evidence that real US users in their evening hours will see deadlines mis-bucket the same way.** Workaround in test data: use noon-UTC instead of midnight-UTC (inside the calendar day in every TZ from UTC-11 to UTC+11). Real fix is the TZ-cookie launch-prep item — confirmed not optional.

**Lessons learned (apply forever):**

1. **Chip filters must reconcile to a partition.** Whenever a chip filter exists alongside a category total, the sum of category counts must equal the total. Buckets that don't map to any chip silently disappear when the user filters — and almost always those are the buckets the user wanted to see (overdue is the canonical example). When designing chip filters, draw the bucket-to-chip mapping explicitly and verify every bucket has exactly one home in the chip space.
2. **Use noon-UTC for test deadlines, not midnight-UTC.** Midnight-UTC straddles the day boundary for every timezone west of UTC; using it in seeds will mis-bucket tasks in local dev and quietly mask bugs. Noon-UTC is inside the calendar day in every timezone (UTC-11 to UTC+11). This isn't a hack — it's how to write TZ-portable test data until the TZ-cookie fix ships. The same trap will catch real US users in their evening hours; the launch-prep TZ-cookie fix isn't optional, this is the live evidence.

---

## Phase 4a — steps 1 + 2: pipeline creation + workspace dashboard (2026-05-19 → 2026-05-20)

**Goal:** ship pipeline creation end-to-end (RPC + route + form) and replace the legacy in-memory `<App />` render at `/w/[slug]` with a real Supabase-data-driven dashboard. Closes Phase 3.4 paper cut #1 (blank workspace home) and the dashboard half of lesson #10 (legacy sign-in fallback for unauthed visits).

**Step 1 — `create_pipeline_with_channels` RPC + `/w/[slug]/p/new` route (commit `2943b34`, applied 2026-05-19).**

Atomic security-definer RPC inserts pipeline + owner pipeline_membership + 2 channels (`general` is_client=false, `client` is_client=true) + creator's channel_memberships, all in one transaction. Permission gate is `is_workspace_owner_or_admin` (same helper Phase 3.4 step 6 uses for workspace_invites). Route at `/w/[slug]/p/new` renders the create form inside AppShell with name + emoji preset picker; on success persists `profiles.last_active_pipeline_id` and routes to `/w/[slug]/p/[new-id]` (a Phase 4a step 5 stub for now).

Step 1 verification (chrome, jordan as agency owner):
- Happy path: created "Step 1 Verification" pipeline. Redirect → `/w/test-workspace-4b/p/[uuid]` returns 404, expected (canvas is step 5 stub).
- SQL spot-check: pipelines row created with name + emoji correct; `channels` has 2 rows (general/client); `pipeline_memberships` has 1 row with role='owner'. Clean.
- Anonymous branch (incognito): `/w/test-workspace-4b/p/new` redirected to `/` with the legacy sign-in screen. Functionally equivalent to `/auth/signin` (unauthed user blocked) — same legacy fallback documented in Phase 3.4 lesson #10. Full normalization to `/auth/signin?next=…` deferred to a Phase 4c step; step 2 closes the dashboard half of this gap directly.
- One pre-existing finding flagged for cleanup: Supabase default privileges grant `EXECUTE` to `anon`/`authenticated`/`postgres`/`service_role` on every RPC independently of PUBLIC, so `REVOKE FROM PUBLIC` alone leaves anon callable. The in-function `auth.uid() is null` check is the actual gate. Logged as a separate task — not a step 1 regression.

**Step 2 — Workspace dashboard at `/w/[slug]` (this commit).**

Server component, all data fetched at page-level (no client waterfalls). Replaces the legacy `<App />` render. Auth + redirect rules per spec: anon → `/auth/signin?next=/w/[slug]` (closes the dashboard half of lesson #10); client-only members in this workspace → `/portal/[first-pipeline-id]`; non-member with a `last_active_workspace_id` elsewhere → that workspace; otherwise → `/`.

Layout:
- **Greeting block** — `Hey [first-letter-capitalized firstname]! 👋` in a #263D5F highlight with #7FA7D9 text, subhead "What can we get done today?", date line. Greeting parses `display_name.trim().split(/\s+/)[0]` then capitalizes; null/empty → "Hey there! 👋".
- **My Tasks card** — top 5 non-completed tasks assigned to current user, sorted: overdue first → deadline asc → no-deadline by created_at desc. Date pills in pipeline color; overdue tasks get red titles, pills stay pipeline-colored.
- **Activity card** — top 5 events from `activity_events`, filtered to `member_joined / stage_advanced / pipeline_submitted / pipeline_created` (the 4 types the current schema can write); mentions/replies/assignments/completions deferred to 4b (needs schema expansion + writer triggers). Subtitle locked as "Recent updates from your team" — don't promise mentions we can't deliver yet.
- **Team chat strip** — always renders in step 2; permanent empty state ("no messages yet." + "Start a conversation" CTA stub). TODO comments mark the spots for 4b workspace-channel schema and Phase 6 `workspaces.plan` gating.
- **Pipelines section** — filter chips (Progress asc default → stalled first / Name / Recents) above a responsive grid (1/2/3/4/5 cols at sm/md/lg/xl/2xl). Each card renders emoji block, name, optional `🏠 [company]` line (per the figma), member cluster (3 avatars + `+N`), current stage with locked 3-state visual derivation, and progress bar.

Shared components introduced:
- **`<UserAvatar user={...} size={...} />`** — new, dashboard-only scope. Renders `profiles.avatar_url` when present; else proportional rounded-square (size × 0.25) with deterministic-hashed bg and initial fallback. Email used ONLY for the single-character initial fallback — never in `alt`/`aria-label`/`title` (guard against agency↔client email leakage). The existing `src/components/Avatar.tsx` + the inline Avatar inside `HeaderProfileMenu` stay untouched; migrating those is a follow-up.
- **AppShell header** restructured: contents wrapped in matching `max-w-[1600px] mx-auto px-6 sm:px-12` so the workspace switcher's left edge and the avatar's right edge align with the cards below. Header gets a search-bar visual placeholder (cmd+K is post-4a) + a "+ Pipeline" button when `activeSlug` is known.

Schema additions:
- Migration `20260519140000_tasks_created_at` — adds `tasks.created_at timestamptz not null default now()` for the third-tier sort in My Tasks (no-deadline tasks by creation desc).
- Migration `20260520120000_create_pipeline_company_param` — extends `create_pipeline_with_channels` with an optional `pipeline_company text default null` parameter so the create form can populate `pipelines.company` (column has existed since `20260508120000_initial_schema`, just had no writer path until now).

Storage migration (Supabase auth):
- Client switched from `createClient` (supabase-js, localStorage) to `createBrowserClient` (`@supabase/ssr`, cookies). New server-side client at `src/lib/supabase-server.ts` reads the same cookies via `next/headers` so RSC can resolve `auth.uid()` correctly. Without this pairing, the dashboard server component saw no session and looped to `/auth/signin` while the client showed authenticated — the infinite-redirect bug observed mid-build.

Bug surfaced + fixed during build (the actual reason the dashboard returned empty data before the FK fix):
- **PostgREST PGRST201 ambiguous embed.** The schema has two FKs between `stages` and `pipelines`: `stages.pipeline_id → pipelines.id` (the parent FK we want) and `pipelines.current_stage_id → stages.id` (auto_advance_stage back-pointer). PostgREST refused to embed without a hint and three queries (`myTasksRes`, `workspaceTasksRes`, `stagesRes`) all returned errors that collapsed to empty arrays via the `.data ?? []` fallback. My Tasks surfaced as an error state in the UI; the other two failed *silently* and made every pipeline card render "0/0 + No stages yet" even when the data was there. Fix: disambiguate explicitly with `pipelines!stages_pipeline_id_fkey!inner(...)` in all three queries. Verified against the live REST endpoint — returns `[]` (RLS deny) instead of PGRST201 with the FK hint.

Verification (live, jordan as workspace owner of Test Workspace 4b):
- Seeded test data: 3 stages (Discovery #DF1E5A, Design #E273C1, Delivery #21B159), 6 tasks (3 done, 3 not), 3 mock activity events from non-jordan actors, `company = 'Smoke Test Co'` on 7a.
- Pipeline card derivation: 7a showed "Design" with 3/6 progress + light-pink bar + solid colored dot. Matches the locked 3-state rule (partial completion → highest-position stage with any completed task).
- My Tasks: 2 visible (First draft / Tomorrow / pipeline color dot · Final delivery / no pill), sorted correctly.
- Activity card: 3 events rendered newest-first with avatars matching actor identity (Jordan Perez Google avatar, William Wayne initials).
- Avatar fallback: jordanperez1270+client@gmail.com (null display_name) renders "J" (first letter of email) — not the previous "4" (first hex char of uuid).
- Unauthed redirect: smoke-tested via `curl` against the production build server → HTTP 307 to `/auth/signin?next=/w/test-workspace-4b`.
- Test data fully cleaned before commit (0 stages, 0 tasks, 0 activity_events, company reset to null on 7a).

Polish landed in step 2 (figma alignment): square greeting highlight, type-scale tweaks (40/600 → 40/500 greeting, 30 → 34 subhead), 48px emoji boxes with #212124 bg + #36363A border across all cards, dotted-grid backdrop (`.dotted-grid` class color refreshed to #424242, applied to dashboard + create-pipeline page), responsive header padding (`px-6 sm:px-12`), responsive max-width 1200 → 1600, pipelines grid xl/2xl breakpoints, rounded-square avatar treatment (size × 0.25 proportional), hover-pill rows with negative-margin pattern, pipeline cards now render `🏠 [company]` when set, conditional `#7FA7D9` text-link color on active "See all" / "Open chat" links.

Two deviations from the original SPEC, both green-lit on disclosure:
1. **My Tasks `+` quick-add** is a placeholder explanation ("Quick-add lands in step 4") instead of a half-broken title-only composer — tasks need a `stage_id` and there's no way to derive one from title alone. Step 4 builds the full picker.
2. **Avatar call-site count** — the new UserAvatar has TWO call sites in step 2 (Activity rows + Pipeline cluster), not three. My Tasks rows use a pipeline-color dot per the row spec, not an assignee avatar.

Convention added this phase (see CLAUDE.md → Conventions):
- **Dashboard sections stay position-agnostic.** User-customizable section ordering is a planned v1.1+ feature, deferred until post-launch validation. Every dashboard section component must stay self-contained, must not hardcode vertical position, and must own its own data/empty/error states. Keeps the v1.1 customization a layout-shell change rather than a rewrite. Free now, expensive to retrofit.

Scope addition deferred to Phase 4a step 5 (canvas):
- **Soft-delete pipelines** via `pipelines.archived_at timestamptz null` + `archive_pipeline` / `restore_pipeline` RPCs + dashboard filter (`.is('archived_at', null)`) + Archived view. Permission gate: workspace owner/admin OR pipeline owner. Activity event types `'pipeline_archived'` / `'pipeline_restored'` added to the CHECK constraint as part of the same migration. Folded into step 5 rather than spawned as a separate chip — pipeline lifecycle is naturally cohesive with the canvas + settings UI.

**Lessons learned (apply forever):**

1. **PostgREST `.data ?? []` fallbacks mask query errors.** A query returning PGRST201 (ambiguous embed, missing FK hint, schema mismatch) hits the JS error branch but the page-level `.data ?? []` pattern silently substitutes an empty array — UI shows empty state, no console log, no error state, no banner. The bug was only caught because the *other* failing query surfaced via `myTasksRes.error` into the My Tasks card's error UI. When checking dashboard data, verify failures aren't masquerading as empty results: log `*Res.error` for each query, or wire a per-card error prop and make sure it's not always-null.

2. **Disambiguate multi-FK embeds explicitly.** Any pair of tables with more than one FK between them (stages↔pipelines is the live example; pipelines.current_stage_id back-pointer is the second FK) requires the `tablename!fk_constraint_name!inner` syntax to embed. PostgREST will not pick a default. Audit happens at the query-write step, not at runtime.

3. **Header alignment matters more than expected.** Aligning the AppShell header's contents with the dashboard body's max-width container costs one extra `<div>` wrapper but pays off across every workspace-scoped surface (workspace switcher ↔ greeting ↔ first card all share a left edge). Don't leave the header at full-bleed if the body is constrained.

4. **Storage mismatch between Supabase client + server clients is silent until you SSR.** The browser client at `createClient` (supabase-js, localStorage) doesn't share session storage with the server's `createServerClient` (@supabase/ssr, cookies). Sessions written by the client are invisible to the server, producing infinite redirect-to-signin loops when SSR pages gate on auth. Pair them: `createBrowserClient` on the client side, `createServerClient` on the server, both via `@supabase/ssr`.

5. **TZ caveat on server-side day boundaries.** Dashboard's "overdue" sort uses midnight-today computed in the server's local TZ (UTC on Vercel). For users west of UTC, deadlines that fall in their local "today" but after server UTC midnight will misbucket as not-overdue. Pre-launch blocker (US-based GHL beachhead is mostly west of UTC). Locked fix path: read user TZ from a cookie set client-side on first load, compute the day boundary in that TZ. Tracked in launch-prep checklist.

---

## Phase 3 — Checkpoint 3.4 COMPLETE: auth wiring + invite flows + identity linking (2026-05-19)

**Goal:** wire Supabase auth end-to-end, ship agency + client invite flows, add identity linking + linked-accounts settings, and verify everything via a two-browser end-to-end run.

**Outcome:** all 8 implementation steps shipped, §9 two-browser verification passed across every section that's testable in Phase 3.4's auth-only scope. Phase 3.4 is closed.

**What shipped (8 implementation steps + verification):**

1. **Steps 1–4 — auth wiring + post-login selector + AppShell** (commit `99f5c83`)
   - `/auth/signin` + `/auth/signup` (email+password and Google OAuth)
   - `/auth/callback` for the PKCE return trip
   - `useSession` + `useUserContexts` hooks
   - WorkspaceSelector + AppShell (logo, workspace switcher, profile menu) — the persistent chrome for `/w/[slug]/*` and `/settings/*`
   - `profiles.last_active_workspace_id` fix (commit `01ca048`) so workspace switches actually persist

2. **Steps 5–7 — workspace creation + invites** (commit `a74c070`)
   - `create_workspace_with_owner` RPC (atomic workspace + owner-membership)
   - Per-user duplicate-name check inside the RPC
   - `workspace_invites` table + `is_workspace_owner_or_admin` helper + `get_workspace_invite_preview` / `accept_workspace_invite` RPCs
   - `client_invites` aligned to the same shape (token=uuid, accepted_at, accepted_by, expires_at)
   - Public-grant hygiene migration (5 RPCs revoked from PUBLIC)
   - `/accept-invite/[token]` (8-state UI) and `/portal/accept/[token]` (10-state UI)
   - `/w/[slug]/settings/team` + `/w/[slug]/p/[pipeline-id]/clients` invite UIs
   - Email send via Resend + React Email templates (`@react-email/components` + `@react-email/render`); API routes use `SUPABASE_SECRET_KEY` for `auth.admin.generateLink`
   - localStorage side-channel (`setPendingAcceptInvite` / `consumePendingAcceptInvite`) so the invite token survives the sign-in / sign-up round trip

3. **Branding polish** (commit `f810f61`) — full Stages wordmark on all auth surfaces

4. **Step 8 — /settings/account: linked accounts** (commit `435ab36`)
   - 8a layout + AppShell `activeSlug` fallback to `last_active_workspace_id` for workspace-agnostic routes
   - 8b Linked accounts section: email+password card (with `user_metadata.has_password` flag for the Supabase quirk where `updateUser({password})` on a Google-linked user skips the email-identity-row creation) + Google card via `linkIdentity`
   - 8c dismissible "Set password" banner (localStorage-persisted), CTA expands the inline form and scrolls it into view
   - 8d Settings link in HeaderProfileMenu

5. **§3 prefill+lock fix** (commit `e76af3b`, surfaced by §9 verification) — `/accept-invite/[token]` → "Create account" was routing to a blank, editable email field, so a recipient could sign up with a different address than the invite. SignUpPanel now fetches the invite preview, pre-fills + locks the email, reframes the title around "Accept your invitation." Defense-in-depth: `accept_workspace_invite` already enforces the email match server-side (migration lines 274–279); both layers are commented to call out the threat model each addresses.

**§9 two-browser verification PASS summary:**

| § | Test | Result |
|---|---|---|
| 1 | Agency A signup + workspace creation (incl. duplicate-name) | PASS |
| 2 | Team invite send / copy / resend | PASS |
| 3 | Teammate accept; prefill+lock fix verified | PASS |
| 5 | Client accept via magic link → `pipeline_memberships` row confirmed via SQL | PASS (portal route is a Phase 4 stub) |
| 6.1 | Client → `/w/agency-a` → blocked | PASS |
| 6.2 | Client → `/w/agency-a/settings/team` → blocked | PASS |
| 6.3 | Teammate (member role) → `/w/agency-a/settings/team` → blocked (role gate) | PASS |
| 6.4 | Unauthed → `/w/agency-a` → no content | PASS |
| 6.5 | Unauthed → `/portal/[id]` → 404 (degenerate, route is Phase 4 stub) | PASS |
| 7 | Teammate workspace switcher shows only Agency A | PASS |
| 8 | Cross-agency isolation | SKIPPED — trusted via §6.3 role-gate verification |

Sections not run: §4 against Agency A (no pipeline-creation route exists yet — substituted with 7a Smoke Test Pipeline in Test Workspace 4b, which exercised the same `/clients` invite path).

**Known transitional gaps for Phase 4 (not §9 failures — documented for the next phase):**

1. `/portal/[pipeline-id]` needs its own auth gate when the view is built — server-side session check + verify `pipeline_memberships` row with `role='client'` for that pipeline.
2. Unauthed `/w/agency-a` renders the legacy in-memory app sign-in screen rather than redirecting to `/auth/signin`. Functionally equivalent (no protected content shown) but should normalize when the legacy app is replaced.
3. `/w/[slug]` renders blank for Supabase-only workspaces — legacy `<App />` uses `useAppState` in-memory data; doesn't know about Supabase-only workspaces. Per `CLAUDE.md → Known transitional state`, Phase 4 wires real Supabase queries inside the views.
4. Pipeline creation has no Next.js route. Currently a legacy in-memory action; Phase 4 needs either `/w/[slug]/p/new` or a modal POSTing to a `create_pipeline` RPC.

**Launch-prep checklist (open):**

- Supabase Pro upgrade — covers email rate limit (4/hr free) + 30-day session timeout + production sending volume. One upgrade resolves three blockers.
- Custom SMTP (Resend or similar) to lift the 4/hr email rate limit. Either redundant with the Pro upgrade or done in addition for cost reasons depending on volume.
- `/portal/[pipeline-id]` auth gate (Phase 4, see gap #1 above).

**Migrations added this phase:**

- `20260511120000_create_workspace_with_owner.sql`
- `20260512120000_block_duplicate_workspace_names.sql`
- `20260513120000_workspace_invites.sql`
- `20260514120000_client_invites_align.sql`
- `20260514130000_revoke_public_rpc_grants.sql`

**Lessons learned (apply forever):**

1. **Supabase redirect URL allowlist matters.** Magic-link `redirect_to` silently fell back to the project's Site URL because `/portal/accept/*` wasn't in the allowlist. Diagnosed via Supabase logs after a long debug session. Solution: add `http://localhost:3000/**` and the production URL wildcard. Always verify wildcards cover every redirect path before debugging "magic links go to the wrong place" symptoms.
2. **`@react-email/render` is separate from `@react-email/components` and `resend`.** Installing the latter two without the renderer ships broken email sends. Watch for missing-dep errors at runtime.
3. **PostgREST nested-select array-vs-object typing is unreliable.** A one-to-one nested select can come back typed as an array even when it's a single object. Cast through `unknown` and handle both shapes defensively in client code.
4. **Phase 3.4 §9 surfaced a real security finding** — `/accept-invite/[token]` signup form let recipients pick any email. The accept RPC enforced server-side, but the UX let an attacker (or confused user) create the wrong account. **The two-browser verification gate is non-optional precisely because it surfaces this class of UX-to-security gap.**

---

## Phase 3 — Checkpoint 3.3 COMPLETE: RLS verified (21/21) + bug fix migration (2026-05-09)

**Goal:** run all 21 SQL-editor tests in `RLS_TEST.md`, document each one's exact query and output, and only advance to 3.4 with a clean board.

**Outcome:** 21 of 21 pass.

**Real production bug caught and fixed mid-run.** Test 16 (admin without `can_submit` cannot submit) initially returned a silent `UPDATE 0` instead of the expected trigger error. Diagnostic chain (D1: `can_submit_pipeline` returns false ✓; D2: admin's pipeline_memberships row exists ✓; D3: `can_edit_pipeline`, `is_pipeline_agency_member`, `auth.uid()` all return correct values ✓; D4: admin and member both see 0 pipelines via SELECT) traced root cause to `pipelines_select` and `workspaces_select` only admitting workspace-level memberships and clients — pipeline-level agency members (anyone added directly via `pipeline_memberships` with role `owner`/`admin`/`member` but no `workspace_memberships` row) failed the SELECT and so PostgreSQL never matched any row for their UPDATE. The trigger never got the chance to fire. Same shape error in `workspaces_select`. **Production-impact bug** — every freelancer or per-engagement teammate added to a single pipeline would have been blind to it. Patched in `20260509130000_fix_pipeline_visibility.sql`, regression-tested Tests 1, 6, 8, 15, 16, then completed 17–21 — all green.

**Three migrations now in the production DB:**
1. `20260508120000_initial_schema` — 18 tables, indexes, constraints
2. `20260509120000_rls_policies` — 9 helper functions, 7 triggers, ~50 RLS policies, 2 private storage buckets + their policies
3. `20260509130000_fix_pipeline_visibility` — pipeline-level agency members can now SELECT their pipeline (and the workspace it lives in)

`npx supabase migration list --linked` shows all three in both Local and Remote.

**Per-test record:** `supabase/RLS_TEST_RESULTS.md` — each of the 21 tests has its impersonation setup, exact SQL, exact observed output, and pass/fail. Test 16 includes the full diagnostic chain (D1–D4), root-cause analysis, and re-run output post-fix. Anyone reviewing this can verify on a per-test basis without re-running.

**Process improvements logged (apply forever):**
1. **Always paste full `db push` output.** A previous session moved on to test setup assuming the push succeeded; the migration had silently never applied. Forces explicit confirmation.
2. **Always run `npx supabase migration list --linked` after a push** and confirm Local + Remote columns both list the new migration. The push-output check above is necessary but not sufficient — verifying via the list is the second confirmation.
3. **Always understand the WHY of test results, not just the WHAT.** Test 15 had been marked PASS at the same time Test 16 silently failed — both produced "0 rows updated," but for different reasons (15: `can_edit_pipeline` denied; 16: SELECT visibility hid the row). Without checking the WHY, the bug would have shipped. Going forward: when a test passes by absence (zero rows / no error), confirm the absence is for the documented reason, not a coincidence.

**Still gated to post-3.4 (these are NOT skipped, just out of SQL-editor scope):**
1. Two-browser test (real auth sessions, full UI flow per `CLAUDE.md → Security model → The two-browser test`).
2. Signed-URL HTTP storage probe (Browser B fetches Agency A's attachment URL → must `403`).
3. Application-layer Layers 2 & 3 of the internal-message defense (server-side `is_internal=false` write enforcement; client-portal render-side filter).

These run during 3.4 and 4 alongside the auth + real-data wiring work.

---

## Phase 3 — Checkpoint 3.3 (verification plan): RLS_TEST.md (2026-05-09)

**Goal:** partial verification of RLS policies via the SQL editor before adding more layers (auth in 3.4) on top.

**What landed:**
- `supabase/RLS_TEST.md` — 21-test checklist for the SQL editor. Three phases: (1) create 5 test users via the Auth dashboard with auto-confirm, (2) seed test data with fixed UUIDs via one big DO block, (3) run impersonated queries using `set local role authenticated; set local request.jwt.claims to '{"sub": "..."}';` wrapped in `begin/rollback` so mutations don't persist between tests. Each test has expected output and a pass/fail checkbox.

**Coverage of the 8 boundaries the founder listed:**
1. Cross-agency workspace isolation — Tests 1–4
2. Client cannot see other agency's pipeline — Test 7
3. Client cannot see internal channel messages — Tests 12–14b (incl. INSERT-block test)
4. Client cannot see hidden stages/tasks/notes/files — Tests 8–11 (incl. parent-gate enforcement)
5. Member cannot submit — Test 15 (RLS silent denial)
6. Admin without can_submit cannot submit — Test 16 (trigger raises)
7. Owner can submit — Test 17
8. Storage cross-agency probe — Test 18 (real HTTP probe waits for 3.4)

**Bonus tests added:** admin can_check_tasks scope (Tests 19–20), last-owner protection trigger (Test 21).

**Status:** awaiting founder to apply the RLS migration and run through the 21-test checklist.

---

## Phase 3 — Checkpoint 3.3 (SQL written): RLS migration ready to apply (2026-05-09)

**Goal:** the RLS migration that enforces every rule in CLAUDE.md → Security model. Plan was approved with answers to the five open questions; SQL implements those answers exactly.

**What landed:**
- `supabase/migrations/20260509120000_rls_policies.sql` — 9 helper functions (security definer stable), 6 triggers (handle_new_user, sync_profile_email, prevent_last_workspace_owner_removal, enforce_admin_can_check_tasks_scope, protect_pipeline_submission, enforce_client_task_update_scope, auto_advance_stage), `enable row level security` on every public table, ~50 RLS policies with plain-English comment blocks, two private storage buckets (`stage_attachments`, `pipeline_files`) with their object-level policies. Verification queries documented at the bottom (commented out — run manually post-apply).
- `CLAUDE.md` — the three-layer internal-message defense-in-depth section now explicitly warns future maintainers not to remove any layer thinking the others are sufficient. Each layer's threat model spelled out.
- `supabase/RLS_PLAN.md` — marked approved, answers to the five open questions documented inline so reviewers can trace plan → SQL.

**Apply path:** `git pull` then `npx supabase db push` from the founder's terminal.

**Verification gate (non-optional before 3.4):** the two-browser test documented in CLAUDE.md. Browser A (Agency A) sets up a pipeline + client invite + internal/public messages. Browser B (Agency B) probes for cross-agency leaks. Browser C (the client of A's pipeline) probes for visibility-scope and internal-message-privacy leaks. Every check must pass.

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
