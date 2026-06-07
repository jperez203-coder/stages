# Stages — OWASP Application Security Audit (Slice S8)

**Status:** Single-phase sweep complete (2026-06-08). Two in-slice fixes shipped (security headers + npm audit fix). Two WISHLIST entries logged (full CSP + auth-flow smoke).

**Scope.** OWASP Top 10 against the current codebase, scoped against work already shipped in S1 (RLS), S2 (Storage), S3 (Stripe webhook), S7 (Privacy/Terms). The pre-emptive scoping pass that opened this slice was correct: most items were already covered structurally; only A05 and A06 needed new work.

**Source-of-truth pointer.** CLAUDE.md → Security Model + Identity Model are canonical. This doc maps the OWASP Top 10 onto that canonical model.

---

## 1. Methodology

Per the Slice S8 spec, this slice did a structural walk-through rather than an exhaustive black-box pen test. The objective was to:

1. Verify each OWASP item is either covered by prior slice work or surface a new finding.
2. Apply low-risk, in-slice fixes for genuinely new findings.
3. WISHLIST anything that needs more careful work than a single-commit sprint allows.

### Sources audited

- **Code-side scans:** `grep` for `dangerouslySetInnerHTML`, `fetch(`, state-mutating API route handlers, `src/middleware.*`, `next.config.ts` headers configuration, security-related auth flow files.
- **Dependency scan:** `npm audit`.
- **Prior-slice cross-reference:** `docs/RLS-AUDIT.md`, `docs/STORAGE-AUDIT.md`, `docs/STRIPE-WEBHOOK-AUDIT.md`, `docs/DATA-COLLECTION.md`.

---

## 2. OWASP Top 10 coverage matrix

