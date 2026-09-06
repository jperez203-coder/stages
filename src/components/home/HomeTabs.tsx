"use client";

import { Fragment } from "react";
import Link from "next/link";
import { DashboardTabIcon } from "@/components/icons/DashboardTabIcon";
import { TaskTabIcon } from "@/components/icons/TaskTabIcon";
import { ProjectsTabIcon } from "@/components/icons/ProjectsTabIcon";
import { ClientsTabIcon } from "@/components/icons/ClientsTabIcon";

/**
 * Sub-nav row under Home: Dashboard | Task | Projects | Clients (Figma V2).
 * Same active/inactive tab pattern as WorkspaceSettingsTabs (bottom-border
 * indicator), just re-themed with the stages-* tokens instead of settings'
 * purple, and re-keyed for these four routes instead of settings' three.
 *
 * "Dashboard" is the existing / [slug] route itself — pathSuffix "" — so
 * clicking it from another tab returns to the workspace home page.
 *
 * Icons: each tab gets its own small Figma icon badge, matching
 * DocIcon/SheetIcon's style (`icon` stays optional so a future tab can
 * render label-only until its icon is supplied).
 *
 * The bottom divider goes edge-to-edge across the whole panel — same look
 * as the doc page's breadcrumb divider (page.tsx under /d/[doc-id]), not
 * just to the dashboard's own left/right padding. Callers mount HomeTabs
 * OUTSIDE their max-w-[1600px] reading column so the line isn't capped by
 * that; the negative margin here ALSO cancels out the dashboard's own
 * `px-6` container padding so it reaches the true panel edges,
 * then re-applies the same padding internally so the tab links land back
 * in the same spot they'd be in without any of this (an inner
 * max-w-[1600px] mx-auto keeps them lined up with the greeting/content
 * above and below too). Don't wrap a HomeTabs call in a max-w container
 * upstream, or the line will cap there instead.
 */

export type HomeTabKey = "dashboard" | "tasks" | "projects" | "clients";

const HOME_TABS: Array<{
  key: HomeTabKey;
  label: string;
  pathSuffix: string;
  icon?: typeof DashboardTabIcon;
}> = [
  { key: "dashboard", label: "Dashboard", pathSuffix: "", icon: DashboardTabIcon },
  { key: "tasks", label: "Task", pathSuffix: "tasks", icon: TaskTabIcon },
  { key: "projects", label: "Projects", pathSuffix: "projects", icon: ProjectsTabIcon },
  { key: "clients", label: "Clients", pathSuffix: "clients", icon: ClientsTabIcon },
];

export function HomeTabs({ activeTab, slug }: { activeTab: HomeTabKey; slug: string }) {
  return (
    <div className="border-b -mx-6 px-6" style={{ borderColor: "#2D2E30" }}>
      <nav className="max-w-[1600px] mx-auto flex items-start gap-4">
      {HOME_TABS.map((tab, i) => {
        const isActive = tab.key === activeTab;
        const href = `/w/${encodeURIComponent(slug)}${tab.pathSuffix ? `/${tab.pathSuffix}` : ""}`;
        const Icon = tab.icon;
        return (
          <Fragment key={tab.key}>
            {i > 0 && (
              <span aria-hidden style={{ width: 1, height: 16, marginTop: 3, background: "#3A3A3A", flexShrink: 0 }} />
            )}
            <Link
              href={href}
              className={`font-poppins flex items-center gap-1.5 pb-3 text-[14px] transition-colors -mb-px border-b ${
                isActive ? "font-semibold" : "font-normal"
              }`}
              style={{
                color: isActive ? "#E4E4E7" : "#71717A",
                borderBottomColor: isActive ? "#D9D9D9" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = "#E4E4E7";
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = "#71717A";
              }}
            >
              {Icon && <Icon size={16} />}
              {tab.label}
            </Link>
          </Fragment>
        );
      })}
      </nav>
    </div>
  );
}
