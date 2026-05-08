"use client";

import type { ReactNode } from "react";
import { Activity, CheckCircle2, Sparkles, UserPlus } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { ActivityEntry, Client } from "@/types/stages";

const META: Record<
  ActivityEntry["type"],
  { color: string; icon: ReactNode }
> = {
  stage_advanced: { color: "#10B981", icon: <CheckCircle2 size={14} /> },
  member_joined: { color: "#3BA5EE", icon: <UserPlus size={14} /> },
  client_created: { color: "#8B5CF6", icon: <Sparkles size={14} /> },
  pipeline_submitted: { color: "#EC4899", icon: <Sparkles size={14} /> },
};

function describe(item: ActivityEntry): ReactNode {
  switch (item.type) {
    case "stage_advanced":
      return (
        <>
          <span className="text-zinc-200 font-medium">{item.who}</span> completed{" "}
          <span className="text-zinc-200">{item.stageName}</span>
        </>
      );
    case "member_joined":
      return (
        <>
          <span className="text-zinc-200 font-medium">{item.who}</span> joined the workspace
        </>
      );
    case "client_created":
      return (
        <>
          <span className="text-zinc-200 font-medium">{item.who}</span> created this workspace
        </>
      );
    case "pipeline_submitted":
      return (
        <>
          <span className="text-zinc-200 font-medium">{item.who}</span> submitted the pipeline 🎉
        </>
      );
    default:
      return <span className="text-zinc-400">{(item as ActivityEntry).type}</span>;
  }
}

type Props = { client: Client };

export function ActivityView({ client }: Props) {
  const items = [...(client.activity || [])].sort((a, b) => b.ts - a.ts);

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8">
      <div className="mb-6">
        <div className="text-[13px] text-zinc-400 mb-1">Workspace</div>
        <h2 className="text-2xl font-semibold mb-1">Activity</h2>
        <div className="text-[13px] text-zinc-500">Auto-tracked events for this client.</div>
      </div>
      {items.length === 0 ? (
        <div className="text-center py-12">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: "rgba(59,165,238,0.1)", border: "1px solid #36363A" }}
          >
            <Activity size={22} style={{ color: "#3BA5EE" }} strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold mb-1">No activity yet</div>
          <div className="text-[13px] text-zinc-500">
            Events will show up here as you and your team work on this client.
          </div>
        </div>
      ) : (
        <div className="panel-card divide-y divide-zinc-800">
          {items.map((item) => {
            const meta = META[item.type] || { color: "#A1A1AA", icon: <Activity size={14} /> };
            return (
              <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-900/40">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: meta.color + "22", color: meta.color }}
                >
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-zinc-300 leading-relaxed">{describe(item)}</div>
                  <div className="text-[12px] text-zinc-500 mt-0.5">{timeAgo(item.ts)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