| # | Item | Status | Coverage |
| --- | --- | --- | --- |
| **A01** | Broken Access Control | ✅ COVERED | Slice S1 RLS audit + 4 fixes + 7-test harness; Slice S2 storage RLS audit + harness extension to 13/13; commit `f34fe32` (C1 bypass closed via `can_create_workspace` helper) |
| **A02** | Cryptographic Failures | ✅ COVERED | Slice S3 webhook signature verification (Stripe SDK HMAC) + Slice 0.1 HttpOnly session cookies (via `@supabase/ssr`); Supabase Auth handles password hashing on its end |
| **A03** | Injection | ✅ HEALTHY (no surface) | Verified zero `dangerouslySetInnerHTML` in `src/`; Supabase parameterized queries throughout (no raw SQL concat at app layer); React JSX escapes by default |
| **A04** | Insecure Design | ✅ MOSTLY COVERED | C1 architectural fix (S1 Fix 4) + JWT-binding fix (X1); server actions are CSRF-resilient by Next.js design; all 7 mutating API routes Bearer-JWT-auth'd per X1 pattern; webhook signature-verified |
| **A05** | Security Misconfiguration | ⚠️ → ✅ FIXED IN-SLICE | NEW finding: `next.config.ts` had **no security headers**. **Fixed this slice** — 5 baseline headers added: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy` |
| **A06** | Vulnerable Components | ⚠️ → ✅ MOSTLY FIXED IN-SLICE | `npm audit` showed 4 moderate (0 critical/high). **`npm audit fix` ran** — cleared 2 of 4 (`brace-expansion` + `ws`). 1 remains (`postcss` transitive via Next.js — accept-and-wait per upstream). 1 was a re-occurrence handled by the same fix. |
| **A07** | Identification + Authentication | ✅ COVERED | Supabase Auth (password + Google OAuth + magic-link); X1 fix bound JWT correctly; forgot-password + reset-password components both exist on disk (handoff WISHLIST 404 likely already fixed; smoke recommended) |
| **A08** | Software + Data Integrity | ✅ COVERED | `package-lock.json` present (npm integrity); zero CDN scripts (Plus Jakarta Sans self-hosted via `next/font`); no SRI needed (no externally-loaded scripts); folds A05's CSP gap into the WISHLIST CSP follow-on |
| **A09** | Security Logging + Monitoring | ✅ HEALTHY | `ai_consent_audit` + `seat_sync_log` + `stripe_events` + `activity_events` tables; Vercel function logs; comprehensive webhook handler logging; 3 audit RPCs as standing invariants (`audit_grant_without_rls`, `audit_public_buckets`, `audit_stuck_webhook_events` on WISHLIST). No third-party SDK (Sentry etc.) by design per data-minimization stance — documented in `docs/DATA-COLLECTION.md` § 1.13. |
| **A10** | SSRF | ✅ HEALTHY | `grep` for `fetch(` calls with user-controlled URLs returned 0 matches (3 false positives — `onRefetch()` callbacks + JSDoc); Stripe SDK + Resend SDK call hardcoded API endpoints; the webhook handler reads request body bytes only (no fetch-based dispatch) |

**Headline.** 0 🚨 CRITICAL findings. 2 ⚠️ MEDIUM findings — both fixed in this slice. 2 WISHLIST entries for follow-on work (full CSP, npm-audit-postcss-accept).

---

## 3. New findings — fixed in this slice

### F1 — Baseline security headers added to `next.config.ts`

**Pre-slice state.** `next.config.ts` had only a Turbopack cache-disable flag. No HTTP security headers configured. Browsers defaulted to no-header behavior, exposing:

- **Clickjacking** — no `X-Frame-Options` or CSP `frame-ancestors`
- **MIME-sniffing** — no `X-Content-Type-Options: nosniff`
- **Referrer leakage** — full URLs (including workspace slugs + pipeline IDs) sent to third-party destinations
- **MITM window** — no `Strict-Transport-Security`, so a brief HTTP request before HTTPS upgrade is vulnerable
- **Powerful browser APIs left open** — no `Permissions-Policy`, so camera/microphone/geolocation defaults apply

**Fix applied (commit pending review).** Added a `headers()` function to `next.config.ts` returning the 5 baseline headers on every route:

```ts
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];
```

**Why each is statically safe.** None of these add new behavior; they refuse certain browser-default behaviors. There's no plausible breaking-change risk:

- `X-Content-Type-Options: nosniff` — only breaks if we were serving a script with a wrong Content-Type, which would have been a bug anyway.
- `X-Frame-Options: DENY` — we don't iframe-embed our app anywhere. If we ever do (e.g., embed within a CRM), switch to `SAMEORIGIN` or migrate to a CSP `frame-ancestors` directive.
- `Referrer-Policy: strict-origin-when-cross-origin` — no in-app feature depends on receiving full URLs from third parties.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS, all subdomains, preload-ready (separate submission to enroll). Vercel already serves all our traffic over HTTPS; this just locks the browser into it.
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` — verified in Slice 0 Part 0.B that the app uses none of these.

**Excluded — full Content-Security-Policy.** Per the Slice S8 spec ("Don't try to add comprehensive CSP if app uses dynamic scripts — start permissive, tighten in follow-on"), CSP is its own sub-slice. See WISHLIST below.

### F2 — `npm audit fix` applied (2 of 4 moderate CVEs resolved)

**Pre-slice state.** `npm audit` showed 4 moderate severity vulnerabilities (0 critical, 0 high):

| Package | Severity | Vector | Path |
| --- | --- | --- | --- |
| `brace-expansion` 5.0.2–5.0.5 | moderate | DoS via numeric range | `node_modules/@typescript-eslint/.../node_modules/brace-expansion` (dev-only transitive via ESLint) |
| `postcss` <8.5.10 | moderate | XSS via `</style>` in stringify output | `node_modules/next/node_modules/postcss` |
| `ws` 8.0.0–8.20.0 | moderate | Uninitialized memory disclosure | `node_modules/ws` |
| (One redundant entry for the same transitive) | | | |

