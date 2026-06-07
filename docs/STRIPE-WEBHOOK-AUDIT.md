# Stages — Stripe Webhook Security Audit (Slice S3)

**Status:** Single-phase audit complete (2026-06-07). One ⚠️ MEDIUM finding identified; all other dimensions HEALTHY. No 🚨 CRITICAL findings.

**Scope.** `src/app/api/billing/webhook/route.ts` (454 lines, main handler) + `src/lib/stripe.ts` (99 lines, SDK helper) + `public.stripe_events` table state. The 6 audit dimensions per the Slice S3 spec: signature verification, idempotency, replay protection, error handling + retry semantics, secret handling, security-adjacent.

**Source-of-truth pointer.** CLAUDE.md → Security Model is canonical. Anything in this document that contradicts it is a bug in this document.

---

## 1. Methodology

The S3 scope is meaningfully smaller than S1 (RLS audit) or S2 (storage): a webhook is a single endpoint with one external counterparty (Stripe). The architecture is already constrained — signature verification is the only authentication gate, the dedup table is the only race-safety mechanism, and Stripe's retry policy is the only failure-recovery channel. So the audit is more "verify each constraint is correctly enforced" than "discover unknowns."

### Sources audited

- **Code, line-by-line:**
  - `src/app/api/billing/webhook/route.ts` (454 lines)
  - `src/lib/stripe.ts` (99 lines)
- **Schema context:** `supabase/migrations/20260619120000_stripe_events_dedup.sql` for `stripe_events` table shape.
- **DB state**, 5 SQL queries (results pasted back at scoping):
  - Q1: 44 events total, 100 % `processed_successfully = true`, 0 stuck, history Jun 4–6.
  - Q2: 17 event types received; all 100 % ok rate. Handler logs broadly + acts on 5 per CLAUDE.md (correct audit-trail behavior).
  - Q3: 0 stuck events older than 1 hour.
  - Q4a: PRIMARY KEY on `event_id` — race-safe foundation.
  - Q4b: Two indexes — `stripe_events_pkey` (unique btree on `event_id`) + `stripe_events_unprocessed_idx` (partial btree on `received_at DESC` WHERE `NOT processed_successfully`).
  - Q5: 0 duplicate `event_id` values (PK working as designed).

### What's out of scope tonight

- Stripe dashboard configuration (founder-side; covered by the founder checklist in Part 0.C § 3.9).
- Vercel edge configuration (rate limiting, IP allowlisting).
- Live-mode flip mechanics (separate pre-launch procedure).

---

## 2. Handler inventory

### File layout

```
src/app/api/billing/webhook/
└── route.ts        (454 lines — POST handler + 5 event-type handlers + extractors)

src/lib/
└── stripe.ts       (99 lines — lazy Stripe client + status-enum mirror)
```

### Framework + runtime config

- **Next.js App Router route handler.** `POST(request: Request)` exported from `route.ts`.
- **`runtime = "nodejs"`** explicit (line 56). Required — Stripe's signature verification uses Node `crypto` module; would silently break on edge runtime.
- **`dynamic = "force-dynamic"`** explicit (line 60). Disables Next caching. Belt-and-suspenders — App Router route handlers are dynamic by default, but explicit > implicit for security-sensitive code.

### Authorized caller of the service-role admin client

Per `src/lib/supabase-admin.ts` header (updated in Slice 0.1), this route is the canonical authorized caller of `getSupabaseAdmin()`. Service-role writes are scoped to:

- `stripe_events` (claim-stake INSERT + post-handler `processed_successfully` flip)
- `user_billing` (UPSERT on checkout)
- `workspace_billing` (UPSERT on checkout, UPDATE on subscription changes)

No service-role reads outside these tables.

### Events explicitly handled

5 types per CLAUDE.md Slice 2 spec:

| Event | Handler | Effect |
| --- | --- | --- |
| `checkout.session.completed` | `handleCheckoutSessionCompleted` | UPSERT user_billing + workspace_billing |
| `customer.subscription.updated` | `handleSubscriptionUpdated` | UPDATE workspace_billing status / trial_ends / period_end |
| `customer.subscription.deleted` | `handleSubscriptionDeleted` | UPDATE workspace_billing status = 'canceled' |
| `invoice.payment_succeeded` | `handleInvoicePaymentSucceeded` | UPDATE workspace_billing period_end + status |
| `invoice.payment_failed` | `handleInvoicePaymentFailed` | UPDATE workspace_billing status = 'past_due' |

