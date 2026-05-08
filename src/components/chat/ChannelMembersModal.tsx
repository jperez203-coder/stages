"use client";

import { useState } from "react";
import { Hash, Plus, UserPlus, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { Channel, Client, Session } from "@/types/stages";

type Props = {
  channel: Channel;
  client: Client;
  session: Session;
  isOwner: boolean;
  clientPortalEmail: string | null;
  onAdd: (email: string) => void;
  onRemove: (email: string) => void;
  onClose: () => void;
};

export function ChannelMembersModal({
  channel, client, isOwner, clientPortalEmail, onAdd, onRemove, onClose,
}: Props) {
  const memberEmails = channel.memberEmails || [];
  const teamPool = (client.members || []).map((m) => m.email);
  const allCandidates = [
    client.ownerEmail,
    ...teamPool,
    ...(channel.isClient && clientPortalEmail ? [clientPortalEmail] : []),
  ];
  const notYetMembers = allCandidates.filter((e) => !memberEmails.includes(e));
  const [inviteEmail, setInviteEmail] = useState("");

  const handleDirectInvite = () => {
    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    if (memberEmails.includes(trimmed)) {
      alert("Already in this channel.");
      return;
    }
    onAdd(trimmed);
    setInviteEmail("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px]" style={{ color: "#979393" }}>
              {channel.isClient ? "Client channel" : "Team channel"}
            </div>
            <h2 className="text-xl font-semibold mt-1 flex items-center gap-2">
              {channel.isClient ? <Users size={18} /> : <Hash size={18} />} {channel.name}
            </h2>
          </div>
          <button onClick={onClose} className="icon-btn"><X size={14} /></button>
        </div>

        {isOwner && (
          <div className="mt-5 mb-5">
            <div className="text-[13px] mb-1.5" style={{ color: "#979393" }}>
              Invite by email
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDirectInvite()}
                placeholder="teammate@example.com"
                className="field"
              />
              <button
                onClick={handleDirectInvite}
                disabled={!inviteEmail.trim() || !inviteEmail.includes("@")}
                className="btn-primary"
              >
                <UserPlus size={13} strokeWidth={2.5} /> Add
              </button>
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: "#979393" }}>
              They&apos;ll be added to this channel immediately.
            </div>
          </div>
        )}

        <div className="text-[13px] mt-4 mb-2" style={{ color: "#979393" }}>
          Members ({memberEmails.length})
        </div>
        <div className="space-y-1 mb-5 max-h-[240px] overflow-y-auto scrollbar-thin">
          {memberEmails.map((email) => {
            const isClientPortal = channel.isClient && email === clientPortalEmail;
            const isOwnerEmail = email === client.ownerEmail;
            return (
              <div
                key={email}
                className="flex items-center gap-2 p-2 rounded-md"
                style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
              >
                <Avatar email={email} size={6} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{email}</div>
                  {(isClientPortal || isOwnerEmail) && (
                    <div className="text-[10px] mt-0.5">
                      {isClientPortal && <span style={{ color: "#7EC2F4" }}>Client</span>}
                      {isOwnerEmail && <span style={{ color: "#FBBF24" }}>Owner</span>}
                    </div>
                  )}
                </div>
                {isOwner && !isOwnerEmail && (
                  <button
                    onClick={() => onRemove(email)}
                    className="icon-btn"
                    title="Remove from channel"
                    style={{ width: 28, height: 28, color: "#F87171" }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {isOwner && notYetMembers.length > 0 && (
          <>
            <div className="text-[13px] mb-2" style={{ color: "#979393" }}>
              Add from pipeline
            </div>
            <div className="space-y-1 mb-4 max-h-[160px] overflow-y-auto scrollbar-thin">
              {notYetMembers.map((email) => (
                <button
                  key={email}
                  onClick={() => onAdd(email)}
                  className="w-full flex items-center gap-2 p-2 rounded-md transition-colors"
                  style={{
                    background: "transparent",
                    border: "1px solid #36363A",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#2C2C2F")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Avatar email={email} size={6} />
                  <div className="flex-1 text-left text-[13px]">{email}</div>
                  <Plus size={13} strokeWidth={2.5} style={{ color: "#979393" }} />
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-ghost">Done</button>
        </div>
      </div>
    </div>
  );
}
