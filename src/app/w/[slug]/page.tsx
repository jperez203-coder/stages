import { App } from "@/components/App";

/**
 * Stub for the workspace home route. Renders the existing in-memory App.
 *
 * AppShell is no longer wrapped here — that moved to /w/[slug]/layout.tsx
 * in step 6b so every nested route under /w/[slug]/* shares the same
 * chrome. The slug route param is captured by the dynamic segment but not
 * consumed in step 6 — Phase 4 wires it to real workspace-scoped data
 * fetching, at which point the in-memory App goes away. See CLAUDE.md →
 * "Known transitional state (Phase 3.4 → 4)" for the design rationale.
 */
export default function WorkspaceStubPage() {
  return <App />;
}
