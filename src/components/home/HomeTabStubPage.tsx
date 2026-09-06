"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { HomeTabs, type HomeTabKey } from "@/components/home/HomeTabs";
import { HomeGreeting } from "@/components/home/HomeGreeting";

/**
 * Placeholder body for the Task/Projects/Clients tabs — the tab row itself
 * is real and routes correctly; the content underneath each is a separate,
 * later build step. Swap this out per-tab as each one gets built, same
 * pattern as the dashboard page (HomeTabs mounted, real content below it).
 */
export function HomeTabStubPage({ activeTab, label }: { activeTab: HomeTabKey; label: string }) {
  const params = useParams();
  const router = useRouter();
  const session = useSession();
  const contexts = useUserContexts();
  const slug = typeof params?.slug === "string" ? params.slug : null;

  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace(`/auth/signin?next=/w/${slug ?? ""}`);
    }
  }, [session.status, router, slug]);

  if (session.status !== "authenticated" || !slug) {
    return <div className="dotted-grid flex-1" />;
  }

  // Same first-name derivation as the dashboard page's greeting: profile
  // display_name, falling back to the email local-part, first word only,
  // capitalized. Kept local rather than shared — the dashboard's version
  // is a locked, heavily-commented block; duplicating four lines here is
  // cheaper than risking that one.
  const rawName = contexts.status === "ready" ? contexts.profile.displayName : null;
  const emailLocal =
    session.status === "authenticated" ? (session.user.email?.split("@")[0] ?? null) : null;
  const nameBase = rawName && rawName.trim() ? rawName.trim() : emailLocal;
  const firstWord = nameBase ? nameBase.split(/\s+/)[0] : "";
  const firstName = firstWord ? firstWord[0].toUpperCase() + firstWord.slice(1) : null;

  return (
    <div className="dotted-grid flex-1 px-6 pt-3 pb-6">
      <div className="max-w-[1600px] mx-auto mb-4">
        <HomeGreeting firstName={firstName} />
      </div>

      <div className="mb-6">
        <HomeTabs activeTab={activeTab} slug={slug} />
      </div>

      <div className="max-w-[1600px] mx-auto">
        <p className="text-[14px]" style={{ color: "#71717A" }}>
          {label} is coming soon.
        </p>
      </div>
    </div>
  );
}