Default branch (lines 413–426): unhandled event types are **ack'd with 200 + marked `processed_successfully = true`** so Stripe stops retrying. Smart — prevents 500-loop on any newly-subscribed Stripe dashboard event whose handler hasn't shipped yet.

---

## 3. Signature verification analysis

### What the code does

- **Raw body via `request.text()` (line 332)** — NOT `request.json()`. Stripe's HMAC is computed over the exact bytes of the request body; round-tripping through `JSON.parse → JSON.stringify` would re-serialize with potentially-different whitespace and break byte-equality. Inline comments at lines 53–55 and 329–331 document this explicitly. ✅
- **Stripe SDK `stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` (line 341).** The canonical method — handles HMAC verification, timestamp validation, and structured-error throwing in one call. No hand-rolled crypto. ✅
- **Order of operations:** signature check happens BEFORE any DB write or business logic. The dedup INSERT (line 353) is the first DB touch and comes only AFTER `constructEvent` returns a parsed event. ✅
- **Response code on signature failure: 400** (line 348). **Not 5xx.** Critical — a 5xx response triggers Stripe retry. Returning 400 tells Stripe "this delivery is malformed, don't bother retrying," which is the correct posture both for legitimate misconfiguration and for thwarting attacker-spoofed deliveries. ✅
- **Missing `STRIPE_WEBHOOK_SECRET` returns 500** with an explicit `[webhook] STRIPE_WEBHOOK_SECRET not set — refusing to process events` log (lines 318–326). Triggers Stripe retry. Rationale: this state is a config error during a deploy rollout where retries naturally catch up once the env var lands. Acceptable. ✅
- **Missing `stripe-signature` header returns 400** (line 334–335). Same correct posture as signature-mismatch. ✅

### What the code does NOT do

- Hand-roll the signature verification. ✅
- Trust a parsed `body.type` or other fields before signature verification. ✅
- Log the webhook secret value. ✅ Lines 320–321 log the variable name only.

### Replay-protection sub-finding (covered in § 5)

`constructEvent`'s default tolerance is **300 seconds (5 minutes)** per the Stripe SDK source. The code passes only 3 arguments (rawBody, sig, secret), so the default is used — see § 5 for the full analysis.

### Severity: ✅ HEALTHY

Signature verification is implemented to spec. The four guardrails (raw body, SDK method, pre-business-logic ordering, 400-not-500 on failure) are all in place and documented inline.

---

## 4. Idempotency mechanism analysis

### The dedup flow (lines 351–393)

```
1. UPSERT stripe_events { event_id, event_type, payload } with
   onConflict='event_id', ignoreDuplicates=true.
2. .select() returns:
     - 1 row    → fresh INSERT (event has never been seen)
     - 0 rows   → already-existed (re-delivery from Stripe)
3. If fresh: run handler → mark processed_successfully=true → 200.
4. If re-delivery: SELECT processed_successfully from existing row:
     - true   → return 200 { dedup: 'already_processed' }
     - false  → re-run handler (Stripe is retrying a prior failure)
```

### What's right

- **Claim-stake pattern.** The row is INSERTed BEFORE the handler runs. If the handler crashes, the row exists for support investigation; the partial index `stripe_events_unprocessed_idx` makes the "find failed events" support query cheap as the table grows. ✅
- **DB-side foundation.** `event_id` is the PK (Q4a confirmed). Two simultaneous deliveries of the same event collide at the DB level — one INSERT wins, the other returns empty via `ignoreDuplicates`. ✅
- **`processed_successfully` flag separate from dedup row presence.** This is the architectural decision that lets the dedup table answer "have we successfully processed this event?" rather than just "have we seen it?" — supports retry of failed handlers without resending Stripe events. ✅ Documented at lines 36–42.
- **Non-idempotent handler future-proofing** (lines 36–42). Comment explicitly states: even if a future handler is non-idempotent, the dedup table makes it naturally idempotent because we only run the handler if `processed_successfully=false`. ✅

### Where there's a subtle race (⚠️ MEDIUM)

**Race scenario:** Two simultaneous webhook deliveries for the same `event_id` (e.g. Stripe re-sends while the first delivery is still mid-flight):

