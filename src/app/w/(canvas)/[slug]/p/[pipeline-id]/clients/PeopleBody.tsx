"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PeopleTabs, type PeopleSubTab } from "./PeopleTabs";
import { MembersBody } from "./MembersBody";
import { ClientsBody } from "./ClientsBody";

/**
 * PI-6: parent body for the People tab on a pipeline. Renders the page
 * heading + sub-tab nav and switches between MembersBody and
 * ClientsBody based on the ?tab= URL search param.
 *
 * Default tab: "members". Any value other than "members" or "clients"
 * collapses to the default.
 *
 * Wrapped in Suspense because useSearchParams suspends in the static
 * render pass when Next.js can't statically resolve the query string.
 * The page is force-dynamic so this is mostly belt-and-suspenders, but
 * the boundary keeps the route safe against future static-prerender
 * changes.
 *
 * Server gates (auth, personal-workspace redirect) live in the parent
 * page.tsx — this body assumes the gates have passed.
 */

function PeopleBodyInner() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: PeopleSubTab = tabParam === "clients" ? "clients" : "members";

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold mb-1">People</h1>
        <p className="text-[14px] text-zinc-500">
          Manage who has access to this pipeline.
        </p>
      </header>
      <PeopleTabs active={activeTab} />
      {activeTab === "members" ? <MembersBody /> : <ClientsBody />}
    </div>
  );
}

export function PeopleBody() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
          <div className="text-[13px] text-zinc-500">Loading…</div>
        </div>
      }
    >
      <PeopleBodyInner />
    </Suspense>
  );
}
