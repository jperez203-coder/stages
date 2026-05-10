# Phase 3.4 — Auth wiring (working spec)

Working spec for the auth phase. Locked decisions + sequenced implementation steps + edge cases that must be tested. Folded into PROGRESS.md when 3.4 ships.

## Locked decisions (founder-approved 2026-05-09)

### D1 — Agency invite flow: custom token via `team_invites`

Per-invite context (pipeline, role, can_submit, invited_by, accepted_at) preserved in the `team_invites` table. Server route inserts the row + sends the email via Resend. `/accept-invite/[token]` validates, signs the user in (existing or new), creates the `pipeline_memberships` row, marks accepted, redirects to the pipeline.

Rejected: native `auth.admin.inviteUserByEmail` — overwrites user metadata on subsequent invites, loses per-invite context, awkward resend/revoke surface.

### D2 — Client invite flow: custom token via `client_invites` + `generateLink`

Server route inserts the `client_invites` row + uses `auth.admin.generateLink({ type: 'magiclink', email })` to mint a Supabase magic link, then embeds BOTH our token AND the magic-link URL in our Resend email. The accept route validates our token AND the OAuth callback together. **Token gating prevents the "stolen email = portal access" attack** that pure `signInWithOtp` would allow.

One-click for the client. Per-invite context preserved (pipeline, agency_email, accepted_at).

### D3 — Google OAuth provider

Standard Supabase Google OAuth setup. Steps documented in the implementation order below.

**Phase 5 launch dependency:** Submit our app for Google verification (4-6 week process) before public marketing starts. Until verified, users see an "Unverified app" warning. This is in flight before first real signups.

### D4 — Identity linking

Enable "Allow manual linking" in the Supabase dashboard. Build a "Linked accounts" section in account settings where users can call `linkIdentity({ provider: 'google' })` on their already-authenticated session. For the magic-link → password upgrade path: prompt users coming in via magic-link to optionally set a password (calls `updateUser({ password })` which adds the password identity to the same `auth.users` row).

Verify auto-linking-on-email-match behavior in the dashboard during implementation. Document what we find in CLAUDE.md so future sessions don't have to re-deduce it.

When a user tries Google OAuth for an email that already has password-only auth (and auto-linking isn't on or fails): show a clear error → "this email already has an account, sign in with password and link Google from settings." Never silently create a duplicate `auth.users` row.

## URL structure

| Path | Purpose |
| --- | --- |
| `/auth/signin` | Agency sign-in (email+password OR Google) |
| `/auth/signup` | Agency sign-up (email+password OR Google) |
| `/auth/callback` | Google OAuth return target (exchanges code for session) |
| `/accept-invite/[token]` | Agency invite acceptance |
| `/portal/accept/[token]` | Client invite acceptance (magic-link landing) |

## Email templates

Use Resend's React Email components. **Phase 3.4 templates are minimal/transactional only** — iterate later with real customer feedback. No fancy graphics or marketing copy.

Template content per type:
- Logo (Stages wordmark)
- Inviter's display name
- Pipeline name + workspace name
- Role they were invited as
- Single CTA button
- Plain footer with the raw URL fallback (in case the button doesn't render in their email client)

Two templates total:
1. `AgencyInviteEmail` — "{Inviter} invited you to {Pipeline} as {Role}"
2. `ClientInviteEmail` — "{Inviter} from {Workspace} invited you to view {Pipeline}"

## Sequenced implementation order

Each step ends with verification before the next begins. **No batched implementation.**

1. **Auth UI scaffolding** — `/auth/signin` and `/auth/signup` routes, static UI matching prototype design system. No real auth wiring yet.
2. **Email+password sign-up + sign-in** — wire `signUp` and `signInWithPassword`. Verify `auth.users` row + `profiles` row created (the `handle_new_user` trigger fires).
3. **`/auth/callback` route + Google OAuth wiring** — Supabase dashboard config done first, then wire the Google button. Verify Google sign-up creates `auth.users` + `auth.identities` + profiles row.
4. **Workspace switcher** — query `workspace_memberships` + `pipeline_memberships` for the logged-in user, route to the right destination per CLAUDE.md identity model.
5. **Workspace creation flow** — first-time user with no memberships lands on "Create your workspace" form. Inserts `workspaces` + `workspace_memberships` (role='owner') in a transaction.
6. **Agency invite flow** — server route + `team_invites` insert + Resend email + `/accept-invite/[token]` route + UI in pipeline settings (send / revoke / list pending). End-to-end test the edge cases below.
7. **Client invite flow** — same shape with `client_invites` + `generateLink` + custom email + `/portal/accept/[token]`. End-to-end test the edge cases below.
8. **Identity linking UI** — "Linked accounts" section in account settings. Magic-link-to-password upgrade prompt.
9. **Two-browser test** — the canonical CLAUDE.md verification gate. Once this passes, Phase 3.4 is done.

## Invite flow edge cases (steps 6 + 7)

These are where invite flows commonly fail in production. Each must be verified by automated test or documented manual test script. **Do not move past steps 6 / 7 until all five are green for that step's flow.**

### E1 — Single-use enforcement

Invite link works **exactly once**. After acceptance, the same link returns "this invite has already been accepted." Implementation: `accepted_at` column on the invite row is set inside the same transaction as the membership insert; accept route checks `accepted_at is null` before processing.

### E2 — Expired invite

Expired invite link returns clear "this invite has expired" error. Implementation: invite rows get an `expires_at` column (default 14 days for agency, 30 days for client per CLAUDE.md). Accept route checks `expires_at > now()`.

### E3 — Revoked invite

A revoked invite link returns clear "this invite has been revoked" error. Implementation: revoke flow sets `revoked_at` (NOT `accepted_at`, so we can distinguish in error messaging). Accept route checks `revoked_at is null` before processing.

### E4 — Email already has an account

Invite for an email that already has an `auth.users` row routes them to "sign in to accept" rather than "create new account." Implementation: accept route does an admin-API lookup of the email; if it exists, render the sign-in form with the invite token preserved through the auth flow. After sign-in, the membership insert + accepted_at update fire.

### E5 — Mismatched email at acceptance (client invites)

A client invite cannot be redeemed by signing in with a different email than was invited. Implementation: even though the magic link in the email is generated for that specific email, the accept route double-checks `client_invites.email == auth.user.email` before creating the membership. Mismatch → clear error "this invite was sent to a different email."

This protects against: invite forwarded to wrong person, invite link copy-pasted into a chat where someone else clicks it.

### Test format

For each flow, the verification record (file: `supabase/INVITE_TEST_RESULTS.md`, written when steps 6 and 7 ship) documents per-edge-case:
- Setup (what state the test starts in)
- Action (the URL clicked / form submitted)
- Expected outcome (error message, redirect, DB state)
- Observed outcome
- Pass/fail

Same format as `RLS_TEST_RESULTS.md` so future regressions are catchable the same way.

## Explicitly out of scope for 3.4

- **Profile pictures** — schema column on `profiles`, Google avatar auto-population in `handle_new_user`, and the email+password upload UI all live in `WISHLIST.md` → "Post-MVP follow-ups → Profile pictures." Not in scope for 3.4. Defer.

## Cleanup before starting

Test users from Phase 3.3 verification are still in `auth.users`. Run `supabase/RLS_TEST.md` Phase 5 Step A before starting step 1. Once 3.4 is done and 21 RLS tests have re-run cleanly under the new auth-wired state, the project is ready for Phase 4.
