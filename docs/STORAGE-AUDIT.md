# Stages — Storage RLS Audit (Slice S2 Phase 1)

**Status:** Phase 1 inventory complete (2026-06-07). Phases 2 (test harness extension) and 3 (fixes) follow on the same Slice S2 sprint.

**Scope.** `storage.buckets`, `storage.objects` policies, and every application call site that touches Supabase Storage (`storage.from(...)`, `.upload(...)`, `.createSignedUrl(...)`, `.getPublicUrl(...)`, `.download(...)`).

**Source-of-truth pointer.** CLAUDE.md → Security Model → "Storage bucket policies (security half #2)" is canonical. Anything in this document that contradicts CLAUDE.md is a bug in this document.

---

## 1. Methodology

The Slice S1 RLS audit covered the `public` schema only — storage policies were explicitly deferred to this slice because they live in the `storage` schema and have their own access patterns (signed URLs, path-derived pipeline_id extraction, etc.). This audit closes that gap.

### Queries run (read-only, via Supabase SQL Editor)

| # | Purpose |
| --- | --- |
| 1 | Bucket inventory (`storage.buckets` — public/private, size limits, MIME allowlist) |
| 2 | RLS-enabled status on `storage.objects` + `storage.buckets` |
| 3 | All RLS policies on `storage.objects` |
| 4 | Object counts per bucket |
| 5 | Sample object paths per bucket (verify convention) |
| 6 | Orphan-object count vs `pipelines` table |

### Cross-checks performed

- **App-side grep** of every Storage call site in `src/`:
  - `storage.from(`, `.upload(`, `.download(`, `.createSignedUrl(`, `.getPublicUrl(`
  - Confirmed **zero `.getPublicUrl(` calls** anywhere in the codebase — matches CLAUDE.md's "signed URLs only" lock.
  - Confirmed **zero `.download(` calls** — all downloads route through signed URLs.
  - Confirmed **zero API routes** under `src/app/api/` touch storage directly — all storage operations happen browser-side from user-scoped (JWT-bound) Supabase clients.
