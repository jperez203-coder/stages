import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";

/**
 * Persistent layout for everything under /w/[slug]/*.
 *
 * Wraps every nested route in AppShell so the logo + workspace switcher +
 * profile menu render consistently across the workspace's own home page
 * (/w/[slug]) AND every subroute (/w/[slug]/settings/team, future
 * /w/[slug]/settings/*, etc.). Extracted from page.tsx in step 6b so the
 * upcoming settings pages inherit AppShell without duplicating the wrap.
 *
 * Stays a server component — no hooks, no client-only APIs. AppShell itself
 * is "use client" and handles its own data fetching internally; the layout
 * just composes it around `children`.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
