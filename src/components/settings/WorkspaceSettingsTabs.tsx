"use client";

import Link from "next/link";

/**
 * Shared chrome for workspace settings pages.
 *
 * Renders the global `<h1>Workspace settings</h1>` once + a horizontal
 * tabs row, then drops into `children` for the per-page body. Both
 * /w/[slug]/settings/team and /w/[slug]/settings/billing mount this
 * wrapper, so the active tab + slug-derived hrefs stay in sync without
 * each page reinventing the nav.
 *
 * "use client" because the team settings page is itself a client
 * component (legacy from phase 3.4). A server-component variant of
 * this wrapper would require restructuring team page to host the
 * tabs from a parent server file — out of scope for slice 4. The
 * component is render-only with no client state; the "use client"
 * is purely about callability from existing client pages.
 *
 * ACTIVE TAB STYLING
 *   * Inactive: text-zinc-500, hover → text-zinc-300, no border.
 *   * Active:   text-zinc-100, font-semibold, 2px bottom border in
 *               stages-purple (#6E5BE8). The -mb-px compensates for
 *               the parent's border-b so the active underline overlays
 *               the separator cleanly.
 *
 * To add a tab later: extend the TabKey type + add the new <Link>
 * entry. The active-tab check is type-safe via the discriminated
 * literal union — TypeScript will fail at the call site if an
 * unknown activeTab prop is passed.
 */

type TabKey = "team" | "billing";

const TABS: Array<{ key: TabKey; label: string; pathSuffix: string }> = [
  { key: "team", label: "Team", pathSuffix: "team" },
  { key: "billing", label: "Billing", pathSuffix: "billing" },
];

export function WorkspaceSettingsTabs({
  activeTab,
  slug,
  children,
}: {
  activeTab: TabKey;
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-[24px] font-semibold mb-6 text-zinc-100">
        Workspace settings
      </h1>
      <nav className="border-b border-zinc-800 flex gap-6 mb-8">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/w/${encodeURIComponent(slug)}/settings/${tab.pathSuffix}`}
              className={`pb-3 text-[14px] transition-colors -mb-px border-b-2 ${
                isActive
                  ? "text-zinc-100 font-semibold"
                  : "text-zinc-500 hover:text-zinc-300 font-medium border-b-transparent"
              }`}
              style={
                isActive
                  ? { borderBottomColor: "#6E5BE8" }
                  : undefined
              }
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
