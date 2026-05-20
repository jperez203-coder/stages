import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for use in App Router server components,
 * route handlers, and server actions. Reads the session from Supabase's
 * cookies via @supabase/ssr so RLS resolves auth.uid() correctly server-
 * side without a round-trip through the browser.
 *
 * Distinct from the client-side `supabase` singleton in src/lib/supabase.ts
 * (which lives in the browser, reads from localStorage, and is used by
 * "use client" components). Never import this from a client component —
 * next/headers won't resolve and the build will fail.
 *
 * The "setAll" branch is a no-op when called from a server component
 * (Next.js blocks cookie writes outside Server Actions / Route Handlers).
 * That's expected — token refresh during a page render is handled by
 * middleware (TODO post-step-2 if session expiry becomes a real issue;
 * for the dashboard, an expired session simply triggers a redirect to
 * /auth/signin via the auth.getUser() check at the top of the page).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components can't set cookies. The middleware (if
            // ever added) would be the place; here we silently no-op.
          }
        },
      },
    },
  );
}