```
T=0   Delivery A arrives. INSERT stripe_events { event_id, processed_successfully=false }. Handler starts running.
T=1   Delivery B arrives. INSERT collides — returns empty. SELECT processed_successfully → false.
T=2   Delivery B falls through (line 391–393) and starts running the handler AGAIN, simultaneously with A.
T=3   A finishes, marks processed_successfully=true.
T=4   B finishes, marks processed_successfully=true (no-op).
```

**Net effect today:** harmless. All current handlers write via UPSERT or UPDATE, both of which are idempotent. Two simultaneous handler runs against the same event produce the same end state.

**Risk for future handlers:** if a future handler does **non-idempotent** work (sends an email, posts to a third-party API, increments a counter), it could fire twice. The dedup-row comment block (lines 36–42) explicitly future-proofs this — but the comment relies on the assumption that the handler is **only called once**, which the current code does not guarantee under simultaneous delivery.

**Why it's MEDIUM, not CRITICAL:**

- Not exploitable. An attacker can't trigger this — only Stripe can re-deliver the same `event_id`.
- Stripe re-delivers happen in practice but are rare (network blip during ack, etc.). Real-world incidence is low.
- Current handlers are idempotent; net effect is zero.

**The fix (deferred to WISHLIST):**

Convert the dedup pattern to a **claim-stake-with-status**: `INSERT … ON CONFLICT (event_id) DO UPDATE SET processed_successfully = false RETURNING (xmax = 0) as fresh`. The `xmax = 0` trick distinguishes a fresh INSERT from an UPDATE-of-existing-row. Combined with `SELECT FOR UPDATE` of the existing row before the handler runs, two simultaneous deliveries serialize on the row lock — one runs the handler, the other waits for the first to commit (or fail), then re-evaluates `processed_successfully`. Clean. ~30 min for the migration + handler code change + harness test.

### Severity: ⚠️ MEDIUM (concurrent-delivery race, currently masked by handler idempotence)

WISHLIST entry to log. Not blocking for live-mode flip because no current handler relies on single-fire semantics, but worth fixing before any non-idempotent handler ships (e.g. a future "send a welcome email on first checkout" handler).

---

## 5. Replay protection analysis

### What the code does

`stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)` is called with **3 arguments**. The SDK signature is `constructEvent(payload, header, secret, tolerance?)` — `tolerance` defaults to **300 seconds (5 minutes)**.

Inside `constructEvent`:
1. Parse the `Stripe-Signature` header into a timestamp + signature components.
2. Compute the expected HMAC over `${timestamp}.${rawBody}` using the secret.
3. Constant-time compare against the signature.
4. Check `(now - timestamp)` ≤ tolerance. If exceeded, throw `"Timestamp outside the tolerance zone"`.

### Two-layer replay protection

| Layer | Mechanism | Window |
| --- | --- | --- |
| Layer 1 — Stripe SDK | Timestamp tolerance check | 5 minutes (default) |
| Layer 2 — Stages `stripe_events` dedup | `event_id` PK | Forever (any prior event short-circuits) |

**An attacker who captures a webhook payload + signature** would need to:

