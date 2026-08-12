import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isAdminUser } from "@/lib/admin-auth";
import { fetchAdminMetrics } from "@/lib/admin-metrics";

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

        {/* ── Stat tiles ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          <StatTile label="MRR" value={`$${metrics.mrr.toLocaleString()}`} />
          <StatTile label="Active subscriptions" value={String(metrics.activeSubscriptions)} />
          <StatTile label="In trial now" value={String(metrics.trialingSubscriptions)} />
          <StatTile
            label="Trial → paid"
            value={
              metrics.trialToPaid.rate === null
                ? "—"
                : `${metrics.trialToPaid.rate}%`
            }
            sub={`${metrics.trialToPaid.converted}/${metrics.trialToPaid.totalEverTrialed} converted`}
          />
          <StatTile label="Solo plans" value={String(metrics.planCounts.solo)} />
          <StatTile label="Team plans" value={String(metrics.planCounts.team)} />
          <StatTile label="Cancellations" value={String(metrics.cancellations.length)} />
        </div>

        {/* ── Funnel ────────────────────────────────────────────────── */}
        <section
          className="rounded-2xl mb-10"
          style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "24px" }}
        >
          <h2 className="text-[15px] font-medium text-white mb-5">
            Acquisition funnel
          </h2>
          <div className="flex flex-col gap-0">
            {metrics.funnel.map((step, i) => {
              const widthPct = step.pctOfFirst ?? (i === 0 ? 100 : 0);
              return (
                <div key={step.label} className="py-3" style={{ borderTop: i > 0 ? "1px solid #36363A" : undefined }}>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[14px] text-white">{step.label}</span>
                    <span className="text-[13px]" style={{ color: "#979393" }}>
                      {step.count.toLocaleString()}
                      {step.pctOfPrevious !== null && (
                        <span> · {step.pctOfPrevious}% of previous step</span>
                      )}
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ background: "#212124" }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(widthPct, step.count > 0 ? 2 : 0)}%`,
                        background: "#108CE9",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Cancellations ─────────────────────────────────────────── */}
        <section
          className="rounded-2xl"
          style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "24px" }}
        >
          <h2 className="text-[15px] font-medium text-white mb-1">Cancellations</h2>
          <p className="text-[12.5px] mb-5" style={{ color: "#71717A" }}>
            Tenure is approximated as created_at → updated_at on the billing
            row — there's no dedicated canceled_at column, so this can be
            off if a row was touched again after cancellation.
          </p>
          {metrics.cancellations.length === 0 ? (
            <p className="text-[13px]" style={{ color: "#979393" }}>
              No cancellations yet.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: "#71717A" }} className="text-left">
                  <th className="font-normal pb-2">Workspace</th>
                  <th className="font-normal pb-2">Plan</th>
                  <th className="font-normal pb-2">Used for</th>
                  <th className="font-normal pb-2">Canceled around</th>
                </tr>
              </thead>
              <tbody>
                {metrics.cancellations.map((c, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #36363A" }}>
                    <td className="py-2 text-white">{c.workspaceName}</td>
                    <td className="py-2 capitalize" style={{ color: "#979393" }}>{c.plan}</td>
                    <td className="py-2" style={{ color: "#979393" }}>
                      {c.tenureDays === null ? "—" : `${c.tenureDays} day${c.tenureDays === 1 ? "" : "s"}`}
                    </td>
                    <td className="py-2" style={{ color: "#979393" }}>
                      {new Date(c.canceledAround).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-2xl"
      style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "16px 18px" }}
    >
      <div
        className="text-[11px] uppercase tracking-wide mb-1"
        style={{ color: "#71717A" }}
      >
        {label}
      </div>
      <div className="text-[22px] font-semibold text-white">{value}</div>
      {sub && (
        <div className="text-[12px] mt-0.5" style={{ color: "#979393" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
