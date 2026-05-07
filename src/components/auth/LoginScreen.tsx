"use client";

import { useState } from "react";
import { AtSign } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";

type Props = {
  onLogin: (email: string, asOwner: boolean) => void;
};

export function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"owner" | "member">("owner");

  const submit = () => {
    if (!email.includes("@")) return;
    onLogin(email, mode === "owner");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in">
        <div className="flex items-center gap-3 mb-6">
          <StagesLogo size={40} />
          <div>
            <div className="text-base font-semibold">Stages</div>
            <div className="text-[13px] text-zinc-500">Client onboarding tracker</div>
          </div>
        </div>
        <h2 className="text-xl font-semibold mb-1">Sign in</h2>
        <p className="text-[13px] text-zinc-500 mb-5">
          Enter your email to access your client workspaces.
        </p>
        <div
          className="flex gap-1 p-1 mb-4 rounded-lg"
          style={{ background: "#1A1A1C", border: "1px solid #36363A" }}
        >
          <button
            onClick={() => setMode("owner")}
            className="flex-1 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              background: mode === "owner" ? "#36363A" : "transparent",
              color: mode === "owner" ? "#E4E4E7" : "#71717A",
            }}
          >
            Owner / Admin
          </button>
          <button
            onClick={() => setMode("member")}
            className="flex-1 py-2 rounded-md text-[13px] font-medium transition-colors"
            style={{
              background: mode === "member" ? "#36363A" : "transparent",
              color: mode === "member" ? "#E4E4E7" : "#71717A",
            }}
          >
            Team Member
          </button>
        </div>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Email</span>
        </label>
        <div className="relative mb-4">
          <AtSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="you@company.com"
            className="field"
            style={{ paddingLeft: "40px" }}
          />
        </div>
        <button
          onClick={submit}
          disabled={!email.includes("@")}
          className="btn-primary w-full justify-center"
        >
          Continue
        </button>
        <div className="mt-5 pt-4 border-t border-zinc-800 text-[12px] text-zinc-500 leading-relaxed">
          {mode === "owner"
            ? "As owner you can create clients, invite team, and manage everything."
            : "Team members only see clients they've been invited to. If you have an invite link, click it instead."}
        </div>
      </div>
    </div>
  );
}