- Replay within 5 minutes (Layer 1 catches anything older).
- Replay the EXACT bytes (Stripe-Signature encodes the timestamp; altering the payload invalidates the HMAC).
- Get past the dedup table (Layer 2 short-circuits any event_id we've seen before).

The combination is strong. Layer 1 is the proximate defense; Layer 2 is the permanent record.

### Sub-question: should we lower the tolerance?

Stripe's default 5 minutes accommodates clock skew between Stripe's edge and our server. Lowering it (to e.g. 60 seconds) would tighten the replay window at the cost of false rejections during clock-skew events or rare slow deliveries. Not recommended. The 5-minute default is industry-standard.

### Severity: ✅ HEALTHY

Two independent layers, both at canonical-spec strength. No action.

---

## 6. Error handling + retry semantics analysis

### Failure paths and response codes

| Failure point | Response | Stripe behavior |
| --- | --- | --- |
| `STRIPE_WEBHOOK_SECRET` not set | 500 | Retries (3-day window). Recovery path for config-rollout race. |
| Missing `stripe-signature` header | 400 | Does not retry. Permanent failure. |
| Signature verification fails | 400 | Does not retry. Permanent failure. |
| `stripe_events` UPSERT errors (DB issue) | 500 | Retries. Recovers when DB recovers. |
| `stripe_events` SELECT (read-back of dedup row) errors | 500 | Retries. |
| Handler throws (lines 428–437) | 500 | Retries. `processed_successfully` stays false. Next retry sees this and re-runs the handler. |
| Post-handler mark-processed UPDATE fails | 200 | Does NOT retry. Work is already done; the audit-flag failure is logged and tolerated (see § 6.2 below). |
| Success | 200 | Does not retry. |

The mapping is consistent: 5xx for transient/recoverable failures (Stripe retries), 4xx for malformed/auth failures (Stripe stops), 200 for success.

### The post-handler-flip → 200 trade-off (hygiene)

Lines 440–451 — if the post-handler `UPDATE processed_successfully=true` fails, the route returns 200 with an `[webhook] failed to mark processed_successfully` log. Rationale documented inline: "The work is already done; the audit flag failing to flip is a minor data-integrity issue, not a Stripe-retry trigger."

**Implication:** if Stripe later re-delivers for an unrelated reason (network blip causing ack-not-received), the next delivery sees `processed_successfully = false` → re-runs the handler. For current handlers (all idempotent), this is harmless. For a future non-idempotent handler, this is the same future-risk surfaced in § 4.

The MEDIUM finding in § 4 covers both this and the simultaneous-delivery race under one umbrella; the fix (claim-stake-with-status pattern) addresses both.

### Severity: ✅ HEALTHY (with the § 4 MEDIUM caveat)

The error-handling structure is correct. The retry behavior is well-aligned with Stripe's contract. The single MEDIUM is in § 4.

---

## 7. Secret handling analysis

### What's verified

- **`STRIPE_WEBHOOK_SECRET`** read from `process.env` at line 318. Never logged at any code path — confirmed by grepping for the variable name across the file. ✅
- **`STRIPE_SECRET_KEY`** in `src/lib/stripe.ts:40`. Same pattern — env-only, never logged. ✅
- **Signature-verification failure log (line 344–347)** logs the SDK's error message but not the secret. The Stripe SDK's error message itself contains no secret. ✅
- **`getStripe()` validates prefix** (`sk_test_` / `sk_live_`) at construction time — catches accidental swap with the publishable key. ✅
- **`server-only` import on `src/lib/stripe.ts:1`** — Next.js fails the build if any module importing this file is bundled into a client component. Prevents secret leakage to the browser bundle. ✅

### Test vs live separation

Handled at the **environment-variable layer**, not in code. Vercel project should have separate `STRIPE_WEBHOOK_SECRET` values for Test (test-mode webhooks from Stripe test dashboard) and Live (live-mode webhooks from Stripe live dashboard). **[FOUNDER VERIFY]** Open Vercel Dashboard → Project Settings → Environment Variables → confirm `STRIPE_WEBHOOK_SECRET` is set for both Production and Preview environments with the right value per environment.

### Rotation

The webhook secret can be rotated in the Stripe dashboard at any time. Procedure:
1. Generate new signing secret in Stripe Dashboard → Developers → Webhooks → Endpoint → Signing secret → "Reveal" → "Roll secret."
2. Update `STRIPE_WEBHOOK_SECRET` in Vercel (both Production and Preview).
3. Wait for Vercel deploy.
4. Stripe stops sending the old signature within minutes.

No code change required for rotation. ✅

### Severity: ✅ HEALTHY

Secret handling is at spec. Only [FOUNDER VERIFY] item is the Vercel env-var configuration.

---

## 8. Security-adjacent findings

### No app-level rate limiting

The webhook endpoint has no app-level rate limiter. An attacker could spam the endpoint with random POSTs; each one consumes minimal resources (raw body read + signature check fail + 400 response). No DB write, no handler execution.

**Mitigation today:**
- Vercel's edge layer provides baseline DDoS protection.
- Stripe sends from a finite, well-known IP range — could be combined with an IP allowlist at the Vercel edge if desired.
- Each spoofed request costs O(milliseconds) of CPU (Stripe SDK signature verification is cheap).

**Severity: hygiene.** Not pre-launch blocking. A future hardening pass could add Vercel edge rate limiting or IP allowlisting based on Stripe's published ranges.

### Unhandled event type silent ack

Lines 413–426 — any Stripe event type we haven't subscribed to (or have but haven't handler-coded) is acknowledged with 200 + marked `processed_successfully = true`. The full event payload IS still stored in `stripe_events.payload` for forensic recovery.

