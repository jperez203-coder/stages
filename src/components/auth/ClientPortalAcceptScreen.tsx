"use client";

import { ArrowRight } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";
import type { Client, ClientInvite } from "@/types/stages";

type Props = {
  invite: ClientInvite & { token: string };
  pipeline: Client | undefined;
  onAccept: () => void;
  onDecline: () => void;
};

export function ClientPortalAcceptScreen({ invite, pipeline, onAccept, onDecline }: Props) {
  const valid = !!pipeline;
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 max-w-md w-full text-center">
        <div className="flex justify-center mb-5">
          <StagesLogo size={48} />
        </div>
        {valid ? (
          <>
            <div className="text-[12px] uppercase tracking-wider mb-1" style={{ color: "#979393" }}>
              Project portal
            </div>
            <h1 className="text-2xl font-semibold mb-1">
              {pipeline.emoji || "📋"} {pipeline.name}
            </h1>
            {pipeline.company && (
              <div className="text-[13px] mb-4" style={{ color: "#979393" }}>
                {pipeline.company}
              </div>
            )}
            <p className="text-[14px] mb-1 leading-relaxed" style={{ color: "#E4E4E7" }}>
              You&apos;ve been invited to track this project&apos;s progress.
            </p>
            <p className="text-[13px] mb-6 leading-relaxed" style={{ color: "#979393" }}>
              You&apos;ll see real-time updates, deliverables, and anything your team needs from
              you — all in one place.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onAccept}
                className="btn-primary justify-center"
                style={{ width: "100%", padding: "12px 16px" }}
              >
                <ArrowRight size={14} strokeWidth={2.5} /> Open project portal
              </button>
              <button
                onClick={onDecline}
                className="btn-ghost justify-center"
                style={{ width: "100%" }}
              >
                Maybe later
              </button>
            </div>
            <div className="text-[11px] mt-5" style={{ color: "#979393" }}>
              Signing in as <span style={{ color: "#E4E4E7" }}>{invite.clientEmail}</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-2xl mb-2">⚠️</div>
            <h1 className="text-lg font-semibold mb-2">Invite no longer valid</h1>
            <p className="text-[13px] mb-5" style={{ color: "#979393" }}>
              This project may have been removed or the invite expired. Please contact the agency
              for a new link.
            </p>
            <button onClick={onDecline} className="btn-ghost">Close</button>
          </>
        )}
      </div>
    </div>
  );
}