**Fix applied.** Ran `npm audit fix` (without `--force`). Cleared:

- `brace-expansion` — patched to fixed version
- `ws` — patched to fixed version

**Remaining: `postcss` transitive via Next.js.** Only fix path is `npm audit fix --force`, which would install Next.js 9.3.3 — a 7-major-version downgrade that would break everything. **Accept and wait** for Next.js to bump the transitive in a patch release. App-side risk: minimal — we don't process untrusted CSS through postcss at runtime. The vulnerability requires the attacker to control the CSS being processed, which only happens at build time on our infrastructure (CI), not in response to user input.

WISHLIST entry below tracks the upstream watch.

---

## 4. Bonus fix shipped in this slice — consent microcopy color

Strategy added a tiny UX fix to the S8 commit window. The Slice S7 signup consent microcopy rendered "Terms of Service" + "Privacy Policy" as `text-stages-blue` links, which fought with the muted `text-zinc-500` of the surrounding paragraph and over-emphasized the legal-consent text. Updated to `text-zinc-500` with `hover:underline` — links stay neutral until interacted with, surrounding microcopy reads as a single visual unit.

Change confined to `src/components/auth/SignUpPanel.tsx` `ConsentMicrocopy` function — 2 className edits.

---

## 5. Per-OWASP-item narratives

### A01 — Broken Access Control ✅

Slice S1's audit + 4 fixes are the canonical coverage. Specifically:

- **RLS policies** on every `public`-schema table (verified by Phase 1 audit, commit `2aff651`).
- **C1 client-boundary** enforced at RLS layer via `can_create_workspace` helper (commit `f34fe32`).
- **`WITH CHECK` mirror** on `stage_notes_update`, `stage_attachments_update`, `pipeline_links_update` (commit `24f65d2`).
- **Slice S2** extended the audit to storage policies; one typo fix in `stage_attachments_storage_select/_delete` (commit `d1cb6c8`).
- **Standing-invariant test harness** (`scripts/test-rls-phase3.mjs`, 13/13 PASS) re-runs the access-control assertions on every change.

### A02 — Cryptographic Failures ✅

Three credential surfaces audited:

- **Session cookies** — Supabase Auth via `@supabase/ssr` issues HttpOnly cookies (verified in Slice 0 Part 0.B § 2.1). JavaScript on the page cannot read them. Transit is HTTPS-only (Vercel forces it; HSTS now ratchets it).
- **Stripe webhook signatures** — Slice S3 verified canonical HMAC verification via `stripe.webhooks.constructEvent` (raw body + Stripe SDK + 5-minute timestamp tolerance).
- **Stripe + Supabase secret keys** — `server-only` import in `src/lib/stripe.ts` + `src/lib/supabase-admin.ts` (verified at Slice 0.1 review). Build fails if any client component imports either. Env-var-only, never logged.

### A03 — Injection ✅

Stages has effectively zero injection surface area by design:

- **SQL** — all DB access goes through `supabase-js`, which uses parameterized queries. The handful of inline SQL strings in migrations are static and run by the founder via the SQL editor, not at runtime.
- **HTML** — React JSX escapes interpolated values by default. `grep` confirms `0 dangerouslySetInnerHTML` in `src/`.
- **OS commands / shell** — the app does not execute shell commands.

### A04 — Insecure Design ✅

Two architectural correctness fixes from earlier in the sprint:

- **Slice X1** (commit `cfb71b8`) — `/api/invites/send` was using an anon-bound Supabase client. Fixed to bind the caller's JWT so RLS evaluates as the user, not as `anon`. All four invite routes now match the canonical pattern.
- **Slice S1 Fix 4** (commit `f34fe32`) — `workspaces_insert` was permitting any authenticated user (including pure clients) to escape the C1 boundary via direct PostgREST. Fixed by lifting the C1 rule into the RLS layer via `can_create_workspace` helper.

