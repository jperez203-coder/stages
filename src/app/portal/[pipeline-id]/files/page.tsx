import { PortalPlaceholder } from "@/components/portal/v2/PortalPlaceholder";

/**
 * /portal/[pipeline-id]/files — placeholder tab.
 * Real surface ships once the files feature exists (post-4b-1).
 *
 * Layout auth-gates and renders the chrome; this page just provides
 * the placeholder body.
 */

export const dynamic = "force-dynamic";

export default function PortalFilesPage() {
  return (
    <PortalPlaceholder
      title="Files coming soon"
      body="Shared documents, images, and uploads from your agency will live here."
    />
  );
}
