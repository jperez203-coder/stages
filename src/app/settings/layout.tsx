import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";

/**
 * Persistent layout for /settings/* — account-level settings outside the
 * workspace tree.
 *
 * Reuses AppShell rather than a parallel SettingsShell component because
 * the chrome it needs (logo + workspace switcher + profile menu) is what
 * AppShell already renders. AppShell falls back to last_active_workspace_id
 * when no [slug] is in the route, so the switcher button shows the user's
 * last-active workspace as a "this is what you'd open by default" hint.
 *
 * Clicking any workspace in the switcher routes to /w/[slug] and leaves
 * settings (decision 5 from the step 8 plan — settings is workspace-
 * agnostic, the switcher is a navigator not a context selector). The
 * existing HeaderWorkspaceSwitcher already does this via router.push;
 * no settings-specific logic needed.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