**Why this is correct:**
- An attacker doesn't control Stripe's outbound event types — they can only spoof events, and spoofed events fail signature verification long before reaching the handler.
- A real Stripe event we don't handle yet shouldn't loop-retry forever (that would happen if we returned 500). The dedup-and-ack pattern is the right behavior.
- The payload IS preserved, so if we later add a handler for that type we can backfill from `stripe_events` history.

**Severity: ✅ HEALTHY** — by design.

### Response info leakage

Audit of every NextResponse.json call:

| Line | Body | Leak? |
| --- | --- | --- |
| 323 | `{ error: "Webhook not configured" }` | Reveals endpoint exists. Stripe IP ranges are public, so endpoint discovery isn't a defense. Negligible. |
| 335 | `{ error: "Missing stripe-signature header" }` | Same as above. |
| 348 | `{ error: "Invalid signature" }` | Same. |
| 370 | `{ error: "Dedup write failed" }` | Generic. No internal details leaked. |
| 386 | `{ error: "Dedup read-back failed" }` | Generic. |
| 389 | `{ dedup: "already_processed" }` | Reveals event was previously processed. Could indicate to Stripe-knowledgeable attacker that the dedup table is working — but that's a feature, not an exploit. |
| 426 | `{ received: true, unhandled: event.type }` | Echoes the event type. Could marginally reveal which Stripe dashboard events we don't yet handle — but an attacker needs Stripe's signing secret to even craft the request, at which point they have far worse capabilities. |
| 436 | `{ error: "Handler failed" }` | Generic. No stack trace. |
| 453 | `{ received: true, type: event.type }` | Echoes event type on success. Same posture as 426. |

**No stack traces leaked. No internal IDs leaked beyond what Stripe already knows. ✅ HEALTHY.**

### Severity rollup for security-adjacent

| Item | Severity |
| --- | --- |
| No app-level rate limiting | hygiene (defer) |
| Unhandled event silent ack | ✅ HEALTHY (by design) |
| Response info leakage | ✅ HEALTHY |

---

## 9. Findings summary

### 🚨 CRITICAL findings — **0**

No exploitable webhook finding. Signature verification correct, replay protection layered, error handling at spec, secrets contained.

### ⚠️ MEDIUM findings — **1**

**M1 — Concurrent-delivery race window before processed_successfully flip.** § 4.

Two simultaneous webhook deliveries of the same `event_id` can both fall past the dedup check and run the handler concurrently. Current handlers are idempotent (UPSERT / UPDATE), so the race is harmless today. But the architectural assumption that future handlers can rely on "I am only called once per successful processing" is not enforced by the code — only by the convention that all handlers be idempotent.

**Fix shape** (for WISHLIST, not in-slice):
- `INSERT … ON CONFLICT (event_id) DO UPDATE SET processed_successfully = false RETURNING (xmax = 0) as fresh` — distinguishes fresh INSERT from UPDATE-of-existing.
- Combined with `SELECT … FOR UPDATE` on the existing row, two simultaneous deliveries serialize on the row lock; one runs the handler, the other waits.
- ~30 min for the migration + handler code change + a harness test that simulates concurrent delivery.

Currently masked by handler idempotence. **Not pre-launch blocking** because the live-mode flip ships with the current idempotent handlers. Worth flagging on WISHLIST so any future non-idempotent handler (e.g. "send a welcome email on first checkout") forces the fix.

### Hygiene items — **1**

**H1 — No app-level rate limiting.** § 8. Vercel edge handles baseline DDoS; Stripe sends from finite IPs; per-request CPU cost is negligible. Not pre-launch blocking. Defer to a future hardening pass; could add Vercel edge rate limit or Stripe-IP allowlist.

### ✅ HEALTHY findings — Many

Named so a future maintainer doesn't accidentally regress them:

