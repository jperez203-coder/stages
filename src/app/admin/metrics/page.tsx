import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminUser } from "@/lib/admin-auth";
import { fetchAdminMetrics } from "@/lib/admin-metrics";
import { MetricsTabs } from "@/components/admin/MetricsTabs";

export const dynamic = "force-dynamic";

/**
 * /admin/metrics — founder-only funnel + revenue dashboard.
 *
 * 404s (not redirect-to-signin) for anyone who isn't the hardcoded admin
 * in src/lib/admin-auth.ts — an authenticated non-admin hitting this
 * route shouldn't even learn the page exists.
 */
export default async function AdminMetricsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();

  if (!isAdminUser(userRes.user?.id)) {
    notFound();
  }

  const metrics = await fetchAdminMetrics();

  return (
    <div className="dotted-grid min-h-screen px-6 sm:px-12 py-10">
      <div className="max-w-[1100px] mx-auto">
        <h1 className="text-[26px] font-semibold text-white mb-1">Metrics</h1>
        <p className="text-[13px] mb-10" style={{ color: "#979393" }}>
          {metrics.pageViewsTrackingSince
            ? `Signup-page visits tracked since ${new Date(metrics.pageViewsTrackingSince).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. Every other step below is all-time.`
            : "No signup-page visits recorded yet — tracking just went live, so the funnel's first step will read 0 until traffic accumulates."}
        </p>

        <MetricsTabs metrics={metrics} />
      </div>
    </div>
  );
}