- **Policy text inspection** in `supabase/migrations/20260509120000_rls_policies.sql` lines 1095–1183 + the follow-on migrations (`20260601120000_client_file_upload_rls.sql`, `20260602120000_pipeline_links_storage_path_binding.sql`).
- **Pattern comparison** between `pipeline_files` (correct shape) and `stage_attachments` (typo'd shape) — the symmetry is what surfaces the bug.

---

## 2. Inventory summary

| Dimension | Result |
| --- | --- |
| Buckets in project | 2 — `stage_attachments`, `pipeline_files` |
| Public buckets | **0** (CLAUDE.md lock honored) |
| RLS-enabled on `storage.objects` | ✅ true |
| RLS-enabled on `storage.buckets` | ✅ true |
| Policies on `storage.objects` (Stages-defined) | 6 — 3 per bucket (SELECT, INSERT, DELETE) |
| App call sites — `.upload(` | 4 |
| App call sites — `.createSignedUrl(` | 1 (the `src/lib/file-signed-url.ts` helper, called from 3 consumers) |
| App call sites — `.getPublicUrl(` | **0** |
| App call sites — `.download(` | **0** |
| API routes touching storage | **0** |
| Critical findings (🚨) | 0 |
| Medium findings (⚠️) | 1 — `stage_attachments` policy join typo |
| Hygiene items | 3 — bucket size limits null, MIME allowlist null, 1 orphan object |

**Headline.** Zero exploitable storage findings. One latent functional bug (`stage_attachments_storage_select` + `_delete` join a column that resolves to the wrong table — silently masked because the feature has zero rows in production). Browser-only storage access model is clean — no service-role storage operations, no public URLs, no `.download` calls.

---

## 3. Bucket configuration

Both buckets confirmed via Query 1.

| Bucket | Public | Path convention | Size limit | MIME allowlist |
| --- | --- | --- | --- | --- |
| `stage_attachments` | ❌ private | `{pipeline_id}/{stage_id}/{attachment_id}.{ext}` | `null` (no limit) | `null` (any MIME) |
| `pipeline_files` | ❌ private | `{pipeline_id}/{filename_uuid}.{ext}` | `null` (no limit) | `null` (any MIME) |

**Naming-convention note.** CLAUDE.md → Security Model lists these buckets with hyphens (`stage-attachments`, `pipeline-files`); the actual live names use underscores. Documented in `docs/DATA-COLLECTION.md` § 1.5; not regenerated here. Worth a CLAUDE.md fix in a future docs sweep.

**Path convention for `pipeline_files`.** The live state (verified via Query 5 sample) shows paths like `{pipeline_id}/{filename_uuid}.{ext}` — a 2-level convention rather than the `{pipeline_id}/links/{link_id}.{ext}` 3-level convention CLAUDE.md describes. **Functional, but documentation drift worth noting.** The policy still works because it joins on the full path string (`storage_path = name`), not on `(storage.foldername(name))[2] = 'links'`. The migration `20260602120000_pipeline_links_storage_path_binding.sql` is where the actual convention was finalized — that's the truth.

---

## 4. Policy inventory + analysis

Six Stages-defined policies on `storage.objects`, three per bucket. All scoped by `bucket_id = '…'` in the predicate so the policies for one bucket never overreach into the other.

### 4.1 `pipeline_files` — all three correct ✅

**`pipeline_files_storage_select`** (USING) — agency members see all; clients see only when the metadata row's `client_visible = true`:

```sql
bucket_id = 'pipeline_files'
and exists (
  select 1
  from public.pipeline_links pl
  where pl.storage_path = name        -- ✅ unambiguous: storage.objects.name
    and (
      public.is_pipeline_agency_member(pl.pipeline_id)
      or (public.is_pipeline_client(pl.pipeline_id) and pl.client_visible = true)
    )
)
```

The bare `name` reference inside the EXISTS resolves to `storage.objects.name` because `public.pipeline_links` has no column called `name`. **Unambiguous and correct.**

**`pipeline_files_storage_insert`** (WITH CHECK) — extracts `pipeline_id` from the path and checks edit permission:

```sql
bucket_id = 'pipeline_files'
and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
```

WITH CHECK on INSERT (no separate USING needed — there's no pre-existing row). Path-element extraction is the documented pattern in CLAUDE.md.

**`pipeline_files_storage_delete`** (USING) — original adder OR agency editor:

```sql
bucket_id = 'pipeline_files'
and exists (
  select 1
  from public.pipeline_links pl
  where pl.storage_path = name        -- ✅ unambiguous
    and (
      pl.added_by = (select auth.uid())
      or public.can_edit_pipeline(pl.pipeline_id)
    )
)
```

Mirrors the SELECT policy's authorization fan-out + adds the uploader-self exception. **Correct.**

### 4.2 `stage_attachments` — typo on SELECT and DELETE ⚠️

INSERT is correct; SELECT and DELETE share the same join-column ambiguity bug.

**`stage_attachments_storage_insert`** (WITH CHECK) — correct, mirrors `pipeline_files_storage_insert`:

```sql
bucket_id = 'stage_attachments'
and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
```

**`stage_attachments_storage_select`** (USING) — **bug**:

```sql
bucket_id = 'stage_attachments'
and exists (
  select 1
  from public.stage_attachments sa
  join public.stages s on s.id = sa.stage_id
  where sa.storage_path = name        -- ⚠️ resolves to `s.name`, NOT storage.objects.name
    and (
      public.is_pipeline_agency_member(s.pipeline_id)
      or (
        public.is_pipeline_client(s.pipeline_id)
        and sa.client_visible = true
        and s.client_visible = true
      )
    )
)
```

`public.stages` has a column called `name` (the human-readable stage name, like `"Discovery"` or `"Design"`). The bare `name` reference inside the EXISTS resolves to the closest enclosing scope's column — which is `s.name` because the join brought `stages` into scope and `stage_attachments` has no `name` column. The query becomes:

```sql
where sa.storage_path = s.name  -- comparing a file path to a human-readable stage name
```

This will never match. The EXISTS subquery returns false for every object, the SELECT policy denies every read, and the feature is effectively broken from the storage layer's perspective.

**`stage_attachments_storage_delete`** (USING) — same bug at the same join site:

```sql
bucket_id = 'stage_attachments'
and exists (
  select 1
  from public.stage_attachments sa
  join public.stages s on s.id = sa.stage_id
  where sa.storage_path = name        -- ⚠️ same resolution bug
    and (
      sa.added_by = (select auth.uid())
      or public.can_edit_pipeline(s.pipeline_id)
    )
)
```

Identical typo. DELETE is denied the same way SELECT is.

### 4.3 Why this hasn't manifested as a user-facing incident

The `stage_attachments` feature is **not in use**:
- `public.stage_attachments` table: 0 rows in production.
- `storage.objects` bucket `stage_attachments`: 0 objects.

The feature path is wired up in the app (`TaskDetailPanel.tsx` line 1608 calls `.upload(...)`) — uploads would succeed because the INSERT policy is correct — but **no user has ever successfully uploaded an attachment in production**, so the broken SELECT/DELETE paths have never been exercised. The bug is latent: shipping it without fixing would mean the first agency user to upload a stage attachment loses access to their own file the moment the page reloads.

### 4.4 Severity: MEDIUM — functional bug, not an exploit

The typo makes the policy **more restrictive**, not less. Effects:
- ✅ No data exposed (no data exists; even if it did, the SELECT denial would hide it from everyone except service-role).
- ✅ No write surface opened (INSERT is correct; the bug is on read/delete).
- ❌ Feature is broken — first prod upload would be unreachable.

Not a security finding in the exploitable sense. Listed as ⚠️ MEDIUM because it's a real correctness bug that will surface the moment the feature is used, and the fix is a one-character edit.

### 4.5 Phase 3 fix shape (not implementing here)

Fully qualify the `name` reference inside both EXISTS subqueries. Two equivalent shapes:

**Option A — qualify `storage.objects.name`:**
```sql
where sa.storage_path = storage.objects.name
```

**Option B — alias the outer table.** Requires a different policy form (e.g. `for select to authenticated using (...)`) and doesn't gain anything over Option A for a one-character fix.

Recommend Option A — minimal diff, mirrors the `pipeline_files` pattern (which would also benefit from explicit qualification for code-review legibility, even though it currently works).

---

## 5. Application call sites

All four uploads + one signed-URL utility + three consumers. **Zero `getPublicUrl`, zero `.download`, zero API-route storage code.**

### 5.1 Uploads (4 sites, all browser-side)

| Site | Bucket | Notes |
| --- | --- | --- |
| `src/app/w/(canvas)/[slug]/p/[pipeline-id]/files/FilesBody.tsx:119` | `pipeline_files` | Agency canvas — Files & Links tab. Constructs `storagePath` client-side from `pipeline_id` + a filename UUID. |
| `src/components/portal/v2/PortalFilesBody.tsx:189` | `pipeline_files` | Client portal — Files tab. Same path pattern. |
| `src/components/portal/v2/PortalTaskAttachmentsSection.tsx:205` | `pipeline_files` | Client portal — task-detail attachments. |
| `src/components/canvas/TaskDetailPanel.tsx:1608` | `pipeline_files` | Agency canvas — task-detail attachments. |

All four use the user-scoped Supabase client (the browser singleton from `src/lib/supabase.ts`). RLS enforces:
- INSERT WITH CHECK requires `can_edit_pipeline(path-extracted pipeline_id)` — clients writing to `pipeline_files` pass via `can_edit_pipeline` only if they're agency-side of the pipeline. **Pure clients can write only via the task-attachments + portal-files surfaces, which write to `pipeline_files` with path `{pipeline_id}/...`** — they pass `can_edit_pipeline` only if they're a member with edit rights. **Worth Phase 2 testing: confirm a client writing to `pipeline_files` via the portal does NOT escape the membership check.** Most likely it works because clients aren't `can_edit_pipeline`-eligible, but worth a regression test.

**No call site uploads to `stage_attachments`.** Despite `TaskDetailPanel.tsx:1608` existing as a wired-up surface, the actual bucket all four sites target is `pipeline_files`. That matches the 0-rows / 0-objects observation in § 4.3 — `stage_attachments` is wired in the database but unused by the app.

### 5.2 Signed URL utility

`src/lib/file-signed-url.ts:69`:
```ts
.createSignedUrl(storagePath, expiresInSeconds, options);
```

Single utility, single signed-URL primitive. Three consumers:
- `src/components/files/FileCard.tsx:143` — thumbnail in file list
- `src/components/files/FilePreview.tsx:47` — full preview overlay
- `src/lib/file-signed-url.ts:120` — `downloadPipelineFile` helper (browser-side anchor click + `a.href = signedUrl`)

All three use the user-scoped browser Supabase client. `createSignedUrl` respects RLS — the policy decides whether the URL is mintable. So the SELECT policy is the actual gate for downloads, not the URL signature.

**Implication:** when the `stage_attachments` typo gets fixed (Phase 3), the signed-URL mint path will start working for that bucket the moment a row + object exist. No app code change needed to consume.

### 5.3 What's explicitly absent — the negative findings ✅

- `.getPublicUrl(` — **zero matches** in `src/`. CLAUDE.md lock honored. The Phase 2 harness should include a grep-based assertion that this stays zero.
- `.download(` — **zero matches**. All download flows go through signed URLs.
- Service-role storage access — **none**. `getSupabaseAdmin` is consumed in the 3 authorized sites documented in `src/lib/supabase-admin.ts` (webhook, seat-count, settings/privacy actions) — none touch storage.
- API routes touching storage — **none under `src/app/api/`**. Every storage operation runs from the browser under the user's JWT.

---

## 6. Findings summary

### 🚨 CRITICAL findings — **0**

No exploitable storage finding. Bucket privacy intact, no service-role bypass paths, no public URLs, no API-route storage access.

### ⚠️ MEDIUM findings — **1**

**M1.** `stage_attachments_storage_select` and `stage_attachments_storage_delete` policies use a bare `name` reference inside an EXISTS subquery that joins `public.stages`. PostgreSQL resolves `name` to `stages.name` (the stage's human-readable label) instead of the intended `storage.objects.name` (the file path). The join can never match. Feature is broken for any agency that uploads a stage attachment; SELECTs return zero rows, DELETEs no-op. Mirror policies on `pipeline_files` are correct (`pipeline_links` has no `name` column so the bare reference resolves correctly to `storage.objects.name`). **Not exploitable** — the typo restricts further than intended, never less. Phase 3 fix is a one-character edit to fully qualify the column reference (see § 4.5).

### Hygiene items

- **H1.** Both buckets have `file_size_limit = null` (no size cap). Pre-launch consideration — see WISHLIST follow-on.
- **H2.** Both buckets have `allowed_mime_types = null` (any MIME accepted). Pre-launch consideration — same WISHLIST entry.
- **H3.** `pipeline_files` bucket has 1 orphan object (path's `pipeline_id` doesn't match any live `pipelines` row) out of 22 total objects — 4.5% orphan rate. Already tracked by the existing "Storage janitor (orphan bytes from deleted pipelines)" WISHLIST entry; this audit documents the current count.

### ✅ HEALTHY findings

- Both buckets private; no `getPublicUrl` in source.
- RLS enabled on `storage.objects` and `storage.buckets`.
- All six Stages-defined policies properly scoped by `bucket_id = '…'`.
- INSERT WITH CHECK on both buckets uses path-extracted `pipeline_id` and the canonical `can_edit_pipeline` helper.
- `pipeline_files_storage_select` / `_delete` properly enforce client-visibility cascade.
- Browser-only storage access pattern across all four upload sites.
- Signed-URL primitive centralized in one utility (`src/lib/file-signed-url.ts`).

---

## 7. Phase 2 — automated test harness recommendations

The Slice S1 harness (`scripts/test-rls-phase3.mjs`, 7/7 PASS) is the natural extension point. Add a new sibling `scripts/test-storage-rls.mjs` (or extend the existing one — see open question Q1 below) covering:

### Tier 1 — critical regression (4 tests)

| # | Test | Maps to |
| --- | --- | --- |
| **S1.1** | **Signed-URL access control.** As Sarah (workspace member of pipeline A, not pipeline B), mint a signed URL for a `pipeline_files` object whose path-extracted `pipeline_id` is pipeline B. Assert the `createSignedUrl` call fails or returns an unfetchable URL. | CLAUDE.md → Storage Bucket Policies; § 4.1 |
| **S1.2** | **Client_visible enforcement on downloads.** As Activity-test (client of seeded pipeline), mint a signed URL for a `pipeline_links` row with `client_visible = false`. Assert denial. Then for a `client_visible = true` row, assert success. | § 4.1 — client-cascade branch |
| **S1.3** | **INSERT WITH CHECK on uploads.** As Activity-test (pure client per Slice S1 fixture), attempt `.upload(...)` to `pipeline_files` with a path whose `pipeline_id` is NOT a pipeline she has edit permission on. Assert RLS denial (path-extracted `pipeline_id` → `can_edit_pipeline` → false). | § 4 INSERT policies |
| **S1.4** | **Browser-only invariant.** Codebase-grep assertion run as part of the harness: count `getPublicUrl(` and `.download(` matches in `src/`. Both must be 0. **CI-friendly invariant** — alerts on any future regression of the locked browser-storage model. | § 5.3 |

### Tier 2 — defensive canaries (2 tests)

| # | Test | Maps to |
| --- | --- | --- |
| **S2.1** | **stage_attachments fix verification (post-Phase 3).** After the Phase 3 fix lands: seed a `stage_attachments` row + matching storage object as Jordan; sign in as Sarah (pipeline member); assert SELECT succeeds. Without the Phase 3 fix this test FAILS — proves the bug is real and the fix is necessary. | § 4.2 — Phase 3 anchor |
| **S2.2** | **Bucket privacy canary.** Standing invariant: every bucket where `public = true` is an incident. Implement via the existing `audit_grant_without_rls` style — a SECURITY DEFINER RPC `audit_public_buckets()` returning a row per public bucket. Harness asserts 0 rows. **Defensive against accidental dashboard misconfiguration.** | § 3 lock |

### Tier 3 deferred — orphan-cascade behavior

`stage_attachments` / `pipeline_links` rows DELETE leaves the storage binary in place (already documented WISHLIST item — the "Storage janitor" entry). Worth a baseline test once the janitor ships, not before. Defer.

### Architectural note

The new tests don't need a separate harness file unless we want a clean S1/S2 split. The Slice S1 harness already has the auth + fixture infrastructure; extending it is ~50 LoC. Either way, the signed-URL mint operations need the bucket to actually have objects in it — seed via service-role at start, clean up at end.

---

## 8. WISHLIST follow-ons to log post-review

Three entries to add when the doc is approved:

1. **Phase 3 fix for the `stage_attachments` policy typo.** One-character edit (qualify `name` → `storage.objects.name`) on `stage_attachments_storage_select` and `stage_attachments_storage_delete`. ~30 min including migration + verification + harness test (S2.1 above). Pre-launch.
2. **File size limits + MIME allowlist for both buckets.** Currently null on both — any file, any size. Likely sensible defaults: 50 MB limit, allowlist of `image/*` + `application/pdf` + maybe a few more. Founder decision. ~30 min.
3. **The existing "Storage janitor" WISHLIST entry** stays open. This audit documents the current orphan count (1 of 22 `pipeline_files` objects, 4.5%) — when the janitor ships, that's the baseline it cleans.

---

## 9. Open questions for founder review

1. **Phase 2 harness architecture.** Extend `scripts/test-rls-phase3.mjs` (existing 7/7 PASS) with the 6 new storage tests, OR ship a sibling `scripts/test-storage-rls.mjs`? Recommend extending — shared auth/fixture infrastructure, single sweep, one harness to invoke from CI. Cost difference: ~10 min more for the sibling file vs ~5 min more for the extension.
2. **File size + MIME allowlist defaults.** Per H1/H2 above. If you have specific numbers in mind, lock them and Phase 3 includes the bucket UPDATEs. Otherwise the WISHLIST entry can stay open until product-side has a position.
3. **`stage_attachments` feature scope going forward.** The feature is wired in app code (`TaskDetailPanel.tsx:1608`) but the production rows / objects are 0. Confirm we want to fix the policy and keep the feature versus deprecate it and rip the wiring. Recommend: fix the policy (~30 min, surgical), keep the feature — agencies will want stage-level attachments eventually.

---

## 10. Phase 3 fix-order recommendation (carry into Phase 3)

Single fix this slice. No sequencing complexity.

1. **§ 4.5 — stage_attachments policy join qualification.** DROP + CREATE both affected policies (SELECT and DELETE) with `sa.storage_path = storage.objects.name` instead of the bare `name`. Same migration; one commit.

Phase 2 harness test S2.1 explicitly proves the fix works (fails pre-Phase-3, passes post-Phase-3).

---

_Phase 1 inventory complete. WISHLIST follow-on entries to log on approval. Phase 2 harness + Phase 3 fix proceed on next-session signal._