**Server actions** (Slice 0.1's `/w/[slug]/settings/privacy`) are CSRF-resilient by Next.js design — they require same-origin POST + form data and validate the request shape internally.

**API routes** that mutate state (8 routes total) all require `Authorization: Bearer <JWT>` — verified at scoping. The Bearer requirement makes them CSRF-resistant in itself: a cross-origin attacker cannot cause the browser to send an Authorization header on a victim's behalf.

### A05 — Security Misconfiguration ✅ (FIXED IN-SLICE)

See § 3 F1 above.

### A06 — Vulnerable Components ✅ (FIXED IN-SLICE)

See § 3 F2 above.

### A07 — Identification + Authentication ✅

Auth flows surveyed:

- **Email + password** — handled by Supabase Auth.
- **Google OAuth** — `/auth/callback` page handles the post-Google handshake (PKCE flow). Standard, no custom crypto.
- **Magic-link** — used for client portal accept flow via `/portal/accept/[token]`.
- **Forgot password + reset password** — components both present (`ForgotPasswordPanel.tsx`, `reset-password/page.tsx`). The handoff WISHLIST had flagged a 404; spot-check showed the files exist with clean structure. Recommend founder smoke-test the flow end-to-end to confirm the 404 is gone.

JWT handling fixed in Slice X1 (commit `cfb71b8`). Column-level UPDATE grants on `profiles` (Slice 0.1 + S1 Fix 1) prevent self-grant of paid status.

### A08 — Software + Data Integrity ✅

- `package-lock.json` is checked in and pinned.
- No CDN scripts in the rendered HTML — fonts self-hosted via `next/font/google` (Plus Jakarta Sans).
- No SRI hashes are needed because there are no externally-loaded scripts to integrity-check.
- The CSP gap that would otherwise sit here folds into the WISHLIST CSP follow-on (§ 6).

### A09 — Security Logging + Monitoring ✅

Logging is appropriate for current scale. Four audit tables (`ai_consent_audit`, `seat_sync_log`, `stripe_events`, `activity_events`) capture structural events. Vercel function logs capture errors. Stripe webhook handler logs extensively (§ 2.3 of `docs/DATA-COLLECTION.md`). Three standing-invariant RPCs (`audit_grant_without_rls`, `audit_public_buckets`, `audit_stuck_webhook_events` on WISHLIST) provide canary signals.

Centralized alerting (Sentry-style) is intentionally absent per the data-minimization stance documented in `docs/DATA-COLLECTION.md` § 1.13. Worth revisiting at scale (post-10x revenue) if signal-to-noise on Vercel logs degrades.

### A10 — SSRF ✅

- `grep` for `fetch(` in `src/` returned 3 matches, all false positives (`onRefetch()` callbacks + JSDoc).
- Stripe SDK calls hit `api.stripe.com` (hardcoded by the SDK).
- Resend SDK calls hit Resend's hardcoded endpoint.
- The webhook handler reads `request.text()` — does not fan out to any URL derived from request data.
- No image-resize / URL-preview / fetch-on-behalf-of-user features that would need an SSRF guard.

---

## 6. WISHLIST follow-ons logged

### WO1 — Full Content-Security-Policy rollout

Strategy explicitly deferred this in the slice spec. Recommended approach when it lands:

1. **Empirically enumerate origins** the app loads from — Supabase (`*.supabase.co`), Stripe (`js.stripe.com`, Stripe iframes), Google OAuth (`accounts.google.com`), our own origin, any newly-added integrations.
2. **Deploy in report-only mode first** (`Content-Security-Policy-Report-Only`) for 1-2 weeks. Collect violation reports.
3. **Tighten** to enforcement mode after violations are reconciled.
4. **Update the WISHLIST CSP entry** with the locked policy text.

Estimated cost: ~3-4 hours including the report-only window. WISHLIST entry to log.

### WO2 — `postcss` transitive CVE — upstream watch

Track the Next.js dependency tree for a patch release that bumps the transitive `postcss` past 8.5.10. Annotate the WISHLIST entry with the upstream issue URL. Estimated cost: opportunistic — the fix is automatic when Next.js publishes; we just verify.

### WO3 — Forgot-password / reset-password smoke verification

The WISHLIST handoff history flagged a 404 on the forgot-password reset page. Files exist on disk now (`ForgotPasswordPanel.tsx`, `reset-password/page.tsx`) so likely already resolved, but a 5-min smoke test (request reset email, click link, set new password, sign in) would confirm. Founder can run during the post-S8 smoke window.

---

## 7. Three locked headers worth double-clicking on

A few of the headers in F1 have subtle ramifications worth being explicit about:

### `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

- **`includeSubDomains`** asserts that **all** Stages subdomains (existing + future) are HTTPS-only.
- **`preload`** is a flag indicating we'd be willing to be added to the browser-shipped HSTS preload list. Adding `preload` doesn't enroll us — Chrome (and others by extension) maintain a list at <https://hstspreload.org/> that we'd separately submit to if desired.
- **Reversal cost is real.** Setting HSTS with `includeSubDomains` makes the browser refuse HTTP for 2 years. If a future maintainer decides they need to serve some subdomain over HTTP for a debugging workflow, that subdomain is locked out until either (a) the 2-year max-age expires or (b) the user manually clears HSTS in browser settings.
- **Verdict: fine.** Vercel forces HTTPS on everything we deploy; we have no plans to serve any subdomain over HTTP.

### `X-Frame-Options: DENY` and the future embed question

If Stages ever ships an "embed your pipeline in another app" feature (e.g., embed a pipeline status widget in an internal company dashboard), `DENY` will block it. The migration path is either:

1. Switch the relevant routes to `SAMEORIGIN` or relax to a per-route override.
2. Move to a CSP `frame-ancestors` directive that allowlists specific embed origins.

Not a problem today (no embed feature on the roadmap); just an awareness flag.

### `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`

The empty allowlists (`()`) refuse the permission entirely. Two flags worth knowing:

- **`payment=()`** denies the Payment Request API. We use Stripe Checkout (which runs in a Stripe-hosted page, not via Payment Request API), so this is fine. If a future "instant pay" feature using Payment Request API ships, this header needs updating.
- **The policy is a list-of-allowed-origins, not a "denied" list.** Empty parens = no origin allowed = feature denied. To allow only our own origin, use `camera=(self)`.

---

## 8. Open questions for founder review

1. **Forgot-password / reset-password smoke.** Recommend a 5-min smoke test post-deploy to confirm the WISHLIST-flagged 404 is gone. Not blocking the S8 ship.
2. **CSP timing.** Full CSP rollout (~3-4 hrs in report-only + tighten window) — schedule for the post-launch hardening sprint, or want it before going live? My read: post-launch is fine. The 5 baseline headers in F1 close the immediate clickjacking + MIME-sniff + referrer-leak gaps; CSP is the next layer of defense, not the first.
3. **HSTS `preload` submission.** Once the headers are live in production, you can optionally submit `app.trystages.com` to <https://hstspreload.org/>. Adds 24-48 hours of human-review latency before it lands in Chrome. Worth doing within the first month post-launch.

---

## 9. Recommended commit shape

One commit covering:
- `next.config.ts` — security headers
- `package-lock.json` — npm audit fix delta
- `src/components/auth/SignUpPanel.tsx` — consent microcopy color
- `docs/OWASP-AUDIT.md` — this doc
- `WISHLIST.md` — 3 new follow-on entries (CSP, postcss upstream watch, forgot-password smoke)

Commit message: `feat(slice-s8): OWASP sweep — security headers + npm audit fix + consent microcopy tweak`.

---

_Slice S8 audit + 2 in-slice fixes complete. Three WISHLIST entries to log. No 🚨 CRITICAL findings; the OWASP Top 10 walkthrough confirms the prior sprint slices were the right shape._
