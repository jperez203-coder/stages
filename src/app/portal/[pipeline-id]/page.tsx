import { redirect } from "next/navigation";

/**
 * /portal/[pipeline-id] — index route, redirects to the Chat tab.
 * Phase 4b-1.
 *
 * Default landing tab is Chat — that's the functional tab in 4b-1.
 * Canvas and Files are placeholders. The invite-accept flow lands here
 * (`router.push(`/portal/${pipeline_id}`)`) and bounces straight to
 * /chat for the user's first conversation.
 *
 * Layout's auth gate has already run by the time this renders. The
 * redirect happens server-side; no flash of any UI.
 */

export const dynamic = "force-dynamic";

export default async function PortalIndexPage({
  params,
}: {
  params: Promise<{ "pipeline-id": string }>;
}) {
  const resolved = await params;
  redirect(`/portal/${resolved["pipeline-id"]}/chat`);
}
