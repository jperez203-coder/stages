import { PortalPlaceholder } from "@/components/portal/v2/PortalPlaceholder";

/**
 * /portal/[pipeline-id]/canvas — placeholder tab.
 * Real surface ships in slice 4b-2.
 *
 * Layout auth-gates and renders the chrome; this page just provides
 * the placeholder body.
 */

export const dynamic = "force-dynamic";

export default function PortalCanvasPage() {
  return (
    <PortalPlaceholder
      title="Canvas coming soon"
      body="Your project journey — stages, tasks, and progress — will live here."
    />
  );
}
