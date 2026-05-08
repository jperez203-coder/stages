"use client";

import { useState } from "react";
import { Check, Hash, Plus, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { Client, Session } from "@/types/stages";

type Props = {
  client: Client;
  session: Session;
  clientPortalEmail: string | null;
  onCreate: (name: string, members: string[], isClient: boolean) => void;
  onClose: () => void;
};

export function CreateChannelModal({
  client, session, clientPortalEmail, onCreate, onClose,
}: Props) {
  const [name, setName] = useState("");
  const [isClient, setIsClient] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  const teamPool = (client.members || [])
    .map((m) => m.email)
    .filter((e) => e !== session.email);

  const existingClientChannel = (client.channels || []).find((ch) => ch.isClient);
  const clientChannelLocked = !!existingClientChannel;

  const toggleMember = (email: string) => {
    setSelectedMembers((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  };

  const submit = () => {
    if (!name.trim()) return;
    if (isClient && clientChannelLocked) return;
    const finalMembers =
      isClient && clientPortalEmail
        ? Array.from(new Set([...selectedMembers, clientPortalEmail]))
        : selectedMembers;
    onCreate(name, finalMembers, isClient);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px]" style={{ color: "#979393" }}>Chat</div>
            <h2 className="text-xl font-semibold mt-1">Create a channel</h2>
          </div>
          <button onClick={onClose} className="icon-btn"><X size={14} /></button>
        </div>

        <p className="text-[13px] mt-3 mb-5 leading-relaxed" style={{ color: "#979393" }}>
          Channels keep conversations organized by topic, team, or audience.
        </p>

        <label className="block mb-4">
          <span className="text-[13px] block mb-1.5" style={{ color: "#979393" }}>
            Channel name
          </span>
          <div
            className="flex items-center gap-2"
            style={{
              background: "#1A1A1C",
              border: "1px solid #36363A",
              borderRadius: "8px",
              padding: "0 12px",
            }}
          >
            <Hash size={14} style={{ color: "#979393" }} />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder={isClient ? "client-name" : "marketing, design, dev…"}
              className="flex-1"
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#E4E4E7",
                fontSize: "14px",
                padding: "10px 0",
              }}
            />
          </div>
        </label>

        <div className="mb-4">
          <button
            onClick={() => {
              if (!clientChannelLocked) setIsClient(!isClient);
            }}
            disabled={clientChannelLocked}
            className="w-full flex items-start gap-3 p-3 rounded-lg transition-all text-left"
            style={{
              background: clientChannelLocked
                ? "#212124"
                : isClient
                  ? "#108CE91A"
                  : "#1A1A1C",
              border: `1px solid ${
                clientChannelLocked ? "#36363A" : isClient ? "#108CE966" : "#36363A"
              }`,
              cursor: clientChannelLocked ? "not-allowed" : "pointer",
              opacity: clientChannelLocked ? 0.6 : 1,
            }}
          >
            <div
              className="flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "4px",
                border: `2px solid ${isClient && !clientChannelLocked ? "#108CE9" : "#4A4A50"}`,
                background: isClient && !clientChannelLocked ? "#108CE9" : "transparent",
              }}
            >
              {isClient && !clientChannelLocked && <Check size={10} strokeWidth={3} color="white" />}
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold flex items-center gap-1.5">
                <Users size={12} /> Client channel
                {clientChannelLocked && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "#36363A", color: "#A1A1AA" }}
                  >
                    EXISTS
                  </span>
                )}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "#979393" }}>
                {clientChannelLocked
                  ? `Each pipeline can only have one client channel. Open #${existingClientChannel?.name} to message your client.`
                  : clientPortalEmail
                    ? `The client (${clientPortalEmail}) will be added and can read & post.`
                    : "Mark as client channel — invite the client to the portal first to give them access."}
              </div>
            </div>
          </button>
        </div>

        {teamPool.length > 0 && (
          <div className="mb-5">
            <div className="text-[13px] mb-1.5" style={{ color: "#979393" }}>
              Team members to add
            </div>
            <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-thin">
              {teamPool.map((email) => {
                const checked = selectedMembers.includes(email);
                return (
                  <label
                    key={email}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors"
                    style={{ background: checked ? "#108CE91A" : "transparent" }}
                    onMouseEnter={(e) => {
                      if (!checked) e.currentTarget.style.background = "#2C2C2F";
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMember(email)}
                      className="hidden"
                    />
                    <div
                      className="flex items-center justify-center flex-shrink-0"
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "4px",
                        border: `2px solid ${checked ? "#108CE9" : "#4A4A50"}`,
                        background: checked ? "#108CE9" : "transparent",
                      }}
                    >
                      {checked && <Check size={10} strokeWidth={3} color="white" />}
                    </div>
                    <Avatar email={email} size={5} />
                    <span className="text-[13px]">{email}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={!name.trim()} className="btn-primary">
            <Plus size={13} strokeWidth={2.5} /> Create channel
          </button>
        </div>
      </div>
    </div>
  );
}
