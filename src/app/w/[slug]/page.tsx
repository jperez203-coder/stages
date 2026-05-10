import { AppShell } from "@/components/app/AppShell";
import { App } from "@/components/App";

/**
 * Workspace-scoped route. Renders the persistent AppShell chrome (logo +
 * workspace switcher + profile menu) and then the existing in-memory App
 * inside it.
 *
 * AppShell is hoisted to the page level (rather than wrapping inside App.tsx)
 * because App.tsx has its own state-machine routing — when the in-memory
 * session is missing, it early-returns the legacy LoginScreen before any
 * inner AppShell wrapping would execute. Hoisting makes AppShell mount
 * unconditionally whenever this route renders, so the post-Supabase-auth
 * shell always shows up.
 *
 * KNOWN TRANSITIONAL STATE (Phase 3.4 → 4):
 * The slug param is captured by the route but NOT consumed by App — the
 * in-memory views ignore it. AppShell uses the slug for its workspace
 * switcher's active-state highlighting via useParams(). Phase 4 wires the
 * slug to actual data fetching, replacing useAppState with real Supabase
 * queries. Until then, you'll see AppShell render correctly with the
 * right workspace name in the header, but the in-memory App below either
 * renders its legacy LoginScreen (if no in-memory session) or its
 * in-memory views (which display in-memory data, not the active
 * workspace's data). See CLAUDE.md → "Known transitional state".
 */
export default function WorkspaceStubPage() {
  return (
    <AppShell>
      <App />
    </AppShell>
  );
}
