"use client";

import { useState } from "react";
import type { AdminMetrics } from "@/lib/admin-metrics";
import { AcquisitionFunnelChart } from "@/components/admin/AcquisitionFunnelChart";

const TABS = ["Overview", "Cancellations / churn"] as const;
type Tab = (typeof TABS)[number];

export function MetricsTabs({ metrics }: { metrics: AdminMetrics }) {
  const [tab, setTab] = useState<Tab>("Overview");

  return (
    <div>
      <div className="flex gap-1 mb-8" style={{ borderBottom: "1px solid #36363A" }}>
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="text-[13px] font-medium"
            style={{
              padding: "10px 14px",
              color: tab === t ? "#FFFFFF" : "#979393",
              borderBottom: tab === t ? "2px solid #108CE9" : "2px solid transparent",
              marginBottom: -1,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottomWidth: 2,
              borderBottomStyle: "solid",
              borderBottomColor: tab === t ? "#108CE9" : "transparent",
            }}
          >
            {t}
            {t === "Cancellations / churn" && metrics.cancellations.length > 0 && (
              <span
                className="ml-2 text-[11px] font-medium"
                style={{
                  background: "rgba(244,63,94,0.12)",
                  color: "#F43F5E",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                {metrics.cancellations.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "Overview" ? (
        <OverviewTab metrics={metrics} />
      ) : (
        <CancelledTab metrics={metrics} />
      )}
    </div>
  );
}

function OverviewTab({ metrics }: { metrics: AdminMetrics }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <StatTile label="MRR" value={`$${metrics.mrr.toLocaleString()}`} />
        <StatTile label="Active subscriptions" value={String(metrics.activeSubscriptions)} />
        <StatTile label="In trial now" value={String(metrics.trialingSubscriptions)} />
        <StatTile
          label="Trial → paid"
          value={metrics.trialToPaid.rate === null ? "—" : `${metrics.trialToPaid.rate}%`}
          sub={`${metrics.trialToPaid.converted}/${metrics.trialToPaid.totalEverTrialed} converted`}
        />
        <StatTile label="Solo plans" value={String(metrics.planCounts.solo)} />
        <StatTile label="Team plans" value={String(metrics.planCounts.team)} />
        <StatTile label="Cancellations" value={String(metrics.cancellations.length)} />
      </div>

      <section
        className="rounded-2xl mb-6"
        style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "24px" }}
      >
        <AcquisitionFunnelChart steps={metrics.funnel} />
      </section>

      <section
        className="rounded-2xl"
        style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "24px" }}
      >
        <h2 className="text-[15px] font-medium text-white mb-5">Acquisition funnel</h2>
        <div className="flex flex-col gap-0">
          {metrics.funnel.map((step, i) => {
            const widthPct = step.pctOfFirst ?? (i === 0 ? 100 : 0);
            return (
              <div
                key={step.label}
                className="py-3"
                style={{ borderTop: i > 0 ? "1px solid #36363A" : undefined }}
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[14px] text-white">{step.label}</span>
                  <span className="text-[13px]" style={{ color: "#979393" }}>
                    {step.count.toLocaleString()}
                    {step.pctOfPrevious !== null && (
                      <span> · {step.pctOfPrevious}% of previous step</span>
                    )}
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "#212124" }}>
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
    </>
  );
}

function CancelledTab({ metrics }: { metrics: AdminMetrics }) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatTile
          label="Churn rate"
          value={metrics.churn.rate === null ? "—" : `${metrics.churn.rate}%`}
          sub={`${metrics.churn.canceled}/${metrics.churn.totalEverSubscribed} ever subscribed`}
        />
        <StatTile label="Cancelled" value={String(metrics.churn.canceled)} />
        <StatTile
          label="Retained"
          value={
            metrics.churn.rate === null ? "—" : `${Math.round((100 - metrics.churn.rate) * 10) / 10}%`
          }
        />
      </div>

      <section
        className="rounded-2xl"
        style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "24px" }}
      >
        <h2 className="text-[15px] font-medium text-white mb-1">
          Cancellation / churn rate detail
        </h2>
        <p className="text-[12.5px] mb-5" style={{ color: "#71717A" }}>
          Churn rate = cancelled ÷ every non-founder workspace that ever had a
          subscription (any status), lifetime — not a rolling monthly rate.
          Tenure below is approximated as created_at → updated_at on the
          billing row — there's no dedicated canceled_at column, so this can
          be off if a row was touched again after cancellation.
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
                <td className="py-2 capitalize" style={{ color: "#979393" }}>
                  {c.plan}
                </td>
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
    </>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-2xl"
      style={{ background: "#2C2C2F", border: "1px solid #36363A", padding: "16px 18px" }}
    >
      <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "#71717A" }}>
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