- Raw body via `request.text()` for signature byte-equality.
- Stripe SDK `constructEvent` (no hand-rolled crypto).
- Signature check ordered BEFORE all business logic.
- 400 (not 5xx) on signature/header failure — no Stripe-retry storm.
- 500 on transient failures — Stripe retries naturally recover.
- `runtime = "nodejs"` explicit (required for Node crypto).
- `dynamic = "force-dynamic"` explicit.
- `STRIPE_WEBHOOK_SECRET` env-only, never logged.
- `STRIPE_SECRET_KEY` env-only, never logged. `sk_` prefix validation.
- `server-only` import on `src/lib/stripe.ts` (build fails if browser-bundled).
- Lazy Stripe client init (Vercel build-safe).
- Stripe API version PINNED (`2026-05-27.dahlia`) — drift-resistant.
- `STRIPE_SUBSCRIPTION_STATUSES` mirrors DB CHECK constraint — strict allowlist.
- Claim-stake dedup pattern (row INSERTed before handler runs).
- `processed_successfully` flag separate from dedup row presence — supports retry of failed handlers.
- Unhandled-event default branch acks with 200 + marks processed (no retry storm on new Stripe events).
- Out-of-order event handling — subscription.updated before checkout-session.completed logs + 200, no crash.
- Defensive `extractSubscriptionId` walks both modern and legacy Stripe Invoice shapes.
- Two-layer replay protection: SDK 5-min timestamp tolerance + permanent dedup PK.
- DB-side PK on `event_id` + partial index on unprocessed rows.

---

## 10. Recommendations + open questions

### In-slice fixes — **none recommended**

Per the Slice S3 protocol ("If 🚨 CRITICAL findings: draft fixes ready for review-before-apply. If only ⚠️ MEDIUM / hygiene: WISHLIST entries logged, no in-slice fixes unless trivial"), the MEDIUM in § 4 + the hygiene in § 8 should go to WISHLIST. The MEDIUM fix is not trivial (requires migration + handler code + harness test) and the current handler idempotence masks the race entirely — no live-mode-flip blocker.

### WISHLIST follow-ons (to log post-approval)

1. **Webhook concurrent-delivery race fix.** Convert dedup pattern to `INSERT … ON CONFLICT … DO UPDATE … RETURNING xmax = 0` + `SELECT FOR UPDATE`. Forces serialization of simultaneous deliveries; future non-idempotent handlers can rely on single-fire semantics. ~30 min. Required before shipping any non-idempotent handler.
2. **Webhook rate limiting / Stripe IP allowlist.** Defense-in-depth. Vercel edge config or middleware. ~1 hour. Pre-launch hardening pass.

### Open questions for founder review

1. **Vercel env-var separation for `STRIPE_WEBHOOK_SECRET`.** Confirm that Production and Preview environments have the correct webhook secret per environment (test-mode secret for Preview, live-mode secret for Production once we flip). Founder-side dashboard check; not a code question.
2. **Stripe dashboard webhook event subscriptions.** Confirm which event types are currently subscribed in the Stripe dashboard. The handler handles 5 explicit types + a default-branch ack. If the dashboard is subscribed to additional events (e.g. `customer.created`, `payment_intent.*`), we want to be aware — the events will still ack-200 + persist to `stripe_events` for forensics, but it'd be good to know what we're receiving for capacity planning + Phase 2 monitoring design.
3. **Test/live cutover plan.** When the live-mode flip ships, the webhook secret must rotate in lockstep — both the Stripe dashboard signing secret AND the Vercel `STRIPE_WEBHOOK_SECRET` env var. A brief windowed-rotation procedure should be documented (Stripe lets you keep both old + new secrets valid during a cutover window).

---

## 11. Phase-2 monitoring recommendations (for future sub-slice, not in scope tonight)

Per the cumulative pattern from S1 + S2, a regression test or standing-invariant canary would be a natural next step. **Not in S3 scope** (this slice was audit-only per the spec). Flagging for a future "Stripe webhook monitoring" sub-slice:

- **Standing-invariant canary RPC.** `audit_stuck_webhook_events()` — SECURITY DEFINER, returns rows from `stripe_events` where `not processed_successfully AND received_at < now() - interval '1 hour'`. Mirrors the `audit_grant_without_rls` + `audit_public_buckets` pattern from S1/S2. Cron-able as a continuous health check. Would have surfaced this audit's Q3 in real time.
- **Harness test.** Extend `scripts/test-rls-phase3.mjs` with a S3.1 test that invokes the canary and asserts 0 rows.
- **Optional alert wiring.** If `audit_stuck_webhook_events()` ever returns rows in production, send a Slack/email alert (would require adding an alerting infrastructure that doesn't exist today).

---

_Slice S3 audit complete. One ⚠️ MEDIUM finding (concurrent-delivery race, currently masked by handler idempotence) + one hygiene item (no rate limiting). No 🚨 CRITICAL findings. WISHLIST entries to log on approval. No in-slice fixes recommended._
