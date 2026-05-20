"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Supabase env vars missing. Copy .env.example to .env.local and fill in your project's URL and publishable key.",
  );
}

/**
 * Browser-side Supabase client. Phase 4a step 2 migrated this from
 * `createClient` (supabase-js, localStorage-backed) to `createBrowserClient`
 * (@supabase/ssr, cookie-backed) so the session is readable by server
 * components via `createSupabaseServerClient` (src/lib/supabase-server.ts).
 *
 * Without this pairing, the server saw no session on every render and
 * the dashboard at /w/[slug] redirected to /auth/signin infinitely while
 * the client showed the user as authenticated. The two clients now share
 * the same cookie-based storage.
 *
 * Same `SupabaseClient` interface — no call-site changes anywhere in the
 * ~25 files that import the `supabase` named export. The auth options
 * (persistSession / autoRefreshToken / detectSessionInUrl) are baked into
 * `createBrowserClient` defaults; explicit overrides aren't needed.
 *
 * Migration cost: any localStorage-backed sessions from the old client
 * are orphaned. Existing users sign in once after this change; new
 * sessions live in cookies thereafter.
 */
export const supabase: SupabaseClient = createBrowserClient(url, key);

// Dev-only escape hatch for browser-console testing. Stripped from production.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __supabase: SupabaseClient }).__supabase = supabase;
}
