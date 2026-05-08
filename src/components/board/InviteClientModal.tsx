"use client";

import { useState } from "react";
import { Check, Copy, Trash2, UserPlus, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/lib/format";
import type { Client, ClientInvite } from "@/types/stages";

type Props = {
  pipeline: Client;
  existingInvites: (ClientInvite & { token: string })[];
  onInvite: (email: string) => { token: string; link: string } | null;
  onRevoke: (token: string) => void;
  onClose: () => void;
};

export function InviteClientModal({
  pipeline,
  existingInvites,
  onInvite,
  onRevoke,
  onClose,
}: Props) {
  const [email, setEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = () => {
    if (!email.trim() || !email.includes("@")) return;
    const result = onInvite(email);
    if (result) {
      setGeneratedLink(result.link);
      setEmail("");
    }
  };

  const handleCopy = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-lg">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px]" style={{ color: "#979393" }}>Client portal</div>
            <h2 className="text-xl font-semibold mt-1">Invite a client</h2>
          </div>
          <button onClick={onClose} className="icon-btn"><X size={14} /></button>
        </div>

        <p
          className="text-[13px] mt-3 mb-5 leading-relaxed"
          style={{ color: "#979393" }}
        >
          Invite the client for{" "}
          <span style={{ color: "#E4E4E7" }}>{pipeline.emoji || "📋"} {pipeline.name}</span> to a
          clean portal where they&apos;ll see only what you choose to share. They sign in with a
          magic link — no password.
        </p>

        <label className="block mb-4">
          <span className="text-[13px] block mb-1.5" style={{ color: "#979393" }}>
            Client email
          </span>
          <div className="flex gap-2">
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="client@example.com"
              className="field"
            />
            <button
              onClick={submit}
              disabled={!email.trim() || !email.includes("@")}
              className="btn-primary"
            >
              <UserPlus size={13} strokeWidth={2.5} /> Invite
            </button>
          </div>
        </label>

        {generatedLink && (
          <div
            className="rounded-lg p-3 mb-4 fade-in"
            style={{ background: "#108CE91A", border: "1px solid #108CE944" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Check size={14} style={{ color: "#108CE9" }} strokeWidth={3} />
              <span
                className="text-[12px] font-semibold"
                style={{ color: "#7EC2F4" }}
              >
                Magic link generated
              </span>
            </div>
            <p className="text-[12px] mb-2" style={{ color: "#979393" }}>
              Share this link with the client. Anyone with the link can access the portal — treat
              it like a password.
            </p>
            <div className="flex gap-2 items-center">
              <input
                readOnly
                value={generatedLink}
                onFocus={(e) => e.target.select()}
                className="field"
                style={{ fontSize: "11px", fontFamily: "monospace" }}
              />
              <button
                onClick={handleCopy}
                className="btn-ghost flex-shrink-0"
                title="Copy link"
              >
                {copied ? (
                  <Check size={13} strokeWidth={2.5} style={{ color: "#15B981" }} />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            </div>
          </div>
        )}

        {existingInvites.length > 0 && (
          <>
            <div className="text-[13px] mb-2" style={{ color: "#979393" }}>
              Active invites
            </div>
            <div className="space-y-2 mb-2">
              {existingInvites.map((inv) => {
                const link = `${window.location.origin}${window.location.pathname}?clientInvite=${inv.token}`;
                return (
                  <div
                    key={inv.token}
                    className="flex items-center gap-3 rounded-lg p-3"
                    style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
                  >
                    <Avatar email={inv.clientEmail} size={6} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate">{inv.clientEmail}</div>
                      <div className="text-[11px]" style={{ color: "#979393" }}>
                        {inv.accepted
                          ? `Joined ${timeAgo(inv.acceptedAt || inv.ts)}`
                          : `Invited ${timeAgo(inv.ts)} · pending`}
                      </div>
                    </div>
                    <button
                      onClick={() => navigator.clipboard?.writeText(link)}
                      className="icon-btn"
                      title="Copy link"
                      style={{ width: 30, height: 30 }}
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Revoke access for ${inv.clientEmail}?`)) onRevoke(inv.token);
                      }}
                      className="icon-btn"
                      title="Revoke"
                      style={{ width: 30, height: 30, color: "#F87171" }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="btn-ghost">Done</button>
        </div>
      </div>
    </div>
  );
}
