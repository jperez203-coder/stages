"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";

/**
 * PI-6: sub-tab nav for the People page (Members | Clients).
 *
 * URL-driven via ?tab=members | ?tab=clients query string. Default tab
 * ("members" when missing/invalid) is resolved by the parent PeopleBody,
 * not here — this component just renders the strip.
 *
 * Visual treatment mirrors WorkspaceSettingsTabs (WT-5 lock): inactive
 * tabs read text-zinc-500, active tab reads text-zinc-100 font-semibold
 * with a 2px stages-purple bottom border. The -mb-px offset overlays the
 * parent border-b separator so the active underline reads cleanly.
 *
 * Accessibility: rendered as role="tablist" with role="tab" + aria-
 * selected on each Link, and arrow-key cycling between tabs handled by
 * the onKeyDown handler. Tab activation uses router.replace (not push)
 * so the back button doesn't accumulate sub-tab swaps.
 */

export type PeopleSubTab = "members" | "clients";

const TABS: { key: PeopleSubTab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "clients", label: "Clients" },
];

export function PeopleTabs({ active }: { active: PeopleSubTab }) {
  const router = useRouter();
  const pathname = usePathname();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.key === active);
    const next =
      e.key === "ArrowRight"
        ? TABS[(idx + 1) % TABS.length]
        : TABS[(idx - 1 + TABS.length) % TABS.length];
    router.replace(`${pathname}?tab=${next.key}`);
  };

  return (
    <nav
      role="tablist"
      aria-label="People sub-tabs"
      onKeyDown={onKeyDown}
      className="border-b border-zinc-800 flex gap-6 mb-8"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`?tab=${tab.key}`}
            replace
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`pb-3 text-[14px] transition-colors -mb-px border-b-2 ${
              isActive
                ? "text-zinc-100 font-semibold"
                : "text-zinc-500 hover:text-zinc-300 font-medium border-b-transparent"
            }`}
            style={isActive ? { borderBottomColor: "#6E5BE8" } : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
