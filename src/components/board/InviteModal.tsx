"use client";

import { useState } from "react";
import { Check, CheckCircle2, Copy, Mail, X } from "lucide-react";
import type { Client } from "@/types/stages";

type Props = {
  client: Client;
  onCreate: (email: string) => string;
  onClose: () => void;
};

export function InviteModal({ client, onCreate, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [generated, setGenerated] = useState<{ token: string; link: string; email: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const submit = () => {
    if (!email.includes("@")) return;
    const token = onCreate(email);
    setGenerated({
      token,
      link: `${window.location.origin}${window.location.pathname}?invite=${token}`,
      email,
    });
  };
  const copy = () => {
    if (!generated) return;
    navigator.clipboard?.writeText(generated.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div className="panel-card p-6 w-full max-w-md">
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[13px] text-zinc-400">Invite to {client.name}</div>
            <h2 className="text-xl font-semibold mt-1">Add a team member</h2>
          </div>
          <button onClick={onClose} className="icon-btn"><X size={14} /></button>
        </div>
        {!generated ? (
          <>
            <p className="text-[13px] text-zinc-500 mb-4 leading-relaxed">
              They&apos;ll get access to <span className="text-zinc-300">this client only</span> —
              not your other workspaces.
            </p>
            <label className="block mb-1.5">
              <span className="text-[13px] text-zinc-400">Their email</span>
            </label>
            <div className="relative mb-4">
              <Mail
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                autoFocus
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="teammate@company.com"
                className="field"
                style={{ paddingLeft: "40px" }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button
                onClick={submit}
                disabled={!email.includes("@")}
                className="btn-primary"
              >
                Generate Invite Link
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              className="rounded-lg p-3 mb-4 flex items-start gap-3"
              style={{ background: "#10B98115", border: "1px solid #10B98144" }}
            >
              <CheckCircle2
                size={16}
                className="text-emerald-400 flex-shrink-0 mt-0.5"
              />
              <div className="text-[13px] text-emerald-300 leading-relaxed">
                Invite created for <span className="font-semibold">{generated.email}</span>. Send
                them this link.
              </div>
            </div>
            <label className="block mb-1.5">
              <span className="text-[13px] text-zinc-400">Invite link</span>
            </label>
            <div className="flex gap-2 mb-4">
              <input
                readOnly
                value={generated.link}
                className="field text-[12px]"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={copy}
                className="btn-primary"
                style={{ minWidth: "90px", justifyContent: "center" }}
              >
                {copied ? (
                  <>
                    <Check size={13} strokeWidth={3} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Copy
                  </>
                )}
              </button>
            </div>
            <div className="text-[13px] text-zinc-500 leading-relaxed mb-4">
              In a real deployment this would be emailed automatically. For now, paste it into
              your email, Slack, or texts.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setGenerated(null);
                  setEmail("");
                }}
                className="btn-ghost"
              >
                Invite Another
              </button>
              <button onClick={onClose} className="btn-primary">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
