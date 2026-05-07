"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";
import type { Client, TeamInvite } from "@/types/stages";

type Props = {
  invite: TeamInvite & { token: string };
  client: Client | undefined;
  onAccept: (email: string) => void;
  onDecline: () => void;
};

export function InviteAcceptScreen({ invite, client, onAccept, onDecline }: Props) {
  const [email, setEmail] = useState(invite.email || "");
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in">
        <div className="flex items-center gap-2 mb-5">
          <StagesLogo size={24} />
          <span className="text-[13px] font-semibold text-zinc-400">Stages</span>
        </div>
        <div
          className="w-12 h-12 rounded-xl mb-4 flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #DF1E5A, #36C5EF)" }}
        >
          <UserPlus size={22} color="white" strokeWidth={2.2} />
        </div>
        <div className="text-[13px] text-zinc-400 mb-1">Invitation</div>
        <h2 className="text-xl font-semibold mb-2">You&apos;ve been invited</h2>
        <p className="text-[13px] text-zinc-400 mb-5 leading-relaxed">
          <span className="text-zinc-200">{invite.invitedBy}</span> invited you to collaborate on
          the <span className="text-zinc-200">{client?.name || "client"}</span> workspace.
        </p>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Confirm your email</span>
        </label>
        <input
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && email.includes("@") && onAccept(email)}
          className="field mb-4"
          placeholder="you@company.com"
        />
        <div className="flex gap-2">
          <button onClick={onDecline} className="btn-ghost flex-1 justify-center">
            Decline
          </button>
          <button
            onClick={() => onAccept(email)}
            disabled={!email.includes("@")}
            className="btn-primary flex-1 justify-center"
          >
            Accept Invitation
          </button>
        </div>
      </div>
    </div>
  );
}
